CREATE TABLE "InboundMessageProcessing" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL DEFAULT '',
    "gmailMessageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL DEFAULT '',
    "processingStatus" TEXT NOT NULL DEFAULT 'CLAIMED',
    "decision" TEXT NOT NULL DEFAULT '',
    "autoReplyType" TEXT NOT NULL DEFAULT '',
    "autoReplySentAt" TIMESTAMP(3),
    "quoteId" TEXT NOT NULL DEFAULT '',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundMessageProcessing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundMessageProcessing_gmailMessageId_key" ON "InboundMessageProcessing"("gmailMessageId");

CREATE INDEX "InboundMessageProcessing_workspaceId_processingStatus_idx" ON "InboundMessageProcessing"("workspaceId", "processingStatus");

ALTER TABLE "InboundMessageProcessing" ADD CONSTRAINT "InboundMessageProcessing_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
