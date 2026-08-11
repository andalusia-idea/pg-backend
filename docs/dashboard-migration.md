# Dashboard App — Migration Plan

**Branch**: `dashboard` · **Status**: in progress · **Scope**: port every endpoint the PG-Dashboard frontend actually calls into `apps/dashboard`, keeping the legacy style (Express, class-validator, class-transformer) rather than refactoring to the Fastify/TypeBox stack used by the transactional apps.

Source of truth for "what to migrate" is the frontend's own API client layer at `C:\prelion\pg\PG-Dashboard\src\api\*.api.ts` — if the frontend doesn't call it, it isn't in scope.

---

## 1. Ground rules

| Rule | Decision |
|---|---|
| HTTP adapter | **Express** (`NestFactory.create(AppModule)` — no FastifyAdapter), same as legacy |
| Validation | **class-validator + class-transformer**, same as legacy — *not* TypeBox/Ajv |
| Inter-service calls | **None.** Dashboard's Prisma client spans `auth` + `config` + `transaction` schemas, so everything is a direct module/service call. No TCP clients, no `MicroserviceModule` |
| DB access | `PrismaMaster` for writes, `PrismaSlave` for reads — injected via `PRISMA_MASTER_PROVIDER_KEY` / `PRISMA_SLAVE_PROVIDER_KEY` from `@app/prisma` |
| Module layout | One folder per domain module under `apps/dashboard/src/modules/<name>/` with `*.controller.ts`, `*.service.ts`, `*.module.ts`, `dto/` — mirroring legacy |
| Shared code | `apps/dashboard/src/shared/` — deliberately **not** promoted to `libs/`, because it's class-validator-based and would clash with the TypeBox conventions the transactional apps use |
| Date handling | App-local (`shared/helper/date.helper.ts`), **not** a shared lib. The transactional backends have to speak whatever date format each upstream provider / PJP mandates; the dashboard only ever serves the internal frontend, so it can assume one timezone |
| Authorization | JWT + `@Roles()` role gates. No CASL — see D3 |
| Refactoring | Port behavior as-is. Anything that looks like a real bug gets flagged in this doc and raised before changing it |

### Why shared code stays app-local

`libs/` is currently TypeBox/Ajv territory (`libs/microservice`), used by auth/config/transaction. Dashboard's `ResponseDto`, pagination, exception filters, and DTO decorators are class-validator/class-transformer based. Putting both idioms in `libs/` would mean every app pulls in both validation stacks. Dashboard keeps its own `shared/` folder; if a second Express-style app ever appears, that's the moment to promote it.

---

## 2. Endpoint inventory

40 endpoints across 4 legacy services, collapsing into one dashboard app. Legacy base URLs per the frontend's `.env`:

- `kyAuth` → `/auth/api/v1`
- `kyConfig` → `/config/api/v2` ← note: **v2**, everything else is v1
- `kyTransaction` → `/transaction/api/v1`
- `kyProvider` → `/settlerecon/api/v1`

After migration all four collapse to a single dashboard base URL. **This is a frontend change**: the four `ky` instances in `src/utils/ky/` become one. Flagged for the frontend developer.

### 2.1 From auth-service → `modules/`

| # | Method | Path | Legacy module | Frontend caller |
|---|---|---|---|---|
| 1 | POST | `login` | `auth` | `postLogin` |
| 2 | GET | `permissions` | `permissions` | `getPermissionByAuthInfo`, `fetchPermissionAll` |
| 3 | GET | `permissions/:id` | `permissions` | `fetchPermissionById` |
| 4 | GET | `user/profile` | `users` | `getUserProfile` |
| 5 | POST | `user/admin/register-merchant` | `users` | `createMerchant` |
| 6 | POST | `user/admin/register-agent` | `users` | `createAgent` |
| 7 | GET | `agent-detail` | `agent-detail` | `getAgentList` |
| 8 | GET | `agent-detail/dropdown` | `agent-detail` | `getDropdownAgent` |
| 9 | GET | `agent-detail/:userId` | `agent-detail` | `getAgentById` |
| 10 | PATCH | `agent-detail/update/:userId` | `agent-detail` | `patchAgent` |
| 11 | GET | `merchant-detail` (page/size/businessName) | `merchant-detail` | `getMerchantList` |
| 12 | GET | `merchant-detail/dropdown` | `merchant-detail` | `getDropdownMerchant` |
| 13 | GET | `merchant-detail/:userId` | `merchant-detail` | `getMerchantById` |
| 14 | PATCH | `merchant-detail/update/:userId` | `merchant-detail` | `patchMerchant` |
| 15 | GET | `merchant-signature/generate-secret-key` | `merchant-signature` | `generateSecretKey` |
| 16 | POST | `merchant-signature/register-webhook-url` | `merchant-signature` | `registerWebhookUrl` |

### 2.2 From config-service

| # | Method | Path | Legacy module | Frontend caller |
|---|---|---|---|---|
| 17 | GET | `agent/:agentId/merchants` | `agent` | `getAgentMerchants` |
| 18 | GET | `common/div?div=` | `common` | `getCommonByDiv` |
| 19 | GET | `fee/config` | `fee` | `getBaseFee` |
| 20 | GET | `merchant/:merchantId/interval` | `merchant` | `getMerchantInterval` |
| 21 | GET | `merchant/:merchantId/config` | `merchant` | `getMerchantConfig` |
| 22 | POST | `merchant/:merchantId/provider` | `merchant` | `upsertMerchantFee` |
| 23 | POST | `merchant/:merchantId/agent-shareholder` | `merchant` | `upsertMerchantAgentShareholder` |

### 2.3 From transaction-service

