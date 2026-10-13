-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "settlement";

-- CreateEnum
CREATE TYPE "settlement"."SettlementRunStatusEnum" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "settlement"."SettlementRun" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "paymentMethodName" TEXT NOT NULL DEFAULT '*',
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "settlement"."SettlementRunStatusEnum" NOT NULL DEFAULT 'PENDING',
    "claimedBy" VARCHAR(100),
    "claimedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "failureReason" VARCHAR(1000),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SettlementRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement"."SettlementBatch" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "sweptFrom" TIMESTAMPTZ(6),
    "sweptTo" TIMESTAMPTZ(6),
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementRun_status_dueAt_idx" ON "settlement"."SettlementRun"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRun_merchantId_paymentMethodName_dueAt_key" ON "settlement"."SettlementRun"("merchantId", "paymentMethodName", "dueAt");

-- CreateIndex
CREATE INDEX "SettlementBatch_runId_idx" ON "settlement"."SettlementBatch"("runId");

-- AddForeignKey
ALTER TABLE "settlement"."SettlementBatch" ADD CONSTRAINT "SettlementBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "settlement"."SettlementRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
