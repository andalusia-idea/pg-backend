/*
  Warnings:

  - Changed the type of `status` on the `MerchantSignature` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "MerchantSignatureStatusEnum" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "MerchantSignature" DROP COLUMN "status",
ADD COLUMN     "status" "MerchantSignatureStatusEnum" NOT NULL;
