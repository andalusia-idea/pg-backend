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

Settlerecon's *provider integrations* (Inacash/PDN/Pakaidonk/Payhere/Zipay) stay out of scope. But settlement + reconciliation read the **same `transaction` Postgres schema** dashboard already maps (verified: settlerecon's legacy `schema.prisma` declares `schemas = ["transaction"]`), so these are portable without touching provider code.

| # | Method | Path | Legacy module | Frontend caller |
|---|---|---|---|---|
| 37 | GET | `settlement/settled` | `settlement` | `getSettleData` |
| 38 | GET | `settlement/unsettled` | `settlement` | `getUnsettleData` |
| 39 | GET | `reconciliation` | `reconciliation` | `getReconciliationData` |
| 40 | GET | `reconciliation/calculate` | `reconciliation` | `getReconciliationCalc` |
| 41 | POST | `reconciliation/file-upload/csv` | `reconciliation` | `reconUploadCsv` ⚠️ see Finding F5 |

### 2.5 Not migrated

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
    ├── settlement/          # 37-38
    └── reconciliation/      # 39-41
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

**Percentage precision — needs your input (Finding F4).** `MoneyType`'s 2-decimal rule doesn't hold for all percentage columns:

| Column | Prisma type | Decimals |
|---|---|---|
| `BaseFee.feeProviderPercentage` | `Decimal(10, 2)` | 2 |
| `MerchantFee.feeInternalPercentage` | `Decimal(10, 4)` | **4** |
| `MerchantFee.feeAgentPercentage` | `Decimal(10, 4)` | **4** |
| `AgentShareholder.percentagePerAgent` | `Decimal(10, 2)` | 2 |

Forcing everything to 2 decimals would **silently truncate** merchant/agent fee percentages on the `upsertMerchantFee` write path. So the percentage decorators are parameterized — `@IsPercentage(4)` / `@ToPercentageString(4)` — defaulting to 2. See F4 below for the open question.

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

## 5. Findings — need your input before I touch them

Each of these is a real defect or ambiguity found while reading the legacy code. **None have been changed.**

### F1 — Frontend `rejectTransactionTopUp` posts to `/approve`

`transaction-top-up.api.ts`:

```ts
export function rejectTransactionTopUp(body: StatusTopUp) {
  return kyTransaction.post("transactions/topup/approve", { ... });  // ← should be /reject
}
```

Legacy backend has both `POST /approve` and `POST /reject`. So today, clicking "reject" in the dashboard **approves the top-up** — real money movement in the wrong direction.

*Plan*: implement both endpoints correctly on the dashboard side (matching legacy), and flag the one-line frontend fix. **This is a frontend bug, not a backend one** — I can't fix it from here. Worth telling your frontend developer sooner rather than later.

### F2 — `agent-detail/dropdown` is `@PublicApi()` in legacy

`agent-detail.controller.ts` marks the dropdown endpoint `@PublicApi()` — no auth. It leaks the full agent list (userId, profileId, fullname) to anyone who can reach the host. `merchant-detail/dropdown` is **not** public, so this looks accidental rather than deliberate.

*Question*: port as-is (public), or require auth? I'd default to requiring auth unless something depends on it being open.

### F3 — CASL `@CheckPolicies` is commented out almost everywhere

Every route in `agent-detail.controller.ts` has its policy check commented out; same pattern across most legacy controllers. Effectively, any authenticated user can read/update any agent or merchant.

*Question*: for dashboard, do you want (a) as-is — JWT only, no per-action policy, (b) JWT + `@Roles()` role gate, or (c) full CASL? I'd suggest **(b)** for now — meaningfully safer than (a), far less work than (c), and it maps onto the `Role`/`Permission` tables that already exist.

### F4 — Percentage decimal precision (see §4.1)

`MerchantFee.feeInternalPercentage` / `feeAgentPercentage` are `Decimal(10,4)`; the existing TypeBox `PercentageType` only allows 2 decimals. The legacy `PercentageType(decimalPlaces)` parameterized version is commented out in `libs/microservice/src/microservice.enum.ts`, which suggests you hit this already.

*Question*: should merchant/agent fee percentages accept 4 decimals (matching the DB), or is 2 the real business rule and the `Decimal(10,4)` column is over-provisioned? I've built the decorators parameterized either way — just need to know which to apply on the `upsertMerchantFee` path.

### F5 — Reconciliation CSV upload may be a no-op

