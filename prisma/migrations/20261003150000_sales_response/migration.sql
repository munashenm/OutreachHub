ALTER TABLE "Workspace" ADD COLUMN "followUpAfterDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Workspace" ADD COLUMN "followUpLimit" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "Rfq" ADD COLUMN "enquiryJson" JSONB;
ALTER TABLE "Rfq" ADD COLUMN "lostReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Rfq" ADD COLUMN "respondedAt" TIMESTAMP(3);

ALTER TABLE "Quote" ADD COLUMN "confidenceScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "followUpCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "followUpStoppedReason" TEXT NOT NULL DEFAULT '';

CREATE TABLE "SalesFunnelEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rfqId" TEXT,
    "stage" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "valueCents" INTEGER NOT NULL DEFAULT 0,
    "marginPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesFunnelEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourcingTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourcingTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesFunnelEvent_workspaceId_stage_idx" ON "SalesFunnelEvent"("workspaceId", "stage");
CREATE INDEX "SalesFunnelEvent_rfqId_stage_idx" ON "SalesFunnelEvent"("rfqId", "stage");
CREATE UNIQUE INDEX "SourcingTask_rfqId_requirement_key" ON "SourcingTask"("rfqId", "requirement");
CREATE INDEX "SourcingTask_workspaceId_status_idx" ON "SourcingTask"("workspaceId", "status");

ALTER TABLE "SalesFunnelEvent" ADD CONSTRAINT "SalesFunnelEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesFunnelEvent" ADD CONSTRAINT "SalesFunnelEvent_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourcingTask" ADD CONSTRAINT "SourcingTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourcingTask" ADD CONSTRAINT "SourcingTask_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
