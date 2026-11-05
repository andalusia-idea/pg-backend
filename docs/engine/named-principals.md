# Named Principals

Why `superadmin` and `agentinternal` move out of the seed and into a migration,
how they get a real password without one being committed, and the order to
build it in.

Written 5 Nov 2026 against `dev` at `7d9a6c3`. This amends the reasoning in
[20261009090000_machine_principals](../../apps/auth/prisma/migrations/20261009090000_machine_principals/migration.sql)
for these two accounts only - that migration deliberately left them behind, and
§4 explains why that call was right about the credential and wrong about the
row.

---

## 1. Three bands of user id

| Band | Ids | Can sign in | Created by | Password column |
|---|---|---|---|---|
| **Machine** | 1-20 | Never | `machine_principals` migration | `'!locked-machine-principal'` - permanently invalid |
| **Named** | 21-22 | Yes | `named_principals` migration | `'!unset-password'` until first login |
| **Self-service** | 23+ | Yes | registration APIs | argon2 from the start |

The middle band is the new one, and keeping it separate from the first is not
tidiness. A machine principal is *defined* by being unable to sign in -
[microservice.constant.ts:54](../../libs/microservice/src/microservice.constant.ts:54)
states it outright. Superadmin and agentinternal sign in, hold profile rows
(`AdminDetail` / `AgentDetail`), and carry sign-in capable roles. File them
under `MACHINE_USER_ID` and the next person who writes "every machine principal
must be unable to log in" will either break login or weaken that assertion into
nothing.

What the two bands share is that their **emails and ids are structural**. What
they do not share is the credential.

---

## 2. What was broken

> Resolved. `config-engine.seed.ts` has since been deleted outright - the rows
> it wrote are now written by migrations, so the links in this section point at
> a file that no longer exists. The section is kept because the failure it
> describes is the reason for everything below, and because the same shape will
> recur the next time a cross-schema id is resolved by seed ordering.

`config-engine.seed.ts` hardcoded `AGENT_INTERNAL_USER_ID = 22` and created
`config.Agent` at that id. There is no foreign key from `config.Agent` to
`auth.User`, and the seed's own comment was honest about the consequence:

> Nothing verifies them at runtime. There is no foreign key from `config.Agent`
> to `auth.User`, so a wrong id here does not error, it points at nothing. [...]
> Both are silent.

It landed at 22 for two reasons that were both coincidences:
`machine_principals` sets `User_id_seq` to 20, and
[auth-engine.seed.ts:42](../../apps/auth/prisma/seed/auth-engine.seed.ts:42)
happens to upsert superadmin before agentinternal. Swap those two blocks and
agentinternal becomes 21.

### The failure is silent and it moves money

`registerMerchant` creates the `AgentShareholder` row only if
`tx.agent.findUnique({ where: { id: authInfo.userId } })` hits. If agentinternal
is no longer at 22:

1. The lookup misses.
2. The merchant is registered **successfully** - 201, no error, no log.
3. No `AgentShareholder` row exists, so the agent is dropped from every fee
   split for that merchant, permanently, until someone notices a settlement
   number is wrong.

The inverse is worse: whichever real user eventually receives id 22 is treated
as an agent by that lookup.

This is the same class of bug `machine_principals` was written to prevent, for
the same reason - a wrong id does not fail, it attributes things to whoever
holds that id.

---

## 3. The shape: identity in the migration, credential in the environment

Split the two concerns that the seed currently bundles together.

| Concern | Owner | Why there |
|---|---|---|
| Row exists, id, email, role, profile row | the migration | runs once, before any seed, so the id is a contract |
| The password | `INITIAL_SUPER_ADMIN_PASSWORD` / `INITIAL_AGENT_INTERNAL_PASSWORD` | never in version control, different per environment |
| Promoting that password to argon2 | the first successful login | bounded exposure, and it makes the fallback self-extinguishing |
| Rotation afterwards | the password-change API | ordinary application concern |

The migration inserts both accounts with `'!unset-password'`, which no argon2
verification accepts. The first login that matches the environment value writes
`argon2.hash(thatSamePassword)` onto the row in the same request. From then on
it is an ordinary row and the environment value is dead weight.

### Why promote rather than compare forever

Comparing against the environment on every login is simpler and strictly worse:

- **Bounded exposure.** Environment variables leak differently from database
  rows - `docker inspect`, process listings, CI logs, crash dumps, and anything
  that serializes `process.env`. Promotion makes that a window instead of a
  state.
