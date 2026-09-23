-- CreateEnum
CREATE TYPE "BalanceHolderTypeEnum" AS ENUM ('MERCHANT', 'AGENT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "BalanceBucketEnum" AS ENUM ('PENDING', 'AVAILABLE', 'RESERVED');

-- CreateEnum
CREATE TYPE "BalanceDirectionEnum" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "BalanceReasonEnum" AS ENUM ('PAYIN_CAPTURED', 'PAYIN_REVERSED', 'PAYOUT_RESERVED', 'PAYOUT_COMPLETED', 'PAYOUT_FAILED', 'MERCHANT_SETTLED', 'TOPUP_APPROVED', 'MANUAL_ADJUSTMENT', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "BalanceSourceTypeEnum" AS ENUM ('PURCHASE', 'DISBURSEMENT', 'WITHDRAW', 'TOPUP', 'ADJUSTMENT', 'OPENING');

-- CreateTable
CREATE TABLE "BalanceEntry" (
    "id" BIGSERIAL NOT NULL,
    "holderType" "BalanceHolderTypeEnum" NOT NULL,
    "holderId" INTEGER NOT NULL,
    "bucket" "BalanceBucketEnum" NOT NULL,
    "direction" "BalanceDirectionEnum" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" "BalanceReasonEnum" NOT NULL,
    "sourceType" "BalanceSourceTypeEnum" NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "batchId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "BalanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "holderType" "BalanceHolderTypeEnum" NOT NULL,
    "holderId" INTEGER NOT NULL,
    "bucket" "BalanceBucketEnum" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "lastEntryId" BIGINT NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "updatedBy" INTEGER NOT NULL,

    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("holderType","holderId","bucket")
);

-- CreateTable
CREATE TABLE "BalanceAdjustment" (
    "id" SERIAL NOT NULL,
    "holderType" "BalanceHolderTypeEnum" NOT NULL,
    "holderId" INTEGER NOT NULL,
    "bucket" "BalanceBucketEnum" NOT NULL,
    "direction" "BalanceDirectionEnum" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "evidence" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER NOT NULL,

    CONSTRAINT "BalanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceEntry_holderType_holderId_bucket_id_idx" ON "BalanceEntry"("holderType", "holderId", "bucket", "id");

-- CreateIndex
CREATE INDEX "BalanceEntry_batchId_idx" ON "BalanceEntry"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceEntry_holderType_holderId_bucket_reason_sourceType_s_key" ON "BalanceEntry"("holderType", "holderId", "bucket", "reason", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BalanceAdjustment_holderType_holderId_idx" ON "BalanceAdjustment"("holderType", "holderId");
