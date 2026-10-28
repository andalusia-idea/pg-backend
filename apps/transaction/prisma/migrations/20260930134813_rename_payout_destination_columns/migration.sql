-- Rename the payout destination columns to match `auth.MerchantDetail` /
-- `auth.AgentDetail` and `config.Bank.code`, which is where these values are
-- copied from.
--
-- HAND-WRITTEN, and it has to be. Prisma cannot detect a rename: it sees a
-- dropped field and a new one, so `migrate dev` would generate DROP COLUMN +
-- ADD COLUMN and silently destroy the destination of every payout already in
-- the table. RENAME COLUMN preserves the data, the type and any index.

-- DisbursementTransaction: NOT NULL, unchanged by the rename.
ALTER TABLE "DisbursementTransaction" RENAME COLUMN "recipientName" TO "accountHolderName";
ALTER TABLE "DisbursementTransaction" RENAME COLUMN "recipientAccount" TO "accountNumber";
ALTER TABLE "DisbursementTransaction" RENAME COLUMN "recipientBankCode" TO "bankCode";

-- WithdrawTransaction: stays NULLABLE. `paymentMethodName` can be USDT, which
-- has no bank, no account number and no account holder.
ALTER TABLE "WithdrawTransaction" RENAME COLUMN "recipientName" TO "accountHolderName";
ALTER TABLE "WithdrawTransaction" RENAME COLUMN "recipientAccount" TO "accountNumber";
ALTER TABLE "WithdrawTransaction" RENAME COLUMN "recipientBankCode" TO "bankCode";

-- Dropped, not renamed: the bank's name is derivable from `bankCode` via
-- `config."Bank"`, and a stored copy goes stale when a bank is renamed.
-- Only `apps/dashboard` ever read it - see docs/engine/dashboard-migration.md.
ALTER TABLE "DisbursementTransaction" DROP COLUMN "recipientBankName";
ALTER TABLE "WithdrawTransaction" DROP COLUMN "recipientBankName";
