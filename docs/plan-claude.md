# Migrate 4 standalone NestJS microservices into the `pg` monorepo (production-grade revamp)

> **Scope change (12 Aug 2026): `settlerecon` is deferred and out of current scope.** The `apps/settlerecon` skeleton has been removed from the monorepo, along with its nest-cli project entry, npm scripts, TCP config getter, k8s manifest, ingress route, nginx upstream, docker-compose service, CI/CD matrix entry, and the `CLIENT_SETTLERECON_*` env vars. The migration target is now **3 apps: auth, config, transaction.**
>
> Audit findings about the *legacy* settlerecon-service are kept below — it still runs in production, and its schema/settlement design directly informs the `apps/transaction` work. Read them as reference material, not as a build plan. If settlerecon comes back into scope, this section is where to restart.

## Context

The user runs 4 separately-deployed NestJS microservices in production — **auth**, **config**, **transaction**, **settlerecon** — each its own repo, each communicating with the others over TCP microservice calls. They now have more time and want to consolidate them into the NestJS monorepo at `C:\le\andalusia\pg`. *(As originally written this plan targeted all 4; per the scope change above, `settlerecon` is deferred and the target is auth + config + transaction.)*

This is explicitly framed as a **revamp**, not a mechanical copy: rewire everything, verify every business process, and reach a production-grade bar before this goes live. Reference material for the migration is 4 zip snapshots of the legacy standalone repos, supplied at:
- `C:\prelion\pg\auth-service\auth.zip`
- `C:\prelion\pg\config-service\config.zip`
- `C:\prelion\pg\transaction-service\transaction.zip`
- `C:\prelion\pg\settlerecon-service\settlerecon.zip`

A full audit of all 4 (structure, business logic, shared plumbing, security posture) was completed before writing this plan. Decisions the user already confirmed:
- **Sequencing**: dependency order — finish `auth`, then `config`, then `transaction`. ~~then `transaction`+`settlerecon` together~~ — superseded by the scope change above; `transaction` is now ported alone, though the unified-schema reasoning below still applies to how its schema is designed.
- **Ambiguous/dead legacy code** (Zipay integration, an orphaned `NetzmeModule`, 3 orphaned settlement TCP handlers, a non-functional reconciliation upload): flag each with findings + a suggested action when its module comes up for porting, rather than deciding all of it now.
- **Security remediation is required, blocking work** — not a fast-follow backlog.
- **Port style**: consolidate duplicated code into shared libs and fix clear bugs while porting, while preserving every real business rule exactly.

## What the audit found (headline facts driving this plan)

- **`auth`'s Prisma schema already matches the monorepo's** (7 models: Role, Permission, User, AdminDetail, AgentDetail, MerchantDetail, MerchantSignature) — but **none of its 7 business modules are ported yet** (users, roles, permissions, agent-detail, merchant-detail, merchant-signature, CASL). Only DB/Redis/audit plumbing exists so far.
- **121 files are byte-for-byte identical across all 4 legacy services** — the entire inter-service TCP client layer (`src/microservice/**`, 79 files) and a shared helper layer (`src/shared/**`, 42 files). This is a clean, unambiguous shared-lib extraction.
- **`config` and `transaction` need to be built from scratch** in the monorepo (schema, DB module, every business module). *(Originally also `settlerecon` — now deferred.)*
- **`transaction` and `settlerecon` currently run two divergent forked Prisma schemas against what looks like the same physical Postgres tables** (`Int` vs `BigInt` PKs, different decimal precision, different timestamp-management strategy). Still relevant with settlerecon deferred: `apps/transaction`'s schema should be designed to serve *both* uses, so a future settlerecon doesn't re-fork it. See Phase 3.1.
- **Real bugs to fix while porting**: a `ZipayProviderClient` that calls PDN's TCP cmd/URL instead of its own (bug exists identically in all 4 copies); a settlement cron using `'0 */90 * * * *'` (invalid — minutes can't step by 90); `user-provider` hardcoding the literal provider name `'aaa'` for admin transactions; CASL `@CheckPolicies` enforcement wired up but commented out on almost every controller; `CaslCacheService` caches permissions forever in an in-memory `Map` with no TTL and a `clearCache()` that's never called.
- **Security gaps that must be closed before launch**: legacy `.gitignore`s have the `.env` exclusion lines commented out, so DB password / JWT secrets / an encryption key look actually committed to those git histories; hardcoded API tokens/keys in source for Inacash, Payhere, Pakaidonk, and a PDN Ed25519 **private key duplicated 3 times in source** (service file, a comment block, and a standalone debug script); **none of the 4 payment-provider webhook callbacks verify a signature** before trusting a payin/payout status update.

