ALTER TYPE "RfqStatus" ADD VALUE IF NOT EXISTS 'NEGOTIATION';

ALTER TABLE "Workspace" ADD COLUMN "autoQuoteMarginPercent" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Workspace" ADD COLUMN "autoSendMarginPercent" INTEGER NOT NULL DEFAULT 25;

ALTER TABLE "Message" ADD COLUMN "automationAt" TIMESTAMP(3);

ALTER TABLE "Rfq" ADD COLUMN "customerReference" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Rfq" ADD COLUMN "deliveryLocation" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Rfq" ADD COLUMN "requiredDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Rfq" ADD COLUMN "acknowledgementSentAt" TIMESTAMP(3);
ALTER TABLE "Rfq" ADD COLUMN "automationNote" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Product" ADD COLUMN "categoryName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "seoTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "metaDescription" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Supplier" ADD COLUMN "catalogueSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Supplier" ADD COLUMN "lastCatalogueSyncAt" TIMESTAMP(3);

CREATE TABLE "RfqLine" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2),
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "modelName" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "manufacturerPartNumber" TEXT NOT NULL DEFAULT '',
    "specifications" TEXT NOT NULL DEFAULT '',
    "matchStatus" TEXT NOT NULL DEFAULT 'NEEDS_PRODUCT_REVIEW',
    "matchNote" TEXT NOT NULL DEFAULT '',
    "productId" TEXT,
    "storeProductId" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "RfqLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RfqLine_workspaceId_idx" ON "RfqLine"("workspaceId");
CREATE INDEX "RfqLine_rfqId_idx" ON "RfqLine"("rfqId");
CREATE INDEX "RfqLine_productId_idx" ON "RfqLine"("productId");

ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RfqLine" ADD CONSTRAINT "RfqLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