My earlier audit of the legacy code flagged `reconciliation` as parsing uploaded CSVs but never persisting results. I haven't re-verified this in detail yet — I'll confirm when I reach that module (it's last in the order). If it is a no-op, porting it faithfully means porting a stub; worth deciding then whether to finish it or leave the endpoint returning success without doing anything.

### F6 — Unrelated latent bug: `libs/date-time` barrel is broken — **fixed**

`libs/date-time/src/index.ts` exported `./date-time.module` and `./date-time.service` — **neither file existed**. Only `date.helper.ts` does. Any `import { DateHelper } from '@app/date-time'` would have failed to compile.

Nothing imported it, so nothing was broken in practice. Dashboard is the first consumer, so the barrel now reads `export * from './date.helper'`. Verified all four other apps still build. Flagged because it's a change outside `apps/dashboard`.

### F7 — Login validation runs *after* the auth guard (legacy behaviour, kept)

`POST /login` carries `@ApiBody({ type: LoginDto })`, but `LoginDto`'s class-validator rules never execute: Nest runs guards before pipes, and `LocalAuthGuard` reads `email`/`password` straight off the raw body. Verified live — posting `{"email":"not-an-email","password":""}` returns **401 UNAUTHORIZED**, not the 422 the DTO implies.

Legacy behaves identically. Kept as-is since the outcome (rejected login) is correct and only the status code/message differ. Raising it because the Swagger contract is misleading. Fixing it would mean validating inside `LocalStrategy` — say the word and I'll do it.

---

## 6. Deliberate deviations from legacy

Everything else is a faithful port. These three are intentional, and each is behaviour-preserving:

1. **`ApiError`** drops legacy's `DependencyErrorContext` / dependency-failure factories. Those existed to describe inter-service TCP call failures; the dashboard makes no such calls.
2. **`PrismaClientKnownExceptionFilter`** is a lookup map covering request-time codes (P1xxx connection, P2xxx query engine) instead of legacy's ~90-case switch. The P3xxx (migrate), P4xxx (db pull) and P6xxx (Accelerate) branches it also listed are unreachable from a request handler. Unmapped codes still return their code as `PRISMA_<code>`. It also strips Prisma's nested `driverAdapterError` from the response — that object quotes raw SQL and relation names, which is schema disclosure; it stays in the logs.
3. **Profile-table resolution on login** uses an explicit role→table map rather than legacy's substring test (`role.includes('admin')` checked before `'merchant'`). Identical results for today's eight roles — it only works in legacy because of the check order, so a future `MERCHANT_ADMIN` would silently resolve to the admin table.

Also worth noting, in `LocalStrategy`: legacy constructed an `UnauthorizedException` and never threw it, so a bad password fell through as a null user. The port throws.

## 7. Progress

- [x] Frontend endpoint inventory (40 endpoints mapped to legacy modules)
- [x] Migration plan + DTO conventions (this doc)
- [x] `shared/` foundation — `ResponseDto`, pagination, `ApiError` + exception filters (incl. Prisma), `ResponseInterceptor`, `CustomValidationPipe`, money/date decorators, `DtoHelper`
- [x] `auth/` foundation — `JwtConfig`, JWT + local strategies, `JwtAuthGuard`/`RolesGuard`, `@PublicApi`/`@Roles`/`@CurrentAuthInfo`, `POST /login`
- [ ] Modules (17), in the order listed in §3

### Verified so far

- `nest build` clean for **all five apps** (dashboard + the four transactional ones — confirms the `libs/` changes didn't regress anything).
- `eslint` clean (0 errors, 0 warnings) across `apps/dashboard`, `libs/configuration`, `libs/date-time`.
- App boots; routes map; Redis connects; Prisma reaches Postgres.
- Live: `POST /auth-info` without a token → `401` in the correct envelope. `POST /login` → mapped Prisma error (the local DB has no `auth` schema yet, which is what surfaced it).
- DTO decorators tested against a **real Prisma `Decimal`**: `10000.5` → `"10000.50"`, `9750` → `"9750.00"`, 4-dp percentage `2.5` → `"2.5000"`, `Date(2026-08-10T10:32:41Z)` → `"2026-08-10T17:32:41+07:00"`. Validation rejects >2 decimals, negatives, and percentages over 100.

> Worth knowing: Prisma's `Decimal` is a **different class** from the app's `decimal.js` — `instanceof` returns false across the two. The money transform converts via `toString()` for exactly this reason.

### Dependencies added

`@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `passport-local`, `argon2`, plus `@types/passport-jwt` / `@types/passport-local` — the same set legacy uses. `JWT_*` variables added to `apps/dashboard/.env.example` and `.env.local`; the access-token secret must match the auth service's, since the dashboard verifies tokens that service issues.
