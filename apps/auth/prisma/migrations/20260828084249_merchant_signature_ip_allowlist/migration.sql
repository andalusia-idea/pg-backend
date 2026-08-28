-- AlterTable
ALTER TABLE "MerchantSignature" ADD COLUMN     "allowedIps" VARCHAR(45)[] DEFAULT ARRAY[]::VARCHAR(45)[];
