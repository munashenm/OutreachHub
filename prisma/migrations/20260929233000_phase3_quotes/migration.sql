ALTER TYPE "ActivityType" ADD VALUE 'PRODUCT_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'QUOTE_SENT';

CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT');

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "unitPriceCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Quote" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "rfqId" TEXT NOT NULL,
  "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuoteLine" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(12,2) NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_workspaceId_sku_key" ON "Product"("workspaceId", "sku");
CREATE INDEX "Product_workspaceId_active_idx" ON "Product"("workspaceId", "active");
CREATE INDEX "Quote_workspaceId_rfqId_idx" ON "Quote"("workspaceId", "rfqId");
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");
CREATE INDEX "QuoteLine_workspaceId_idx" ON "QuoteLine"("workspaceId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
