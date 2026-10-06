ALTER TABLE "InboundMessageProcessing" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InboundMessageProcessing" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "InboundMessageProcessing" ADD COLUMN IF NOT EXISTS "lastError" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "QuoteSendAttempt" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "quoteVersion" INTEGER NOT NULL DEFAULT 1,
  "rfqId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "gmailMessageId" TEXT NOT NULL DEFAULT '',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteSendAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "QuoteSendAttempt_idempotencyKey_key" ON "QuoteSendAttempt"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "QuoteSendAttempt_rfqId_idx" ON "QuoteSendAttempt"("rfqId");
CREATE INDEX IF NOT EXISTS "QuoteSendAttempt_quoteId_idx" ON "QuoteSendAttempt"("quoteId");
ALTER TABLE "QuoteSendAttempt" DROP CONSTRAINT IF EXISTS "QuoteSendAttempt_quoteId_fkey";
ALTER TABLE "QuoteSendAttempt" ADD CONSTRAINT "QuoteSendAttempt_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteSendAttempt" DROP CONSTRAINT IF EXISTS "QuoteSendAttempt_rfqId_fkey";
ALTER TABLE "QuoteSendAttempt" ADD CONSTRAINT "QuoteSendAttempt_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq"("id") ON DELETE CASCADE ON UPDATE CASCADE;
