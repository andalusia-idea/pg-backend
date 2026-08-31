-- DropIndex
DROP INDEX "BaseFee_code_key";

-- AlterTable
ALTER TABLE "BaseFee" DROP COLUMN "code";

-- CreateIndex
CREATE UNIQUE INDEX "BaseFee_providerName_paymentMethodName_transactionType_key" ON "BaseFee"("providerName", "paymentMethodName", "transactionType");

