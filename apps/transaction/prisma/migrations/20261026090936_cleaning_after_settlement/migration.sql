/*
  Warnings:

  - The values [SETTLEMENT_PURCHASE] on the enum `TransactionTypeEnum` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `batchReconciliationId` on the `DisbursementTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `reconciliationAt` on the `DisbursementTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `batchReconciliationId` on the `PurchaseTransaction` table. All the data in the column will be lost.
  - You are about to drop the column `reconciliationAt` on the `PurchaseTransaction` table. All the data in the column will be lost.
  - You are about to drop the `AgentBalanceLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `InternalBalanceLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MerchantBalanceLog` table. If the table is not empty, all the data it contains will be lost.

*/


-- DropForeignKey
ALTER TABLE "AgentBalanceLog" DROP CONSTRAINT "AgentBalanceLog_disbursementId_fkey";

-- DropForeignKey
ALTER TABLE "AgentBalanceLog" DROP CONSTRAINT "AgentBalanceLog_purchaseId_fkey";

-- DropForeignKey
ALTER TABLE "AgentBalanceLog" DROP CONSTRAINT "AgentBalanceLog_topupId_fkey";

-- DropForeignKey
ALTER TABLE "AgentBalanceLog" DROP CONSTRAINT "AgentBalanceLog_withdrawId_fkey";

-- DropForeignKey
ALTER TABLE "InternalBalanceLog" DROP CONSTRAINT "InternalBalanceLog_disbursementId_fkey";

-- DropForeignKey
ALTER TABLE "InternalBalanceLog" DROP CONSTRAINT "InternalBalanceLog_purchaseId_fkey";

-- DropForeignKey
ALTER TABLE "InternalBalanceLog" DROP CONSTRAINT "InternalBalanceLog_topupId_fkey";

-- DropForeignKey
ALTER TABLE "InternalBalanceLog" DROP CONSTRAINT "InternalBalanceLog_withdrawId_fkey";

-- DropForeignKey
ALTER TABLE "MerchantBalanceLog" DROP CONSTRAINT "MerchantBalanceLog_disbursementId_fkey";

-- DropForeignKey
ALTER TABLE "MerchantBalanceLog" DROP CONSTRAINT "MerchantBalanceLog_purchaseId_fkey";

-- DropForeignKey
ALTER TABLE "MerchantBalanceLog" DROP CONSTRAINT "MerchantBalanceLog_topupId_fkey";

-- DropForeignKey
ALTER TABLE "MerchantBalanceLog" DROP CONSTRAINT "MerchantBalanceLog_withdrawId_fkey";

-- AlterTable
ALTER TABLE "DisbursementTransaction" DROP COLUMN "batchReconciliationId",
DROP COLUMN "reconciliationAt";

-- AlterTable
ALTER TABLE "PurchaseTransaction" DROP COLUMN "batchReconciliationId",
DROP COLUMN "reconciliationAt";

-- DropTable
DROP TABLE "AgentBalanceLog";

-- DropTable
DROP TABLE "InternalBalanceLog";

-- DropTable
DROP TABLE "MerchantBalanceLog";

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionTypeEnum_new" AS ENUM ('WITHDRAW', 'TOPUP', 'DISBURSEMENT', 'PURCHASE');
ALTER TABLE "WebhookLog" ALTER COLUMN "transactionType" TYPE "TransactionTypeEnum_new" USING ("transactionType"::text::"TransactionTypeEnum_new");
ALTER TABLE "TransactionAudit" ALTER COLUMN "transactionType" TYPE "TransactionTypeEnum_new" USING ("transactionType"::text::"TransactionTypeEnum_new");
ALTER TYPE "TransactionTypeEnum" RENAME TO "TransactionTypeEnum_old";
ALTER TYPE "TransactionTypeEnum_new" RENAME TO "TransactionTypeEnum";
DROP TYPE "transaction"."TransactionTypeEnum_old";
COMMIT;