- **The dangerous branch becomes unreachable.** In steady state no row carries
  the sentinel, so a bug in the fallback cannot be reached in a healthy
  production.
- **It is verifiable.** `select email from auth."User" where password =
  '!unset-password'` returning zero rows is a one-line go-live gate. A permanent
  fallback cannot distinguish "activated" from "never touched".
- **It survives review.** manapay operates as a Merchant Aggregator under
  partner PJP licenses, so partner security review is coming. "Admin password
  held in an environment variable indefinitely, compared on every login" is a
  finding. "Set at provisioning, promoted on first login, verifiable as
  promoted" is not.

---

## 4. Rejected alternatives

**A hardcoded argon2 hash in the migration.** What `machine_principals`
correctly refused, in its own words: it "would put the production admin password
in version control, identical in every environment and unchangeable without a
new migration." All three objections are about the *hash*. None is about the
row, which is why pinning the row costs nothing.

**A separate bootstrap script.** Workable, and what the first draft of this
design proposed. The environment is better: it uses a channel the deployment
already treats as secret, there is no extra command to remember at provisioning
time, and recovery needs no local Node or argon2 installation.

**A permanent environment comparison with no promotion.** See §3.

---

## 5. The two guards that are not optional

### 5.1 Gate on the account, never on "the hash is broken"

[auth.helper.ts:14](../../apps/dashboard/src/auth/auth.helper.ts:14) already
swallows malformed-hash errors:

```ts
} catch {
  // argon2 throws on a malformed hash; treat that as "does not match"
  return false;
}
```

That `catch` is the obvious place to put the fallback and the wrong one. It
fires for *every* invalid-hash row in the table, so the provisioning password
would authenticate against all of them.

Today that happens to be survivable, but only by accident: the 20 machine
principals reach `findProfileIdByUserIdAndRole`, hit `default:` because
`PROFILE_KIND_BY_ROLE` omits SYSTEM and SCHEDULER, and get a 401 from
[auth.service.ts:80](../../apps/dashboard/src/auth/auth.service.ts:80). The
credential check would be wide open and the thing saving it would be a `switch`
about *profile lookups*. Any future locked row with a sign-in capable role - or
one truncated password column after a bad restore - walks straight through.

Two independent conjuncts, both in `validateUser`, neither in the helper:

```ts
user.id === 21 || user.id === 22     // the account we meant
&& user.password === UNSET_PASSWORD  // exact sentinel, not "argon2 threw"
```

This is why `'!unset-password'` must be a **different string** from
`'!locked-machine-principal'`. The difference is a security boundary, not a
label.

### 5.2 Refuse empty, short and committed values

- Unset gives `undefined`; never compare.
- **Empty must be refused.** `INITIAL_SUPER_ADMIN_PASSWORD=` plus a submitted
  empty string would otherwise authenticate.
- Minimum 16 characters in production.
- **Refuse values committed to this repository.** `password123456789` is both
  `SEED_PASSWORD` and the value `.env.example` and `.env.test` give these two
  keys, and every `.env.test` is tracked. The realistic failure is someone
  copying `.env.test` onto a server, which would silently publish the admin
  password. Note that the length rule does **not** catch it - at 17 characters it
  clears the 16-character minimum, so the named list is the only thing that
  does. `change-me` is refused for the same reason: it is the placeholder
  `.env.example` uses for secrets.

### 5.3 Compare in constant time

`argon2.verify` is already constant-time. A plain `===` on the fallback path is
a timing oracle against the one password that owns everything. Hash both sides
to a fixed length first, so `timingSafeEqual` cannot throw on a length mismatch:

```ts
const constantTimeEqual = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(),
                  createHash('sha256').update(b).digest());
```

---

## 6. Build order

> **Status, 2026-11-05: built, and three things shipped differently from the
> plan below.** The steps are kept as written because the reasoning still
> explains the design, but where they disagree with the code, the code is right.
>
> | Planned | Shipped |
> | --- | --- |
> | `configuredCount()` checked at boot | not implemented; a bad value surfaces at the activation login, logged as an error and answered 401 |
> | Step 5: the auth seed stops creating 21 and 22 | the seed still upserts both. Its `update: {}` leaves an existing row alone, so the migration's sentinel survives a re-seed - which makes the step unnecessary rather than skipped |
> | Step 6: promote on first login | **not done, by decision.** Resetting both passwords is the first protocol after go-live, via `POST /super-admin/reset-password`. Each activation login logs a warning naming that endpoint |
>
> The consequence of the last one is worth stating plainly: the provisioning
> password stays a valid credential until someone resets it, rather than dying
> at first use. Section 7 carries it as an open item.