## Target architecture — what becomes a shared lib vs. stays per-app

New libs to create (joining the existing `libs/{configuration,date-time,redis,logger}`):

| Lib | Contents (ported from legacy `src/microservice/**` + `src/shared/**`) |
|---|---|
| `libs/microservice-clients` | The `SERVICES` cmd/path/url registry + all 14 `*.client.ts` TCP client classes + their system DTOs. Fix the Zipay cmd bug and the missing `@Injectable()` on `ZipayProviderClient` while porting. Decide whether to add the missing Payhere client for parity (currently the only provider with no client stub). |
| `libs/auth` (new) | `JwtAuthGuard`, `RolesGuard`, `MerchantSignatureHeadersGuard`, `JwtStrategy`, the `@PublicApi/@SystemApi/@MerchantApi/@Roles/@CurrentAuthInfo` decorators, `AuthInfoDto`, `ROLE` enum — plus a typed `JwtConfig` (extends the existing `libs/configuration` pattern) replacing the legacy raw `process.env` reads. |
| `libs/common` (new) | `ApiError`/`DependencyErrorContext`/`DependencyErrorHelper`, `ResponseException`/`ResponseDto`. Normalize onto the newer `DependencyErrorHelper.withFallback()` pattern only — the legacy code has two competing fallback implementations (older raw try/catch+console.log vs. this one); don't port the older one. |
| `libs/logger` (existing stub → finished) | Wire the already-added `nestjs-pino`/`pino-http` deps into a real `LoggerService`. This replaces ~30+ scattered `console.log`/`console.error` calls across the legacy code and the buggy `MyLogger.logToConsole()` pattern (calls `.close()` on the Winston transport after every single log line) plus its local `./logs/*.log` file writes — the monorepo should log to stdout, ready for centralized shipping in a containerized deploy. |
| `libs/configuration` (existing → extended) | Add `JwtConfig`. Reconcile the TCP port scheme — legacy uses 4000-4003, the monorepo's `apps/auth/.env.example` already stubs 4001-4004; pick one. Decide the fate of `ENCRYPTION_KEY` (declared in every legacy `.env` but referenced by zero source code — likely drop, confirm with user when reached). |

