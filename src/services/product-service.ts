import { Prisma } from "../generated/prisma/client";
import { getDb, isUniqueViolation } from "../lib/db";
import { AppError } from "../lib/errors";
import { parseMoneyToCents } from "../lib/quote";
import { parseProductImageUrls } from "../lib/stock";
import type { ProductInput } from "../lib/validators";
import { recordActivity } from "./activity-service";
import type { Actor } from "./types";

function price(input: ProductInput) {
  const cents = parseMoneyToCents(input.unitPrice);
  if (cents === null) throw new AppError("Enter a unit price in rands, such as 1299.50.");
  return cents;
}

function images(input: ProductInput) {
  try {
    return parseProductImageUrls(input.imageUrls);
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : "Enter public https image addresses.");
  }
}

export async function listProducts(workspaceId: string) {
  return getDb().product.findMany({
    where: { workspaceId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function getProduct(workspaceId: string, id: string) {
  return getDb().product.findFirst({ where: { id, workspaceId } });
}

export async function createProduct(actor: Actor, input: ProductInput) {
  try {
    return await getDb().$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          workspaceId: actor.workspaceId,
          sku: input.sku,
          name: input.name,
          description: input.description,
          specifications: input.specifications,
          imageUrls: images(input),
          unitPriceCents: price(input),
          active: input.active === "true",
        },
      });
      await recordActivity(tx, {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        type: "PRODUCT_CREATED",
        summary: `Added product ${product.sku}.`,
      });
      return product;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("A product with this SKU already exists in this workspace.");
    throw error;
  }
}

export async function updateProduct(actor: Actor, id: string, input: ProductInput) {
  const current = await getProduct(actor.workspaceId, id);
  if (!current) throw new AppError("Product not found.", 404, "NOT_FOUND");
  try {
    return await getDb().product.update({
      where: { id: current.id },
      data: {
        sku: input.sku,
        name: input.name,
        description: input.description,
        specifications: input.specifications,
        imageUrls: images(input),
        unitPriceCents: price(input),
        active: input.active === "true",
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("A product with this SKU already exists in this workspace.");
    throw error;
  }
}

export function centsToInput(cents: number) {
  return new Prisma.Decimal(cents).dividedBy(100).toFixed(2);
}