Do not start a step until the previous step's check passes. Steps 1-5 are all
database and configuration; step 6 is the only one that touches the login path,
and by then everything it depends on is already verified.

| # | Step | How you know it worked |
|---|---|---|
| 1 | Constants | `npx tsc --noEmit` - catches anything still on `FIRST_HUMAN_USER_ID` |
| 2 | config engine seed imports the constant | same |
| 3 | The migration | `npm run db:test:all` applies it clean on a reset |
| 4 | `PrincipalConfig` + module + barrel + env | dashboard boots and logs the configured count |
| 5 | Seed becomes an activation step | reset + engine seed, then sign in as agentinternal |
| 6 | Login fallback | the activation login works, and keeps working on every later login until a reset - unsetting the env var alone makes it 401 |

### Step 1 - Constants

In [microservice.constant.ts](../../libs/microservice/src/microservice.constant.ts),
replacing `FIRST_HUMAN_USER_ID` at the bottom of the file:

```ts
/**
 * The two named principals, pinned by the `named_principals` migration.
 *
 * Distinct from MACHINE_USER_ID above, and the distinction carries weight: a
 * machine principal is *defined* by being unable to sign in, while these two
 * sign in, hold profile rows, and carry sign-in capable roles. Filing them
 * under MACHINE_USER_ID would make "every machine principal must be unable to
 * log in" either false or unenforceable.
 *
 * Pinned because apps/config's engine seed creates `config.Agent` at
 * AGENT_INTERNAL's id with no foreign key behind it - see the migration header
 * for what a shifted id costs.
 */
export const NAMED_PRINCIPAL_USER_ID = {
  SUPER_ADMIN: 21,
  AGENT_INTERNAL: 22,
} as const;
export type NAMED_PRINCIPAL_USER_ID =
  (typeof NAMED_PRINCIPAL_USER_ID)[keyof typeof NAMED_PRINCIPAL_USER_ID];

/**
 * The password value the `named_principals` migration writes for an account
 * that has not been activated yet.
 *
 * Not a valid argon2 hash, so `argon2.verify` rejects it - the same trick the
 * machine principals use. It is a different string from
 * '!locked-machine-principal' on purpose, and that difference is a security
 * boundary rather than a label: the login path treats this exact value as
 * "compare the submitted password against the provisioning password in the
 * environment", and a machine principal must never qualify for that.
 *
 * Compare it with `===`. Never infer it from `argon2.verify` throwing - that is
 * true of *any* malformed hash, including a truncated or corrupted column, and
 * would hand the provisioning password to rows it was never meant for.
 */
export const UNSET_PASSWORD = '!unset-password';

/** The id the first self-service account receives. Everything below is pinned. */
export const FIRST_SELF_SERVICE_USER_ID = 23;
```

`FIRST_HUMAN_USER_ID` has no callers, so replacing it is free. Its name was also
becoming a lie - 21 and 22 *are* human accounts.

### Step 2 - The config engine seed

As planned, this step had `config-engine.seed.ts` import
`NAMED_PRINCIPAL_USER_ID.AGENT_INTERNAL` and delete its local
`const AGENT_INTERNAL_USER_ID = 22` together with the comment above it - that
comment warned about something the migration had just fixed, and a stale warning
is worse than none.

**What actually happened went further: the file was deleted.** Importing the
constant removes the *wrong value* but leaves the *second writer*, and two
writers for one row is the thing worth removing. The rows moved to migrations
instead:

| Row | Now written by |
| --- | --- |
| `config.Agent` 22 | `20261105170000_named_principals` |
| `Provider` INTERNAL | `20261105200000_provider_and_payment_methods` |
| 8 `PaymentMethod` rows | `20261105200000_provider_and_payment_methods` |

Banks still come from `bankEngineSeed`, so `apps/config/prisma/seed/index.ts`
keeps its engine tier - it just has one function in it now. The config migration
also carries the assertion this step could not: it reads `auth."User"` and
refuses to apply if id 22 is not agentinternal, guarded by `to_regclass` so it
is a no-op on a database where auth has not migrated yet.

