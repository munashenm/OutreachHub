ALTER TABLE "SupplierFeedItem" ADD COLUMN "barcode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierFeedItem" ADD COLUMN "productUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierFeedItem" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE TYPE "SupplierImportStatus" AS ENUM ('COMPLETED', 'FAILED');

CREATE TABLE "SupplierImport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "status" "SupplierImportStatus" NOT NULL,
    "errorMessage" TEXT NOT NULL DEFAULT '',
    "rejections" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "SupplierImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierImport_workspaceId_idx" ON "SupplierImport"("workspaceId");
CREATE INDEX "SupplierImport_supplierId_uploadedAt_idx" ON "SupplierImport"("supplierId", "uploadedAt");

ALTER TABLE "SupplierImport" ADD CONSTRAINT "SupplierImport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