| # | Method | Path | Legacy module | Frontend caller |
|---|---|---|---|---|
| 24 | GET | `balance/aggregate/internal?providerName=` | `balance` | `getBalanceInternal` |
| 25 | GET | `balance/aggregate/merchant` | `balance` | `getBalanceMerchant` |
| 26 | GET | `balance/aggregate/agent` | `balance` | `getBalanceAgent` |
| 27 | GET | `balance/merchant/:merchantId` | `balance` | `getBalanceMerchantById` |
| 28 | GET | `balance/agent/:agentId` | `balance` | `getBalanceAgentById` |
| 29 | GET | `transactions/purchase` | `purchase` | `getTransactionPurchase` |
| 30 | GET | `transactions/topup` | `topup` | `getTransactionTopUp` |
| 31 | POST | `transactions/topup` | `topup` | `createTransactionTopUp` |
| 32 | POST | `transactions/topup/approve` | `topup` | `approveTransactionTopUp` |
| 33 | POST | `transactions/topup/reject` | `topup` | ⚠️ see Finding F1 |
| 34 | GET | `transactions/withdraw` | `withdraw` | `getTransactionWithdrawal` |
| 35 | POST | `transactions/withdraw` | `withdraw` | `createTransactionWithdrawal` |
| 36 | GET | `transactions/disbursement` | `disbursement` | `getTransactionDisbursement` |

### 2.4 From settlerecon-service

Settlerecon's *provider integrations* (Inacash/PDN/Pakaidonk/Payhere/Zipay) stay out of scope. But settlement reads the **same `transaction` Postgres schema** dashboard already maps (verified: settlerecon's legacy `schema.prisma` declares `schemas = ["transaction"]`), so it is portable without touching provider code.

| # | Method | Path | Legacy module | Frontend caller |
|---|---|---|---|---|
| 37 | GET | `settlement/settled` | `settlement` | `getSettleData` |
| 38 | GET | `settlement/unsettled` | `settlement` | `getUnsettleData` |

### 2.5 Not migrated

- **Reconciliation** (`GET reconciliation`, `GET reconciliation/calculate`, `POST reconciliation/file-upload/csv`) — **out of dashboard scope**. The business requirement is still under discussion, and the intent is a separate dedicated app (NestJS or Go, chosen for concurrency and a small memory footprint) that will also own scheduled / background file generation. Revisited only after everything else lands. See D5.

- **Region lookup** (`getProvinces`/`getRegencies`/`getDistricts`/`getVillages`) — the frontend calls `emsifa.com/api-wilayah-indonesia` **directly** from the browser, no backend involvement. Nothing to port.
- **CSV export endpoints** — legacy has `GET transactions/{purchase,topup,withdraw,disbursement}/csv`. The frontend doesn't call them yet. Not migrating now; noted here because they're an obvious near-future ask.
- **`:id/detail` endpoints** — legacy has per-transaction detail routes the frontend doesn't call. Same treatment.

---

## 3. Module plan

Ported in dependency order. Each is self-contained: `controller` → `service` → `dto/`.

```
apps/dashboard/src/
├── shared/                  # ResponseDto, pagination, filters, interceptors, DTO decorators
├── auth/                    # JWT strategy, guards, decorators, AuthInfoDto  (cross-cutting)
└── modules/
    ├── auth/                # 1      login
    ├── permission/          # 2-3
    ├── user/                # 4-6    profile, register-merchant, register-agent
    ├── agent-detail/        # 7-10
    ├── merchant-detail/     # 11-14
    ├── merchant-signature/  # 15-16
    ├── config-common/       # 18
    ├── config-agent/        # 17
    ├── config-fee/          # 19
    ├── config-merchant/     # 20-23
    ├── balance/             # 24-28
    ├── purchase/            # 29
    ├── topup/               # 30-33
    ├── withdraw/            # 34-35
    ├── disbursement/        # 36
    └── settlement/          # 37-38
```

Write-path modules (`user`, `agent-detail`, `merchant-detail`, `merchant-signature`, `config-merchant`, `topup`, `withdraw`) use `PrismaMaster`. Everything else is `PrismaSlave`.

---

## 4. DTO conventions

### 4.1 Money — plain string, fixed 2 decimals

Legacy typed money fields as `Decimal` (decimal.js) and relied on `@ToDecimalFixed()` + a globally-registered `ClassSerializerInterceptor` to emit `"10000.00"`. The new convention keeps the wire format identical but makes the DTO type honest:

```ts
// Response DTO — field is the wire type
@ApiMoneyProperty()
@ToMoneyString()
nominal: string;          // "10000.00"

// Request DTO
@ApiMoneyProperty()
@IsMoney()
nominal: string;          // accepts "10000" or "10000.5" or "10000.50"
```

- `@ToMoneyString()` — `toPlainOnly` transform. Accepts Prisma `Decimal`, `string`, or `number`; emits `toFixed(2)`. Runs through `ClassSerializerInterceptor` (registered globally, same as legacy).
- `@IsMoney()` — class-validator constraint matching the existing TypeBox `MoneyType` pattern `^\d+(\.\d{1,2})?$`, so request validation is identical across the Fastify apps and dashboard.
- Internally, services still compute with `Decimal` — only the DTO boundary is string. No float arithmetic anywhere.

**On `@ApiProperty({ type: Decimal })`**: you asked to keep this for Swagger. One caveat worth knowing before I commit to it — `@nestjs/swagger` will introspect `Decimal` as a *model class*, and since decimal.js's `Decimal` has no `@ApiProperty`-decorated members, the generated schema comes out as an empty object (`{}` / `type: object`), not as a string. That's actively misleading in the rendered docs: the frontend dev reading Swagger sees an object where the wire carries `"10000.00"`.