### Step 3 - The migration

`apps/auth/prisma/migrations/20261105090000_named_principals/migration.sql`:

```sql
-- Pin the two named principals so their ids are a contract, not seed ordering.
--
-- Amends 20261009090000_machine_principals for these two accounts only. That
-- migration left them in the seed to keep an argon2 hash out of version
-- control, and that reasoning still holds - what moves here is their
-- *identity*, not their credential. The password column carries a sentinel no
-- argon2 verification accepts; a real password arrives per environment.
--
-- Why the identity has to be pinned: apps/config/prisma/seed/
-- config-engine.seed.ts creates `config.Agent` at a hardcoded id 22, and there
-- is no foreign key from config.Agent to auth.User. Today agentinternal lands
-- at 22 only because User_id_seq is set to 20 and the auth engine seed happens
-- to upsert superadmin first. Reorder those two upserts, restore a dump, or
-- import a legacy user, and agentinternal moves with no error. The dashboard's
-- registerMerchant then misses its `tx.agent.findUnique({ id: registrarId })`
-- lookup and registers the merchant *successfully* with no AgentShareholder
-- row - silently dropping the agent from every fee split for that merchant.
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
```

The detail-row values are copied verbatim from the seed, so a database that has
already been seeded ends up identical to one that starts from this migration.

**Verify**, after `npm run db:test:all`:

```sql
select id, email, "roleId", password from auth."User" where id in (21, 22);
```

Both rows at exactly those ids. If an environment disagrees the migration
refuses to apply and names the row, rather than letting it through.

### Step 4 - `PrincipalConfig`

`libs/configuration/src/principal.config.ts`:

**This is the shipped file**, reproduced from
[principal.config.ts](../../libs/configuration/src/principal.config.ts). It
differs from the draft this section originally carried in two ways, both
deliberate: `read` throws on an empty or missing key rather than returning
`null`, and there is no `configuredCount` boot check - see the note at the top
of Step 6 for why.

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from './app.config';

/**
 * Minimum length for a provisioning password in production.
 *
 * A floor and nothing more. It does not exclude the seed password: SEED_PASSWORD
 * is `password123456789`, 17 characters, which clears this comfortably.
 * REFUSED_IN_PRODUCTION is what actually keeps that value out.
 */
const MIN_LENGTH_PRODUCTION = 16;

/**
 * Values refused in production outright, whatever their length.
 *
 * This list, not MIN_LENGTH_PRODUCTION, is what stands between a production
 * deploy and a credential that is committed to this repository.
 *
 * `password123456789` is both SEED_PASSWORD and the value .env.example and
 * .env.test use for these two keys, so it reaches production by either of the
 * two routes that actually happen: a seeded database, or an example env file
 * copied onto a server. At 17 characters no length rule will ever catch it -
 * which is the whole reason this list exists and cannot be folded into the one
 * above.
 *
 * `change-me` is the .env.example placeholder for a secret.
 *
 * `password123` was SEED_PASSWORD until 2026-11-05 and no longer appears in the
 * repository. It stays listed because it is still in git history, and in any
 * .env file copied before that change.
 */
const REFUSED_IN_PRODUCTION = ['password123', 'password123456789', 'change-me'];

@Injectable()
export class PrincipalConfig {
  constructor(
    private readonly configService: ConfigService,
    private readonly appConfig: AppConfig,
  ) {}

  private read(key: string): string {
    const raw = this.configService.get<string>(key);

    if (raw === '' || raw === undefined)
      throw new Error(`key [${key}] cannot be empty`);

    /// Local and test are exempt from both rules below so the UAT specs can use
    /// the committed value. It only matters there if a named principal is still
    /// unactivated: once the account holds a real argon2 hash, the login path
    /// never consults this at all.
    if (!this.appConfig.IS_PRODUCTION) return raw;

    if (raw.length < MIN_LENGTH_PRODUCTION) {
      throw new Error(
        `key [${key}] must be at least ${MIN_LENGTH_PRODUCTION} characters in ` +
          `production - until that account's first login it is the only ` +
          `credential standing in front of a named principal`,
      );
    }

    if (REFUSED_IN_PRODUCTION.includes(raw)) {
      throw new Error(
        `key [${key}] is set to a value committed to this repository. This ` +
          `usually means an .env.example or .env.test was copied onto a ` +
          `server - generate a value instead`,
      );
    }

    return raw;
  }

