/*
  Warnings:

  - The values [SETTLEMENT_PURCHASE] on the enum `TransactionTypeEnum` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `lastSettlementAt` on the `Merchant` table. All the data in the column will be lost.
  - You are about to drop the column `settlementInterval` on the `Merchant` table. All the data in the column will be lost.
  - You are about to drop the column `lastReconciliationAt` on the `Provider` table. All the data in the column will be lost.
  - You are about to drop the column `reconciliationTime` on the `Provider` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "TransactionTypeEnum_new" AS ENUM ('WITHDRAW', 'TOPUP', 'DISBURSEMENT', 'PURCHASE');
ALTER TABLE "PaymentMethod" ALTER COLUMN "transactionTypes" TYPE "TransactionTypeEnum_new"[] USING ("transactionTypes"::text::"TransactionTypeEnum_new"[]);
ALTER TABLE "BaseFee" ALTER COLUMN "transactionType" TYPE "TransactionTypeEnum_new" USING ("transactionType"::text::"TransactionTypeEnum_new");
ALTER TYPE "TransactionTypeEnum" RENAME TO "TransactionTypeEnum_old";
ALTER TYPE "TransactionTypeEnum_new" RENAME TO "TransactionTypeEnum";
DROP TYPE "config"."TransactionTypeEnum_old";
COMMIT;

-- AlterTable
ALTER TABLE "Merchant" DROP COLUMN "lastSettlementAt",
DROP COLUMN "settlementInterval";

-- AlterTable
ALTER TABLE "Provider" DROP COLUMN "lastReconciliationAt",
DROP COLUMN "reconciliationTime";
