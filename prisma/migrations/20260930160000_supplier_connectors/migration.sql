CREATE TYPE "SupplierFeedType" AS ENUM ('JSON', 'XML', 'CSV_URL', 'MANUAL_CSV');
CREATE TYPE "SupplierAuthType" AS ENUM ('NONE', 'BEARER', 'API_KEY_HEADER', 'BASIC');
CREATE TYPE "SupplierVatMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');

ALTER TABLE "Product" ADD COLUMN "pendingUnitPriceCents" INTEGER;
ALTER TABLE "Product" ADD COLUMN "priceChangeFlagged" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Supplier" ADD COLUMN "feedType" "SupplierFeedType" NOT NULL DEFAULT 'JSON';
ALTER TABLE "Supplier" ADD COLUMN "feedEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Supplier" ADD COLUMN "authType" "SupplierAuthType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "Supplier" ADD COLUMN "authHeaderName" TEXT NOT NULL DEFAULT 'X-Api-Key';
ALTER TABLE "Supplier" ADD COLUMN "authUsername" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Supplier" ADD COLUMN "vatMode" "SupplierVatMode" NOT NULL DEFAULT 'EXCLUSIVE';
ALTER TABLE "Supplier" ADD COLUMN "stockSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Supplier" ADD COLUMN "priceSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Supplier" ADD COLUMN "preference" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Supplier" ADD COLUMN "leadTimeDays" INTEGER;
ALTER TABLE "Supplier" ADD COLUMN "fieldMapping" JSONB;
ALTER TABLE "Supplier" ADD COLUMN "lastPriceSyncAt" TIMESTAMP(3);

UPDATE "Supplier" SET "feedEnabled" = true WHERE "stockFeedUrl" IS NOT NULL;
UPDATE "Supplier" SET "authType" = 'BEARER' WHERE "stockFeedKeyEncrypted" IS NOT NULL;

ALTER TABLE "SupplierPrice" ADD COLUMN "manufacturerPartNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierPrice" ADD COLUMN "offerName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierPrice" ADD COLUMN "brand" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierPrice" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierPrice" ADD COLUMN "specifications" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierPrice" ADD COLUMN "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SupplierPrice" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierPrice" ADD COLUMN "leadTimeDays" INTEGER;
ALTER TABLE "SupplierPrice" ADD COLUMN "costKnown" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SupplierPrice" ADD COLUMN "stockKnown" BOOLEAN NOT NULL DEFAULT true;