  get INITIAL_SUPER_ADMIN_PASSWORD(): string {
    return this.read('INITIAL_SUPER_ADMIN_PASSWORD');
  }

  get INITIAL_AGENT_INTERNAL_PASSWORD(): string {
    return this.read('INITIAL_AGENT_INTERNAL_PASSWORD');
  }
}
```

Register `PrincipalConfig` in both `providers` and `exports` of
[configuration.module.ts](../../libs/configuration/src/configuration.module.ts),
next to `JwtConfig`, and add `export * from './principal.config';` to
[index.ts](../../libs/configuration/src/index.ts).

Call `configuredCount()` once from the dashboard's `bootstrap()` and log it, so
a bad value refuses to boot instead of surfacing at someone's login.

`apps/dashboard/.env.example` gains the two keys. Note what is committed
there - the seed password, not an empty value:

```bash
# Principal
INITIAL_SUPER_ADMIN_PASSWORD="password123456789"
INITIAL_AGENT_INTERNAL_PASSWORD="password123456789"
```

`apps/dashboard/.env.test` carries the same two values, which is what lets the
UAT specs sign in untouched. Both are honoured only while the account still
carries the migration's sentinel: once a reset writes a real argon2 hash they
stop being read, and can be unset.

This is also the clearest case for why `REFUSED_IN_PRODUCTION` is not redundant
with the length rule. A copied `.env.example` reaches a server holding a working
admin password, and at 17 characters it clears `MIN_LENGTH_PRODUCTION` without
help. The named list is the only thing that refuses it.

### Step 5 - The seed becomes an activation step

[auth-engine.seed.ts](../../apps/auth/prisma/seed/auth-engine.seed.ts) stops
creating the two accounts. What is left is giving them a working password
outside production, and only while they still carry the sentinel - so
re-running can never rotate a password an operator set.

`EngineSeedResult` goes away with it:
[index.ts:67](../../apps/auth/prisma/seed/index.ts:67) already discards the
return value, and after this the ids are constants rather than something the
seed discovers.

### Step 6 - The login fallback

Shipped, but without the promotion the step was drafted around - see the status
note at the head of this section. The fallback compares and signs in; it never
rewrites the password column.

In [auth.service.ts](../../apps/dashboard/src/auth/auth.service.ts),
`validateUser` dispatches on the sentinel before argon2 is reached:

```ts
    // An unactivated named principal: the migration wrote a sentinel instead of
    // a hash, so there is nothing for argon2 to verify against and the
    // provisioning password from the environment stands in for one login.
    //
    // The two branches are disjoint on purpose. Falling through to
    // verifyPassword on a failed activation would work - argon2 rejects the
    // sentinel - but it would also mean the provisioning path is reachable from
    // the normal path, and the whole point of UNSET_PASSWORD being a distinct
    // string from LOCKED_MACHINE_PASSWORD is that those two paths never meet.
    if (user.password === UNSET_PASSWORD) {
      return this.activateNamedPrincipal(user, password);
    }
