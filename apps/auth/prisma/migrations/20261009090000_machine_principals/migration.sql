-- Pin the machine principals so application code can name them as constants.
--
-- These 6 roles and 20 users are part of the machine, not data: without a role
-- row no user can exist at all (User.roleId is a required FK), and without a
-- SYSTEM user nothing can stamp `createdBy` on a row it writes on its own
-- initiative - a provider webhook crediting a balance, a cron clearing a
-- retired secret.
--
-- They were previously created by the engine seed with autoincrement ids. That
-- produced ids 1..20 reliably, but only *incidentally*: the sequence happens to
-- start at 1, the seed happens to run first, and its internal order happens to
-- be 5 system, 5 reserved, 10 scheduler. Change SYSTEM_COUNT, restore a dump,
-- or import legacy users, and every id shifts with no error - a wrong
-- `createdBy` does not fail, it silently attributes money movements to whoever
-- holds that id. A migration runs exactly once, before any seed, so pinning
-- them here makes the ids a contract instead of a coincidence.
--
-- Roles move too, and had to: migrations run BEFORE seeds, so a user row
-- inserted here could not reference a role the seed has not created yet.
--
-- `superadmin` and `agentinternal` deliberately stay in the seed. They are real
-- login credentials, and a hardcoded argon2 hash here would put the production
-- admin password in version control, identical in every environment and
-- unchangeable without a new migration.

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- Roles. Ids are the declaration order of ROLE in
-- libs/microservice/src/microservice.enum.ts, matched by ROLE_ID.
INSERT INTO "Role" ("id", "name", "createdAt") VALUES
  (1, 'SYSTEM',      now()),
  (2, 'SCHEDULER',   now()),
  (3, 'SUPER_ADMIN', now()),
  (4, 'ADMIN',       now()),
  (5, 'AGENT',       now()),
  (6, 'MERCHANT',    now())
ON CONFLICT ("name") DO NOTHING;

SELECT setval('"Role_id_seq"', 6, true);

-- Machine users.
--
-- The password column is NOT NULL and argon2 cannot be computed in SQL, so
-- these carry a value that is not a valid argon2 hash. `argon2.verify` rejects
-- it, which makes these accounts structurally unable to sign in - better than
-- the seed's previous behaviour of giving them working hashes of a shared
-- ENGINE_PASSWORD despite being documented as unable to log in.
--
-- system01 has a null `createdBy` because it is the principal every other row
-- is attributed to; there is nothing older to credit.
INSERT INTO "User" ("id", "email", "password", "roleId", "createdAt", "createdBy") VALUES
  ( 1, 'system01@pg.id',    '!locked-machine-principal', 1, now(), NULL),
  ( 2, 'system02@pg.id',    '!locked-machine-principal', 1, now(), 1),
  ( 3, 'system03@pg.id',    '!locked-machine-principal', 1, now(), 1),
  ( 4, 'system04@pg.id',    '!locked-machine-principal', 1, now(), 1),
  ( 5, 'system05@pg.id',    '!locked-machine-principal', 1, now(), 1),
  ( 6, 'reserved01@pg.id',  '!locked-machine-principal', 1, now(), 1),
  ( 7, 'reserved02@pg.id',  '!locked-machine-principal', 1, now(), 1),
  ( 8, 'reserved03@pg.id',  '!locked-machine-principal', 1, now(), 1),
  ( 9, 'reserved04@pg.id',  '!locked-machine-principal', 1, now(), 1),
  (10, 'reserved05@pg.id',  '!locked-machine-principal', 1, now(), 1),
  (11, 'scheduler01@pg.id', '!locked-machine-principal', 2, now(), 1),
  (12, 'scheduler02@pg.id', '!locked-machine-principal', 2, now(), 1),
  (13, 'scheduler03@pg.id', '!locked-machine-principal', 2, now(), 1),
  (14, 'scheduler04@pg.id', '!locked-machine-principal', 2, now(), 1),
  (15, 'scheduler05@pg.id', '!locked-machine-principal', 2, now(), 1),
  (16, 'scheduler06@pg.id', '!locked-machine-principal', 2, now(), 1),
  (17, 'scheduler07@pg.id', '!locked-machine-principal', 2, now(), 1),
  (18, 'scheduler08@pg.id', '!locked-machine-principal', 2, now(), 1),
  (19, 'scheduler09@pg.id', '!locked-machine-principal', 2, now(), 1),
  (20, 'scheduler10@pg.id', '!locked-machine-principal', 2, now(), 1)
ON CONFLICT ("email") DO NOTHING;

-- The sequence does not advance on explicit ids, so without this the next real
-- signup would be handed id 1 and collide on the primary key. `true` means "20
-- is used, next is 21", which is where superadmin and agentinternal land.
SELECT setval('"User_id_seq"', 20, true);

-- Fail loudly rather than ship wrong constants.
--
-- Both inserts above skip on conflict, which is what makes this migration safe
-- to apply to a database the seed has already populated. But skipping is only
-- correct if the existing rows are already at the expected ids. If an
-- environment created a role or an account in some other order, the constants
-- in libs/microservice would be wrong and every `createdBy` and `roleId`
-- written against them would point at the wrong row - so refuse to complete
-- instead of leaving that to be discovered in an audit.
DO $$
DECLARE
  bad_roles TEXT;
  bad_users TEXT;
BEGIN
  SELECT string_agg(format('role %s is id %s, expected %s', r.name, r.id, want.expected), '; ')
    INTO bad_roles
  FROM (
    VALUES
      ('SYSTEM', 1), ('SCHEDULER', 2), ('SUPER_ADMIN', 3),
      ('ADMIN', 4), ('AGENT', 5), ('MERCHANT', 6)
  ) AS want(want_name, expected)
  JOIN "Role" r ON r.name = want.want_name
  WHERE r.id <> want.expected;

  SELECT string_agg(format('%s is id %s, expected %s', u.email, u.id, want.expected), '; ')
    INTO bad_users
  FROM (
    VALUES
      ('system01@pg.id', 1), ('system02@pg.id', 2), ('system03@pg.id', 3),
      ('system04@pg.id', 4), ('system05@pg.id', 5),
      ('reserved01@pg.id', 6), ('reserved02@pg.id', 7), ('reserved03@pg.id', 8),
      ('reserved04@pg.id', 9), ('reserved05@pg.id', 10),
      ('scheduler01@pg.id', 11), ('scheduler02@pg.id', 12), ('scheduler03@pg.id', 13),
      ('scheduler04@pg.id', 14), ('scheduler05@pg.id', 15), ('scheduler06@pg.id', 16),
      ('scheduler07@pg.id', 17), ('scheduler08@pg.id', 18), ('scheduler09@pg.id', 19),
      ('scheduler10@pg.id', 20)
  ) AS want(want_email, expected)
  JOIN "User" u ON u.email = want.want_email
  WHERE u.id <> want.expected;

  IF bad_roles IS NOT NULL OR bad_users IS NOT NULL THEN
    RAISE EXCEPTION
      'pinned ids do not match the constants in libs/microservice. roles: [%] users: [%]',
      COALESCE(bad_roles, 'ok'), COALESCE(bad_users, 'ok');
  END IF;
END $$;
