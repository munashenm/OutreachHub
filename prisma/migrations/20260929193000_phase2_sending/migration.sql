-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'EMAIL_SENT';
ALTER TYPE "ActivityType" ADD VALUE 'EMAIL_FAILED';
ALTER TYPE "ActivityType" ADD VALUE 'REPLY_RECEIVED';
ALTER TYPE "ActivityType" ADD VALUE 'TEMPLATE_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'TEMPLATE_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'MAILBOX_CONNECTED';
ALTER TYPE "ActivityType" ADD VALUE 'MAILBOX_DISCONNECTED';

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "mailboxId" TEXT,
ADD COLUMN "templateId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
ADD COLUMN "subject" TEXT NOT NULL DEFAULT '',
ADD COLUMN "body" TEXT NOT NULL DEFAULT '',
ADD COLUMN "error" TEXT,
ADD COLUMN "externalId" TEXT,
ADD COLUMN "threadId" TEXT,
ADD COLUMN "sentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Mailbox_workspaceId_idx" ON "Mailbox"("workspaceId");
CREATE UNIQUE INDEX "Mailbox_workspaceId_email_key" ON "Mailbox"("workspaceId", "email");
CREATE INDEX "EmailTemplate_workspaceId_idx" ON "EmailTemplate"("workspaceId");
CREATE INDEX "Message_workspaceId_direction_status_idx" ON "Message"("workspaceId", "direction", "status");
CREATE INDEX "Message_workspaceId_createdAt_idx" ON "Message"("workspaceId", "createdAt");
CREATE INDEX "Message_externalId_idx" ON "Message"("externalId");
CREATE INDEX "Message_campaignId_prospectId_idx" ON "Message"("campaignId", "prospectId");

-- DropIndex
DROP INDEX "Message_workspaceId_direction_idx";

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
