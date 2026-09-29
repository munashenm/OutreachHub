ALTER TYPE "ActivityType" ADD VALUE 'SUPPLIER_IMPORTED';

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierPrice" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierSku" TEXT NOT NULL,
  "costCents" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierPrice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Supplier_workspaceId_idx" ON "Supplier"("workspaceId");
CREATE UNIQUE INDEX "SupplierPrice_supplierId_productId_key" ON "SupplierPrice"("supplierId", "productId");
CREATE INDEX "SupplierPrice_workspaceId_idx" ON "SupplierPrice"("workspaceId");
CREATE INDEX "SupplierPrice_productId_idx" ON "SupplierPrice"("productId");

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
