# Legacy Microservices Audit — Reference Material

Source: 4 zip snapshots (each including full git history) of the standalone legacy repos, extracted read-only for analysis:
- `C:\prelion\pg\auth-service\auth.zip`
- `C:\prelion\pg\config-service\config.zip`
- `C:\prelion\pg\transaction-service\transaction.zip`
- `C:\prelion\pg\settlerecon-service\settlerecon.zip`

This is the full findings backing [the migration plan](can-you-analysize-this-polymorphic-axolotl.md). Use it as a lookup while executing each phase.

---

## 1. Shared plumbing (byte-identical across all 4 services)

**121 files are byte-for-byte identical across all 4 legacy repos** — `src/microservice/**` (79 files) and `src/shared/**` (42 files). Verified by SHA-256 hash of every file, pairwise across all 4: zero mismatches anywhere.

### Architecture
Each service is a NestJS **hybrid app**: a normal HTTP server plus a TCP microservice listener (`app.connectMicroservice({transport: Transport.TCP, options:{host,port}})` in `src/main.ts`). Every service is simultaneously a **TCP client** to its peers (`src/microservice/**/*.client.ts`) and a **TCP server** for its own domain (`@MessagePattern({cmd})` handlers living in that service's own `src/modules/**/*.controller.ts`).

### The `SERVICES` registry (`src/shared/constant/client.constant.ts`)
A plain object keyed `APP/AUTH/CONFIG/TRANSACTION/SETTLERECON`, each with `name`/`host`/`port` (env-driven) and a `point` map. Every RPC operation has one `point` entry with three parallel addresses:
```
find_profile_bank: { cmd: 'find_profile_bank', path: 'user/internal/profile-bank', url: `${URL_AUTH}/user/internal/profile-bank` }
```
`cmd` is the contract between the client's `.send({cmd})` and the peer's `@MessagePattern({cmd})` handler.

### Dual-transport pattern (TCP-primary / HTTP-fallback)
Almost every op has two methods: `foo()` (axios HTTP call to `point.url`) and `fooTCP()` (tries `ClientProxy.send()` first, falls back to `foo()` on error). **Two competing fallback implementations coexist** (normalize onto the newer one when porting):
- Older/simpler (`UserAuthClient`, `AgentConfigClient`, `MerchantConfigClient`, `SettlementSettleReconClient`, the 3 transaction clients): raw try/catch + `console.log(error)` + fallback call.
- Newer/hardened (`FeeCalculateConfigClient`, `ProfileProviderConfigClient`, `MerchantSignatureAuthClient`, Inacash/Pdn/Pakaidonk provider clients): routed through `DependencyErrorHelper.withFallback()/.ensureData()/.throwFromError()` (`src/shared/helper/dependency-error.helper.ts`), classifying axios errors (timeout, 5xx, 404-as-missing) via a per-dependency `DependencyErrorContext` map (`src/shared/exception/api-error.ts`) into a `ResponseException`/`ResponseDto` envelope.

### `microservice.module.ts`
Single `@Global()` module: registers all 14 client classes; opens 4 separate `ClientsModule.register([{transport: TCP, host, port}])` blocks (one per peer — a service never TCP-registers to itself); wires `JwtModule.register()`, `ClsModule.forRoot()` (nestjs-cls request-scoped auth context); installs 3 global `APP_GUARD`s (`JwtAuthGuard`, `RolesGuard`, `MerchantSignatureHeadersGuard`) + `JwtStrategy`.

### Decorators / guards / strategy (`src/microservice/auth/**`)
- `@PublicApi()` / `@SystemApi()` / `@MerchantApi()` — metadata flags read by guards to skip auth; `@SystemApi()` marks the `.../internal/...` endpoints the `*.client.ts` files call; `@MerchantApi()` auto-injects 5 Swagger header docs (`x-client-id/x-timestamp/x-nonce/x-signature/x-sign-alg`) for HMAC-signed merchant calls.
- `@Roles(...roles: ROLE[])` — allowlist metadata for `RolesGuard`; `ROLE` enum (`src/shared/constant/auth.constant.ts`) = `SYSTEM, SCHEDULER, ADMIN_SUPER, ADMIN_ROLE_PERMISSION, ADMIN_AGENT, ADMIN_MERCHANT, AGENT, MERCHANT`.
- `@CurrentAuthInfo()` — param decorator pulling `request.user` (`AuthInfoDto{userId, profileId, role}`).
- `@MerchantSignatureHeader()` — param decorator extracting the 5 x-* headers.
- `JwtAuthGuard extends AuthGuard('jwt')` — global; bypasses `/metrics` + Public/System/Merchant routes; mirrors user into `nestjs-cls`; has leftover debug `console.log`s (logs on **every** authenticated request).
- `RolesGuard` — global; bypasses Public/System/Merchant; else checks `authInfo.role` against `@Roles()` allowlist (plain string compare, no DB lookup).
- `MerchantSignatureHeadersGuard` — global; only acts on `@MerchantApi()` routes; validates the 5 headers are *present* (doesn't verify the HMAC itself — that's a separate call to `MerchantSignatureAuthClient`).
- `JwtStrategy` — passport-jwt, Bearer extraction, secret = `JWT_ACCESS_TOKEN_SECRET`, **no DB lookup / no revocation check** — casts payload straight to `AuthInfoDto`.

### The 14 `*.client.ts` files

| Client | Peer (TCP token) | Ops |
|---|---|---|
| `auth/user.auth.client.ts` → `UserAuthClient` | AUTH | findAllMerchantsAndAgentsByIds, findProfileBank |
| `config/agent.config.client.ts` → `AgentConfigClient` | CONFIG | create (agent) |
| `config/merchant.config.client.ts` → `MerchantConfigClient` | CONFIG | create (merchant) |
| `config/fee-calculate.config.client.ts` → `FeeCalculateConfigClient` | CONFIG | calculate Purchase/Withdraw/Topup/Disbursement fee |
| `config/profile-provider.config.client.ts` → `ProfileProviderConfigClient` | CONFIG | findProfileProvider |
| `merchant-signature/merchant-signature.auth.client.ts` → `MerchantSignatureAuthClient` | AUTH | signatureValidation, findMerchantUrl |
| `settlerecon/settlement.settlerecon.client.ts` → `SettlementSettleReconClient` | SETTLERECON | schedule |
| `transaction/{purchase,withdraw,disbursement}/*.client.ts` (3 files) | TRANSACTION | callback / createCallbackProvider (status callbacks) |
| `provider/inacash/inacash.provider.client.ts` → `InacashProviderClient` | SETTLERECON | purchaseQRIS, withdraw, disbursement |
| `provider/pdn/pdn.provider.client.ts` → `PdnProviderClient` | SETTLERECON | purchaseQRIS, withdraw, disbursement |
| `provider/pakaidonk/pakaidonk.provider.client.ts` → `PakaidonkProviderClient` | SETTLERECON | purchaseQRIS only |
| `provider/zipay/zipay.provider.client.ts` → `ZipayProviderClient` | SETTLERECON | purchaseQRIS only (**buggy**, see below) |
| `provider/payhere/` | — | **empty directory, no client exists** |

### Bugs found in the shared layer (identical in all 4 copies — bugs in the shared code itself, not drift)
- **`ZipayProviderClient.purchaseQRIS()`/`purchaseQRISTCP()` call `this.point.pdn_purchase_qris`** (PDN's cmd/URL) instead of `this.point.zipay_purchase_qris`, and reuse PDN's `DependencyErrorContext`. Classic copy-paste-from-PDN mistake. `SERVICES.SETTLERECON.point.zipay_purchase_qris` exists and is used correctly server-side, so any caller of `ZipayProviderClient` today silently hits the PDN handler instead.
- `ZipayProviderClient` is the only one of the 14 client classes **missing `@Injectable()`**.
- `provider/payhere/` is an empty dir in all 4 — Payhere is fully implemented server-side in settlerecon but was never given a TCP client stub like the other 4 providers.

### `package.json` diff
Scripts structurally identical (`start`, `start:dev`, `start:test`, `lint`, `test*`, `prisma:seed:*`).

**Common to all 4 (30 packages)**: `@nestjs/{axios,common,config,core,jwt,microservices,passport,platform-express,swagger,terminus}`, `@prisma/{adapter-pg,client}`, `@willsoto/nestjs-prometheus`, `argon2`, `axios`, `canonicalize`, `class-transformer`, `class-validator`, `decimal.js`, `luxon`, `nest-winston`, `nestjs-cls`, `passport`, `passport-jwt`, `pg`, `prom-client`, `reflect-metadata`, `rxjs`, `uuid`, `winston`, `winston-daily-rotate-file`.

**Version skew**: mostly harmless patch/minor drift. One real jump: **`uuid` is `^9.0.1`** in auth/config/transaction **but `^13.0.0` in settlerecon alone** — needs code review, not just a lockfile bump, if consolidating.

**Only in some services**:
- `@casl/ability`/`@casl/prisma` — listed in auth *and* config, but config **never imports them** (dead dependency; real usage is auth-only).
- `passport-local` — auth + config; config has zero references (dead dependency).
- `dotenv` — explicit dep only in auth+config, yet the identical `client.constant.ts` does `import 'dotenv/config'` in all 4 — transaction/settlerecon implicitly rely on it transitively.
- `mustache` — auth + config only. `@nestjs/schedule` — config only. `cross-env`/`date-fns`/`exceljs`/`file-type` — transaction + settlerecon only.
- `typescript-eslint` is misplaced under `dependencies` (not `devDependencies`) in transaction/settlerecon, which also still ship a dead legacy `.eslintrc.js` (ESLint 8 style) alongside the real flat `eslint.config.mjs` — auth/config already cleaned this up.
- **No service uses Redis, BullMQ, or any queue library.**

### Dockerfile / CI
**Dockerfile**: identical multi-stage template in all 4 (`node:20-alpine` → `npx prisma generate` → `npm run build`; prod stage copies `dist` + `.prisma`/`@prisma`, non-root `app` user, `HEALTHCHECK` against `/api/v1/health`). Only difference: port number (3000 auth / 3001 config / 3002 transaction / 3003 settlerecon).

**`.github/workflows/deploy.yml`** (one workflow per repo, no lint/test CI gate on PRs anywhere): checkout → write SSH key from `secrets.BIZNET_SSH_PRIVATE_KEY` → SSH into a Biznet-hosted VM → `git pull` in `/home/user-manapay/backend/<service>-service` → `docker compose build/up -d <service>` → poll health → tag-based rollback on failure. Push-triggered on `release/development` only. **Drift**: config's workflow reads `secrets.BIZNET_DEPLOY_PATH`; the other 3 read `secrets.BIZNET_SSH_DEPLOY_PATH` — inconsistent secret name.

### Env vars (consolidated across all 4)
No `.env.example` exists in any of the 4 zips — only real `.env`/`.env.development`/`.env.production`/`.env.test` with real-shaped values.
- **DB**: `DATABASE_URL` (single connection string, all 4).
- **Redis**: none — no legacy service references Redis.
- **JWT/auth**: `JWT_ACCESS_TOKEN_SECRET`, `JWT_ACCESS_TOKEN_EXPIRE`, `JWT_REFRESH_TOKEN_SECRET`, `JWT_REFRESH_TOKEN_EXPIRE`, `ENCRYPTION_KEY` (declared everywhere, **referenced by zero source code anywhere** — dead/reserved var).
- **TCP/self-identity**: `APP_NAME`, `APP_HOST`, `PORT`, `PORT_TCP`, `VERSION`, per-peer `CLIENT_{AUTH,CONFIG,TRANSACTION,SETTLERECON}_{NAME,HOST,PORT}`, HTTP-fallback base URLs `URL_{AUTH,CONFIG,TRANSACTION,SETTLERECON}`.
- **Provider credentials**: only settlerecon references any via env — `INACASH_BASE_URL`, `INACASH_TOKEN`, `PAYHERE_BASE_URL`, `PAYHERE_API_KEY`, `APP_BASE_URL`. PDN/Zipay/Pakaidonk have **zero env-based credentials** (see security section).
- **Misc**: `NODE_ENV`, `TIMEZONE`.

**Secrets flag**: `.gitignore` in the legacy repos has the `.env`-family exclusion lines **commented out** — only `.env.development` is actually ignored. `.env`/`.env.production`/`.env.test` (DB password, JWT secrets, encryption key) appear intentionally committed. Treat as compromised; rotate before go-live.

### nest-cli.json / tsconfig / eslint
`nest-cli.json` and `tsconfig.build.json` byte-identical across all 4. `tsconfig.json` identical in config/transaction/settlerecon; **auth's has one extra flag** (`esModuleInterop: true`) the others lack — safe to standardize on. `eslint.config.mjs` (flat, ESLint 9) byte-identical across all 4 — this is the active config. Legacy `.eslintrc.js` only in transaction/settlerecon — dead weight, don't port.

### Suggested lib split (feeds directly into the plan)
- **`libs/microservice`**: `SERVICES` registry + all 14 clients + DTOs — fix Zipay bug + missing `@Injectable()` while porting.
- **`libs/auth`**: guards/strategy/decorators, `AuthInfoDto`, `ROLE` enum, a real `JwtConfig`.
- **`libs/common`**: `ApiError`/`DependencyErrorContext`/`DependencyErrorHelper`/`ResponseException`/`ResponseDto` — normalize onto the newer fallback pattern only.
- **Stays per-app**: CASL (auth-only), each provider's server-side implementation, provider credential material (needs real secrets management, not a repo re-commit).

---

## 2. Auth Service

### Module inventory
`AppModule` wires: **AuthModule, UserModule, PermissionsModule, RolesModule, AgentDetailModule, MerchantDetailModule, MerchantSignatureModule**, plus global **CaslModule**. Infra: `PrismaModule`, `MicroserviceModule`, `PrometheusModule` (`/metrics`), `ConfigModule`. Almost every controller endpoint has a paired `@MessagePattern` TCP twin.

### Feature modules — endpoints & logic

**agent-detail**: `GET /agent-detail` (list), `GET /agent-detail/dropdown` (public), `GET /agent-detail/:userId`, `PATCH /agent-detail/update/:userId`. Thin CRUD over `AgentDetail` 1:1-joined with `User`, DTOs flattened by spread. No pagination despite a `// TODO Pagination` comment. **All `@CheckPolicies` calls commented out** — zero CASL enforcement, JWT-authenticated access only.

**merchant-detail**: `GET /merchant-detail` (paginated, filter by `businessName`), `GET /merchant-detail/dropdown`, `GET /merchant-detail/:userId`, `PATCH /merchant-detail/update/:userId` (CASL-protected — the one real enforcement point). Same flatten-join pattern. Pagination *is* implemented here despite the same stale TODO comment. `findAll`/`findOne` have CASL checks commented out.

**merchant-signature**: `GET /merchant-signature/generate-secret-key` (rotates secret, moves old to `previousSecretKey`), `POST /merchant-signature/register-webhook-url` (`@IsUrl`-validated payin/payout URLs), TCP `validateSignature`/`getMerchantUrl` (internal). This is the merchant API-key/HMAC system: validates secret exists → status `ACTIVE` → timestamp freshness (`CryptoHelper.isTimestampValid`) → HMAC match over method+path+timestamp+nonce+body. **Gaps**: `previousSecretKey` stored on rotation but validation only checks the *current* key (no grace period despite the field existing for it); **nonce replay protection is an explicit `// TODO`** — timestamp is checked but nonce uniqueness is never verified, so requests can be replayed within the validity window.

**permissions**: full CRUD + `assign-role`/`unassign-role`/`assign-bulk`. Permissions are standalone rows (`roleId` nullable) attachable independently of creation. `findAll` filters `deletedAt: null` correctly. `assignMultiplePermissions` throws a bare `Error` (not `HttpException`) if role missing — inconsistent. **No `@CheckPolicies` anywhere in this controller**, despite managing the permission system itself.

**roles**: full CRUD, **the only controller that fully uses `@CheckPolicies`** (create/read/update/delete on Role). `remove()` is soft-delete (hard-delete line commented out). **Bug**: `findAll()`/`findOne()` do **not** filter `deletedAt: null` — soft-deleted roles still appear (inconsistent with Permissions).

**users** (`UserService` + `UserProfileService`): `GET /user/profile`, `GET /user/role` (legacy `@Roles(ROLE.ADMIN_SUPER)`, not CASL), `GET /user` (**`@PublicApi()` — no auth at all**, confirm intentional), `POST /user/admin/register-merchant` (creates User+MerchantDetail+MerchantSignature in a transaction, argon2-hashes password, generates client ID, TCP-calls config-service to create merchant config), `POST /user/admin/register-agent` (same shape for agents). Several internal endpoints exposed both HTTP `@SystemApi()` and TCP.
- `findProfileIdByUserIdAndRole`/`profile()` resolve Admin/Agent/Merchant detail via **substring matching** (`role.toLowerCase().includes('admin')`) instead of exact enum comparison — fragile; large commented-out stricter implementation left in place with `// TODO Semua ROLE belum ke declare semua berdasarkan bisnis process`.
- `findProfileBank` admin branch returns **hardcoded empty strings** for bank fields — `// TODO Tanya ke manager, apa nomor rekeningnya` ("ask the manager what the account number is") — genuinely unfinished, not a typing stub.
- `registerMerchant`/`registerAgent` make **synchronous TCP calls to config-service inside a Prisma `$transaction`** — a distributed-transaction consistency risk (no compensating logic if config-service partially succeeds then something else fails). Becomes easier to fix once auth+config share a process.

### Prisma schema (`schema "auth"`)
7 models, all audit-columned (`created/updated/deletedAt+By`, soft-delete):
- **Role** — `name`. Has many Permission, User.
- **Permission** — `action`, `subject` (CASL verb/noun), `inverted`, `field: String[]`, `conditions: Json?`, `reason?`. Belongs to Role (nullable).
- **User** — `email` (unique), `password` (argon2). Self-relation `parentUser`/`Users` ("UserHierarcy"), `nmid?`. Optional 1:1 to AgentDetail/MerchantDetail/AdminDetail/MerchantSignature.
- **AdminDetail** — fullname/address/phone. 1:1 User.
- **AgentDetail** — fullname/address/phone + bank fields. 1:1 User.
- **MerchantDetail** — KYC fields (ownerName/businessName/brandName/phoneNumber/nik/ktpImage?/npwp/address hierarchy/postalCode/bank fields/siupFile?/coordinate?). 1:1 User.
- **MerchantSignature** — `clientId` (unique), `secretKey?`, `previousSecretKey?`, `status`, `credentials: Json` (default `{}`), `payoutUrl?`, `payinUrl?`. 1:1 User.

### CASL / RBAC system end to end
**Actions**: manage/create/read/update/delete. **Subjects**: Permission, Role, AgentDetail, MerchantDetail, all. **`User`, `AdminDetail`, `MerchantSignature` are not CASL subjects at all** — permissions can't be expressed on them today.
- `CaslAbilityFactory.createForPermissions()` converts DB rows into CASL raw rules. Row-scoping does a fragile **JSON-stringify + string-replace of the literal token `"$userId"`** before re-parsing — works for the common case but not a safe general templating approach.
- `CaslCacheService.getAbility(userId)` builds from Prisma then **caches forever in a module-level in-memory `Map`** (no TTL, not Redis). `clearCache(userId)` exists but **is never called anywhere** — role/permission changes never take effect until restart, and it doesn't work across replicas. Code comment literally says "could also use Redis."
- `PoliciesGuard` — global; bypasses `/metrics`+Public/System/Merchant. **Hardcoded superuser bypass**: `if (authInfo.role === 'ADMIN_SUPER') return true` (string literal, not enum) skips CASL entirely. No `@CheckPolicies` on a handler defaults to **allow** (opt-in, not opt-out) — and in practice only `RolesController` (fully) and `MerchantDetailController.update` (partially) actually enforce anything.
- **Two parallel authorization layers**: CASL (`PoliciesGuard`, auth-only) and `RolesGuard`+`@Roles()` (global via `MicroserviceModule`, active in **all four** services, just a string compare against JWT-decoded role, no DB lookup). Both run on every request alongside `JwtAuthGuard`/`MerchantSignatureHeadersGuard`. Config/transaction/settlerecon never import `CaslModule` — cross-service authorization elsewhere is JWT-claims-only.

### Login flow end to end
`POST /login` → `LocalAuthGuard` (Passport `'local'`, `usernameField:'email'`) → `LocalStrategy.validate()` → `AuthService.validateUser()`:
1. `findOneByEmailThrow(email)` (Prisma `findFirstOrThrow` incl. role); errors are caught, `console.log`'d, and swallowed into `null`.
2. Password check via **argon2** (`argon2.verify`).
3. Resolve `profileId` via the same substring-match role resolution noted above.
4. Build `AuthInfoDto{userId, profileId, role}`.
5. `AuthController.login()` signs a JWT (`jwtService.signAsync(instanceToPlain(authInfoDto))`, payload = userId/profileId/role only), returns `{token, authInfo}`.
6. `JwtStrategy` later verifies signature only — `validate(payload)` casts straight to `AuthInfoDto`, **no DB re-check, no revocation/versioning**. Default 12h expiry; a deactivated user or role change doesn't take effect until the token expires.

**Bug**: `LocalStrategy.validate()` — on invalid credentials, constructs `new UnauthorizedException()` but **never throws or returns it**; falls through to `return authInfo` (null). Still produces a 401 in practice (Passport rejects a falsy `validate()` result), but the exception-construction line is dead code — almost certainly meant to be `throw`.

**Secrets/config risk**: `JWT.accessToken.secret` defaults to `process.env.JWT_ACCESS_TOKEN_SECRET || ''` — if unset, signing secret silently becomes an empty string (forgeable tokens) rather than failing startup. `LoginDto`'s Swagger default bakes in `superadmin@manapay.id`/`password123` as the visible API-docs example — confirm these aren't real prod credentials before porting Swagger defaults as-is.

### Consolidated TODOs / risks (auth)
- **~30+ `console.log`/`console.error` debug call sites** across `auth.service.ts`, `local.strategy.ts`, `auth.controller.ts`, `casl-ability.factory.ts`, `policies.guard.ts`, `roles.controller.ts`, `user.controller.ts`, `user.service.ts`, `user-profile.service.ts`, `jwt-auth.guard.ts` (logs on **every** authenticated request), `microservice/*.client.ts`, `pagination.decorator.ts`.
- CASL ability cache never invalidated; CASL subjects incomplete (no User/AdminDetail/MerchantSignature).
- Most controllers don't use `@CheckPolicies` despite the machinery existing.
- `RolesService` soft-delete filter inconsistency; `PermissionsService` throws bare `Error` instead of `HttpException`.
- Merchant-signature: no nonce replay protection; `previousSecretKey` never checked.
- Admin bank-info lookup hardcodes empty strings; role resolution uses fragile substring matching.
- `auth.module.ts` and `microservice.module.ts` both register `JwtModule` identically — flagged by the code's own TODO to remove the duplicate.
- `GET /user` is `@PublicApi()` — confirm intentional.
- Dead/no-op exception construction in `LocalStrategy` (see above).
- Informal Indonesian dev comments throughout (e.g. `/// TODO Non aktifkan dulu bolooo`) signal actively-iterated, not fully settled code.

### Schema comparison: auth.zip vs. monorepo's `apps/auth/prisma/schema.prisma`
**The monorepo's existing auth schema is already a semantic match** — all 7 models, fields, types, relations (incl. the User self-relation and all CASL-relevant Permission fields) are identical. Only two differences, both tooling/precision:
1. Generator: monorepo uses `prisma-client` (ESM, custom output aliased `@auth/prisma`) vs. legacy's `prisma-client-js` (default `@prisma/client`) — every ported file importing `PrismaClient`/`Prisma` from `@prisma/client` needs its import path changed.
2. Timestamp precision: monorepo uses `@db.Timestamptz(6)` vs. legacy's `@db.Timestamptz(3)` — cosmetic, but a conscious choice.

### Monorepo compatibility notes (auth)
- **Prisma injection pattern differs**: monorepo splits `PrismaMasterProvider`/`PrismaSlaveProvider` (read/write); legacy injects a single `PRISMA_SERVICE` token everywhere — every ported service needs a deliberate read-vs-write choice per call. This is the single biggest mechanical adaptation.
- **Monorepo's audit extension already supersedes legacy's two extension files**: `apps/auth/src/database/audit.extension.ts` uses an explicit `AUDITED_MODELS` allow-list and **also handles restore-from-soft-delete** (legacy doesn't). Don't port either legacy extension file — diff carefully first (e.g. confirm `upsert` handling matches) but this is largely done.
- **Redis is wired but unused** in the monorepo (`RedisModule` from `@app/redis`) — natural home for fixing the CASL cache TTL/invalidation problem.
- Shared `LoggerModule`/`ConfigurationModule` already exist — replace the ~30+ `console.log`s and the raw `ConfigModule.forRoot({envFilePath})` pattern with these during the port.
- `apps/config` needs its entire `DatabaseModule` (master/slave + extensions) and schema built from scratch before any business modules land, mirroring the pattern established in `apps/auth`.
- CASL/`PoliciesGuard` and `RolesGuard`/`@Roles()` are two separate global-guard mechanisms today; decide whether `apps/config` should gain CASL enforcement now that it can be in-process with auth, or keep the coarser `@Roles()`+JWT-claims check.
- The dual HTTP+TCP exposure pattern exists because these were separate deployables — once in one process, many TCP round-trips (`UserAuthClient`, `AgentConfigClient`, `MerchantConfigClient`) are candidates to become direct in-process calls. Decide how much of `src/microservice/*` is worth porting at all vs. replacing.

---

## 3. Config Service

### Module inventory
`AppModule` wires: **CommonModule, FeeModule, MerchantModule, SettlementSchedulerModule, ReconciliationModule, AgentModule, UserProviderModule**. Infra: `PrismaModule`, `ConfigModule`, `ScheduleModule.forRoot()` (cron, used by reconciliation + settlement-scheduler), `MicroserviceModule`, `PrometheusModule`. **No CaslModule** — config has no ability-based authorization, only JWT+`@Roles()`.

### Feature modules — endpoints & logic

**agent**: `POST`+TCP `create_agent_config` (`@SystemApi`, creates bare `Agent` row, called by auth on registration). `GET /agent/:agentId/merchants` (merchants where this agent is a shareholder, resolved via `UserAuthClient` TCP back to auth for display data).

**common**: `GET /common/div?div=...` — generic reference-data lookup (banks, providers excluding INTERNAL, payment methods, payment methods filtered by transaction type) — the dropdown/reference-data source for frontends.

**fee** (`fee.service.ts` + 4 near-identical calculators: purchase/topup/withdraw/disbursement): `GET /fee/config` (list `BaseFee`), plus internal-only endpoints per transaction type (`@SystemApi`+`@MessagePattern`, called by transaction-service). **Core calculation** (identical shape across all 4, `decimal.js`):
1. Look up `BaseFee` by provider+paymentMethod+transactionType.
2. Provider fee = fixed + nominal × percentage/100.
3. Look up merchant-specific `MerchantFee` override.
4. Internal fee = fixed + nominal × percentage/100 (from merchant fee row).
5. Agent fee = fixed + nominal × percentage/100 ("has agents" inferred from non-zero fixed/percentage, not an explicit relation check).
6. If merchant has agents, split agent fee across `AgentShareholder` rows proportional to `percentagePerAgent`.
7. **Net amount direction differs by type — the key rule to preserve exactly**: for **PURCHASE/TOPUP** (money in), merchant net = `nominal − providerFee − internalFee − agentFee`. For **WITHDRAW/DISBURSEMENT** (money out), merchant net = `nominal + providerFee + internalFee + agentFee` (fees added on top).
- **~95% duplication** across the 4 calculators (same steps/DTO shape/heavy console.log instrumentation, only `transactionType` + final +/- differ) — strong consolidation candidate.
- No visible guard against `nominal` being zero/negative before a `dividedBy(nominal)` — verify the filter DTO's validation when porting.

**merchant**: `GET /merchant/:merchantId/interval` (settlement interval + last settlement time). `GET /merchant/:merchantId/config` (agent shareholders + every `BaseFee` left-joined with this merchant's `MerchantFee` override). `POST`+TCP `create_merchant_config` (`@SystemApi`, default `settlementInterval=120`, **conditionally** creates an initial 0%-`AgentShareholder` only if the registering `agentId` maps to a real Agent — well-commented rule). `POST /merchant/:merchantId/provider` (batch upsert/delete `MerchantFee`, `U`/`D` action enum). `POST /merchant/:merchantId/agent-shareholder` (batch upsert/delete `AgentShareholder`; **enforced invariant**: sum of `percentagePerAgent` across non-deleted shareholders being submitted must equal exactly 100% or `422`).

**reconciliation** (cron + one internal method, no controller): `@Cron(EVERY_10_MINUTES)` checks `Provider.reconciliationTime` vs. now/`lastReconciliationAt`; if due, is *supposed* to run reconciliation and stamp the timestamp. **The actual reconciliation logic is entirely unimplemented** — `// TODO: Gantikan dengan proses recon kamu` — the loop just updates the timestamp. `runForProvider()` (manual trigger) is similarly a stub. **Treat as unimplemented, not a working feature.**

**settlement-scheduler**: `GET /fee/settlement-scheduler?interval=N` (`@SystemApi`, manual trigger). `@Cron` jobs at 90min/2h/6h/daily-midnight (30min/1min variants commented out, test-only), each finding merchants due for settlement and TCP-calling settlerecon-service (`SettlementSettleReconClient`) to actually run it, stamping `lastSettlementAt` on success. **Likely bug**: the 90-minute cron `'0 */90 * * * *'` — minutes field can't step by 90 (out of range for standard cron parsers); validate/fix rather than carry forward.

**user-provider**: `GET`/TCP `find_profile_provider` (`@SystemApi`) — resolves provider+payment method for a transaction. AGENT role reads `Agent.providerName`/`paymentMethodName`; MERCHANT resolves via `MerchantFee→BaseFee`; **for ADMIN, provider name is hardcoded to the literal string `'aaa'`** (with a `// TODO` beside it), and the AGENT branch also falls back to `'aaa'` if null. Looks like leftover placeholder logic — **any admin-initiated transaction currently routes to a non-existent "aaa" provider.**

### Prisma schema (`schema "config"`)
9 models + 1 enum, same audit-column convention:
- **Bank** — code (PK), name. Reference data.
- **Merchant** — PK `id` (externally provisioned by auth's TCP call, not autoincrement), `settlementInterval` (min, default 120), `lastSettlementAt?`. Has many MerchantFee, AgentShareholder.
- **Agent** — PK `id` (externally provisioned), `providerName?`, `paymentMethodName?`. Has many AgentShareholder.
- **AgentShareholder** — join table, `percentagePerAgent: Decimal(10,2)`. Unique `(agentId, merchantId)`.
- **Provider** — PK `name` (string, comment shows an earlier id/code design that was replaced), `reconciliationTime` ("HH:mm"), `lastReconciliationAt?`. Has many BaseFee.
- **PaymentMethod** — PK `name`, `explain`, `transactionTypes: TransactionTypeEnum[]`. Has many BaseFee.
- **BaseFee** — PK `id`, unique `code`, FKs to Provider+PaymentMethod by name, `transactionType` enum, `feeProviderFixed/Percentage: Decimal(10,2)`, `isActive`. Has many MerchantFee.
- **MerchantFee** — per-merchant override: `feeInternalFixed/Percentage`, `feeAgentFixed/Percentage: Decimal(10,4)` (one more decimal place than provider-level). Unique `(merchantId, baseFeeId)`.
- **Common** — generic `div`/`value`/`isActive`/`explain` key-value catalog.
- **enum TransactionTypeEnum**: WITHDRAW, TOPUP, DISBURSEMENT, PURCHASE.

No separate `Reconciliation`/`SettlementSchedule` entity tables — those concerns piggyback on fields already in `Provider`/`Merchant`. No audit/history table for reconciliation or settlement runs.

### Consolidated TODOs / risks (config)
- Reconciliation module unimplemented (2 explicit TODOs).
- `user-provider` hardcodes `'aaa'` fallback provider name.
- Same pervasive `console.log` litter, especially dense in all 4 fee-calc services (every intermediate value logged) and most controllers.
- ~95% duplication across the 4 fee-calculation services.
- Settlement scheduler's `'0 */90 * * * *'` cron is likely broken.
- **Both `reconciliation` and `settlement-scheduler` crons have no distributed lock/leader election** — multiple replicas would double-fire. Redis (already wired in the monorepo's auth app) is a natural fix.
- `main.ts`: `// TODO jangan sampai production, origin set true demi development dan testing` — CORS origin wide-open for dev/testing; don't carry an open CORS origin into the monorepo.
- Seed data exists (`prisma/seed/index.ts`, `bank.seed.ts`) — useful reference for monorepo seed data, not to be ported verbatim.

---

## 4. Transaction Service

### Module inventory
`AppModule` wires: `ConfigModule`, `PrismaModule`, `LoggerModule`, `PurchaseModule`, `TopupTransactionModule`, `WithdrawTransactionModule`, `DisbursementModule`, `BalanceModule`, `ApiModule` (merchant-facing), `MicroserviceModule`, `PrometheusModule`. A `src/modules/provider` (`NetzmeModule`/`NetzmeService`, bare axios POST to `api.netzme.com`) **is not imported by `AppModule` at all** — dead/orphaned, skip porting.

### Endpoints and business logic
Two layers per transaction type: **internal/admin CRUD** (`/transactions/{purchase,disbursement,topup,withdraw}`) and the **merchant-facing "Open API v1"** (`Api1Controller` at `/open/v1/*`) — where the real money-movement logic (merchant-signature auth, fee calc, provider dispatch, balance writes) actually lives.

| Method + route | Purpose |
|---|---|
| POST `/open/v1/payin/purchase` | Create QRIS purchase (payin) |
| POST `.../purchase/internal/callback` + TCP `purchase_callback` | Provider payin callback (system-only) |
| GET `/open/v1/payin/purchase/:id`, `/order/:orderId`, `/date` | Purchase lookups |
| GET `/open/v1/payout/balance` | Merchant balance |
| POST `/open/v1/payout/transfer` | Create disbursement (payout) |
| POST `.../disbursement/internal/callback` + TCP `disbursement_callback` | Provider payout callback |
| GET `/open/v1/payout/transfer/:id`, `/order/:orderId`, `/date` | Disbursement lookups |
| Internal | `GET/POST /transactions/{purchase,disbursement,topup,withdraw}` (list/detail/CSV export), `POST /transactions/topup/approve\|reject`, `POST /transactions/withdraw`, `POST .../withdraw/internal/callback` + TCP `withdraw_callback` |

**Core business logic**:
- **Correlation key** (`TransactionHelper.createCode()`): `{timestampMs}{txType 1char}{paymentMethod 2char}{provider 5char}-{userId}[-random]`, later `extractCode()`'d on callbacks. Load-bearing for every callback path — regex: `^(\d{13})([A-Z0-9])([A-Z0-9]{2})([A-Z0-9]{5})-(\d+)(?:-([A-Za-z0-9]+))?$`.
- **Fee model**: every type computes a 4-way split via `FeeCalculateConfigClient` (TCP to config), persisted as typed `*FeeDetail` rows (MERCHANT/PROVIDER/INTERNAL/AGENT).
- **Balance ledger**: append-only log tables (`MerchantBalanceLog`, `AgentBalanceLog`, `InternalBalanceLog`) — no running-total column; "current balance" = latest row by `id desc`. Writes serialized with **Postgres advisory locks**: global `pg_advisory_xact_lock(30,0)` plus per-merchant `(10,merchantId)`/per-agent `(20,agentId)` locks inside the same DB transaction before reading last balance and inserting next. **Essential correctness logic to preserve exactly**; lock id 30 is also a known throughput bottleneck.
- **Purchase (payin)**: create → call provider → `PENDING` + `expiresAt` + QR string. Callback → SUCCESS/FAILED, fee + balance logs written, money credited to `balancePending` (not active — settlement promotes pending→active).
- **Disbursement (payout)**: pre-checks `balanceActive >= fee.netNominal`, `PENDING`, callback SUCCESS debits `balanceActive` immediately (no pending stage).
- **Withdraw**: same shape as disbursement, resolves bank profile via TCP to auth first; logic lives directly in `withdraw.service.ts`.
- **Topup**: merchant deposit; `receiptImage` upload is a stub (`'www.google.com'` fallback, multipart upload not implemented). Admin `approve` credits `balanceActive` inline.
- **Webhook-to-merchant delivery**: fire-and-forget `axios.post` to the merchant's registered URL after a callback resolves — failure only logged. **Explicit TODO**: implement real retry (exponential backoff/queue) instead of silently swallowing delivery failures.
- **Cross-service auth**: every merchant endpoint independently re-validates the HMAC signature via TCP to auth — the `@MerchantApi()` guard only checks headers are present, not valid.

### Prisma schema (`schema "transaction"`)
Models: `TopUpTransaction`, `TopupFeeDetail`, `WithdrawTransaction`, `WithdrawFeeDetail`, `DisbursementTransaction`, `DisbursementFeeDetail`, `PurchaseTransaction`, `PurchaseFeeDetail`, `WebhookLog`, `TransactionAudit`, `MerchantBalanceLog`, `AgentBalanceLog`, `InternalBalanceLog`. Enums: `TransactionStatusEnum` (PENDING/SUCCESS/FAILED/EXPIRED/CANCELLED), `FeeTypeEnum` (AGENT/INTERNAL/PROVIDER/MERCHANT), `TransactionTypeEnum` (WITHDRAW/TOPUP/DISBURSEMENT/PURCHASE/SETTLEMENT_PURCHASE). PKs are plain `Int @default(autoincrement())`. Uses Prisma 7 + `@prisma/adapter-pg`, an `auditTrailExtension` stamping from `nestjs-cls`.

**Important**: functionally the same logical schema as settlerecon's, but materially diverged — see §6.

### Provider-facing DTOs
Transaction doesn't call PSPs directly — it calls settlerecon via 4 thin TCP client wrappers (same TCP-primary/HTTP-fallback pattern). Canonical shapes: `ProviderPurchaseSystemDto{nominal, content(QR string), externalId, code, expiresAt, message, metadata}`, `ProviderDisbursementSystemDto`/`ProviderWithdrawSystemDto{code, status, nominal, feeProviderRealized, netNominal, externalId, recipient/account fields, metadata}`. Merchant-facing DTOs are simple, class-validator-typed, decimal amounts as strings.

**Bug** (same one noted in §1): `ZipayProviderClient` in transaction calls PDN's cmd/URL instead of Zipay's.

### Consolidated TODOs / risks (transaction)
- **`disbursement.service.ts` has its entire `create`/`callback`/`createFailed`/`createBalanceLog`/`feeDetailMapper` implementation commented out** — only find/list/CSV are live; real logic lives in `Disbursement1Api`. Don't port the dead code.
- Webhook delivery has no retry/DLQ — real risk of silently dropped payment notifications.
- `TopupService.create()`: hardcoded `'www.google.com'` receipt fallback; multipart upload not implemented.
- Multiple DTOs have large blocks of commented-out aspirational fields (mid-refactor leftovers) — clean up, don't port.
- `MyLogger.logToConsole()` calls `.close()` on the winston transport after **every single log line** (looks like a bug); also writes local `./logs/{level}.log` files — needs stdout + centralized shipping for a containerized deploy.
- `prisma/middleware/audit.middleware.ts` is an empty file — dead.
- `BalanceService.aggregateBalance*()` has a commented-out, faster raw-SQL window-function version with `/// TODO: Jangan di hapus => Performance` — reconsider if these endpoints are hot paths.

---

## 5. Settlerecon Service

### Module inventory
`AppModule` wires: `ConfigModule`, `PrismaModule`, `LoggerModule`, `ReconciliationModule`, `SettlementModule`, `BalanceModule`, `PayhereModule`, `HealthModule`, `MicroserviceModule`, `InacashModule`, `PdnModule`, `ZipayModule`, `PakaidonkModule`, `PrometheusModule`.

### Endpoints and business logic

**Balance**: read-only ledger endpoints identical in shape to transaction-service's — same 3 balance-log tables, queried **directly** by this service too (see §6 shared-DB risk).

**Inacash** (QRIS + disbursement + withdraw): `POST provider/inacash/internal/{qris,withdraw,disbursement}` (+TCP), `GET provider/inacash/callback/{qris,cashout}` (public, query-param callbacks). 2-step withdraw/disbursement (`inquiry`→`payment`), maps Inacash `rc` codes to canonical status, calls back into transaction via its TCP clients. `listProductMapper()` **hardcoded to always return `'TRF_BCA'`** — not actually implemented, despite a 468KB `inacash.json` product-catalog dump sitting unused in the module.

**Pakaidonk** (QRIS, SNAP/B2B-style): `POST provider/pakaidonk/internal/qris` (+TCP), `POST provider/pakaidonk/callback/qris` (**`@PublicApi()`, no signature validation** — `/// TODO Headers Validation`). RSA-signed B2B access-token + per-request HMAC-SHA512 signature, in-memory token cache with 10s-early-refresh.
- **Credential finding**: `src/modules/pakaidonk/credential/private_key.pem` (1704B) + `public_key.pem` (451B) exist but **are not referenced by any code path found**. `pakaidonk.auth.service.ts` instead uses a **different, fully hardcoded RSA private key literal** embedded directly in source (with hardcoded `PARTNER_ID`/`CLIENT_KEY`/`SECRET`, commented "Sandbox"). Two separate pieces of key material exist: an unused file pair and a hardcoded-in-source key actually in use — both need to move to a secrets manager; confirm the orphaned `.pem` files are truly dead before deleting.

**Payhere** (broadest but least consistent): `POST provider/payhere/{va,qris,ewallet,payment-links,disbursement}`, `GET .../va/:id`, `.../qris/:id`, `.../balance`, plus `WebhookController` (`provider/payhere/callback` — generic no-op stub, and `/callback/qris`). `processQrisCallback()` **hardcodes `http://localhost:3002/api/v1/transactions/purchase/callback`** via raw axios instead of the standard TCP/HTTP-fallback client every other provider uses — architecturally an outlier, looks never fully wired in. No signature validation on the webhook. VA/e-wallet/payment-link/disbursement/balance look like thin unimplemented pass-throughs with no local persistence/callback handling visible.

**PDN** (QRIS + payout, Ed25519-signed "Open API"): `POST provider/pdn/internal/{qris,withdraw,disbursement}` (+TCP), `POST provider/pdn/callback/{qris,settlement,payout}` (all `@PublicApi()`), plus read-only `PdnAdditionalController`. Withdraw/disbursement is inquiry→transfer. Signing: canonical string signed with Ed25519, sent as `X-Signature`/`X-Sign-Alg`/`X-Sign-Key-Id`. Inbound webhook headers are parsed by custom decorators but **the signature is never actually verified** before the callback body is trusted.
- **Serious secret-hygiene finding**: a production-looking Ed25519 private key, its `KEY_ID`, and a `WEBHOOK_SECRET_KEY` are hardcoded in `pdn.auth.service.ts` pointing at `https://api.posdigitalnusantara.com` (not obviously sandbox). **The same private key is duplicated three times**: in `pdn.auth.service.ts`, in a comment block at the bottom of `pdn.constant.ts` (which also documents the matching **public** key), and in a standalone debug script `src/modules/pdn/mtcpay-get-order.js`. A second script, `mtcpay-create-tx.js`, is a placeholder-templated manual-testing tool. **Flag this key for rotation; don't carry the two `mtcpay-*.js` scripts into the monorepo at all.**

**Reconciliation**: `POST reconciliation/file-upload/csv` (multipart CSV/XLSX, magic-byte file-type sniffing, `exceljs` parsing), `GET reconciliation` (list already-reconciled purchases), `GET reconciliation/calculate` (sum/count). **Gap**: `processCSV()` parses uploads into rows and **returns them — never writes anything back to the database**. The matching/stamping code is entirely commented out. As shipped, this is read-only reporting plus a non-functional upload endpoint — probably the single biggest functional gap to scope explicitly.

**Settlement** (separate from Reconciliation — the actual pending→active mover, most sophisticated logic in either codebase): `GET settlement/{settled,unsettled}`, `POST`+TCP `settlement_schedule` → `internalSettlement()`. Runs per-merchant inside `pg_advisory_xact_lock(merchantId)` + `Serializable` isolation, retrying on Prisma `P2034` up to 3x. Claims eligible `PurchaseTransaction` rows via a conditional `updateMany` (idempotent), then for every fee-detail row moves the amount from `balancePending`→`balanceActive`, writing a new `*BalanceLog` row per movement (`SETTLEMENT_PURCHASE`). **Confirms the system-wide two-phase balance model**: purchase success → credit pending; scheduled settlement → move pending→active.
- `settlementDisbursement`/`settlementTopup`/`settlementWithdraw` also exist (wired to `@MessagePattern` cmds) but those cmds **are not defined anywhere in `SERVICES.SETTLERECON.point`** (unlike every actively-used cmd) — and disbursement/withdraw already do their own immediate balance-logging inline in transaction. Strong signal these three are **orphaned** — confirm before deciding whether to port.

**Zipay** (QRIS only): `ZipayAuthService` has `MERCHANT_ID`/`MERCHANT_KEY`/`USER_ID`/`PASSWORD` all hardcoded as **empty strings** — non-functional as shipped (login would fail immediately). Combined with the transaction-side client bug, Zipay looks incomplete/unused end-to-end.

**Logger**: identical `MyLogger`/`LoggerModule` to transaction-service (same `.close()`-per-line quirk).

### Prisma schema — diverged from transaction-service's (important!)
Same model set and Postgres schema (`schemas=["transaction"]`), but:

| Aspect | transaction-service | settlerecon-service |
|---|---|---|
| PK/FK type | `Int @default(autoincrement())` | `BigInt @db.BigInt` |
| Decimal columns | plain `Decimal` (no precision) | explicit `@db.Decimal(18,2)`/`(10,2)` |
| `updatedAt` | `@updatedAt()` (Prisma-managed) | plain `DateTime?`, manually stamped by a custom `timestampzExtension` |
| Timestamp columns | implicit default type | explicit `@db.Timestamptz(3)` everywhere |
| Extensions applied | `auditTrailExtension` only | `auditTrailExtension` **and** `timestampzExtension` |
| Indexes | minimal (single-column) | several composite indexes tuned for settlement/reconciliation queries |

Both services point at the same Postgres schema/tables and both actively read/write it directly via their own Prisma client. **Real correctness risk if carried forward as-is** — two independently-generated clients with different ID types pointed at the same physical tables. Strong argument for one shared Prisma schema/client used by both apps.

### Provider DTOs summary (one-line each)
**Inacash** = QRIS payin + 2-step payout via bearer-token REST. **Pakaidonk** = QRIS payin only, SNAP-style B2B OAuth + dual signature. **Payhere** = broadest surface, shallowest/most inconsistent implementation. **PDN** = QRIS payin + inquiry-then-transfer payout via Ed25519-signed API, most complete/typed integration. **Zipay** = QRIS payin only, currently non-functional (blank credentials).

### Consolidated TODOs / risks (settlerecon)
- **Systemic**: none of the 4 provider webhook callbacks (Inacash/Pakaidonk/PDN/Zipay) verify a signature/HMAC before trusting the payload and forwarding it into transaction's balance/status pipeline. Given these callbacks directly move money-adjacent state, this is the **top security item** to resolve as part of the port.
- Hardcoded fallback bearer tokens as defaults for `INACASH_TOKEN` and `PAYHERE_API_KEY` in source.
- All `@SystemApi()` internal endpoints bypass JWT entirely with no other auth mechanism visible (no shared secret, mTLS, IP allowlist) — pure network-level trust between services; needs a deliberate decision for the monorepo.
- CSV/XLSX parsing assumes semicolon-delimited single-column rows — fragile, worth hardening if reconciliation gets finished.
- `PurchaseTransactionClient.createCallbackProviderTCP()` has unreachable code after a `return`.
- 468KB unused `inacash.json` product-catalog dump — decide port vs. drop.

---

## 6. Cross-cutting findings (transaction + settlerecon)

- **Full-mesh service dependency, verified byte-identical in both zips**: the shared `microservice.module.ts` registers TCP connections to **all four** services unconditionally. Practically: porting transaction/settlerecon still requires auth and config to be reachable (real or stubbed) at startup, since fee calc, signature validation, and bank-profile lookups all go through them via TCP.
- **Shared Postgres schema, divergent Prisma clients** — see table above. Highest-leverage decision point: unify into one shared Prisma schema/package.
- **Provider client naming, clarified**: transaction's `src/microservice/provider/*` are clients calling **into** settlerecon; settlerecon's `src/microservice/transaction/*` are clients calling **back into** transaction to land the callback. Full round-trip: PSP → settlerecon (thin translate) → transaction (canonical business logic) → merchant webhook. Transaction's callback handlers are the source of truth; settlerecon's provider modules are comparatively thin translators.
- **Identical shared infra in both**: `nestjs-cls`, Winston-based `MyLogger` (local file writes — needs a stdout/centralized-logging story), `decimal.js`, `luxon`, Prisma 7 + `@prisma/adapter-pg`, `@willsoto/nestjs-prometheus` at `/metrics`. **No Redis/queue library in either** — you won't need to add Redis just to port this logic (unless used for the webhook-retry/idempotency gaps).
- Dependency versions effectively identical between the two (NestJS 11.1.6, Prisma 7.4.0, etc.) — safe to standardize on one version set.

## Suggested scoping takeaways (from the transaction/settlerecon audit)
1. Treat the **balance ledger + advisory-lock pattern** and the **code-format correlation key** as the two pieces that must be ported bit-for-bit correct — everything else hangs off them.
2. Decide up front on **one Prisma schema** (id type, decimal precision, timestamp strategy) for the shared `transaction` Postgres schema.
3. Budget explicit time for the security gaps (unverified webhook signatures across all 4 PSPs; hardcoded secrets/keys in 4+ files) — these are shipped-as-is and touch real settlement money.
4. Get an explicit answer before porting on three "is this actually dead?" items: `NetzmeModule`, the 3 orphaned settlement TCP handlers, and Zipay end-to-end.
5. Reconciliation file-upload is currently non-functional — confirm whether the port needs to finish it or just preserve the read endpoints.
6. Auth/Config are hard runtime dependencies for both transaction and settlerecon even though they're a later phase — plan for stubs/mocks or network access to the still-standalone services in the interim.

---

## Security findings — consolidated

| Finding | Where | Severity |
|---|---|---|
| DB password, JWT secrets, encryption key appear committed to git (`.gitignore` exclusions commented out) | All 4 legacy repos | Critical — rotate before go-live |
| Hardcoded RSA private key + partner credentials in source ("Sandbox") | `settlerecon: pakaidonk.auth.service.ts` | High |
| Orphaned, unreferenced RSA key-pair files | `settlerecon: src/modules/pakaidonk/credential/*.pem` | Medium — confirm dead, then remove |
| Production-looking Ed25519 private key + webhook secret hardcoded, duplicated 3× in source (incl. a debug script) | `settlerecon: pdn.auth.service.ts`, `pdn.constant.ts`, `mtcpay-get-order.js` | Critical — rotate |
| Hardcoded fallback bearer tokens for provider API auth | `settlerecon: inacash.service.ts`, `payhere.service.ts` | High |
| Zero webhook-signature verification on any inbound PSP callback (Inacash/Pakaidonk/PDN/Zipay) despite moving settlement-money state | `settlerecon`, all 4 provider modules | Critical — these callbacks are the top item to fix |
| JWT signing secret silently becomes `''` if env var unset (no fail-fast) | `auth: auth.module.ts` JWT config | High |
| All internal `@SystemApi()` endpoints trust pure network-level access, no shared secret/mTLS/IP-allowlist | All 4 services | Medium — deliberate decision needed for monorepo |
| CORS origin explicitly set wide-open with a "don't let this reach production" comment | `config: main.ts` | Medium — confirm tightened |
