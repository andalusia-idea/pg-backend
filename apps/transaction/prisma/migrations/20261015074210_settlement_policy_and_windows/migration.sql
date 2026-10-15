-- CreateEnum
CREATE TYPE "settlement"."SettlementModeEnum" AS ENUM ('INSTANT', 'FOLLOW_UPSTREAM', 'FIXED_DELAY', 'SCHEDULED');

-- CreateTable
CREATE TABLE "settlement"."MerchantSettlementPolicy" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "paymentMethodName" TEXT NOT NULL DEFAULT '*',
    "mode" "settlement"."SettlementModeEnum" NOT NULL,
    "delayDays" INTEGER,
    "releaseTimes" TEXT[],
    "businessDaysOnly" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "MerchantSettlementPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement"."UpstreamSettlementWindow" (
    "id" SERIAL NOT NULL,
    "providerName" TEXT NOT NULL,
    "paymentMethodName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "windowStart" TEXT NOT NULL,
    "windowStartDayOffset" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TEXT NOT NULL,
    "settlementOffset" INTEGER NOT NULL,
    "settlementTime" TEXT,
    "businessDaysOnly" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "UpstreamSettlementWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement"."BusinessDayCalendar" (
    "date" DATE NOT NULL,
    "isBusinessDay" BOOLEAN NOT NULL,
    "providerName" TEXT NOT NULL DEFAULT '*',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,

    CONSTRAINT "BusinessDayCalendar_pkey" PRIMARY KEY ("date","providerName")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettlementPolicy_merchantId_paymentMethodName_effec_key" ON "settlement"."MerchantSettlementPolicy"("merchantId", "paymentMethodName", "effectiveFrom");

-- CreateIndex
CREATE INDEX "UpstreamSettlementWindow_providerName_paymentMethodName_idx" ON "settlement"."UpstreamSettlementWindow"("providerName", "paymentMethodName");

-- CreateIndex
CREATE UNIQUE INDEX "UpstreamSettlementWindow_providerName_paymentMethodName_lab_key" ON "settlement"."UpstreamSettlementWindow"("providerName", "paymentMethodName", "label", "effectiveFrom");
