ALTER TYPE "ActivityType" ADD VALUE 'STORE_ORDERS_IMPORTED';

CREATE TABLE "StoreOrder" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "companyName" TEXT NOT NULL DEFAULT '',
  "totalCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "summary" TEXT NOT NULL DEFAULT '',
  "placedAt" TIMESTAMP(3) NOT NULL,
  "prospectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreOrder_workspaceId_externalId_key" ON "StoreOrder"("workspaceId", "externalId");
CREATE INDEX "StoreOrder_workspaceId_placedAt_idx" ON "StoreOrder"("workspaceId", "placedAt");

ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;
