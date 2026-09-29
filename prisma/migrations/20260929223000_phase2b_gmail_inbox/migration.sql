ALTER TYPE "ActivityType" ADD VALUE 'RFQ_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'INBOX_UPDATED';

CREATE TYPE "MailboxConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT');
CREATE TYPE "InboxCategory" AS ENUM ('NEW_ENQUIRY', 'RFQ', 'PRICING_REQUEST', 'PRODUCT_ENQUIRY', 'ORDER_ENQUIRY', 'SUPPORT', 'CAMPAIGN_REPLY', 'OTHER');
CREATE TYPE "RfqStatus" AS ENUM ('NEW', 'REVIEWING', 'NEEDS_INFORMATION', 'READY_TO_QUOTE', 'QUOTE_PREPARED', 'QUOTE_SENT', 'WON', 'LOST');

ALTER TABLE "Mailbox" ADD COLUMN "connectionStatus" "MailboxConnectionStatus" NOT NULL DEFAULT 'CONNECTED';
ALTER TABLE "Mailbox" ADD COLUMN "historyId" TEXT;
ALTER TABLE "Mailbox" ADD COLUMN "lastSyncAt" TIMESTAMP(3);
ALTER TABLE "Mailbox" ADD COLUMN "lastError" TEXT;
ALTER TABLE "Mailbox" ADD COLUMN "lastSuccessfulSendAt" TIMESTAMP(3);
ALTER TABLE "Mailbox" ADD COLUMN "lastInboundSyncAt" TIMESTAMP(3);

ALTER TABLE "EmailTemplate" ADD COLUMN "htmlBody" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Message" ADD COLUMN "snippet" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Message" ADD COLUMN "fromEmail" TEXT;
ALTER TABLE "Message" ADD COLUMN "fromName" TEXT;
ALTER TABLE "Message" ADD COLUMN "internetMessageId" TEXT;
ALTER TABLE "Message" ADD COLUMN "category" "InboxCategory";
ALTER TABLE "Message" ADD COLUMN "ignored" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX "Message_externalId_idx";
CREATE UNIQUE INDEX "Message_workspaceId_externalId_key" ON "Message"("workspaceId", "externalId");
CREATE INDEX "Message_workspaceId_threadId_idx" ON "Message"("workspaceId", "threadId");

CREATE TABLE "Rfq" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "prospectId" TEXT,
  "companyId" TEXT,
  "sourceMessageId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "status" "RfqStatus" NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Rfq" ADD CONSTRAINT "Rfq_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Rfq_workspaceId_status_idx" ON "Rfq"("workspaceId", "status");
CREATE INDEX "Rfq_workspaceId_createdAt_idx" ON "Rfq"("workspaceId", "createdAt");
CREATE INDEX "Rfq_sourceMessageId_idx" ON "Rfq"("sourceMessageId");
