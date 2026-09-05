/*
  Warnings:

  - You are about to drop the column `purchaseTransactionId` on the `WebhookLog` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "WebhookLog" DROP CONSTRAINT "WebhookLog_purchaseTransactionId_fkey";

-- AlterTable
ALTER TABLE "WebhookLog" DROP COLUMN "purchaseTransactionId";
