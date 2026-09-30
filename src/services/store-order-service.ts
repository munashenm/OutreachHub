import { getDb, isUniqueViolation } from "../lib/db";
import { AppError } from "../lib/errors";
import { parseStoreOrders } from "../lib/store-order";
import { recordActivity } from "./activity-service";
import { createProspect } from "./prospect-service";
import { fetchStoreOrders, queueStockForWebsite } from "./stock-sync-service";
import type { Actor } from "./types";

export async function getStoreOrder(workspaceId: string, id: string) {
  return getDb().storeOrder.findFirst({
    where: { id, workspaceId },
    include: {
      prospect: { select: { id: true, firstName: true, lastName: true } },
      lines: { orderBy: { sku: "asc" }, include: { product: { select: { id: true, sku: true, name: true } } } },
    },
  });
}

export async function listStoreOrders(workspaceId: string) {
  return getDb().storeOrder.findMany({
    where: { workspaceId },
    include: { prospect: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { placedAt: "desc" },
    take: 100,
  });
}

export async function pullStoreOrders(actor: Actor) {
  const body = await fetchStoreOrders(actor.workspaceId);
  const parsed = parseStoreOrders(body);
  if (parsed.error) throw new AppError(parsed.error);
  const emails = [...new Set(parsed.orders.map((order) => order.email))];
  const prospects = await getDb().prospect.findMany({
    where: { workspaceId: actor.workspaceId, email: { in: emails } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(prospects.map((prospect) => [prospect.email, prospect.id]));
  const products = await getDb().product.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { id: true, sku: true },
  });
  const bySku = new Map(products.map((product) => [product.sku.toLowerCase(), product.id]));
  const supplierSkus = await getDb().supplierPrice.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { productId: true, supplierSku: true },
  });
  for (const link of supplierSkus) bySku.set(link.supplierSku.toLowerCase(), link.productId);
  const touched = new Set<string>();
  let created = 0;
  let matched = 0;
  for (const order of parsed.orders) {
    const prospectId = byEmail.get(order.email) ?? null;
    if (prospectId) matched += 1;
    const lineData = order.lines.map((line) => {
      const productId = bySku.get(line.sku.toLowerCase()) ?? null;
      if (productId) touched.add(productId);
      return { workspaceId: actor.workspaceId, productId, sku: line.sku, quantity: line.quantity };
    });
    const existing = await getDb().storeOrder.findFirst({
      where: { workspaceId: actor.workspaceId, externalId: order.externalId },
      select: { id: true, prospectId: true, lines: { select: { productId: true } } },
    });
    for (const line of existing?.lines ?? []) {
      if (line.productId) touched.add(line.productId);
    }
    const { lines: _lines, ...header } = order;
    if (existing) {
      await getDb().storeOrderLine.deleteMany({ where: { orderId: existing.id, workspaceId: actor.workspaceId } });
      await getDb().storeOrder.update({
        where: { id: existing.id },
        data: {
          status: header.status,
          totalCents: header.totalCents,
          summary: header.summary,
          prospectId: existing.prospectId ?? prospectId,
          lines: { create: lineData },
        },
      });
      continue;
    }
    await getDb().storeOrder.create({
      data: { workspaceId: actor.workspaceId, ...header, prospectId, lines: { create: lineData } },
    });
    created += 1;
  }
  await queueStockForWebsite(getDb(), actor.workspaceId, [...touched]);
  if (created > 0) {
    await recordActivity(getDb(), {
      workspaceId: actor.workspaceId,
      actorId: actor.userId === "system" ? null : actor.userId,
      type: "STORE_ORDERS_IMPORTED",
      summary: `Imported ${created} website orders.`,
    });
  }
  return { created, matched, skipped: parsed.skipped };
}

export async function createProspectFromOrder(actor: Actor, orderId: string) {
  const order = await getDb().storeOrder.findFirst({ where: { id: orderId, workspaceId: actor.workspaceId } });
  if (!order) throw new AppError("Order not found.", 404, "NOT_FOUND");
  if (order.prospectId) return order.prospectId;
  const existing = await getDb().prospect.findFirst({
    where: { workspaceId: actor.workspaceId, email: order.email },
    select: { id: true },
  });
  let prospectId = existing?.id;
  if (!prospectId) {
    const [first, ...rest] = order.customerName.split(" ").filter(Boolean);
    try {
      const prospect = await createProspect(actor, {
        firstName: first || "Customer",
        lastName: rest.join(" ") || "Website",
        jobTitle: null,
        email: order.email,
        phone: null,
        companyId: null,
        newCompanyName: order.companyName || null,
        website: null,
        industry: null,
        country: null,
        province: null,
        city: null,
        source: "website",
        linkedinUrl: null,
        notes: `Website order ${order.number}. ${order.summary}`.trim(),
        leadStatus: "NEW",
        marketingStatus: "UNKNOWN",
      });
      prospectId = prospect.id;
    } catch (error) {
      if (!isUniqueViolation(error) && !(error instanceof AppError)) throw error;
      const again = await getDb().prospect.findFirst({
        where: { workspaceId: actor.workspaceId, email: order.email },
        select: { id: true },
      });
      if (!again) throw error;
      prospectId = again.id;
    }
  }
  await getDb().storeOrder.update({ where: { id: order.id }, data: { prospectId } });
  return prospectId;
}

export async function pullAllStoreOrders() {
  const workspaces = await getDb().workspace.findMany({
    where: { storeName: { not: null }, storePublicUrl: { not: null }, storeBaseUrl: { not: null }, storeKeyEncrypted: { not: null } },
    select: { id: true },
  });
  const results = [];
  for (const workspace of workspaces) {
    try {
      results.push({ workspaceId: workspace.id, ...(await pullStoreOrders({ userId: "system", workspaceId: workspace.id })) });
    } catch (error) {
      results.push({ workspaceId: workspace.id, error: error instanceof Error ? error.message : "Order sync failed." });
    }
  }
  return results;
}