So I've centralized it behind one decorator, `@ApiMoneyProperty()`, which emits an accurate schema:

```ts
{ type: 'string', format: 'decimal', pattern: '^\\d+(\\.\\d{1,2})?$', example: '10000.00' }
```

It's still a single decorator at each call site, so it's no more verbose than `@ApiProperty({ type: Decimal })` — and it's self-documenting, so you don't have to explain it verbally to the frontend dev. If you'd rather have the literal `type: Decimal`, it's a **one-line change inside `ApiMoneyProperty`** and every DTO picks it up. Your call — flagging, not overriding.

**Percentage precision — settled (D4).** The rule across every schema is:

| Kind | Prisma column | DTO decorators |
|---|---|---|
| **Money** | `Decimal(10, 2) // Money` | `@IsMoney()` / `@ToMoneyString()` |
| **Percentage** | `Decimal(10, 4) // Percentage` | `@IsPercentage(4)` / `@ToPercentageString(4)` |

The source schemas now carry `// Money` / `// Percentage` markers on every Decimal column, so the intended scale is greppable rather than inferred. The percentage decorators stay parameterized (defaulting to 2) in case a 2-decimal percentage ever appears, but **every percentage column in the current schema is 4** — pass `4` explicitly on those paths.

> Range note, not a blocker: `Decimal(10, 2)` allows 8 integer digits, so the largest representable amount is **99,999,999.99** (~100 juta IDR). Legacy settlerecon used `Decimal(18, 2)`. Fine if no single transaction, balance, or ledger entry ever exceeds ~100 million rupiah — worth a deliberate confirmation, since a balance log accumulates rather than resetting.

### 4.2 Dates — ISO 8601 string with Jakarta offset

**Recommendation: type date fields as plain `string`, carrying ISO 8601 with an explicit `+07:00` offset** — `2026-08-10T17:32:41+07:00`, exactly the format in the DANA doc you linked.

Reasoning:

1. **Same principle as money** — the DTO field type should be the wire type. One mental model for both, no "what does this serialize to?" guessing.
2. **The legacy type was already a fiction.** Legacy typed these as Luxon `DateTime`, but the frontend types the same fields as `string | null` (see `transaction-purchase.type.ts`). The contract was always a string; only the backend pretended otherwise.
3. **It matches the payment-gateway convention** you're targeting — DANA, Midtrans, and friends all specify ISO 8601 with an explicit offset. Being byte-identical to what your integrators emit makes cross-referencing logs and payloads trivial.
4. **It's SNAP-compatible.** SNAP mandates `yyyy-MM-ddTHH:mm:ss.SSSTZD` for `X-TIMESTAMP` (see [snap-standardization.md](snap-standardization.md) §5.3) — the same shape, plus milliseconds. Dashboard is internal/admin so it isn't SNAP-facing, but keeping the same family of format means no re-learning later.
5. **It removes a real failure mode.** A Luxon `DateTime` serializes through its own `toJSON()` in whatever zone it happens to hold. If one ever arrives in UTC, you silently emit `+00:00` and every downstream reader is 7 hours off, with no type error. A string built through one helper can't drift.

Implementation:

```ts
// Response DTO
@ApiDateProperty()
@ToJakartaISO()
createdAt: string;              // "2026-08-10T17:32:41+07:00"

@ApiDateProperty({ nullable: true })
@ToJakartaISONullable()
paidAt: string | null;

// Request DTO (query filters)
@ApiDateProperty({ required: false })
@ToJsDateNullable()
from: Date | null;              // parsed to JS Date for Prisma
```

- `@ToJakartaISO()` — `toPlainOnly`; takes a JS `Date` from Prisma, emits ISO with `+07:00` via the existing `DateHelper.toISO()` in `libs/date-time`.
- `@ToJsDateNullable()` — request side; parses an incoming ISO string to a JS `Date` (what Prisma wants), throwing `ApiError.invalidDate()` on garbage. Validation lives inside the transform because class-transformer runs *before* class-validator in Nest's pipe, same as legacy.
- No milliseconds, matching DANA's example. Trivial to switch on later if a SNAP-facing surface ever needs `.SSS`.

Timezone comes from `DateHelper`, which reads `TIMEZONE` (default `Asia/Jakarta`) — already set in `apps/dashboard/.env.example`.

### 4.3 Response envelope

Unchanged from legacy — the frontend's `ResponseDto<T>` in `global.type.ts` already matches:

```ts
{ statusCode, status, message, data, pagination, meta, error }
```

`ResponseInterceptor` wraps bare returns; returning a `Page<T>` populates `pagination`. `ResponseStatus` keeps the legacy enum (`CREATED`/`UPDATED`/`SUCCESS`/`ERROR`/`PARTIAL_SUCCESS`).

> Minor mismatch, no action needed: the frontend's local `ResponseStatus` enum is missing `UPDATED`, which the backend does emit on PATCH. Since the frontend only reads `data`, it's harmless — worth a one-line frontend addition whenever convenient.

---

## 5. Decisions

Each of these was a real defect or ambiguity found while reading the legacy code, now resolved.

### D1 — Frontend `rejectTransactionTopUp` posts to `/approve` → **backend implements both**

`transaction-top-up.api.ts`:

```ts
export function rejectTransactionTopUp(body: StatusTopUp) {
  return kyTransaction.post("transactions/topup/approve", { ... });  // ← should be /reject
}
```

Today, clicking "reject" in the dashboard **approves the top-up** — real money movement in the wrong direction.

**Decision**: the dashboard implements `POST transactions/topup/approve` *and* `POST transactions/topup/reject` correctly, matching legacy. The frontend one-liner is a separate fix on the frontend dev's side. Until it lands, reject remains broken **in the frontend only** — the backend will be correct.

