-- Pin the two named principals so their ids are a contract, not seed ordering.
--
-- Amends 20261009090000_machine_principals for these two accounts only. That
-- migration left them in the seed to keep an argon2 hash out of version
-- control, and that reasoning still holds - what moves here is their
-- *identity*, not their credential. The password column carries a sentinel no
-- argon2 verification accepts; a real password arrives per environment.
--
-- Why the identity has to be pinned: `config.Agent` holds a row at agentinternal's
-- id, written by apps/config's 20261105170000_named_principals with 22 spelled
-- out, and there is no foreign key from config.Agent to auth.User to hold the
-- two together. They are in different schemas, migrated by different apps, and
-- nothing but this pinning makes them agree.
--
-- Before this migration, agentinternal landed at 22 for two reasons that were
-- both coincidences: User_id_seq is set to 20 by 20261009090000, and the auth
-- engine seed happens to upsert superadmin before agentinternal. Reordering
-- those two upserts, restoring a dump, or importing a legacy user moved it with
-- no error.
--
-- What a disagreement costs: the dashboard's registerMerchant misses its
-- `tx.agent.findUnique({ id: registrarId })` lookup and registers the merchant
-- *successfully* with no AgentShareholder row - silently dropping the agent from
-- every fee split for that merchant, with no error and no log line.
--
-- The config side asserts this rather than assuming it: that migration reads
-- auth."User" and refuses to apply if 22 is not agentinternal@pg.id.
--
-- These are NOT machine principals. They sign in, they hold profile rows, and
-- their roles are sign-in capable. Ids 1-20 are machine, 21-22 are named,
-- 23+ is self-service.

-- Named principals.
--
-- '!unset-password' is not a valid argon2 hash, so verification rejects it and
-- neither account can be signed into until it is activated. Deliberately a
-- DIFFERENT string from the machine principals' '!locked-machine-principal':
-- the login path treats this exact value as "compare against the provisioning
-- password in the environment", and a machine principal must never qualify.
--
-- ON CONFLICT DO NOTHING is load-bearing. On every database the seed has
-- already populated, these rows exist with a working argon2 hash, and this
-- migration must not reset a live production password.
INSERT INTO "User" ("id", "email", "password", "roleId", "createdAt", "createdBy") VALUES
  (21, 'superadmin@pg.id',    '!unset-password', 3, now(), 1),
  (22, 'agentinternal@pg.id', '!unset-password', 5, now(), 1)
ON CONFLICT ("email") DO NOTHING;

-- GREATEST rather than a bare setval: on a database that already holds users
-- above 22 - a restore, or an environment seeded before this migration existed
-- - rewinding the sequence makes the next signup collide on the primary key.
-- (20261009090000 sets 20 unconditionally and carries that latent bug.)
SELECT setval(
  '"User_id_seq"',
  GREATEST(22, (SELECT COALESCE(max("id"), 0) FROM "User")),
  true
);

-- Verify BEFORE the detail inserts, not after.
--
-- The insert above skips on conflict, which is only correct if the existing
-- rows are already at the expected ids. If an environment created superadmin
-- somewhere else, no row exists at id 21 - and the AdminDetail insert below
-- would then fail on a foreign key, with an error naming a constraint instead
-- of the problem. Checking here produces a message that names the row.
--
-- roleId is asserted as well as id: a demoted superadmin makes every
-- @Roles(SUPER_ADMIN) endpoint unreachable, with no error anywhere.
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(
           format('%s is id %s role %s, expected id %s role %s',
                  u.email, u.id, u."roleId", want.id, want.role),
           '; ')
    INTO bad
  FROM (
    VALUES
      ('superadmin@pg.id',    21, 3),
      ('agentinternal@pg.id', 22, 5)
  ) AS want(email, id, role)
  JOIN "User" u ON u.email = want.email
  WHERE u.id <> want.id OR u."roleId" <> want.role;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'named principals do not match NAMED_PRINCIPAL_USER_ID in libs/microservice: [%]',
      bad;
  END IF;
END $$;

-- Profile rows.
--
-- Required, not cosmetic: AuthService.findProfileIdByUserIdAndRole throws
-- ApiError.notFound('Admin profile') when the row is missing, so an account
-- with a correct password and no detail row still cannot complete a login.
--
-- Ids are left to the sequence - no constant names them, so there is nothing to
-- pin. ON CONFLICT infers the unique index on "userId".
INSERT INTO "AdminDetail" ("fullname", "address", "phone", "userId", "createdAt", "createdBy")
VALUES ('Super Admin', 'Jl. Super Admin', '00000000', 21, now(), 1)
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "AgentDetail" (
  "fullname", "address", "phone",
  "bankCode", "bankName", "accountNumber", "accountHolderName",
  "userId", "createdAt", "createdBy"
) VALUES (
  'Agent Internal', 'Jl. Agent Internal', '00000000',
  'default', 'default', 'default', 'default',
  22, now(), 1
)
ON CONFLICT ("userId") DO NOTHING;
