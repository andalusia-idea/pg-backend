-- Engine-level config data, so a fresh database is usable before any seed runs
-- and a production cutover does not depend on a seed step.
--
-- Previously written by apps/config/prisma/seed/config-engine.seed.ts, which
-- has since been deleted - this migration is now the only writer.
--
-- `name` is the primary key on both tables and is what runtime code matches
-- against ProviderNameEnum / PaymentMethodNameEnum in libs/microservice. There
-- is no foreign key and no check constraint behind that match, so a name
-- spelled differently here inserts *successfully* and is simply unreachable -
-- and a BaseFee row keyed on the real name never joins. The strings below are
-- the enum values; the human-readable form belongs in `explain`, and the two
-- are deliberately not the same thing.
--
-- Identifiers are double-quoted and literals single-quoted. Postgres reads
-- 'Provider' as a string where a table name is expected (a syntax error) and
-- "INTERNAL" as a column reference where a value is expected, so getting these
-- backwards fails in two different and unhelpful ways.

-- INTERNAL only. It is the house provider - transactions we settle ourselves
-- rather than route to a third party - so it exists in every environment.
-- MOTIONPAY, TELEANJAR and JATELINDO are commercial integrations whose presence
-- depends on a signed agreement, and stay with the dev seed tier.
--
-- ON CONFLICT DO NOTHING here and below. Nothing else writes these rows any
-- more, so on a fresh database it never fires - it is for the databases that
-- were seeded before this migration existed and already hold them. Dropping it
-- would make this migration fail on exactly those.
INSERT INTO "Provider" ("name", "createdAt", "createdBy") VALUES
  ('INTERNAL', now(), 1)
ON CONFLICT ("name") DO NOTHING;

-- `transactionTypes` drives the dashboard's `common/div?div=PAYMENT_METHOD_*`
-- dropdowns, which filter on `transactionTypes has <type>`.
--
-- The ::"TransactionTypeEnum"[] cast is required, not decoration. ARRAY[...]
-- resolves its literals to text, and postgres has no assignment cast from
-- text[] to an enum array, so an uncast list fails with `column
-- "transactionTypes" is of type "TransactionTypeEnum"[] but expression is of
-- type text[]`. A single-element list is no exception.
INSERT INTO "PaymentMethod" ("name", "explain", "transactionTypes", "createdAt", "createdBy") VALUES
  ('QRIS',           'QRIS',            ARRAY['PURCHASE']::"TransactionTypeEnum"[], now(), 1),
  ('VIRTUALACCOUNT', 'VIRTUAL_ACCOUNT', ARRAY['PURCHASE']::"TransactionTypeEnum"[], now(), 1),
  ('DIRECTEWALLET',  'DIRECT_E_WALLET', ARRAY['PURCHASE']::"TransactionTypeEnum"[], now(), 1),
  ('TRANSFERBANK',   'TRANSFER_BANK',
   ARRAY['TOPUP', 'DISBURSEMENT', 'WITHDRAW']::"TransactionTypeEnum"[], now(), 1),
  ('TRANSFEREWALLET_DANA',      'TRANSFER_E_WALLET_DANA',
   ARRAY['DISBURSEMENT', 'WITHDRAW']::"TransactionTypeEnum"[], now(), 1),
  ('TRANSFEREWALLET_GOPAY',     'TRANSFER_E_WALLET_GOPAY',
   ARRAY['DISBURSEMENT', 'WITHDRAW']::"TransactionTypeEnum"[], now(), 1),
  ('TRANSFEREWALLET_OVO',       'TRANSFER_E_WALLET_OVO',
   ARRAY['DISBURSEMENT', 'WITHDRAW']::"TransactionTypeEnum"[], now(), 1),
  ('TRANSFEREWALLET_SHOPEEPAY', 'TRANSFER_E_WALLET_SHOPEEPAY',
   ARRAY['DISBURSEMENT', 'WITHDRAW']::"TransactionTypeEnum"[], now(), 1)
ON CONFLICT ("name") DO NOTHING;

-- Banks are NOT moved yet - 95 rows still come from bankEngineSeed, which
-- remains the source of truth for them. Left here commented rather than
-- deleted so the unfinished half of the move is visible from this file:
--
-- INSERT INTO "Bank" ("code", "name", "createdAt", "createdBy") VALUES
--   ('002', 'BANK BRI', now(), 1),
--   ... 95 rows ...
-- ON CONFLICT ("code") DO NOTHING;
