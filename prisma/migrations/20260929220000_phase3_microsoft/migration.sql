CREATE TYPE "MailboxProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

ALTER TABLE "Mailbox" ADD COLUMN "provider" "MailboxProvider" NOT NULL DEFAULT 'GOOGLE';

DROP INDEX "Mailbox_workspaceId_email_key";

CREATE UNIQUE INDEX "Mailbox_workspaceId_provider_email_key" ON "Mailbox"("workspaceId", "provider", "email");
