/*
  Warnings:

  - You are about to drop the column `code` on the `DisbursementTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `externalId` on the `DisbursementTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `DisbursementTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `referenceId` on the `DisbursementTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMethodName` on the `InternalBalanceLog` table. All the data in the column will be lost.
  - You are about to drop the column `providerName` on the `InternalBalanceLog` table. All the data in the column will be lost.
  - You are about to drop the column `code` on the `PurchaseTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `externalId` on the `PurchaseTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `nmid` on the `PurchaseTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `PurchaseTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `referenceId` on the `PurchaseTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `code` on the `TopUpTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `externalId` on the `TopUpTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `TopUpTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `reconciliationAt` on the `TopUpTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `referenceId` on the `TopUpTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `code` on the `WithdrawTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `externalId` on the `WithdrawTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `reconciliationAt` on the `WithdrawTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `referenceId` on the `WithdrawTransaction` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[systemReference]` on the table `DisbursementTransaction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[merchantReference]` on the table `DisbursementTransaction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerReference]` on the table `DisbursementTransaction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[systemReference]` on the table `PurchaseTransaction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[merchantReference]` on the table `PurchaseTransaction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerReference]` on the table `PurchaseTransaction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[systemReference]` on the table `TopUpTransaction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[systemReference]` on the table `WithdrawTransaction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerReference]` on the table `WithdrawTransaction` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `merchantReference` to the `DisbursementTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `providerReference` to the `DisbursementTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `systemReference` to the `DisbursementTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `merchantReference` to the `PurchaseTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `providerReference` to the `PurchaseTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `systemReference` to the `PurchaseTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `systemReference` to the `TopUpTransaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `systemReference` to the `WithdrawTransaction` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "DisbursementTransaction_code_key";

-- DropIndex
DROP INDEX "DisbursementTransaction_orderId_key";

-- DropIndex
DROP INDEX "PurchaseTransaction_code_key";

-- DropIndex
DROP INDEX "PurchaseTransaction_orderId_key";

-- DropIndex
DROP INDEX "TopUpTransaction_code_key";

-- DropIndex
DROP INDEX "TopUpTransaction_referenceId_idx";

-- DropIndex
DROP INDEX "TopUpTransaction_referenceId_key";

-- DropIndex
DROP INDEX "WithdrawTransaction_code_key";

-- DropIndex
DROP INDEX "WithdrawTransaction_referenceId_key";

-- AlterTable
ALTER TABLE "DisbursementTransaction" DROP COLUMN "code",
DROP COLUMN "externalId",
DROP COLUMN "orderId",
DROP COLUMN "referenceId",
ADD COLUMN     "additionalInfo" JSONB,
ADD COLUMN     "bankReference" TEXT,
ADD COLUMN     "batchReconciliationId" INTEGER,
ADD COLUMN     "batchSettlementId" INTEGER,
ADD COLUMN     "merchantReference" TEXT NOT NULL,
ADD COLUMN     "providerReference" TEXT NOT NULL,
ADD COLUMN     "settlementAt" TIMESTAMPTZ(6),
ADD COLUMN     "systemReference" TEXT NOT NULL,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "reconciliationAt" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "InternalBalanceLog" DROP COLUMN "paymentMethodName",
DROP COLUMN "providerName";

-- AlterTable
ALTER TABLE "PurchaseTransaction" DROP COLUMN "code",
DROP COLUMN "externalId",
DROP COLUMN "nmid",
DROP COLUMN "orderId",
DROP COLUMN "referenceId",
ADD COLUMN     "additionalInfo" JSONB,
ADD COLUMN     "bankReference" TEXT,
ADD COLUMN     "batchReconciliationId" INTEGER,
ADD COLUMN     "batchSettlementId" INTEGER,
ADD COLUMN     "merchantReference" TEXT NOT NULL,
ADD COLUMN     "providerReference" TEXT NOT NULL,
ADD COLUMN     "systemReference" TEXT NOT NULL,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "settlementAt" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "reconciliationAt" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "TopUpTransaction" DROP COLUMN "code",
DROP COLUMN "externalId",
DROP COLUMN "metadata",
DROP COLUMN "reconciliationAt",
DROP COLUMN "referenceId",
ADD COLUMN     "systemReference" TEXT NOT NULL,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "settlementAt" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "WithdrawTransaction" DROP COLUMN "code",
DROP COLUMN "externalId",
DROP COLUMN "reconciliationAt",
DROP COLUMN "referenceId",
ADD COLUMN     "additionalInfo" JSONB,
ADD COLUMN     "bankReference" TEXT,
ADD COLUMN     "providerReference" TEXT,
ADD COLUMN     "recipientAccount" TEXT,
ADD COLUMN     "recipientBankCode" TEXT,
ADD COLUMN     "recipientBankName" TEXT,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "settlementAt" TIMESTAMPTZ(6),
ADD COLUMN     "systemReference" TEXT NOT NULL,
ALTER COLUMN "status" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementTransaction_systemReference_key" ON "DisbursementTransaction"("systemReference");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementTransaction_merchantReference_key" ON "DisbursementTransaction"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementTransaction_providerReference_key" ON "DisbursementTransaction"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseTransaction_systemReference_key" ON "PurchaseTransaction"("systemReference");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseTransaction_merchantReference_key" ON "PurchaseTransaction"("merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseTransaction_providerReference_key" ON "PurchaseTransaction"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpTransaction_systemReference_key" ON "TopUpTransaction"("systemReference");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawTransaction_systemReference_key" ON "WithdrawTransaction"("systemReference");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawTransaction_providerReference_key" ON "WithdrawTransaction"("providerReference");
