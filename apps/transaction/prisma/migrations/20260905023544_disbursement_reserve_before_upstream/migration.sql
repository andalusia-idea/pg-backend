-- DropIndex
DROP INDEX "DisbursementTransaction_merchantReference_key";

-- AlterTable
ALTER TABLE "DisbursementTransaction" ALTER COLUMN "providerReference" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "DisbursementTransaction_merchantId_idx" ON "DisbursementTransaction"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementTransaction_merchantId_merchantReference_key" ON "DisbursementTransaction"("merchantId", "merchantReference");

