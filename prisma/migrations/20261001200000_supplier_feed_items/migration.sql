CREATE TABLE "SupplierFeedItem" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierSku" TEXT NOT NULL,
  "manufacturerPartNumber" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "specifications" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT '',
  "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "leadTimeDays" INTEGER,
  "costCents" INTEGER NOT NULL DEFAULT 0,
  "costKnown" BOOLEAN NOT NULL DEFAULT false,
  "stockQty" INTEGER NOT NULL DEFAULT 0,
  "stockKnown" BOOLEAN NOT NULL DEFAULT false,
  "productId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierFeedItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierFeedItem_supplierId_supplierSku_key" ON "SupplierFeedItem"("supplierId", "supplierSku");
CREATE INDEX "SupplierFeedItem_workspaceId_idx" ON "SupplierFeedItem"("workspaceId");
CREATE INDEX "SupplierFeedItem_productId_idx" ON "SupplierFeedItem"("productId");

ALTER TABLE "SupplierFeedItem" ADD CONSTRAINT "SupplierFeedItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierFeedItem" ADD CONSTRAINT "SupplierFeedItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
