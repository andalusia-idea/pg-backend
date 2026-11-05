-- The Indonesian bank catalogue - the last of the config engine data to live in
-- a seed. Supersedes the commented-out placeholder in
-- 20261105200000_provider_and_payment_methods, and replaces
-- apps/config/prisma/seed/bank-engine.seed.ts, deleted in the same commit.
-- This migration is now the only writer.
--
-- Why it cannot stay a seed step: every merchant and agent carries a bankCode,
-- and the dashboard's `common/div?div=BANK` dropdown reads this table, so an
-- empty Bank table means nobody can be onboarded at all. A fresh database has
-- to hold these before any seed runs, and a production cutover must not depend
-- on remembering to run one.
--
-- 95 rows - 91 banks and the 4 e-wallets below - every code distinct.
-- `Bank.code` is the primary key, typed `String` with no length or format
-- constraint, which is why numeric clearing codes and alphabetic e-wallet
-- codes share one column.
--
-- The four e-wallet rows are load-bearing, not padding. The dashboard splits
-- this single table into two dropdowns by testing `code` against EWalletEnum
-- (apps/dashboard/src/modules/config-common/config-common.service.ts):
-- div=EWALLET returns the codes in that enum and div=BANK returns everything
-- else. So the four below have to match EWalletEnum in libs/microservice
-- exactly. Add an e-wallet to the enum with no row here and it is missing from
-- the dropdown; add a row here that is not in the enum and it appears under
-- div=BANK as though it were a bank.
--
-- Provenance, as recorded by the seed this replaces: the original list carried
-- six duplicate codes and would have thrown P2002 partway through. They were
-- resolved by hand - renames collapsed to a single entry, and Bank NTB / Bank
-- SulutGo split across 127 / 128. This is that resolved list. The seed called
-- it "91 banks", which is this same list counted differently: 91 banks plus the
-- four e-wallets, and 91 is also what div=BANK returns.
--
-- ON CONFLICT DO NOTHING, as in the other engine-data migrations. On a fresh
-- database it never fires; on one the seed already populated it is what lets
-- this apply at all. It also preserves a name corrected in the database by
-- hand, which is what the seed's `update: {}` did.
--
-- Identifiers are double-quoted and literals single-quoted. See
-- 20261105200000_provider_and_payment_methods for what each way round of
-- getting that wrong looks like.