```

The branch it dispatches to, and the lookup behind it:

```ts
  /**
   * Signs in a named principal that still carries UNSET_PASSWORD, by comparing
   * the submitted password against the provisioning password in the
   * environment.
   *
   * Only ids 21 and 22 have one. Anything else holding the sentinel - a row
   * hand-edited, restored from a dump, or a machine principal whose password
   * column was tampered with - gets null, because
   * `provisioningPasswordFor` has nothing to offer it.
   */
  private async activateNamedPrincipal(
    user: { id: number; role: { name: string } },
    password: string,
  ): Promise<AuthInfoDto | null> {
    let provisioningPassword: string;
    try {
      const configured = this.provisioningPasswordFor(user.id);
      if (configured === null) return null;
      provisioningPassword = configured;
    } catch (error) {
      // PrincipalConfig throws when the key is missing, or set to something it
      // refuses in production. That is a deployment fault, not a credential
      // fault: log it so it is findable, and still answer 401 rather than
      // telling an anonymous caller that the server is misconfigured.
      this.logger.error(
        `Named principal ${user.id} is unactivated and its provisioning ` +
          `password is unusable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    if (!AuthHelper.secretEquals(provisioningPassword, password)) return null;

    // Role and profile are read, never assumed. The migration asserts this
    // account's roleId, so reading it costs nothing and cannot drift; and the
    // detail row's id is left to the sequence by that same migration, so there
    // is no constant to hardcode it from. It happens to be 1 on a database
    // seeded in the usual order, which is precisely what makes hardcoding it
    // dangerous - it would pass every local test and sign a wrong profileId
    // into the JWT on a restored or differently-ordered database.
    const role = user.role.name as ROLE;
    const profileId = await this.findProfileIdByUserIdAndRole(user.id, role);

    this.logger.warn(
      `Named principal ${user.id} signed in with its provisioning password. ` +
        `Reset it via POST /super-admin/reset-password.`,
    );

    return new AuthInfoDto({ userId: user.id, profileId, role });
  }

  /** The provisioning password for a named principal, or null for anything else. */
  private provisioningPasswordFor(userId: number): string | null {
    switch (userId) {
      case NAMED_PRINCIPAL_USER_ID.SUPER_ADMIN:
        return this.principalConfig.INITIAL_SUPER_ADMIN_PASSWORD;
      case NAMED_PRINCIPAL_USER_ID.AGENT_INTERNAL:
        return this.principalConfig.INITIAL_AGENT_INTERNAL_PASSWORD;
      default:
        return null;
    }
  }
```

What the plan called for and this does not do is promote the password on first
use:

```ts
const provisioning = this.provisioningPasswordFor(user);
if (provisioning) {
  if (!constantTimeEqual(provisioning, password)) return null;

  /// Promote: from here on this is an ordinary argon2 row and the environment
  /// fallback is dead for this account. Conditional on the sentinel so two
  /// concurrent first logins are idempotent rather than racing two writes.
  await this.prismaMaster.user.updateMany({
    where: { id: user.id, password: UNSET_PASSWORD },
    data: {
      password: await AuthHelper.hashPassword(password),
      updatedAt: new Date(),
      updatedBy: SYSTEM_USER_ID,
    },
  });
  this.logger.warn(
    { userId: user.id },
    'named principal activated from provisioning password - rotate it now',
  );
} else if (!(await AuthHelper.verifyPassword(user.password, password))) {
  return null;
}
```

What dropping that leaves:

- **No master client is needed.** The plan's one structural change was
  injecting `PRISMA_MASTER_PROVIDER_KEY` into `AuthService`, which still has
  only the slave. That existed solely to carry the promotion write; a
  comparison reads nothing it does not already have.
- **Replica lag never arises**, for the same reason. Nothing is written, so
  there is no window in which the slave still shows the sentinel after the
  master has moved on.
- **A `WARN` on every activation login, not just the first** - shipped, and it
  names the reset endpoint. Because the password is never promoted, that line
  is the only signal that an account is still carrying its provisioning
  password, and it keeps appearing until someone resets it.

---

## 7. What this does not solve

- **Rotation.** The password-change API is still needed: "change my own
  password" requiring the current one, and a SUPER_ADMIN-only "reset someone
  else's" that forces a change on next login. There is no password endpoint in
  the dashboard today.
- **`RolesGuard` is implemented but not registered**
  ([app.module.ts](../../apps/dashboard/src/app/app.module.ts)), so
  `@Roles(ROLE.SUPER_ADMIN)` is currently decoration. Registering it changes
  two existing endpoints: `register-merchant` becomes AGENT-only via
  `MERCHANT_REGISTRAR_ROLES`, which means SUPER_ADMIN could not register a
  merchant, and `register-agent` becomes SUPER_ADMIN + ADMIN. Decide whether
  SUPER_ADMIN belongs in `MERCHANT_REGISTRAR_ROLES` before turning it on.
- **Lockout recovery** is `update auth."User" set password = '!unset-password'
  where id = 21`, then set the environment value and restart. That needs
  database access *and* deploy access - two hands on the lever, which is the
  right bar for this.
- **Enforcing exactly one SUPER_ADMIN.** A partial unique index on
  `"roleId" WHERE "roleId" = 3` turns the policy into a constraint, at the cost
  of making a handover demote before it promotes.
- **agentinternal is a shared account.** Ops signs in as it daily to onboard
  merchants, so `createdBy` says "agentinternal" for every merchant regardless
  of who did it - no per-person audit trail on the one action that creates fee
  splits. Fine for UAT and bootstrap. Long term each ops person should hold
  their own AGENT account, with agentinternal reserved as the system's default
  agent identity for `config.Agent` id 22. Same principle as SUPER_ADMIN: the
  pinned accounts are structure, not daily drivers.