CASL stays **auth-app-local** (it's an in-process ability cache keyed to auth's own Role/Permission tables — not shared TCP plumbing, and `config`-service's `@casl/*` deps were confirmed dead/unused). Payment-provider integrations (Inacash/PDN/Pakaidonk/Payhere/Zipay) were scoped to `apps/settlerecon` and are **deferred with it** — no provider integration is in current scope. When they return, decide then whether they live in the app that owns them or in a shared lib.

## Phased roadmap

### Phase 0 — Foundations (do this first; unblocks everything else)
1. Create `libs/microservice-clients`, `libs/auth`, `libs/common` (scaffold via `nest g library`, matching the existing lib pattern in [nest-cli.json](nest-cli.json)/[tsconfig.json](tsconfig.json)).
2. Port the `SERVICES` registry + 14 TCP clients into `libs/microservice-clients`, fixing the Zipay bug and `@Injectable()` gap.
3. Port guards/strategy/decorators into `libs/auth`; add `JwtConfig` to `libs/configuration`.
4. Finish [libs/logger/src/logger.service.ts](libs/logger/src/logger.service.ts) with real `nestjs-pino` wiring.
5. Add missing root dependencies confirmed by the audit: `passport`, `passport-jwt`, `@nestjs/jwt`, `class-validator`, `class-transformer`, `argon2`, `canonicalize`, `decimal.js`, `@casl/ability`+`@casl/prisma` (auth only), `uuid` — standardize on the newer major versions found (e.g. `uuid@13`, not the `^9` used by 3 of the 4 legacy services).
6. Rotate every credential the audit found exposed in the legacy repos (DB password, JWT secrets, encryption key, Inacash token, Payhere API key, Pakaidonk sandbox creds, PDN Ed25519 key + webhook secret) — do this regardless of migration progress, since those repos/keys must be treated as compromised the moment they were committed.

### Phase 1 — Finish `apps/auth`
Port the 7 business modules (users incl. `UserProfileService`, roles, permissions, agent-detail, merchant-detail, merchant-signature, CASL) into `apps/auth/src/modules/`, wired through [apps/auth/src/app/app.module.ts](apps/auth/src/app/app.module.ts).

Mechanical adaptation needed everywhere: every legacy service used one `PRISMA_SERVICE` token — the monorepo's [apps/auth/src/database/database.module.ts](apps/auth/src/database/database.module.ts) already splits master/slave, so each ported query needs a deliberate read-vs-write choice. The monorepo's existing [apps/auth/src/database/audit.extension.ts](apps/auth/src/database/audit.extension.ts) is already a strict superset of the legacy `audit.extension.ts` + `timestampz.extension.ts` (it also handles restore-from-soft-delete, which legacy doesn't) — don't port either legacy extension file.

Fix-as-we-go items (per the user's "consolidate + fix" choice):
- `CaslCacheService`: move off the unbounded in-memory `Map` onto `libs/redis` (already wired into `apps/auth`, currently unused) with a real TTL and actual invalidation on role/permission change (`clearCache()` exists in legacy but is never called).
- Decide and apply consistent `@CheckPolicies` enforcement (today it's wired up but commented out on agent-detail/permissions/merchant-signature/most of users — only `RolesController` and half of `MerchantDetailController` actually enforce it).
- Fix the dead-exception bug in `LocalStrategy.validate()` (constructs an `UnauthorizedException` but never throws it), the `RolesService` soft-delete filter inconsistency, and the substring-based role matching in `findProfileIdByUserIdAndRole` (use enum comparison).
- Merchant-signature: add nonce replay protection (currently only timestamp freshness is checked) and make `previousSecretKey` actually usable as a rotation grace period (it's stored but never checked).
- Route all logging through `libs/logger` instead of the ~30+ `console.log` call sites, including the one in `jwt-auth.guard.ts` that currently logs on every authenticated request.

### Phase 2 — Build `apps/config` from scratch
1. Port the Prisma schema (9 models + `TransactionTypeEnum`: Bank, Merchant, Agent, AgentShareholder, Provider, PaymentMethod, BaseFee, MerchantFee, Common) and a `DatabaseModule` mirroring the pattern now established in `apps/auth`.
2. Port `common`, `merchant`, `agent`, `user-provider` modules.
3. **Consolidate the 4 near-identical fee calculators** (purchase/topup/withdraw/disbursement — ~95% duplicated) into one parameterized fee-calculation service, preserving the direction-of-application business rule exactly: fees are *deducted* from nominal for PURCHASE/TOPUP, *added on top* for WITHDRAW/DISBURSEMENT.
4. `reconciliation` module is a no-op stub in legacy (cron only stamps a timestamp, does no real work) — flag with findings when reached, per the agreed policy.
5. `settlement-scheduler`: fix the invalid `*/90` cron expression; add a distributed lock (Redis is available) since this and the reconciliation cron have no leader-election today and would double-fire across replicas.
6. The hardcoded `'aaa'` provider fallback in `user-provider` needs a real value from the user — surface this explicitly when this module comes up, since guessing wrong would misroute real admin transactions.

### Phase 3 — Build `apps/transaction`
Originally scoped as `transaction` + `settlerecon` together, since the pair shares one Postgres schema in legacy (forked into two incompatible Prisma clients). With settlerecon deferred, only `transaction` gets built — but design its schema as the *single* schema for that Postgres namespace, so a future settlerecon extends it rather than re-forking it:
1. Design one unified Prisma schema for the shared `"transaction"` schema. Recommend basing it on settlerecon's more rigorous version (`BigInt` PKs, explicit `Decimal(18,2)`/`Decimal(10,2)` precision, the composite indexes tuned for settlement/reconciliation queries) plus the `timestampzExtension` pattern, rather than transaction-service's looser types.
2. Port the **balance ledger + Postgres advisory-lock pattern** bit-for-bit correct — this is the highest-risk piece of logic in the whole migration (global lock id 30 + per-merchant `(10,id)`/per-agent `(20,id)` locks around append-only `*BalanceLog` inserts; "current balance" = latest row by id, no running total column).
3. Port the transaction **code-format correlation key** (`{timestampMs}{type}{method}{provider}-{userId}[-random]`) and its parsing regex exactly — it's load-bearing for every callback path.
4. `apps/transaction`: purchase, topup, withdraw, disbursement, balance, and the merchant-facing Open API v1. Drop the confirmed-orphaned `NetzmeModule` (never imported) and the fully-commented-out dead code in `disbursement.service.ts` (the real disbursement logic lives in `Disbursement1Api` instead) — surface both explicitly rather than silently omitting.
5. Add retry/backoff (or a Redis-backed queue) for the currently fire-and-forget merchant webhook delivery — a concrete "production grade" gap the audit flagged.

**Deferred with settlerecon** (kept here so nothing is lost if it returns to scope):
- `apps/settlerecon` modules: balance (decide single-source-of-truth vs. read-only relative to transaction's copy), settlement (the two-phase pending→active balance mover — port its `Serializable`-isolation + retry-on-`P2034` pattern carefully), reconciliation (currently parses uploads but never persists results — decide finish-it vs. preserve-as-stub).
- **Provider integrations + their security remediation**: for Inacash/PDN/Pakaidonk/Payhere, move every hardcoded credential/key to `libs/configuration`-managed env vars with no source fallback, and add webhook-signature verification before any callback payload is trusted (today none of the 4 verify anything). Drop the two orphaned `mtcpay-*.js` debug scripts and the unreferenced Pakaidonk `.pem` file pair (confirm truly unused before deleting). Zipay: broken client + blank credentials in legacy — likely a drop candidate, user's call.
- Note: the **credential rotation** in Phase 0.6 is *not* deferred — those keys are exposed in legacy git history regardless of what gets ported.

### Phase 4 — Production-grade hardening (cross-cutting, closes out the migration)
- **CI/CD**: legacy is 4 independent SSH+docker-compose-to-one-VM pipelines, no lint/test gate on PRs. Design one consolidated pipeline for the monorepo (path-based/affected-app builds), and add lint+test as an actual required PR check (currently absent everywhere). Fix the inconsistent secret name found between workflows (`BIZNET_DEPLOY_PATH` vs `BIZNET_SSH_DEPLOY_PATH`) if the SSH/docker-compose deploy mechanism carries forward.
- **Testing**: bring each legacy `*.spec.ts` along as its module is ported (Phases 1-3), then make the CI pipeline actually run them (today they exist but nothing gates on them).
- **Full env-var consolidation**: fold every env var found across the 4 legacy services into `libs/configuration`'s typed config classes, with one clean `.env.example` per app (today none of the 4 legacy services even has a `.env.example` — only real `.env*` files).
- **End-to-end business-process verification**: once the 3 in-scope apps are ported, walk every real flow end-to-end against the running monorepo (register merchant → configure fees → purchase → provider callback → withdraw/disbursement → merchant webhook) to confirm behavioral parity — settlement/reconciliation steps drop out of this walkthrough while settlerecon is deferred — this is the direct answer to "check all the business process before deliver it into production."

## Immediate next step

Start with **Phase 0**: scaffold `libs/microservice-clients`, `libs/auth`, `libs/common`, finish `libs/logger`, extend `libs/configuration` with `JwtConfig`, and add the missing root dependencies. This unblocks Phase 1 (`auth`), which is the natural next milestone since it's already partially wired.

## Verification approach

- Per phase: `npm run build`, `nest start <app> --watch`, exercise real endpoints (curl or the in-app browser) rather than relying on type-checks alone; `npm test` for ported spec files; `prisma migrate dev` against a local Postgres for schema changes.
- Where useful, compare responses from the new monorepo app against the still-running legacy service for the same request as a parity smoke test.
- Phase 4's end-to-end walkthrough is the final gate before calling any service production-ready — tied directly to the security remediation items (rotated secrets, verified webhooks) also being must-fix, not optional, before that gate passes.
