import { Prisma } from "../generated/prisma/client";
import { getDb } from "../lib/db";
import { AppError } from "../lib/errors";
import { findSupplierItem, type ImportRejection, type SupplierIdentity } from "../lib/supplier-file";
import { readFieldMapping, type SupplierFieldMapping, type SupplierOffer } from "../lib/supplier-connector";
import { recordActivity } from "./activity-service";
import { saveSupplierOffers } from "./stock-sync-service";
import type { Actor } from "./types";

export async function recordSupplierImport(
  actor: Actor,
  supplierId: string,
  input: {
    filename: string;
    offers: SupplierOffer[];
    rejections: ImportRejection[];
    rowsRead: number;
    mapping: SupplierFieldMapping;
  },
) {
  const db = getDb();
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, workspaceId: actor.workspaceId },
    select: { id: true, name: true, stockFeedUrl: true, fieldMapping: true },
  });
  if (!supplier) throw new AppError("Supplier not found.", 404, "NOT_FOUND");
  const existing = await db.supplierFeedItem.findMany({
    where: { supplierId: supplier.id },
    select: { id: true, supplierSku: true, manufacturerPartNumber: true, barcode: true },
  });
  const known: SupplierIdentity[] = existing.map((item) => ({ ...item }));
  let rowsCreated = 0;
  let rowsUpdated = 0;
  for (const offer of input.offers) {
    const found = findSupplierItem(known, offer);
    if (found) {
      rowsUpdated += 1;
      found.supplierSku = offer.supplierSku || found.supplierSku;
      found.manufacturerPartNumber = offer.manufacturerPartNumber || found.manufacturerPartNumber;
      found.barcode = offer.barcode || found.barcode;
    } else {
      rowsCreated += 1;
      known.push({
        id: "",
        supplierSku: offer.supplierSku,
        manufacturerPartNumber: offer.manufacturerPartNumber,
        barcode: offer.barcode ?? "",
      });
    }
  }
  if (input.offers.length > 0) {
    await saveSupplierOffers(actor, supplier.id, input.offers, {
      applyPrice: false,
      applyStock: input.offers.some((offer) => offer.stockQty !== null),
      preserveMissing: true,
    });
  }
  const now = new Date();
  const savedMapping = { ...readFieldMapping(supplier.fieldMapping), ...input.mapping };
  if (rowsCreated + rowsUpdated > 0) {
    await db.supplier.update({
      where: { id: supplier.id },
      data: {
        feedEnabled: true,
        ...(supplier.stockFeedUrl ? {} : { feedType: "MANUAL_CSV" }),
        fieldMapping: Object.keys(savedMapping).length === 0 ? Prisma.JsonNull : savedMapping,
        lastStockSyncAt: now,
        lastPriceSyncAt: now,
        lastStockSyncError: null,
      },
    });
  }
  const history = await db.supplierImport.create({
    data: {
      workspaceId: actor.workspaceId,
      supplierId: supplier.id,
      filename: input.filename.slice(0, 200),
      rowsRead: input.rowsRead,
      rowsCreated,
      rowsUpdated,
      rowsRejected: input.rejections.length,
      status: "COMPLETED",
      rejections: input.rejections.slice(0, 500) as unknown as Prisma.InputJsonValue,
    },
  });
  if (rowsCreated + rowsUpdated > 0) {
    await recordActivity(db, {
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      type: "SUPPLIER_IMPORTED",
      summary: `Imported ${rowsCreated + rowsUpdated} supplier rows for ${supplier.name}.`,
    });
  }
  return { id: history.id, rowsRead: input.rowsRead, rowsCreated, rowsUpdated, rowsRejected: input.rejections.length };
}
