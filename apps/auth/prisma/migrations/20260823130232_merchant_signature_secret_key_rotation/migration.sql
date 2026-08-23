/*
  Warnings:

  - You are about to drop the column `previousSecretKey` on the `MerchantSignature` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MerchantSignature" DROP COLUMN "previousSecretKey",
ADD COLUMN     "secretKeyPrevious" TEXT,
ADD COLUMN     "secretKeyRotatedAt" TIMESTAMPTZ(6);
