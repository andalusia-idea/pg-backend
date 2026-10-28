-- DropIndex
DROP INDEX "PurchaseTransaction_merchantReference_key";

-- AlterTable
ALTER TABLE "PurchaseTransaction" ALTER COLUMN "expiresAt" DROP NOT NULL,
ALTER COLUMN "providerReference" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseTransaction_merchantId_merchantReference_key" ON "PurchaseTransaction"("merchantId", "merchantReference");

