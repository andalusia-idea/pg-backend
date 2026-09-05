-- AlterTable
ALTER TABLE "TopUpTransaction" ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "TransactionAudit" ALTER COLUMN "changedAt" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "WebhookLog" ALTER COLUMN "receivedAt" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "WithdrawTransaction" ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(6);

