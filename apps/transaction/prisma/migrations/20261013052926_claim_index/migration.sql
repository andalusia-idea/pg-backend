-- The claim index for apps/settlement.
--
-- Partial, so it stays small forever: a row leaves the index the moment it is
-- settled, which is why the claim can select by `batchSettlementId IS NULL`
-- instead of by a time window. Prisma cannot express a WHERE clause on an
-- index, so this is hand-written and has no counterpart in schema.prisma.
-- Verified that `prisma migrate dev` does not then propose dropping it.
--
-- Every identifier is quoted. This schema uses no @map, so the table really is
-- "PurchaseTransaction" with camelCase columns, and Postgres folds anything
-- unquoted to lower case - an unquoted merchantId fails with
-- `column "merchantid" does not exist`.
CREATE INDEX "PurchaseTransaction_unsettled_idx"
  ON "transaction"."PurchaseTransaction" ("merchantId", "paymentMethodName")
  WHERE
    "batchSettlementId" IS NULL
    AND "status" = 'SUCCESS'
    AND "deletedAt" IS NULL;