INSERT INTO "Bank" ("code", "name", "createdAt", "createdBy") VALUES
  -- E-wallets (4)
  ('DANA',      'DANA',                          now(), 1),
  ('GOPAY',     'GOPAY',                         now(), 1),
  ('OVO',       'OVO',                           now(), 1),
  ('SHOPEEPAY', 'SHOPEEPAY',                     now(), 1),
  -- Bank Umum Nasional (30)
  ('014',       'BCA',                           now(), 1),
  ('008',       'MANDIRI',                       now(), 1),
  ('009',       'BNI',                           now(), 1),
  ('002',       'BRI',                           now(), 1),
  ('200',       'BTN',                           now(), 1),
  ('013',       'PERMATA',                       now(), 1),
  ('011',       'DANAMON',                       now(), 1),
  ('016',       'MAYBANK INDONESIA',             now(), 1),
  ('426',       'MEGA',                          now(), 1),
  ('153',       'SINARMAS',                      now(), 1),
  ('028',       'OCBC NISP',                     now(), 1),
  ('441',       'BUKOPIN (KB BUKOPIN)',          now(), 1),
  ('019',       'PANIN',                         now(), 1),
  ('213',       'BTPN / Jenius',                 now(), 1),
  ('950',       'COMMONWEALTH',                  now(), 1),
  ('023',       'UOB INDONESIA',                 now(), 1),
  ('054',       'CAPITAL INDONESIA',             now(), 1),
  ('097',       'MAYAPADA',                      now(), 1),
  ('157',       'MASPION',                       now(), 1),
  ('161',       'GANESHA',                       now(), 1),
  ('212',       'WOORI SAUDARA',                 now(), 1),
  ('095',       'JTRUST',                        now(), 1),
  ('566',       'VICTORIA INTERNATIONAL',        now(), 1),
  ('523',       'SAHABAT SAMPOERNA',             now(), 1),
  ('555',       'INDEX SELINDO',                 now(), 1),
  ('503',       'NOBU (NATIONAL NOBU)',          now(), 1),
  ('513',       'INA PERDANA',                   now(), 1),
  ('553',       'MAYORA INDONESIA',              now(), 1),
  ('485',       'MNC INTERNASIONAL',             now(), 1),
  ('567',       'HARDA INTERNASIONAL',           now(), 1),
  -- Bank Digital / Fintech (7)
  ('501',       'blu by BCA Digital',            now(), 1),
  ('535',       'Seabank',                       now(), 1),
  ('542',       'Bank Jago',                     now(), 1),
  ('490',       'Bank Neo Commerce',             now(), 1),
  ('484',       'Line Bank',                     now(), 1),
  ('562',       'Superbank',                     now(), 1),
  ('947',       'Bank Aladin Syariah',           now(), 1),
  -- Bank Syariah (10)
  ('451',       'Bank Syariah Indonesia (BSI)',  now(), 1),
  ('147',       'Bank Muamalat',                 now(), 1),
  ('536',       'BCA Syariah',                   now(), 1),
  ('547',       'BTPN Syariah',                  now(), 1),
  ('521',       'KB Bukopin Syariah',            now(), 1),
  ('022',       'CIMB Niaga Syariah',            now(), 1),
  ('425',       'Bank BJB Syariah',              now(), 1),
  ('517',       'Bank Panin Dubai Syariah',      now(), 1),
  ('506',       'Bank Mega Syariah',             now(), 1),
  ('116',       'BPD Aceh Syariah',              now(), 1),
  -- Bank Pembangunan Daerah (26)
  ('110',       'Bank BJB',                      now(), 1),
  ('111',       'Bank DKI',                      now(), 1),
  ('112',       'BPD DIY',                       now(), 1),
  ('113',       'Bank Jateng',                   now(), 1),
  ('114',       'Bank Jatim',                    now(), 1),
  ('115',       'BPD Jambi',                     now(), 1),
  ('117',       'Bank Sumut',                    now(), 1),
  ('118',       'Bank Nagari (Sumbar)',          now(), 1),
  ('119',       'Bank Riau Kepri',               now(), 1),
  ('120',       'Bank Sumsel Babel',             now(), 1),
  ('121',       'Bank Lampung',                  now(), 1),
  ('122',       'Bank Kalsel',                   now(), 1),
  ('123',       'Bank Kalbar',                   now(), 1),
  ('124',       'Bank Kaltimtara',               now(), 1),
  ('125',       'Bank Kalteng',                  now(), 1),
  ('126',       'Bank Sulselbar',                now(), 1),
  ('128',       'Bank SulutGo',                  now(), 1),
  ('127',       'Bank NTB',                      now(), 1),
  ('129',       'BPD Bali',                      now(), 1),
  ('130',       'Bank NTT',                      now(), 1),
  ('131',       'Bank Muluku Malut',             now(), 1),
  ('132',       'Bank Papua',                    now(), 1),
  ('133',       'Bank Bengkulu',                 now(), 1),
  ('134',       'Bank Sulteng',                  now(), 1),
  ('135',       'Bank Sultra',                   now(), 1),
  ('137',       'Bank Banten',                   now(), 1),
  -- Bank Asing (18)
  ('041',       'HSBC',                          now(), 1),
  ('050',       'Standart Chartered',            now(), 1),
  ('032',       'JP Morgan Chase',               now(), 1),
  ('033',       'Bank of America',               now(), 1),
  ('046',       'DBS Indonesia',                 now(), 1),
  ('069',       'Bank of China',                 now(), 1),
  ('048',       'Mizuho Bank',                   now(), 1),
  ('042',       'MUFG Bank',                     now(), 1),
  ('061',       'ANZ Indonesia',                 now(), 1),
  ('067',       'Deutsche Bank',                 now(), 1),
  ('057',       'BNP Paribas',                   now(), 1),
  ('040',       'Bangkok Bank',                  now(), 1),
  ('036',       'China Construction Bank (CCB)', now(), 1),
  ('164',       'ICBC Indonesia',                now(), 1),
  ('047',       'Resona Perdania',               now(), 1),
  ('039',       'Credit Agricole Indosuez',      now(), 1),
  ('949',       'CTBC Indonesia',                now(), 1),
  ('059',       'Korea Exchane Bank',            now(), 1)
ON CONFLICT ("code") DO NOTHING;
