-- The `config.Agent` row for agentinternal.
--
-- Previously written by apps/config/prisma/seed/config-engine.seed.ts, which
-- has since been deleted - this migration is now the only writer.
--
-- Counterpart to apps/auth/prisma/migrations/20261105150000_named_principals,
-- which pins that account at auth.User id 22. Read that file for why the id is
-- a contract: there is no foreign key from config.Agent to auth.User, so if the
-- two ever disagree the dashboard's registerMerchant misses its
-- `tx.agent.findUnique({ id: registrarId })` lookup and registers the merchant
-- *successfully* with no AgentShareholder row - dropping the agent from every
-- fee split for that merchant, with no error and no log line.
--
-- 22 is hardcoded because SQL cannot import NAMED_PRINCIPAL_USER_ID from
-- libs/microservice. The assertion below is what stands in for that.
--
-- Agent.id is `@id @db.Integer` with no autoincrement - the id comes from
-- auth.User, not a sequence - so unlike the auth migration there is no setval
-- to keep in step here.
INSERT INTO "Agent" ("id", "createdAt", "createdBy") VALUES
  (22, now(), 1)
ON CONFLICT ("id") DO NOTHING;

-- Assert that id 22 really is agentinternal, rather than trusting it.
--
-- auth and config share one database, so `auth."User"` is reachable from here.
-- But they have separate migration histories and separate _prisma_migrations
-- tables, and nothing orders one app's `migrate deploy` before the other's -
-- so on a fresh database this may well run before auth has any tables at all.
-- Hence the to_regclass guard: no auth.User table yet means there is nothing to
-- contradict, and the check becomes a no-op rather than a hard failure. Once
-- auth has migrated, a mismatch stops the deploy with a message that names the
-- problem instead of leaving config pointing at nothing.
DO $$
DECLARE
  found TEXT;
BEGIN
  IF to_regclass('auth."User"') IS NULL THEN
    RAISE NOTICE 'auth.User not present yet - skipping agentinternal id check';
    RETURN;
  END IF;

  SELECT u.email INTO found FROM auth."User" u WHERE u.id = 22;

  IF found IS DISTINCT FROM 'agentinternal@pg.id' THEN
    RAISE EXCEPTION
      'config.Agent 22 expects auth.User 22 to be agentinternal@pg.id, found [%]. '
      'Check NAMED_PRINCIPAL_USER_ID in libs/microservice and '
      'apps/auth/prisma/migrations/20261105150000_named_principals',
      COALESCE(found, 'no such user');
  END IF;
END $$;