### D2 — `agent-detail/dropdown` was `@PublicApi()` → **removed**

Legacy left the agent dropdown unauthenticated, leaking the full agent list (userId, profileId, fullname) to anyone who could reach the host. `merchant-detail/dropdown` was not public, confirming it was an oversight rather than a design choice.

**Decision**: no `@PublicApi()` on this endpoint. `POST /login` is the only public route in the app.

### D3 — Authorization depth → **JWT enforced; `@Roles()` and `@CheckPolicies()` are placeholders**

Legacy wired CASL `@CheckPolicies` then commented it out on nearly every controller, so any authenticated user could read or update any agent or merchant.

**Decision**: only **authentication** is enforced right now. Both authorization decorators are attached to every route but read by nothing, pending an internal decision on the role model.

| Decorator | Status | Guard |
|---|---|---|
| `JwtAuthGuard` | **Enforced** | Registered globally |
| `@Roles(...)` | Metadata only | `RolesGuard` exists and works, deliberately **not registered** |
| `@CheckPolicies()` | Metadata only | No `PoliciesGuard` exists yet |

Enabling role enforcement is one line in `app.module.ts` (the commented `{ provide: APP_GUARD, useClass: RolesGuard }`). Keeping the decorators on the routes means intended access is recorded next to each handler and greppable, so switching enforcement on is a flag flip rather than an audit of every controller.

This is the inverse of legacy's failure mode, which had real policies written out and then commented out — reading as "authorized" at a glance while enforcing nothing.

⚠️ **Until enforcement is enabled, any authenticated user can call any endpoint**, including merchant/agent registration and updates. Fine for internal development; must be settled before production.

### D4 — Decimal precision → **Money 2dp, Percentage 4dp, everywhere**

Settled and applied across all schemas: `Decimal(10, 2) // Money`, `Decimal(10, 4) // Percentage`. See §4.1. The dashboard's merged schema is now generated from the source schemas rather than hand-maintained — see §6.

### D5 — Reconciliation → **out of scope**

Deferred entirely; a separate dedicated app will own it along with scheduled / background file generation. See §2.5.

### D6 — `libs/date-time` → **deleted, moved into the dashboard**

The lib's barrel was also broken (it exported two files that never existed), so nothing could have imported it anyway.

**Decision**: `DateHelper` now lives at `apps/dashboard/src/shared/helper/date.helper.ts` and the lib is gone. Rationale: the transactional backends will each need date handling shaped by whatever their upstream provider / PJP mandates, so a single shared Luxon helper would have been a false abstraction. The dashboard's copy serves only the internal frontend. Removed from `nest-cli.json`, the `tsconfig.json` paths, and the Jest `moduleNameMapper`; all five apps verified building afterwards.

### D8 — `GET permissions` serves two different needs → **kept as legacy, flag raised**

The frontend calls this one endpoint from two places with opposite intentions:

| Caller | File | Wants |
|---|---|---|
| `getPermissionByAuthInfo()` | `store/ability.store.ts` → `router/guard/ability.guard.tsx` | **the caller's own** permissions, to build a CASL ability and render the menu |
| `fetchPermissionAll()` | `store/permission.ts` | **all** permissions, presumably for a permission-management screen |

Legacy's `findAll()` returns every permission row regardless of caller. So the ability built in `buildAbilityFromPermissions()` is the *union of all roles' permissions* for every signed-in user — meaning an agent or merchant session gets the full admin menu client-side.

**Impact is UI-only**, not a data breach: server-side authorization is the role gate (D3), which is unaffected. But it's misleading navigation, and the naming shows the intent was per-user.

**Decision**: port legacy behaviour unchanged. Scoping it to the caller's role would silently break `fetchPermissionAll()`, since both hit the same URL — the real fix is two endpoints (`GET permissions` for management, `GET permissions/me` for the ability), which needs a coordinated frontend change. Raising it rather than choosing unilaterally.

Consequence for now: `GET permissions` is **deliberately not role-gated**. Gating it to admins would leave agent/merchant sessions with no navigation at all.

### D9 — Intended roles per endpoint → **recorded (not enforced, see D3)**

| Endpoint | Intended roles |
|---|---|
| `GET user/profile` | *(any authenticated)* — returns only the caller's own profile |
| `POST user/admin/register-merchant` | `AGENT` (`MERCHANT_REGISTRAR_ROLES`) |
| `POST user/admin/register-agent` | `ADMIN_SUPER`, `ADMIN_AGENT` (`AGENT_ADMIN_ROLES`) |
| `GET permissions`, `GET permissions/:id` | *(any authenticated)* — see D8 |
| `agent-detail/*`, `merchant-detail/*` | *(any authenticated)* — pending the role decision |

**Merchants are onboarded by their agent, not by an admin.** The internal team is issued an "AgentInternal" agent account and signs in as an agent to register merchants. That keeps every merchant attached to an agent, which is what the `AgentShareholder` row created during registration depends on.

Consequence in `registerMerchant`: the `registrarIsAgent` check now normally holds, so the shareholder row is created every time. The check stays because `@Roles()` isn't enforced — without it, a non-agent caller would hit a foreign key violation on `agentId` rather than simply not getting a shareholder row.

### D11 — Legacy's agent/merchant update threw on `email` → **fixed**

`UpdateAgentDetailDto extends PartialType(CreateAgentDto)`, so it carries `email` and `password` — but those columns live on `auth.User`, not `auth.AgentDetail`. Legacy spread the filtered DTO straight into `agentDetail.update({ data: {...dto} })`.

That only appeared to work because the frontend sends `email: null` when untouched, and `DtoHelper.filter` drops nulls. **The moment anyone actually edited an email or password, it threw.** Verified against the real client:

