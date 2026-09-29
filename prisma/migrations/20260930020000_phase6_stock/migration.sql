ALTER TYPE "ActivityType" ADD VALUE 'STOCK_SYNCED';

ALTER TABLE "Workspace" ADD COLUMN "storeBaseUrl" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "storeKeyEncrypted" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "storeSecretEncrypted" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "storeLastSyncAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "storeLastError" TEXT;

ALTER TABLE "Product" ADD COLUMN "stockOnHand" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Supplier" ADD COLUMN "markupPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Supplier" ADD COLUMN "stockFeedUrl" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "stockFeedKeyEncrypted" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "lastStockSyncAt" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "lastStockSyncError" TEXT;

ALTER TABLE "SupplierPrice" ADD COLUMN "stockQty" INTEGER NOT NULL DEFAULT 0;
