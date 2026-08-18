-- CreateEnum
CREATE TYPE "TransactionStatusEnum" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeeTypeEnum" AS ENUM ('AGENT', 'INTERNAL', 'PROVIDER', 'MERCHANT');

-- CreateEnum
CREATE TYPE "TransactionTypeEnum" AS ENUM ('WITHDRAW', 'TOPUP', 'DISBURSEMENT', 'PURCHASE', 'SETTLEMENT_PURCHASE');

-- CreateTable
CREATE TABLE "TopUpTransaction" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "externalId" TEXT,
    "referenceId" TEXT NOT NULL,
    "nominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "netNominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "status" "TransactionStatusEnum" NOT NULL DEFAULT 'PENDING',
    "providerName" TEXT NOT NULL,
    "paymentMethodName" TEXT NOT NULL,
    "receiptImage" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "settlementAt" TIMESTAMP(3),
    "reconciliationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "TopUpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopupFeeDetail" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER,
    "topupId" INTEGER NOT NULL,
    "type" "FeeTypeEnum" NOT NULL,
    "nominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feeFixed" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feePercentage" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "TopupFeeDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawTransaction" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "externalId" TEXT,
    "userId" INTEGER NOT NULL,
    "userRole" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "paymentMethodName" TEXT NOT NULL,
    "nominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "netNominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "status" "TransactionStatusEnum" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "reconciliationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "WithdrawTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawFeeDetail" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER,
    "withdrawId" INTEGER NOT NULL,
    "type" "FeeTypeEnum" NOT NULL,
    "nominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feeFixed" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feePercentage" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "WithdrawFeeDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementTransaction" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "externalId" TEXT,
    "referenceId" TEXT,
    "merchantId" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientBankCode" TEXT NOT NULL,
    "recipientBankName" TEXT,
    "recipientAccount" TEXT NOT NULL,
    "nominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "netNominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "status" "TransactionStatusEnum" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paymentMethodName" TEXT NOT NULL,
    "metadata" JSONB,
    "reconciliationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "DisbursementTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementFeeDetail" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER,
    "disbursementId" INTEGER NOT NULL,
    "type" "FeeTypeEnum" NOT NULL,
    "nominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feeFixed" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feePercentage" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "DisbursementFeeDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseTransaction" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "referenceId" TEXT,
    "externalId" TEXT NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "nmid" TEXT,
    "providerName" TEXT NOT NULL,
    "paymentMethodName" TEXT NOT NULL,
    "nominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "netNominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "status" "TransactionStatusEnum" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "settlementAt" TIMESTAMP(3),
    "reconciliationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "PurchaseTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseFeeDetail" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER,
    "purchaseId" INTEGER NOT NULL,
    "type" "FeeTypeEnum" NOT NULL,
    "nominal" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feeFixed" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "feePercentage" DECIMAL(8,4) NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "PurchaseFeeDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rawSignature" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionType" "TransactionTypeEnum" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,
    "purchaseTransactionId" INTEGER,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAudit" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "oldStatus" "TransactionStatusEnum" NOT NULL,
    "newStatus" "TransactionStatusEnum" NOT NULL,
    "source" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionType" "TransactionTypeEnum" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "TransactionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantBalanceLog" (
    "id" SERIAL NOT NULL,
    "topupId" INTEGER,
    "purchaseId" INTEGER,
    "withdrawId" INTEGER,
    "disbursementId" INTEGER,
    "merchantId" INTEGER NOT NULL,
    "changeAmount" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "balanceActive" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "balancePending" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "transactionType" "TransactionTypeEnum" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "MerchantBalanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentBalanceLog" (
    "id" SERIAL NOT NULL,
    "topupId" INTEGER,
    "purchaseId" INTEGER,
    "withdrawId" INTEGER,
    "disbursementId" INTEGER,
    "agentId" INTEGER NOT NULL,
    "changeAmount" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "balanceActive" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "balancePending" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "transactionType" "TransactionTypeEnum" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "AgentBalanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalBalanceLog" (
    "id" SERIAL NOT NULL,
    "topupId" INTEGER,
    "purchaseId" INTEGER,
    "withdrawId" INTEGER,
    "disbursementId" INTEGER,
    "merchantId" INTEGER,
    "changeAmount" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "balanceActive" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "balancePending" DECIMAL(15,2) NOT NULL DEFAULT 0.0,
    "transactionType" "TransactionTypeEnum" NOT NULL,
    "providerName" TEXT NOT NULL,
    "paymentMethodName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMPTZ(6),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMPTZ(6),
    "deletedBy" INTEGER,

    CONSTRAINT "InternalBalanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopUpTransaction_code_key" ON "TopUpTransaction"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpTransaction_referenceId_key" ON "TopUpTransaction"("referenceId");

-- CreateIndex
CREATE INDEX "TopUpTransaction_referenceId_idx" ON "TopUpTransaction"("referenceId");

-- CreateIndex
CREATE INDEX "TopUpTransaction_merchantId_idx" ON "TopUpTransaction"("merchantId");

-- CreateIndex
CREATE INDEX "TopupFeeDetail_topupId_idx" ON "TopupFeeDetail"("topupId");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawTransaction_code_key" ON "WithdrawTransaction"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawTransaction_referenceId_key" ON "WithdrawTransaction"("referenceId");

-- CreateIndex
CREATE INDEX "WithdrawTransaction_userId_idx" ON "WithdrawTransaction"("userId");

-- CreateIndex
CREATE INDEX "WithdrawTransaction_status_idx" ON "WithdrawTransaction"("status");

-- CreateIndex
CREATE INDEX "WithdrawFeeDetail_withdrawId_idx" ON "WithdrawFeeDetail"("withdrawId");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementTransaction_code_key" ON "DisbursementTransaction"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementTransaction_orderId_key" ON "DisbursementTransaction"("orderId");

-- CreateIndex
CREATE INDEX "DisbursementTransaction_providerName_idx" ON "DisbursementTransaction"("providerName");

-- CreateIndex
CREATE INDEX "DisbursementTransaction_status_idx" ON "DisbursementTransaction"("status");

-- CreateIndex
CREATE INDEX "DisbursementFeeDetail_disbursementId_idx" ON "DisbursementFeeDetail"("disbursementId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseTransaction_code_key" ON "PurchaseTransaction"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseTransaction_orderId_key" ON "PurchaseTransaction"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseTransaction_merchantId_idx" ON "PurchaseTransaction"("merchantId");

-- CreateIndex
CREATE INDEX "PurchaseTransaction_providerName_idx" ON "PurchaseTransaction"("providerName");

-- CreateIndex
CREATE INDEX "PurchaseTransaction_status_idx" ON "PurchaseTransaction"("status");

-- CreateIndex
CREATE INDEX "PurchaseFeeDetail_purchaseId_idx" ON "PurchaseFeeDetail"("purchaseId");

-- CreateIndex
CREATE INDEX "WebhookLog_source_idx" ON "WebhookLog"("source");

-- CreateIndex
CREATE INDEX "TransactionAudit_transactionId_idx" ON "TransactionAudit"("transactionId");

-- CreateIndex
CREATE INDEX "MerchantBalanceLog_merchantId_idx" ON "MerchantBalanceLog"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantBalanceLog_topupId_idx" ON "MerchantBalanceLog"("topupId");

-- CreateIndex
CREATE INDEX "MerchantBalanceLog_purchaseId_idx" ON "MerchantBalanceLog"("purchaseId");

-- CreateIndex
CREATE INDEX "MerchantBalanceLog_withdrawId_idx" ON "MerchantBalanceLog"("withdrawId");

-- CreateIndex
CREATE INDEX "MerchantBalanceLog_disbursementId_idx" ON "MerchantBalanceLog"("disbursementId");

-- CreateIndex
CREATE INDEX "AgentBalanceLog_agentId_idx" ON "AgentBalanceLog"("agentId");

-- CreateIndex
CREATE INDEX "AgentBalanceLog_topupId_idx" ON "AgentBalanceLog"("topupId");

-- CreateIndex
CREATE INDEX "AgentBalanceLog_purchaseId_idx" ON "AgentBalanceLog"("purchaseId");

-- CreateIndex
CREATE INDEX "AgentBalanceLog_withdrawId_idx" ON "AgentBalanceLog"("withdrawId");

-- CreateIndex
CREATE INDEX "AgentBalanceLog_disbursementId_idx" ON "AgentBalanceLog"("disbursementId");

-- CreateIndex
CREATE INDEX "InternalBalanceLog_topupId_idx" ON "InternalBalanceLog"("topupId");

-- CreateIndex
CREATE INDEX "InternalBalanceLog_purchaseId_idx" ON "InternalBalanceLog"("purchaseId");

-- CreateIndex
CREATE INDEX "InternalBalanceLog_withdrawId_idx" ON "InternalBalanceLog"("withdrawId");

-- CreateIndex
CREATE INDEX "InternalBalanceLog_disbursementId_idx" ON "InternalBalanceLog"("disbursementId");

-- AddForeignKey
ALTER TABLE "TopupFeeDetail" ADD CONSTRAINT "TopupFeeDetail_topupId_fkey" FOREIGN KEY ("topupId") REFERENCES "TopUpTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawFeeDetail" ADD CONSTRAINT "WithdrawFeeDetail_withdrawId_fkey" FOREIGN KEY ("withdrawId") REFERENCES "WithdrawTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementFeeDetail" ADD CONSTRAINT "DisbursementFeeDetail_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "DisbursementTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseFeeDetail" ADD CONSTRAINT "PurchaseFeeDetail_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PurchaseTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_purchaseTransactionId_fkey" FOREIGN KEY ("purchaseTransactionId") REFERENCES "PurchaseTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantBalanceLog" ADD CONSTRAINT "MerchantBalanceLog_topupId_fkey" FOREIGN KEY ("topupId") REFERENCES "TopUpTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantBalanceLog" ADD CONSTRAINT "MerchantBalanceLog_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PurchaseTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantBalanceLog" ADD CONSTRAINT "MerchantBalanceLog_withdrawId_fkey" FOREIGN KEY ("withdrawId") REFERENCES "WithdrawTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantBalanceLog" ADD CONSTRAINT "MerchantBalanceLog_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "DisbursementTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBalanceLog" ADD CONSTRAINT "AgentBalanceLog_topupId_fkey" FOREIGN KEY ("topupId") REFERENCES "TopUpTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBalanceLog" ADD CONSTRAINT "AgentBalanceLog_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PurchaseTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBalanceLog" ADD CONSTRAINT "AgentBalanceLog_withdrawId_fkey" FOREIGN KEY ("withdrawId") REFERENCES "WithdrawTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBalanceLog" ADD CONSTRAINT "AgentBalanceLog_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "DisbursementTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalBalanceLog" ADD CONSTRAINT "InternalBalanceLog_topupId_fkey" FOREIGN KEY ("topupId") REFERENCES "TopUpTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalBalanceLog" ADD CONSTRAINT "InternalBalanceLog_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PurchaseTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalBalanceLog" ADD CONSTRAINT "InternalBalanceLog_withdrawId_fkey" FOREIGN KEY ("withdrawId") REFERENCES "WithdrawTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalBalanceLog" ADD CONSTRAINT "InternalBalanceLog_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "DisbursementTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
