ALTER TABLE "Product" ADD COLUMN "manufacturerPartNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "brand" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "storeProductId" TEXT;

CREATE UNIQUE INDEX "Product_workspaceId_storeProductId_key" ON "Product"("workspaceId", "storeProductId") WHERE "storeProductId" IS NOT NULL;
CREATE UNIQUE INDEX "Product_workspaceId_mpn_key" ON "Product"("workspaceId", lower("manufacturerPartNumber")) WHERE "manufacturerPartNumber" <> '';
CREATE UNIQUE INDEX "Product_workspaceId_barcode_key" ON "Product"("workspaceId", lower("barcode")) WHERE "barcode" <> '';

CREATE TABLE "StoreCatalogueScan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "page" INTEGER NOT NULL DEFAULT 1,
    "perPage" INTEGER NOT NULL DEFAULT 100,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "stats" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    CONSTRAINT "StoreCatalogueScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreCatalogueItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "storeProductId" TEXT NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "skuKey" TEXT NOT NULL DEFAULT '',
    "manufacturerPartNumber" TEXT NOT NULL DEFAULT '',
    "mpnKey" TEXT NOT NULL DEFAULT '',
    "barcode" TEXT NOT NULL DEFAULT '',
    "barcodeKey" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "brandModelKey" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "unitPriceCents" INTEGER NOT NULL,
    "salePriceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "stockStatus" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "specifications" TEXT NOT NULL DEFAULT '',
    "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "storeUpdatedAt" TIMESTAMP(3),
    "reviewStatus" TEXT NOT NULL DEFAULT 'BASELINE',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "duplicateKinds" TEXT NOT NULL DEFAULT '',
    "mergedIntoStoreProductId" TEXT NOT NULL DEFAULT '',
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreCatalogueItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogueAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "storeProductId" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogueAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreCatalogueScan_workspaceId_status_idx" ON "StoreCatalogueScan"("workspaceId", "status");
CREATE UNIQUE INDEX "StoreCatalogueItem_workspaceId_storeProductId_key" ON "StoreCatalogueItem"("workspaceId", "storeProductId");
CREATE INDEX "StoreCatalogueItem_workspaceId_skuKey_idx" ON "StoreCatalogueItem"("workspaceId", "skuKey");
CREATE INDEX "StoreCatalogueItem_workspaceId_mpnKey_idx" ON "StoreCatalogueItem"("workspaceId", "mpnKey");
CREATE INDEX "StoreCatalogueItem_workspaceId_barcodeKey_idx" ON "StoreCatalogueItem"("workspaceId", "barcodeKey");
CREATE INDEX "StoreCatalogueItem_workspaceId_brandModelKey_idx" ON "StoreCatalogueItem"("workspaceId", "brandModelKey");
CREATE INDEX "StoreCatalogueItem_scanId_idx" ON "StoreCatalogueItem"("scanId");
CREATE INDEX "StoreCatalogueItem_productId_idx" ON "StoreCatalogueItem"("productId");
CREATE INDEX "CatalogueAudit_workspaceId_createdAt_idx" ON "CatalogueAudit"("workspaceId", "createdAt");

ALTER TABLE "StoreCatalogueScan" ADD CONSTRAINT "StoreCatalogueScan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCatalogueItem" ADD CONSTRAINT "StoreCatalogueItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCatalogueItem" ADD CONSTRAINT "StoreCatalogueItem_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "StoreCatalogueScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCatalogueItem" ADD CONSTRAINT "StoreCatalogueItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CatalogueAudit" ADD CONSTRAINT "CatalogueAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
