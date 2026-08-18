-- CreateEnum
CREATE TYPE "TransactionTypeEnum" AS ENUM ('WITHDRAW', 'TOPUP', 'DISBURSEMENT', 'PURCHASE', 'SETTLEMENT_PURCHASE');

-- CreateTable
CREATE TABLE "Bank" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" INTEGER NOT NULL,
    "settlementInterval" SMALLINT NOT NULL DEFAULT 120,
    "lastSettlementAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" INTEGER NOT NULL,
    "providerName" TEXT,
    "paymentMethodName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentShareholder" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "percentagePerAgent" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "AgentShareholder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "name" TEXT NOT NULL,
    "reconciliationTime" TEXT NOT NULL,
    "lastReconciliationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "name" TEXT NOT NULL,
    "explain" TEXT NOT NULL,
    "transactionTypes" "TransactionTypeEnum"[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "BaseFee" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "paymentMethodName" TEXT NOT NULL,
    "transactionType" "TransactionTypeEnum" NOT NULL,
    "feeProviderFixed" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feeProviderPercentage" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "BaseFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantFee" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "baseFeeId" INTEGER NOT NULL,
    "feeInternalFixed" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feeInternalPercentage" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
    "feeAgentFixed" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feeAgentPercentage" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "MerchantFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Common" (
    "id" SMALLSERIAL NOT NULL,
    "div" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "explain" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "Common_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentShareholder_agentId_merchantId_key" ON "AgentShareholder"("agentId", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "BaseFee_code_key" ON "BaseFee"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantFee_merchantId_baseFeeId_key" ON "MerchantFee"("merchantId", "baseFeeId");

-- AddForeignKey
ALTER TABLE "AgentShareholder" ADD CONSTRAINT "AgentShareholder_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentShareholder" ADD CONSTRAINT "AgentShareholder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseFee" ADD CONSTRAINT "BaseFee_providerName_fkey" FOREIGN KEY ("providerName") REFERENCES "Provider"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaseFee" ADD CONSTRAINT "BaseFee_paymentMethodName_fkey" FOREIGN KEY ("paymentMethodName") REFERENCES "PaymentMethod"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantFee" ADD CONSTRAINT "MerchantFee_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantFee" ADD CONSTRAINT "MerchantFee_baseFeeId_fkey" FOREIGN KEY ("baseFeeId") REFERENCES "BaseFee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