```
ERROR TYPE: PrismaClientValidationError
MESSAGE : Invalid `prisma.agentDetail.update()` invocation:
          data: { fullname: "X", email: "legacy@style.id", ~~~~~ }   ← Unknown argument `email`
```

Both `merchant-detail` and `agent-detail` had it.

**Fix**: the DTOs declare their fields explicitly rather than deriving from the create DTO, and the service splits the payload — `email`/`password` to `auth.User`, everything else to the detail table — inside one transaction. Passwords are argon2-hashed before write. Verified end-to-end: after updating an agent's email *and* password, that agent can sign in with the new credentials.

### D12 — Soft-deleted rows appeared in list endpoints → **fixed**

Legacy's `findAll` / `findAllNames` on both agent-detail and merchant-detail queried without a `deletedAt` filter, so soft-deleted agents and merchants showed up in admin lists and dropdowns. Every query in the ported modules filters `deletedAt: null`, consistent with the rest of the app.

### D13 — Array-body endpoints returned a different error shape → **fixed**

`@Body(new ParseArrayPipe({ items: Dto }))` builds its own `ValidationPipe` with default options, ignoring the global `CustomValidationPipe`. So the two fee-upsert endpoints answered a validation failure with **400 and a prose message**, while every object-body endpoint answered with **422 and a per-field map** — the same class of failure in two shapes for the frontend to handle.

Replaced with `ParseDtoArrayPipe(Dto)` (`shared/pipe/parse-dto-array.pipe.ts`), which passes the shared `validationExceptionFactory`. Both now return:

```json
{ "statusCode": 422, "error": { "code": "VALIDATION_FAILED",
  "fields": { "feeInternalFixed": "...", "feeInternalPercentage": "..." } } }
```

### D14 — `registerWebhook` was fire-and-forget → **fixed**

Legacy's controller called `this.service.registerWebhook(...)` **without awaiting**, then immediately returned 201. A failed write still reported success, and the rejection surfaced as an unhandled promise rejection rather than a response. Now awaited.

### D15 — Aggregate balances exclude PURCHASE, single balances don't → **ported as-is, needs a decision**

The balance log tables are append-only snapshots: each row carries the resulting `balanceActive` / `balancePending`, so the current balance is simply the newest row.

But the two families of endpoint disagree on which rows count:

| Endpoint | `transactionType` filter |
|---|---|
| `GET balance/merchant/:id`, `balance/agent/:id` | **none** — newest row wins |
| `GET balance/aggregate/*` | only `WITHDRAW`, `TOPUP`, `DISBURSEMENT`, `SETTLEMENT_PURCHASE` |

So if a holder's newest row is a `PURCHASE`, the aggregate reads their *previous* row and reports a stale balance — meaning **the sum of the individual balances will not always equal the aggregate**.

Ported unchanged, because which one is right is a business question and changing it moves numbers already shown on the dashboard. My read: the per-holder version looks correct (a snapshot is a snapshot regardless of what caused it) and the aggregate's filter looks like a leftover. If you agree, deleting `AGGREGATE_TRANSACTION_TYPES` from the three aggregate queries in `balance.service.ts` is the whole fix.

**Related, worth knowing before production**: the two per-holder aggregates use Prisma `distinct: ['merchantId']` with `orderBy: createdAt`. Postgres `DISTINCT ON` requires the ordering to lead with the distinct column, which this doesn't — so Prisma cannot push it down and dedupes **in memory after fetching every matching row**. Fine at current volumes; it degrades linearly with balance-log growth. Legacy left the equivalent `DISTINCT ON` SQL in a comment marked *"TODO: Jangan di hapus => Performance"*, which is the ready-made replacement.

### D16 — Ordering had no tiebreak → **fixed**

Every "latest row" and listing query ordered by `createdAt` alone. Rows written inside one transaction can share a timestamp, and the winner was then arbitrary. All such queries now order by `createdAt DESC, id DESC` — `id` is monotonic on these append-only tables, so the newest row is picked deterministically.

### D17 — The legacy balance-ledger write path has three defects → **needs your decision before porting**

Found while reading `topup.service.ts` and `withdraw.service.ts` to port the write endpoints. These are in **legacy, in production today** — they are not migration artifacts, and each one affects money.

**1. Balance logs are written outside their transaction (withdraw).**

`WithdrawService.createBalanceLog` is called from inside `this.prisma.$transaction(async (trx) => …)`, but every write inside it uses **`this.prisma.*`, not `trx`**:

```ts
return this.prisma.$transaction(async (trx) => {
  const withdraw = await trx.withdrawTransaction.create({ … });   // in the transaction
  await this.createBalanceLog({ … });                             // NOT in the transaction
});
…
private async createBalanceLog(dto) {
  return Promise.all([
    this.prisma.merchantBalanceLog.create({ … }),   // separate connection
    this.prisma.internalBalanceLog.create({ … }),
    this.prisma.agentBalanceLog.createMany({ … }),
  ]);
}
```

Prisma's `this.prisma` runs on its own connection, so those three writes commit independently. **If the enclosing transaction rolls back, the withdrawal row vanishes but the balance debit survives** — the merchant is permanently charged for a withdrawal that does not exist.

**2. No advisory locks on the topup/withdraw balance chains.**

Both paths read the last balance and then write a new row derived from it, with nothing serializing them. Two concurrent operations on the same merchant read the same baseline and the second overwrites the first's effect — a classic lost update, on balances.

The correct pattern already exists **in the same codebase**, in `purchase.1.api.ts` and `disbursement.1.api.ts`:

