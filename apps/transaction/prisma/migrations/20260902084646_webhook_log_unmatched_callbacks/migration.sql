-- AlterTable
ALTER TABLE "WebhookLog" ADD COLUMN     "providerReference" TEXT,
ALTER COLUMN "transactionId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "WebhookLog_providerReference_idx" ON "WebhookLog"("providerReference");

