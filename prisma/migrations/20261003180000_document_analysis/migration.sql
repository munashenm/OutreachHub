ALTER TABLE "QuoteLine" ADD COLUMN "scheduleNumber" TEXT NOT NULL DEFAULT '';

CREATE TABLE "StoredAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TenderAnalysis" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "attachmentId" TEXT,
    "documentType" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL DEFAULT '',
    "responseMode" TEXT NOT NULL DEFAULT '',
    "analysis" JSONB NOT NULL,
    "approvedById" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenderAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentEdit" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL DEFAULT '',
    "field" TEXT NOT NULL,
    "previousValue" TEXT NOT NULL DEFAULT '',
    "nextValue" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoredAttachment_workspaceId_messageId_idx" ON "StoredAttachment"("workspaceId", "messageId");
CREATE INDEX "TenderAnalysis_workspaceId_rfqId_idx" ON "TenderAnalysis"("workspaceId", "rfqId");
CREATE INDEX "TenderAnalysis_referenceNumber_idx" ON "TenderAnalysis"("referenceNumber");
CREATE INDEX "DocumentEdit_analysisId_idx" ON "DocumentEdit"("analysisId");

ALTER TABLE "StoredAttachment" ADD CONSTRAINT "StoredAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredAttachment" ADD CONSTRAINT "StoredAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderAnalysis" ADD CONSTRAINT "TenderAnalysis_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderAnalysis" ADD CONSTRAINT "TenderAnalysis_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderAnalysis" ADD CONSTRAINT "TenderAnalysis_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "StoredAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentEdit" ADD CONSTRAINT "DocumentEdit_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "TenderAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
