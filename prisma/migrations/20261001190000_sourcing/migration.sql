ALTER TYPE "RfqStatus" ADD VALUE IF NOT EXISTS 'SOURCING';

ALTER TABLE "RfqLine" ADD COLUMN "sourcedName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RfqLine" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RfqLine" ADD COLUMN "matchGrade" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RfqLine" ADD COLUMN "costStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RfqLine" ADD COLUMN "stockNote" TEXT NOT NULL DEFAULT '';

ALTER TABLE "QuoteLine" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuoteLine" ADD COLUMN "sourceUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuoteLine" ADD COLUMN "sourceCheckedAt" TIMESTAMP(3);
ALTER TABLE "QuoteLine" ADD COLUMN "matchGrade" TEXT NOT NULL DEFAULT '';
ALTER TABLE "QuoteLine" ADD COLUMN "costStatus" TEXT NOT NULL DEFAULT '';

CREATE TABLE "ExternalSourceOffer" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL DEFAULT '',
  "sourceName" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "brand" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "sku" TEXT NOT NULL DEFAULT '',
  "mpn" TEXT NOT NULL DEFAULT '',
  "specifications" TEXT NOT NULL DEFAULT '',
  "listedPriceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "vatIncluded" BOOLEAN NOT NULL DEFAULT true,
  "shippingCents" INTEGER NOT NULL DEFAULT 0,
  "availability" TEXT NOT NULL DEFAULT '',
  "deliveryEstimate" TEXT NOT NULL DEFAULT '',
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
  "sourceType" TEXT NOT NULL DEFAULT 'RETAILER',
  "stockQty" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalSourceOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalSourceOffer_workspaceId_cacheKey_idx" ON "ExternalSourceOffer"("workspaceId", "cacheKey");
CREATE INDEX "ExternalSourceOffer_workspaceId_checkedAt_idx" ON "ExternalSourceOffer"("workspaceId", "checkedAt");

ALTER TABLE "ExternalSourceOffer" ADD CONSTRAINT "ExternalSourceOffer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