```ts
// Serialize shared balance chains to prevent stale baseline reads.
await tx.$executeRaw`SELECT pg_advisory_xact_lock(30, 0)`;              // global
await tx.$executeRaw`SELECT pg_advisory_xact_lock(10, ${merchantId})`;  // per merchant
for (const agentId of agentIds) {                                       // per agent, sorted
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(20, ${agentId})`;
}
```

Note the agent ids are `.sort()`ed there — consistent lock ordering is what stops two transactions deadlocking on each other. Topup and withdraw simply never got this treatment.

The insufficient-balance guard has the same problem: `if (lastBalanceMerchant.balanceActive.lessThan(nominal)) throw` is a check-then-act, so two concurrent withdrawals can both pass it and overdraw the merchant.

**3. `merchantId: withdraw.id` in the withdraw callback.**

```ts
await this.createBalanceLog({
  withdrawId: withdraw.id,
  merchantId: withdraw.id,   // ← transaction id passed as merchant id
  …
});
```

The create path passes `profileBank.profileId` correctly; the callback path passes the withdrawal's own id. So a withdraw settled via provider callback debits **whichever merchant happens to have that id**, not the one who withdrew. This is a plain bug, not a race — worth checking against production data independently of this migration.

**Recommendation**: port these endpoints with all three corrected — locks and transaction scoping applied per the pattern the codebase already uses in its purchase/disbursement paths, and the merchant id fixed. That is not a redesign; it is applying this project's own established pattern to the two places that missed it. Porting them as-is would knowingly reproduce a lost-update race and a rollback hole.

**Not yet implemented**, pending that decision.

### D10 — `prisma migrate` is currently unusable in this repo → **flagged, not fixed**

Found while setting up a local database to test against. Every `prisma migrate` path fails:

```
$ npx dotenv -e apps/auth/.env.local -- npx prisma migrate status --schema apps/auth/prisma/schema.prisma
Error: The datasource.url property is required in your Prisma config file when using prisma migrate status.
```

Two compounding causes:

1. **No `prisma.config.ts` at the repo root.** Prisma 7 looks for the config in the working directory. Each app has one, but running from root finds none — so `datasource.url` is undefined, which `migrate` requires (`generate` doesn't, which is why `prisma:generate:*` works fine).
2. **Passing `--config apps/auth/prisma.config.ts` doesn't help**: that file declares `schema: 'apps/auth/prisma/schema.prisma'`, and Prisma resolves it relative to the *config file's own directory*, producing `apps/auth/apps/auth/prisma/schema.prisma`.

So `npm run prisma:migrate:dev:auth`, `prisma:migrate:deploy:auth`, and the `config` equivalents are all broken today. No app has a `migrations/` folder yet, so nothing has been migrated — consistent with this never having worked.

**Not fixed here** because it affects the transactional apps' deployment path, not the dashboard. The likely fix is making paths inside each `prisma.config.ts` relative to the config file (`prisma/schema.prisma`, `prisma/migrations`) and passing `--config` in the scripts. Worth resolving before any deploy that needs `migrate deploy`.

For local development in the meantime, `db push` works with an explicit URL:

```bash
npx prisma db push --schema apps/auth/prisma/schema.prisma --url "$POSTGRESQL_URL_MASTER"
```

### D7 — Login validation runs *after* the auth guard → **kept as legacy**

`POST /login` carries `@ApiBody({ type: LoginDto })`, but `LoginDto`'s class-validator rules never execute: Nest runs guards before pipes, and `LocalAuthGuard` reads `email`/`password` straight off the raw body. Verified live — posting `{"email":"not-an-email","password":""}` returns **401**, not the 422 the DTO implies.

**Decision**: keep legacy behaviour. The outcome (rejected login) is correct; only the status code differs. Noted so the Swagger contract isn't mistaken for enforced validation.

---

## 6. Deliberate deviations from legacy

Everything else is a faithful port. These four are intentional, and each is behaviour-preserving:

1. **`ApiError`** drops legacy's `DependencyErrorContext` / dependency-failure factories. Those existed to describe inter-service TCP call failures; the dashboard makes no such calls.
2. **`PrismaClientKnownExceptionFilter`** is a lookup map covering request-time codes (P1xxx connection, P2xxx query engine) instead of legacy's ~90-case switch. The P3xxx (migrate), P4xxx (db pull) and P6xxx (Accelerate) branches it also listed are unreachable from a request handler. Unmapped codes still return their code as `PRISMA_<code>`. It also strips Prisma's nested `driverAdapterError` from the response — that object quotes raw SQL and relation names, which is schema disclosure; it stays in the logs.
3. **Profile-table resolution on login** uses an explicit role→profile map keyed on `UserRoleEnum`, rather than legacy's substring test (`role.includes('admin')` checked before `'merchant'`). Identical results for today's eight roles — it only works in legacy because of the check order, so a future `MERCHANT_ADMIN` would silently resolve to the admin table.
4. **The dashboard's `schema.prisma` is generated, not hand-maintained** — see §6.1.

Also worth noting, in `LocalStrategy`: legacy constructed an `UnauthorizedException` and never threw it, so a bad password fell through as a null user. The port throws.

### 6.1 The merged schema is generated

`apps/dashboard/prisma/schema.prisma` is produced by `apps/dashboard/prisma/merge-schema.js`, which concatenates the auth, config and transaction schemas:

```bash
npm run prisma:merge:dashboard && npm run prisma:generate:dashboard
```

It was previously a hand-copied concatenation, which would silently drift whenever a source schema changed — and did: the Money/Percentage precision rework landed in `apps/config` and `apps/transaction` while the dashboard's copy kept the old types.

The script also owns the enum-collision rename. Config and transaction each declare their own `TransactionTypeEnum` (necessary — Prisma requires every `@@schema` block to be self-contained), but Prisma needs globally unique identifiers within one file. So config's copy becomes `TransactionTypeEnumConfig` with `@@map("TransactionTypeEnum")` pointing back at the real Postgres type. **The rename is local to the dashboard's client; the database is untouched.** If a source schema ever stops declaring a renamed enum, the script fails loudly rather than silently skipping the rename.

The output carries a `DO NOT EDIT` banner. Edit the source schemas, then re-run.

> Reminder: the dashboard **never migrates**. `migrations` is commented out in its `prisma.config.ts`, and no `prisma:migrate:*:dashboard` script exists. Each owning app migrates its own tables.

## 7. Progress

- [x] Frontend endpoint inventory (40 endpoints mapped to legacy modules)
- [x] Migration plan + DTO conventions (this doc)
- [x] `shared/` foundation — `ResponseDto`, pagination, `ApiError` + exception filters (incl. Prisma), `ResponseInterceptor`, `CustomValidationPipe`, money/date decorators, `DtoHelper`
- [x] `auth/` foundation — `JwtConfig`, JWT + local strategies, `JwtAuthGuard`/`RolesGuard`, `@PublicApi`/`@Roles`/`@CurrentAuthInfo`, `POST /login`
- [x] Schema merge automated (`prisma:merge:dashboard`); Money/Percentage precision synced from the source schemas
- [x] `libs/date-time` removed, `DateHelper` moved into the dashboard
- [x] **`user`** — `GET user/profile`, `POST user/admin/register-merchant`, `POST user/admin/register-agent` (endpoints 4-6)
- [x] **`permission`** — `GET permissions`, `GET permissions/:id` (endpoints 2-3)
- [x] **`agent-detail`** — list, dropdown, by-userId, update (endpoints 7-10)
- [x] **`merchant-detail`** — paginated list + filter, dropdown, by-userId, update (endpoints 11-14)
- [x] **`merchant-signature`** — secret rotation, webhook URL registration (endpoints 15-16)
- [x] **`config-common`** — `GET common/div` (endpoint 18)
- [x] **`config-agent`** — `GET agent/:agentId/merchants` (endpoint 17)
- [x] **`config-fee`** — `GET fee/config` (endpoint 19)
- [x] **`config-merchant`** — interval, config, fee upsert, shareholder upsert (endpoints 20-23)
- [x] **`balance`** — 3 aggregates + 2 per-holder (endpoints 24-28)
- [x] **`purchase` / `topup` / `withdraw` / `disbursement`** — listings (endpoints 29, 30, 34, 36)
- [x] **`settlement`** — settled / unsettled (endpoints 37-38)
- [ ] **Deferred — the 3 transaction write endpoints** (31, 32/33, 35): `POST transactions/topup`, `POST transactions/topup/{approve,reject}`, `POST transactions/withdraw`

**35 of 38 endpoints ported.**

### Why the 3 write endpoints are deferred

They are not more of the same — each pulls in a subsystem that isn't in the dashboard yet:

| Endpoint | Depends on |
|---|---|
| `POST transactions/topup` | **Fee calculation.** Legacy calls config-service over TCP (`calculateTopupFeeConfigTCP`) to split a nominal into merchant / agent / provider / internal cuts. The dashboard has no TCP, so this means porting config's fee calculators — the four ~95%-duplicated services my earlier audit flagged for consolidation. |
| `POST transactions/topup/approve` | **The balance ledger.** Approval calls `settlementTopup`, which moves money: Postgres advisory locks (global id 30, per-merchant `(10, id)`, per-agent `(20, id)`) around append-only inserts into `MerchantBalanceLog` / `AgentBalanceLog` / `InternalBalanceLog`. |
| `POST transactions/withdraw` | Both of the above. |

`POST topup/reject` is a one-line status update and could land immediately, but shipping reject without approve isn't useful.

This is the highest-risk logic in the system — it is the money movement, and getting the lock ordering wrong causes deadlocks or double-spend under concurrency. It deserves its own focused pass with the lock semantics ported deliberately and tested under concurrent load, not appended to the end of a long session. The listings and balances above cover every read the dashboard needs; these three are the write path.

The controllers carry a comment at the spot where each belongs.

### End-to-end verification (real database)

Against a local Postgres with all three schemas pushed (29 tables) and a seeded `ADMIN_SUPER`:

| Check | Result |
|---|---|
| `POST /login` | 200, returns JWT + `authInfo` |
| `GET /user/profile` | 200, admin block populated, agent/merchant null |
| `GET /permissions` | 200, permission list |
| `POST /user/admin/register-agent` | 201 — `auth.User` + `auth.AgentDetail` + `config.Agent` all created |
| `POST /user/admin/register-merchant` | 201 — `auth.User` + `MerchantDetail` + `MerchantSignature` (clientId `3-<uuid>`) + `config.Merchant` (`settlementInterval` 60, not the 120 default) |
| `config.AgentShareholder` after admin-registered merchant | **empty**, correct — the registrar is not an agent |
| Duplicate email | 422 `email is already registered` |
| `MERCHANT` token on an admin route | 403 naming the role |
| Unauthenticated on any route | 401 in the standard envelope |
| **Audit trail** | `createdBy = 1` stamped on every row the admin created — confirms JwtAuthGuard → CLS → Prisma extension |
| **Transaction rollback** | Forced a `config.Merchant` PK collision mid-registration: 409 returned, **zero** orphaned `User` / `MerchantDetail` / `MerchantSignature` rows |

That last row is the one legacy could not guarantee: auth committed its own transaction, *then* made a TCP call to config, so a config failure left an orphaned user with no merchant config.

Both `config.TransactionTypeEnum` and `transaction.TransactionTypeEnum` exist as separate Postgres types in the pushed database, confirming the merged-schema `@@map` rename targets real types.

> Local test data: roles `ADMIN_SUPER`/`AGENT`/`MERCHANT`, `admin@manapay.id` / `password123`, plus one seeded agent and merchant. Wipe with
> `DROP SCHEMA auth, config, transaction CASCADE;` then re-push.

**agent-detail / merchant-detail**, same database:

| Check | Result |
|---|---|
| `GET /agent-detail`, `/dropdown`, `/:userId` | 200, flattened AgentDetail + User |
| `GET /merchant-detail?page=1&size=10` | 200 with `pagination` populated |
| `businessName` filter | case-insensitive partial match; 1 hit for `toko`, 0 for `zzz` |
| `PATCH /agent-detail/update/:userId`, detail fields only | 200; nulls dropped, untouched fields preserved |
| `PATCH` **with `email` + `password`** | 200 — email updated on `auth.User`, password re-hashed, **and the agent then signed in with the new credentials** |
| Same for merchant | 200, email and businessName both updated |
| `GET /agent-detail/999` | 404 `Agent not found` |
| Legacy's update approach, run directly | `PrismaClientValidationError: Unknown argument 'email'` — confirms D11 |

**merchant-signature + config modules**, same database (seeded 2 banks, 3 providers, 2 payment methods, 2 base fees):

| Check | Result |
|---|---|
| `common/div?div=BANK` | 200, banks as `{name: code, explain: name}` |
| `?div=PROVIDER` | 200, **INTERNAL excluded** as intended |
| `?div=PROVIDER_TOPUP` | 200, fixed single INTERNAL option |
| `?div=PAYMENT_METHOD_PURCHASE` | 200, filtered by `transactionTypes has PURCHASE` |
| `?div=BOGUS` | 422 |
| `GET /fee/config` | `feeProviderFixed: "500.00"` (Money 2dp), `feeProviderPercentage: "0.7000"` (Percentage 4dp) |
| `GET /merchant/:id/interval` | 200, `settlementInterval: 60`, null date renders null |
| `GET /merchant/:id/config` | 200; `merchantFeeConfig: null` where no override, `agentShareholders: null` when empty |
| `POST /merchant/:id/provider` | 201; `"100"` → `"100.00"`, `"0.1"` → `"0.1000"` on read-back |
| Action `D` in a batch | 201, override row removed |
| `POST /:id/agent-shareholder` summing 60% | rejected: *"Sum of agent shareholder percentage must be 100%"*, `fields` reports `"Current sum is 60.0000%"` |
| Same summing 100% | 201 |
| `GET /agent/:id/merchants` | 0 before the shareholder link, 1 after — the cross-schema join that replaced legacy's TCP call |
| Merchant rotates secret twice | new key returned each time; DB confirms `secretKey` = 2nd, `previousSecretKey` = 1st |
| `register-webhook-url` with a bad URL | 422 |
| Money with 14 integer digits | 422 at the API boundary, not a Postgres overflow |
| Percentage 150 | 422 |
| `GET /merchant/999/config` | 404 |

**balance + transaction listings**, same database (seeded 3 purchases incl. one 30 days old, plus topup / withdraw / disbursement and balance logs):

| Check | Result |
|---|---|
| `balance/merchant/3` | `149300.00` / `25000.00` — picked the newer TOPUP row over the older settlement row |
| `balance/agent/2`, `aggregate/internal` | correct snapshots |
| `aggregate/internal?providerName=NOPE` | zeroes, not an error |
| `balance/merchant/999` (no rows) | zeroes, not a 404 — no movement yet is a zero balance |
| `transactions/purchase` default window | 2 of 3 rows; the 30-day-old one correctly excluded |
| Same with an explicit 60-day range | all 3 |
| Purchase row shape | `nominal: "100000.00"`, `totalFeeCut: "700.00"` (500 + 200 from feeDetails), `createdAt: "2026-08-10T20:37:41+07:00"`, `feePercentage: "0.0000"` |
| `topup` / `withdraw` / `disbursement` listings | 1 row each, correct fields |
| `settlement/settled` vs `unsettled` | correctly split the two successful purchases by `settlementAt` |
| `status=PENDING` filter | returned only the pending row |
| `merchantId=3` on withdraw | matched `userId` 3 — withdrawals key on userId, not merchantId |
| `status=NOPE` | 422 |
| `from=notadate` | 422 `Field 'from' must be a valid date-time` |

### Verified so far

- `nest build` clean for **all five apps** (dashboard + the four transactional ones — confirms the `libs/` changes didn't regress anything).
- `eslint` clean (0 errors, 0 warnings) across `apps/dashboard`, `libs/configuration`, `libs/date-time`.
- App boots; routes map; Redis connects; Prisma reaches Postgres.
- Live: `POST /auth-info` without a token → `401` in the correct envelope. `POST /login` → mapped Prisma error (the local DB has no `auth` schema yet, which is what surfaced it).
- DTO decorators tested against a **real Prisma `Decimal`**: `10000.5` → `"10000.50"`, `9750` → `"9750.00"`, 4-dp percentage `2.5` → `"2.5000"`, `Date(2026-08-10T10:32:41Z)` → `"2026-08-10T17:32:41+07:00"`. Validation rejects >2 decimals, negatives, and percentages over 100.

> Worth knowing: Prisma's `Decimal` is a **different class** from the app's `decimal.js` — `instanceof` returns false across the two. The money transform converts via `toString()` for exactly this reason.

### Dependencies added

`@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `passport-local`, `argon2`, plus `@types/passport-jwt` / `@types/passport-local` — the same set legacy uses. `JWT_*` variables added to `apps/dashboard/.env.example` and `.env.local`; the access-token secret must match the auth service's, since the dashboard verifies tokens that service issues.
