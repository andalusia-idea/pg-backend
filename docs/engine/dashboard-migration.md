# Dashboard App — Migration Plan

**Branch**: `dashboard` · **Status**: in progress · **Scope**: port every endpoint the PG-Dashboard frontend actually calls into `apps/dashboard`, keeping the legacy style (Express, class-validator, class-transformer) rather than refactoring to the Fastify/TypeBox stack used by the transactional apps.

Source of truth for "what to migrate" is the frontend's own API client layer at `C:\prelion\pg\PG-Dashboard\src\api\*.api.ts` — if the frontend doesn't call it, it isn't in scope.

---

## Update — 2026-10-27 frontend task 8 complete

The frontend has now completed the requested transaction read-model follow-up against the current `apps/dashboard` DTOs:

- **8a / D18:** the internal balance provider filter is hidden, the `providerName` query parameter was removed from the balance API/query hook, and the provider dropdown lookup wiring was removed. The endpoint is house-wide and does not accept provider filtering.
- **8b:** purchase, top-up, disbursement, withdrawal, and settlement response types now follow their backend DTOs. Transaction and settlement tables/exports no longer reference `reconciliationAt`; metadata is not rendered in transaction UI. Metadata remains in response types only for backend DTOs that still return it. Withdrawal reads now use `paymentMethodName`, `accountHolderName`, `accountNumber`, and `bankCode`.
- **D18 is closed for this frontend cleanup.** Withdrawal create/approval request behavior remains a separate contract item and is not implied by the read DTO alignment.

The current frontend task list is `PG-Dashboard/new-task.md` (updated 2026-10-27). Historical comparison notes below are retained as records of earlier findings.

---
## Update — 2026-10-26 post-pull comparison

Compared the latest dashboard source and DTOs with the frontend and all five files under `docs/batch/`. Commits `2bef704`, `aaef4c2`, and `409adcc` implement cleanup after settlement and update the dashboard reads.

- **Step 15 cleanup landed.** The legacy balance-log tables, reconciliation columns, merchant settlement interval columns, provider reconciliation-time columns, and `SETTLEMENT_PURCHASE` enum value were removed by migrations. Dashboard DTOs dropped `reconciliationAt`; config responses dropped `settlementInterval`/`lastSettlementAt`.
- **Dashboard Step 12 is partially delivered.** `BalanceService` now reads and aggregates `BalanceSnapshot` and all balance responses add `balanceReserved`. Admin profit and manual adjustment/history endpoints/screens, plus run/batch read APIs, are still absent. Update the frontend for `balanceReserved` and the removed response fields.
- **Backend defect to fix:** `checkBalanceAgent()` in `apps/dashboard/src/modules/balance/balance.service.ts` filters `BalanceSnapshot` with `BalanceHolderTypeEnum.MERCHANT`, so per-agent balances can return the wrong holder's rows. It should use the agent holder type.
- **D15 is resolved** by aggregating snapshot buckets; there is no transaction-type filter to diverge between aggregate and per-holder balances. **D22 is partially resolved:** balance reads migrated, but the agent filter defect and deferred balance writes/admin features remain.
- **D24 is resolved.** Backend interval fields were removed from the legacy GET DTOs in this pull; frontend creation had already stopped sending `settlementInterval`.
- **Transaction listing contract changed:** `reconciliationAt` was removed from purchase, top-up, disbursement, and withdrawal DTOs. The frontend still declares/renders it in its corresponding transaction and legacy settlement views. The separate reconciliation module remains out of scope; check its own service contract independently.
- **The frontend's `SETTLEMENT_PURCHASE` enum is stale** after the backend removed that value. The `EWALLET` mock split remains fixed.
- The older manual `POST /settlement/settle` is still a no-op stub, while the frontend still presents a success message. Scheduled settlement Steps 10–11 remain live. The new run/batch records still have no dashboard read routes.
- The merchant policy UI remains mock-backed pending a real dashboard controller. D3 authorization enforcement and D19 reference-field mapping remain open. D18 frontend cleanup is complete; D21 remains open only for withdrawal create/approval request behavior.

The current actionable frontend list is in `PG-Dashboard/new-task.md` (2026-10-26 post-pull). The implementation guide's Steps 13–14 remain planned; its Step 15 status should be read as complete from this pull, and Step 12 as partial rather than wholly unstarted.

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
| Authorization | **JWT only.** `@Roles()` and `@CheckPolicies()` are attached to every route but read by nothing yet — see D3 |
| Refactoring | Port behavior as-is. Anything that looks like a real bug gets flagged in this doc and raised before changing it |

### Why shared code stays app-local

`libs/` is currently TypeBox/Ajv territory (`libs/microservice`), used by auth/config/transaction. Dashboard's `ResponseDto`, pagination, exception filters, and DTO decorators are class-validator/class-transformer based. Putting both idioms in `libs/` would mean every app pulls in both validation stacks. Dashboard keeps its own `shared/` folder; if a second Express-style app ever appears, that's the moment to promote it.

---

## 2. Endpoint inventory

The frontend calls 41 endpoints across 4 legacy services. Three (reconciliation) are out of scope per D5, leaving **38 in scope**, collapsing into one dashboard app. Legacy base URLs per the frontend's `.env`:

- `kyAuth` → `/auth/api/v1`
- `kyConfig` → `/config/api/v2` ← note: **v2**, everything else is v1
- `kyTransaction` → `/transaction/api/v1`
- `kyProvider` → `/settlerecon/api/v1`

After migration all four collapse to a single dashboard base URL. **This is a frontend change**: the four `ky` instances in `src/utils/ky/` become one. Flagged for the frontend developer.

> **Verification pass (2026-08-25, `dev` branch).** Cross-checked every row below against the real controllers in `apps/dashboard/src/**/*.controller.ts` and the frontend's actual API layer at `C:\Users\USER\Documents\programming_folder\web dev\PG-Dashboard\src\api\*.api.ts` (the frontend source-of-truth path above, `C:\prelion\pg\PG-Dashboard`, is stale — that's not where the checked-out frontend lives). Two new columns were added: **Status** (does the backend route exist, and does it actually match what the frontend calls) and **Role** (which frontend-authenticated persona actually reaches this call, read from each page's `roles:` route metadata in `src/router/routes/modules/*.ts` — client-side menu/route gating only, **not** server enforcement; per D3 the backend still enforces authentication only — `RolesGuard` is not registered as an `APP_GUARD` in `app.module.ts` — so today any authenticated role can call any endpoint regardless of what's shown here).
>
> This pass also turned up **10 endpoints the frontend calls that were missing from this inventory entirely** — not "not yet ported," but never counted. They're appended to their category tables below, numbered 39–48, so the existing 1–38 numbering (referenced elsewhere in this doc) doesn't shift.
>
> **Update (2026-08-26): the three issues flagged below on 2026-08-25 are now fixed on the frontend.** Re-verified by re-reading the current frontend source and its git log (`b9475b4`, `42e086a`, `0efd1b6`, `2df39fa`, plus a run of smaller fixes in between) — kept here for history rather than deleted, since all three were live bugs at the time this doc was written:
>
> - **Role rename, was 🔴 blocking every admin login.** `ROLE` (shared at `libs/microservice/src/microservice.enum.ts`) renamed `ADMIN_SUPER`→`SUPER_ADMIN` and collapsed `ADMIN_AGENT`/`ADMIN_MERCHANT`/`ADMIN_ROLE_PERMISSION` into one `ADMIN`, but the frontend's `AuthGuard` had `"ADMIN_SUPER"` hardcoded for its role re-check and every route file gated on it — no admin-type account could stay logged in. **Fixed** (commit `0efd1b6`): the guard (`src/router/guard/auth.guard.tsx`) now calls the previously-unused `POST auth-info` endpoint via a new `getAuthInfo()` (`src/api/auth.api.ts`) and compares the raw server-side role string directly, instead of guessing one from `/user/profile`'s shape — a more robust fix than a literal string swap, since it no longer hardcodes any role name at all. Every `roles: [...]` array under `src/router/routes/modules/*.ts` was also updated to `SUPER_ADMIN` (confirmed by grepping all of them). See the frontend's own findings doc, §0, for the fix write-up.
> - **Config base URL, was disagreeing with itself.** `.env`/`.env.development`/`.env.production` disagreed on config-service's version (v1 vs v2) and its URL prefix generally. **Fixed** (commit `42e086a`): all four `VITE_API_*` vars now point at one identical collapsed base URL per environment (e.g. `https://api.manapay.id/api/v1` in `.env`/`.env.production`) — exactly the "four `ky` instances become one" change this doc asked for above.
> - **Merchant-signature path mismatch (rows 15, 16, 39).** Fixed the same way — see the note under §2.1 rather than repeating it here.
>
> **Update (2026-08-26, second entry): rows 39–48 now have real controllers, modules, and DTOs in `apps/dashboard`.** Per request, scaffolding was added for all 10 previously-🆕 endpoints so the frontend can integrate against a real response shape today. Row 39 (`merchant-signature/status`) is a genuine read — trivial, no money involved, so it's wired up for real. The other nine (rows 40–48 — withdraw approve/reject, the purchase/disbursement callback trio each, and settlement/settle) are **stubs**: the route, validation, and response envelope are real, but the handler body is a no-op that reports success without writing anything. Marked 🟡 **Stubbed** below, distinct from ✅ Matches (fully correct) and 🆕 New (nothing exists). **Rows 31, 32, 33, 35 were deliberately left alone** — those are gated on the D17 balance-ledger decision, which is explicitly yours to make (§5), not a "just wire it up" gap like 39–48 were; stubbing them would have jumped ahead of that decision.
>
> **Update (2026-10-01): frontend `.env` compared against `apps/dashboard`, full endpoint re-check.** The frontend's root `.env` (`VITE_API_AUTH`/`CONFIG`/`TRANSACTION`/`PROVIDER`) now collapses all four services to one identical base URL (`https://api.manapay.id/api/v1`), matching the backend's single `app.setGlobalPrefix()` prefix — no routing mismatch, nothing further needed there; the "four `ky` instances become one" note two paragraphs up is still the only outstanding frontend change on that front, and it's cosmetic (one shared client vs. four pointed at the same place), not a functional gap. Re-diffed the frontend's `src/api/*.ts` against this inventory via `git log` since the last pass and re-grepped every `apps/dashboard/src/**/*.controller.ts` route: **no endpoint the frontend calls is missing from this table, and no backend route is undocumented.** The one real finding this pass is **not** a missing or unfinished *endpoint* — it's that five already-"✅ Matches" rows (24–28) are wired up correctly end-to-end but read from tables nothing in the codebase writes to, so they're correct and dead at the same time. See the new D22 in §5, and the per-row notes in §2.3.
>
> **Update (2026-10-12): re-checked after pulling new `dev` commits (12 on the backend, none on the frontend).** `apps/dashboard` itself has **zero** file changes in this range — every backend commit since 2026-10-01 touched `apps/transaction` and shared `libs/` instead (a new Jatelindo bank-transfer rail, disbursement internals, and the balance library). No endpoint routes moved and nothing new needs adding to this inventory. But one of those `apps/transaction`/schema changes **breaks two already-inventoried endpoints that `apps/dashboard` never got updated for**: rows 34 and 36 now point at columns a migration renamed/dropped nine days ago. That's not a new endpoint gap, it's an existing ✅-rated contract about to start failing — see the new **D23** in §5 (urgent), and the row-34/row-36 notes in §2.3. Also updated: D21 (the transaction-app schema quietly grew real bank/USDT discrimination for withdrawals, narrowing but not closing that decision) and D22 (the balance library's transaction-client guard had a bug that's now fixed, and the dev seeder is its first caller — but only for fixtures, still zero production callers).
>
> **Update (2026-10-13): re-checked after pulling 4 more `dev` commits, and the picture moved a lot.** Still zero hand-written changes under `apps/dashboard/src` — but its generated Prisma client got regenerated as a side effect of an unrelated `auth`/`Role` migration, which **fixes D23's crash risk for free**: row 34 is fully clear again, row 36 is downgraded from "will 500" to a D19-style silently-blank set of 4 fields. Separately, and far bigger: **D17 is fixed, and the balance-ledger library from D22 now has real, live callers.** `apps/transaction`'s purchase and disbursement webhooks now post actual balance movements — verified against fixtures and cross-checked by a new nightly integrity job. This closes D17 outright (moved to Settled in §5) and substantially narrows D22, but with a sharper edge than "progress": `apps/dashboard`'s own balance module (rows 24–28) reads three tables that this change confirms, a second time, nothing will ever write to again — the live ledger has fully and permanently moved to `BalanceSnapshot`. Those rows don't get fixed by anyone finishing D17; they need `apps/dashboard` itself ported to read the new model. Full detail in the updated D17, D22, and D23 write-ups in §5. Also noted: a new, currently-empty `apps/settlement` app scaffold was added — no routes, no effect on this inventory yet.
>
> **Update (2026-10-19): re-checked after pulling 16 more `dev` commits.** This pass found the backend had already written its own entry for the one thing that actually changed — **D24**, added directly by the backend (commit `3b47db3`), covering the move from a `settlementInterval` integer to a `MerchantSettlementPolicy` model. It's thorough and written for this doc's audience already; nothing to redo there. What this pass added: confirmed D24's "frontend, now — the only thing that is actually broken" items are both still true against current frontend source — `src/api/merchant.api.ts` still sends `settlementInterval` on merchant creation (now silently discarded), and `src/pages/merchant/index.tsx` still renders it back from `GET merchant/:id/interval`/`:id/config`, which return the meaningless DB default for any merchant created from 2026-10-16 on. Cross-referenced this onto rows 5, 20, and 21 in §2.1/§2.2, which D24 itself didn't touch. Also confirmed via `git log` that zero commits touched `apps/dashboard` since D24 was written — its content is still accurate today, not stale. Separately, the new `apps/settlement` app gained real functionality this round (schema, run/batch claiming, attribution fixes) — still no routes this dashboard or frontend calls, so no inventory changes from that, but it's the subsystem D24 depends on and worth knowing it's no longer just a scaffold.
>
> **Second pass the same day, 2026-10-19: read `docs/batch/*` as reference material, at the user's request.** No code changed between the two passes; this one is purely about using the backend's own internal design docs (`balance-explained.md`, `settlement-explained.md`, `settlement-batching.md`, `settlement-batching-implementation.md`) to sharpen what's already tracked, rather than finding anything new in the repo. Two things worth the update: the implementation doc spells out D22's eventual fix in enough detail to record here — `balance.service.ts`'s `findFirst` becomes a `findUnique` on `BalanceSnapshot`, two new screens (admin profit view, manual adjustment) are planned for the same step, and a `BigInt`/`JSON.stringify` gotcha is called out for whoever builds it — and it states outright that this same change resolves D15 by construction, with no business decision left to make. Both entries updated in §5; no inventory or endpoint changes, since none of this is built yet.
>
> **Update (2026-10-21): D23 fixed, at the user's explicit request this time — not just found and tracked.** `WithdrawTransactionDto` and `DisbursementTransactionDto` (`apps/dashboard/src/modules/{withdraw,disbursement}/dto/`) now declare `accountHolderName`/`accountNumber`/`bankCode`, matching `schema.prisma`. No service-layer change was needed — both services spread the raw Prisma row into the DTO with no `select`, so renaming the DTO's fields to match the row was the entire fix. `recipientBankName` is dropped from the disbursement response rather than derived (the column itself is gone, not renamed, and nothing in `apps/dashboard` does a `bankCode`→name lookup today — building one is new scope, not this fix). `WithdrawTransactionDto` also gained the same three fields even though D23 never broke it, since the schema has had them nullable all along and nothing was exposing them — this doesn't close D21 (naming still doesn't match what the frontend sends/expects, and there's still no BANK-vs-USDT discriminator field), but the raw data D21 needs is visible in the API now. D23 moved to Settled in §5; rows 34/36 updated in §2.3. Verified with `npx tsc -p apps/dashboard/tsconfig.app.json --noEmit` — clean.
>
> **Update (2026-10-21), second change the same day: row 18's `common/div?div=BANK` fixed too, no open Decision for this one.** Not something previously tracked anywhere in this doc — found only because the user asked for a correlation check after making the change. `config.Bank` (seeded by `apps/config/prisma/seed/bank-engine.seed.ts`, mandatory production data) has always included four e-wallets (`DANA`/`GOPAY`/`OVO`/`SHOPEEPAY`) alongside the 91 real banks, with no column distinguishing them — so `?div=BANK` returned all 95 rows, e-wallets included, mislabeled as banks. `config-common.service.ts` now excludes them (`code: { notIn: EWalletEnum values }`) and a new `?div=EWALLET` returns just those four, using `libs/microservice`'s existing `EWalletEnum` as the comparator (its values are identical strings to the e-wallet rows' `Bank.code`, confirmed by reading the seed file — no translation layer needed).
>
> **Five frontend call sites get the correctness fix automatically, with no frontend change required**: `src/pages/acc-management/manage-agent/index.tsx`, `manage-merchant/index.tsx`, `src/pages/agent/index.tsx`, `src/pages/merchant/index.tsx` (all four: a bank-account-details field), and — the one worth calling out — `src/pages/transaction/withdrawal/index.tsx`'s bank-transfer withdrawal form, whose "select your bank" dropdown could previously show "DANA" or "GOPAY" as if they were banks. None of the five need updating; they already call `?div=BANK` and just receive cleaner data now. `?div=EWALLET` itself has no consumer yet — added for a stated future need, not wired to anything today.
>
> **No correlation to any existing Decision** — this wasn't D21's scope (D21 is about withdrawal field *naming*, not dropdown *contents*) and wasn't previously flagged anywhere in this doc. Worth a one-line cross-reference from D21 anyway, since both touch the withdrawal page's bank-selection UI, even though they're otherwise unrelated. Not tracked as its own Decision — nothing is pending from anyone, the fix is already live, and there's no open question for the user to weigh in on.

### 2.1 From auth-service → `modules/`

Two more columns since the last pass: **Issue & Responsible** (populated only where Status isn't a clean ✅ — states what's wrong and whether Frontend, Backend, or Both own the fix) and **Request Body / Requirement** (populated only for not-yet-built or mis-shaped endpoints — the request shape and behavior the backend needs to implement).

| # | Method | Path | Legacy module | Frontend caller | Role | Status | Issue & Responsible | Request Body / Requirement |
|---|---|---|---|---|---|---|---|---|
| 1 | POST | `login` | `auth` | `postLogin` | Public | ✅ Matches | — | — |
| 2 | GET | `permissions` | `permissions` | `getPermissionByAuthInfo`, `fetchPermissionAll` | Any authenticated (see D8) | ✅ Matches | — | — |
| 3 | GET | `permissions/:id` | `permissions` | `fetchPermissionById` | Any authenticated | ✅ Matches | — | — |
| 4 | GET | `user/profile` | `users` | `getUserProfile` | Any authenticated (own profile) | ✅ Matches | — | — |
| 5 | POST | `user/admin/register-merchant` | `users` | `createMerchant` | `AGENT` (backend `@Roles`, frontend route `/acc-management/create-merchant`) | ✅ Matches, but **`settlementInterval` silently dropped since 2026-10-16** | **Frontend.** `CreateMerchantDto.settlementInterval` no longer exists server-side; `whitelist: true` strips the field rather than rejecting it, so the create form still gets a 201 while the value it sent has no effect. See D24 | — |
| 6 | POST | `user/admin/register-agent` | `users` | `createAgent` | Backend `@Roles`: `SUPER_ADMIN`, `ADMIN` (`AGENT_ADMIN_ROLES`). Frontend route `/acc-management/create-agent` grants only `SUPER_ADMIN` | ✅ Matches (route is reachable now — see the resolved role-rename note above) | **Frontend, minor residual gap.** The lockout that made this route unreachable is fixed. One narrower gap remains: `roles: ["SUPER_ADMIN"]` on this route doesn't include plain `ADMIN`, which backend's `AGENT_ADMIN_ROLES` does permit — low priority, since no `ADMIN`-role account exists in the test data yet (§7 only exercises `SUPER_ADMIN`/`AGENT`/`MERCHANT`) | — (body is `CreateAgentDto`, already correct — no backend change needed) |
| 7 | GET | `agent-detail` | `agent-detail` | `getAgentList` | `SUPER_ADMIN` | ✅ Matches | — | — |
| 8 | GET | `agent-detail/dropdown` | `agent-detail` | `getDropdownAgent` | `SUPER_ADMIN` | ✅ Matches | — | — |
| 9 | GET | `agent-detail/:userId` | `agent-detail` | `getAgentById` | `SUPER_ADMIN` | ✅ Matches | — | — |
| 10 | PATCH | `agent-detail/update/:userId` | `agent-detail` | `patchAgent` | `SUPER_ADMIN` | ✅ Matches | — | — |
| 11 | GET | `merchant-detail` (page/size/businessName) | `merchant-detail` | `getMerchantList` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |
| 12 | GET | `merchant-detail/dropdown` | `merchant-detail` | `getDropdownMerchant` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |
| 13 | GET | `merchant-detail/:userId` | `merchant-detail` | `getMerchantById` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |
| 14 | PATCH | `merchant-detail/update/:userId` | `merchant-detail` | `patchMerchant` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |
| 15 | GET | `merchant-signature/generate-secret-key` | `merchant-signature` | `generateSecretKey` | `MERCHANT` (own record only — see note below) | ✅ Matches (fixed 2026-08-26 — see note below) | — | — |
| 16 | POST | `merchant-signature/register-webhook-url` | `merchant-signature` | `registerWebhookUrl` | `MERCHANT` (own record only) | ✅ Matches (fixed 2026-08-26) | — | — |
| 39 | GET | `merchant-signature/status` | *(none)* | `getMerchantSignatureStatus` | `MERCHANT` (own record only) | ✅ Matches (implemented 2026-08-26 — see note below) | — | — |
| 53 | PUT | `merchant-signature/allowed-ips` | *(none)* | `updateAllowedIps` | `MERCHANT` (own record only) | ✅ Matches (frontend caller added 2026-08-28 — see note below) | — | — |

> **Rows 15, 16, 39 — merchant-signature, fixed 2026-08-26.** As of the 2026-08-25 pass, the frontend called `generate-secret-key` and `register-webhook-url` with a `:merchantUserId` path segment the ported (id-less) backend controller didn't accept, and `getMerchantSignatureStatus` didn't exist on the backend under any path. **The frontend fixed its side** (commit `b9475b4`, "refactor: remove merchantUserId"): `merchant-signature.api.ts` now calls all three with no path param at all — `generate-secret-key`, `register-webhook-url`, and `status` (was `:merchantUserId/status`) — matching the backend's "acts on the caller's own record via the bearer token" design exactly, not just patched to the same URL shape.
>
> The reason this is *correct* rather than a workaround: the calling component, `MerchantApiIntegration` (`src/pages/merchant/components/merchant-detail-api-integrate.tsx`), no longer takes a `merchantUserId` prop either, and its own doc comment now states it's "only ever rendered for a MERCHANT-role session viewing their own detail page." Confirmed against the caller — `merchant-detail/index.tsx` renders the "Api Integrasi" tab containing this component only inside `...(isMerchant ? [...] : [])`, where `isMerchant = hasAccessByRoles([AccessControlRoles.merchant])` checks the *signed-in user's own* role, not the role of the merchant record being viewed. So the `SUPER_ADMIN`/`AGENT`-views-another-merchant's-signature scenario this doc previously worried about doesn't exist in the UI — that tab simply isn't shown to those roles — which is why the Role column above is `MERCHANT` only, not the three-role set every other merchant-detail-page row carries.
>
> Rows 15 and 16 are clean ✅ matches. Row 39's `GET status` route landed 2026-08-26 (`MerchantSignatureController.status()`, backed by `MerchantSignatureService.status()`) — a genuine implementation, not a stub: it's a plain read of the caller's own `MerchantSignature` row (`secretKeyRotatedAt` mapped onto the wire field `secretKeyGeneratedAt`, plus `payinUrl`/`payoutUrl`), no money or write path involved, so there was nothing left to "review later" about it.

> ### 🆕 Row 53 — `PUT merchant-signature/allowed-ips`, added 2026-08-28
>
> **This is the first endpoint here that the frontend does not yet call.** Everything else in this inventory was reverse-engineered from existing frontend calls; this one went backend-first, so the UI has to be built for it. Flagged prominently for that reason.
>
> **What it does.** Opt-in IP allowlisting for the merchant Public API (`api.manapay.id`, *not* the dashboard). A merchant lists the addresses their server calls from, and a request carrying a valid signature from anywhere else is rejected — so a leaked secret key stops being sufficient on its own.
>
> **`GET merchant-signature/status` (row 39) gained a field** to back the same screen without a second call:
>
> ```ts
> {
>   secretKeyGeneratedAt: string | null,
>   payinUrl: string | null,
>   payoutUrl: string | null,
>   allowedIps: string[],          // ← new, [] means unrestricted
> }
> ```
>
> **Request shape** — a full replace, not add/remove:
>
> ```ts
> PUT /merchant-signature/allowed-ips
> { "allowedIps": ["203.0.113.5", "198.51.100.0/24"] }   // max 20 entries
> ```
>
> Bare IPv4/IPv6 addresses or CIDR ranges. A malformed entry is a 422 naming the offending value. **An empty array removes the restriction entirely** and must stay offerable in the UI — it is the only way back for a merchant who has locked themselves out.
>
> Note the verb is **`PUT`**, unlike `register-webhook-url`'s `POST`. It replaces a collection wholesale, so `PUT` is the accurate verb; the older `POST` is a legacy carry-over, not a convention worth propagating. Returns the standard envelope with `ResponseStatus.UPDATED`.
>
> **Three things the UI should get right**, none of which the backend can enforce:
>
> 1. **This is the merchant's *server* egress IP, not their browser's.** The person configuring it is usually a developer on a laptop, while the API calls come from a production host. A field pre-filled with "your current IP" would be wrong far more often than right — which is also why the backend deliberately does *not* warn when the saved list excludes the caller's address. Static guidance beats a spurious warning here.
> 2. **Make the lockout consequence explicit.** Saving a wrong list does not break the dashboard — it is never IP-restricted — but it does break their live payment integration until corrected. Worth a confirmation step.
> 3. **Position it as optional.** Most merchants (toko kelontong, warung) are on dynamic consumer connections where pinning an address guarantees an outage. This is for merchants with stable hosting; the default of "unrestricted" is correct for everyone else, and the UI should not imply they are less secure for leaving it empty.
>
> **What a rejected request looks like** to the merchant, on the Public API (not this dashboard): `401` with `responseCode` `4010109`, message *"Request origin is not in this merchant IP allowlist"* — see [merchant-api-response-codes.md](merchant-api-response-codes.md).
>
> **Update (2026-08-28): frontend caller added, all three UI points addressed.** Commit `9d749a8` ("feat: add IP whitelist management to merchant API integration page") adds a card to `merchant-detail-api-integrate.tsx` alongside the existing webhook-configuration card: a text field + "Add" button builds up a list of tags (each removable via its `×`), and a "Confirm IP Whitelist" / "Update IP Whitelist" button (label switches on whether the caller already has a saved list) does the `PUT`, disabled whenever the draft matches what's already saved. Verified against every point this callout raised:
>
> - **Own-server-IP note** — the card's description and the new "IP Whitelist" section under the page's API docs both say outright this is the server's outbound IP, not the browser's, with no dynamic "your IP is X" prefill.
> - **Confirmation step** — saving opens a `Modal.confirm` spelling out that a wrong list breaks the live API integration, not the dashboard, before the request fires.
> - **Positioned as optional** — card title is "IP Whitelist (Optional)"; the docs say most merchants should leave it empty and don't imply reduced security for doing so.
> - **Empty stays offerable** — confirmed by driving it end-to-end (Playwright against the dev server): adding 2 entries → save → remove both → the button re-enables on the empty draft, the confirm dialog swaps to a "this removes all IP restrictions" message instead of the generic replace message, and the save round-trips to an empty `allowedIps` on refetch. This is the one hard requirement this callout called a "must," so it got the most scrutiny.
> - **Max 20 entries, full replace** — the frontend mirrors the backend's `MAX_ALLOWED_IPS = 20` bound client-side (blocks further "Add" clicks past it with a message) and always sends the entire draft array on save, never a partial add/remove.
>
> **One gap found doing this check, not specific to row 53 — fixed the same day.** A malformed entry's 422 (`ApiError.validationFailed`) puts the per-field message that actually names the offending value under `error.fields["allowedIps.N"]`, but the frontend's global `handleErrorResponse()` (`src/utils/ky/error-response.ts`) only ever read the top-level `message`/`errorMsg` — which for this error type was just the generic `"Request validation failed"`. **Fixed** (commit `b7578bf`, "fix: error handling show message fix"): `handleErrorResponse()` now checks `error.fields` first and, when present, joins every entry into one readable line (e.g. `"allowedIps.1: 203.0.113.zz is not a valid IP address or CIDR range"`) before falling back to the old prose message — and `ResponseErrorDto`/`ResponseDto.error` in `global.type.ts` were typed accordingly so `fields` is no longer read off an untyped blob. Confirmed by re-reading both files: this isn't scoped to row 53 either — the fix lives in the shared handler, so every class-validator 422 across the dashboard benefits, not just the IP allowlist.

### 2.2 From config-service

| # | Method | Path | Legacy module | Frontend caller | Role | Status | Issue & Responsible | Request Body / Requirement |
|---|---|---|---|---|---|---|---|---|
| 17 | GET | `agent/:agentId/merchants` | `agent` | `getAgentMerchants` | `SUPER_ADMIN` (agent detail page) | ✅ Matches | — | — |
| 18 | GET | `common/div?div=` | `common` | `getCommonByDiv` | Any authenticated — dropdown data (bank/provider/payment-method) reused across the create-agent, create-merchant, config-fee, provider and withdrawal pages | ✅ Matches, and **`?div=BANK` fixed 2026-10-21** — see the note below | — | — |
| 19 | GET | `fee/config` | `fee` | `getBaseFee` | `SUPER_ADMIN`, `MERCHANT` (provider page + config-fee) | ✅ Matches | — | — |
| 20 | GET | `merchant/:merchantId/interval` | `merchant` | `getMerchantInterval` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` (merchant detail / create-merchant) | ✅ Matches, but **`settlementInterval` is now a meaningless number for merchants created after 2026-10-16** | **Backend decision, then frontend.** Returns the DB default (120) rather than anything real — settlement timing moved to `MerchantSettlementPolicy`. The merchant-edit page's "Settlement Interval" dropdown (`src/pages/merchant/index.tsx:677`) was already a pre-existing no-op before this (legacy's update never wrote this column either) — not a new regression, but now also displaying a number that was never set to begin with. See D24 | — |
| 21 | GET | `merchant/:merchantId/config` | `merchant` | `getMerchantConfig` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` (merchant detail + config-fee) | ✅ Matches, but **same `settlementInterval`/`lastSettlementAt` staleness as row 20** | **Backend decision, then frontend.** `MerchantConfigDto` still serves both dead fields. See D24 | — |
| 22 | POST | `merchant/:merchantId/provider` | `merchant` | `upsertMerchantFee` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |
| 23 | POST | `merchant/:merchantId/agent-shareholder` | `merchant` | `upsertMerchantAgentShareholder` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |

### 2.3 From transaction-service

| # | Method | Path | Legacy module | Frontend caller | Role | Status | Issue & Responsible | Request Body / Requirement |
|---|---|---|---|---|---|---|---|---|
| 24 | GET | `balance/aggregate/internal` | `balance` | `getBalanceInternal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` (home dashboard) | ⚠️ **Updated 2026-10-26** — now sums `BalanceSnapshot` and returns `balanceReserved`; `providerName` query is still unsupported | **Frontend.** Provider filter removed (D18 complete); reserved-balance support remains. See D22 | — |
| 25 | GET | `balance/aggregate/merchant` | `balance` | `getBalanceMerchant` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ **Updated 2026-10-26** — sums merchant `BalanceSnapshot` rows by bucket, including `balanceReserved` | **Frontend.** Add the reserved-balance field to the API type and views. See D22 | — |
| 26 | GET | `balance/aggregate/agent` | `balance` | `getBalanceAgent` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ **Updated 2026-10-26** — sums agent `BalanceSnapshot` rows by bucket, including `balanceReserved` | **Frontend.** Add the reserved-balance field to the API type and views. See D22 | — |
| 27 | GET | `balance/merchant/:merchantId` | `balance` | `getBalanceMerchantById` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` (merchant detail balance widget) | ✅ **Updated 2026-10-26** — reads merchant `BalanceSnapshot` buckets and returns `balanceReserved` | **Frontend.** Add the reserved-balance field to the API type and views. See D22 | — |
| 28 | GET | `balance/agent/:agentId` | `balance` | `getBalanceAgentById` | `SUPER_ADMIN` (agent detail balance widget) | 🔴 **Updated 2026-10-26** — reads snapshots but filters `holderType: MERCHANT` instead of `AGENT` | **Backend.** Fix the holder type before relying on this response. Frontend should add `balanceReserved` to the type and detail view. See D22 | — |
| 29 | GET | `transactions/purchase` | `purchase` | `getTransactionPurchase` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ⚠️ **Updated 2026-10-27** — exposes Prisma reference fields; `reconciliationAt` removed 2026-10-26 | **Frontend.** Read the canonical reference fields and remove legacy aliases; see D19 | — |
| 30 | GET | `transactions/topup` | `topup` | `getTransactionTopUp` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ⚠️ **Updated 2026-10-27** — only `systemReference` exists; `metadata` and `reconciliationAt` are absent | **Frontend.** Metadata column removed (D18 complete); read `systemReference`; see D19 | — |
| 31 | POST | `transactions/topup` | `topup` | `createTransactionTopUp` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🚧 Not ported (fee-calc dependency) | **Backend.** Blocked on porting config's fee-calculation services (currently ~95%-duplicated across four legacy services) — see §7 | POST `transactions/topup`. Frontend sends `CreateTopUp = { userId: number, receiptImage: string, nominal: number }`. Requirement: split `nominal` into merchant/agent/provider/internal cuts via the fee calculator, write the pending top-up row |
| 32 | POST | `transactions/topup/approve` | `topup` | `approveTransactionTopUp` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🚧 Not ported (implementation pending, D17 fixed 2026-10-12) | **Backend.** D17's balance-ledger defects are fixed and proven live in disbursement/purchase (see D22) — no decision left to make here, just the implementation: call `@app/balance`'s `post()` for the credit legs, following `disbursement-common.service.ts`'s pattern | POST `transactions/topup/approve`. Frontend sends `StatusTopUp = { topupId: number }`. Requirement: mark approved, post the credit legs via `BalanceService.post()` (`BalanceReasonEnum.TOPUP_APPROVED`, `BalanceSourceTypeEnum.TOPUP`) inside the same transaction as the status update |
| 33 | POST | `transactions/topup/reject` | `topup` | `rejectTransactionTopUp` — see D1, fixed 2026-08-26 | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🚧 Not ported (backend only, now — see note below) | **Backend.** Implementation-only now, same as row 32 — D17 is fixed, nothing left pending a decision. The frontend's D1 bug (posting to `/approve` instead of `/reject`) is fixed — commit `2df39fa`, confirmed by re-reading `transaction-top-up.api.ts`, which now posts to `transactions/topup/reject` correctly. Once the backend ships `/reject`, this call will work with no further frontend change needed | POST `transactions/topup/reject`. Frontend sends `StatusTopUp = { topupId: number }`. Requirement: flip status to rejected only — no ledger write, unlike approve |
| 34 | GET | `transactions/withdraw` | `withdraw` | `getTransactionWithdrawal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ⚠️ **Updated 2026-10-27** — raw destination fields and canonical Prisma reference fields are present; `reconciliationAt` is removed | **Frontend.** Align the display/read model and the USDT API-approval guard to the returned fields. See D19 and D21 | — |
| 35 | POST | `transactions/withdraw` | `withdraw` | `createTransactionWithdrawal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🚧 Not ported (fee-calc dependency; D17's balance-ledger half fixed 2026-10-12); **request shape changed 2026-09-11, see D21** | **Backend.** Fee-calculation porting is still the real blocker; the balance-ledger half (D17) now has a proven, live reference implementation in disbursement's `reserve()` flow to copy. The shape below is stale — see D21 | POST `transactions/withdraw`. Frontend now sends `CreateWithdrawal = { userId: number, nominal: number, withdrawMethod: "BANK" \| "USDT", bankName?: string, accountNumber?: string }` — `bankName`/`accountNumber` required for `BANK`, both omitted for `USDT` (was `{ userId, nominal }` as of the 2026-08-25 pass; see D21). Requirement: insufficient-balance check via `BalanceService.reserve()` (lock-and-check in one statement, per D17/D22's now-shipped pattern), then write the pending withdrawal row with whatever columns D21 settles on |
| 36 | GET | `transactions/disbursement` | `disbursement` | `getTransactionDisbursement` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ⚠️ **Updated 2026-10-27** — D23 destination fields and canonical Prisma reference fields are present; `reconciliationAt` is removed | **Frontend.** Remove the now-empty reconciliation column/export field and read canonical reference fields; see D19 | — |
| 40 | POST | `transactions/withdraw/approve` | *(none)* | `approveTransactionWithdrawal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26**; **request body grew a field 2026-09-11, see note below and D21** | **Backend.** Route/DTO/response shape are real; the handler is still a no-op, but D17 no longer blocks it — `disbursement-common.service.ts`'s reserve/complete/fail methods are a working reference to copy. The DTO (`StatusWithdrawalDto`) doesn't yet declare the new `approvalMethod` field — harmless today (`whitelist: true` without `forbidNonWhitelisted` drops unknown properties rather than rejecting the request), but the field needs adding before real logic lands, since `API` vs `MANUAL` changes what that logic has to do | POST `transactions/withdraw/approve`. Frontend now sends `StatusWithdrawal = { withdrawalId: string, approvalMethod?: "API" \| "MANUAL" }` (was `{ withdrawalId }` alone as of 2026-08-25; see D21) — `withdrawalId` is still typed `string` here vs. `topupId: number` on the topup side (row 32), worth reconciling. Requirement: for `API`, reserve-then-complete via `BalanceService` exactly like disbursement now does (fixed 2026-10-12, including sourcing the merchant id from the row in hand rather than an echoed value); for `MANUAL`, just record that the admin transferred the funds themselves and mark it done |
| 41 | POST | `transactions/withdraw/reject` | *(none)* | `rejectTransactionWithdrawal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** — request body unchanged by the 2026-09-11 withdraw-flow update, only approve (row 40) gained a field | **Backend.** Same as row 40 | POST `transactions/withdraw/reject`. Body: `StatusWithdrawal = { withdrawalId: string }`. Requirement: flip status only, no ledger write — same shape as topup reject (row 33) |
| 42 | POST | `transactions/purchase/resend-callback` | *(none)* | `resendPurchaseCallback` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Route/DTO/response shape are real; the handler is a no-op pending the provider-integration work | POST `transactions/purchase/resend-callback`. Body: `PurchaseCallbackAction = { purchaseId: string }`. Requirement: re-fire the provider webhook callback for that purchase — needs the provider-integration layer this dashboard doesn't otherwise touch |
| 43 | POST | `transactions/purchase/refresh-status` | *(none)* | `refreshPurchaseStatus` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 42 | POST `transactions/purchase/refresh-status`. Body: `{ purchaseId: string }`. Requirement: re-poll the provider for this purchase's current status and update the row |
| 44 | POST | `transactions/purchase/notify-merchant` | *(none)* | `notifyPurchaseMerchant` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 42 | POST `transactions/purchase/notify-merchant`. Body: `{ purchaseId: string }`. Requirement: re-send this purchase's webhook to the merchant's registered `payinUrl` (see rows 16/39 for where that URL comes from) |
| 45 | POST | `transactions/disbursement/resend-callback` | *(none)* | `resendDisbursementCallback` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 42, disbursement side | POST `transactions/disbursement/resend-callback`. Body: `DisbursementCallbackAction = { disbursementId: string }`. Requirement: re-fire the provider webhook callback for that disbursement |
| 46 | POST | `transactions/disbursement/refresh-status` | *(none)* | `refreshDisbursementStatus` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 45 | POST `transactions/disbursement/refresh-status`. Body: `{ disbursementId: string }`. Requirement: re-poll the provider for this disbursement's current status |
| 47 | POST | `transactions/disbursement/notify-merchant` | *(none)* | `notifyDisbursementMerchant` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 45 | POST `transactions/disbursement/notify-merchant`. Body: `{ disbursementId: string }`. Requirement: re-send this disbursement's webhook to the merchant's registered `payoutUrl` |

> **Rows 40–47, stubbed 2026-08-26.** All eight now have a real controller method, request DTO (with class-validator rules matching the frontend's existing types exactly), and response envelope in `apps/dashboard` — `WithdrawController`/`WithdrawService`, `PurchaseController`/`PurchaseService`, `DisbursementController`/`DisbursementService`. Each service method is a deliberate no-op (`void dto; return Promise.resolve();`, commented `TODO(backend)`): the controller returns `ResponseDto` with `UPDATED` (40/41, a real status transition once implemented) or `SUCCESS` (42–47, a triggered action) so the frontend can wire up its success/error handling against a real shape, but nothing is written to the database and no provider is called yet. Rows 40/41 (withdraw approve/reject) are confirmed wired to real, distinct buttons in `src/pages/transaction/withdrawal/index.tsx` (`useApproveWithdrawal`/`useRejectWithdrawal`) — clicking them now gets a success response instead of a 404, but the withdrawal's status won't actually change until that stub is replaced with real logic following the now-proven `@app/balance` pattern (D17 is fixed as of 2026-10-12; what's left here is implementation, not a blocked decision — see D22). Same caveat for the purchase/disbursement resend-callback / refresh-status / notify-merchant trio and their pages. Verified: `npm run build:dashboard` succeeds and `eslint` is clean on all five touched modules; every other endpoint in this doc is untouched.
>
> **Rows 34, 35, 40 — withdraw also grew a bank/USDT split and a manual-approval mode on the frontend, 2026-09-11 — see D21.** None of it is live yet: row 34 keeps returning exactly what it always has (the new fields are simply absent — same silent-omission shape as D19, not a new failure mode), row 35 was never implemented so there's nothing to break, and row 40's stub ignores its body regardless of which fields are in it. Full detail, including the one open schema question, is in D21 (§5) rather than repeated here.

### 2.4 From settlerecon-service

Settlerecon's *provider integrations* (Inacash/PDN/Pakaidonk/Payhere/Zipay) stay out of scope. But settlement reads the **same `transaction` Postgres schema** dashboard already maps (verified: settlerecon's legacy `schema.prisma` declares `schemas = ["transaction"]`), so it is portable without touching provider code.

| # | Method | Path | Legacy module | Frontend caller | Role | Status | Issue & Responsible | Request Body / Requirement |
|---|---|---|---|---|---|---|---|---|
| 37 | GET | `settlement/settled` | `settlement` | `getSettleData` | `SUPER_ADMIN` (settlement page) | ⚠️ **Updated 2026-10-27** — uses purchase DTO with canonical Prisma reference fields; `reconciliationAt` removed | **Frontend.** Read canonical fields and remove stale `reconciliationAt` column/export field; see D19 | — |
| 38 | GET | `settlement/unsettled` | `settlement` | `getUnsettleData` | `SUPER_ADMIN` | ⚠️ **Updated 2026-10-27** — uses purchase DTO with canonical Prisma reference fields; `reconciliationAt` removed | **Frontend.** Read canonical fields and remove stale `reconciliationAt` column/export field; the paired `POST settlement/settle` is still a no-op stub | — |
| 48 | POST | `settlement/settle` | *(none)* | `settleUnsettledData` | `SUPER_ADMIN` | 🟡 **Stubbed 2026-08-26** — wired to a live "settle" action in `src/pages/transaction/settlement/components/unsettled-table.tsx`, now gets a success response instead of a 404 | **Backend.** Route/DTO/response shape are real (`SettlementController.settle()` / `SettlementService.settle()`); the handler is a no-op — no row is actually stamped `settlementAt` yet | POST `settlement/settle`. Frontend sends `SettleUnsettledBody = { ids: string[] }` — a batch of purchase/settlement ids. Requirement: mark each as settled (stamp `settlementAt`), moving it out of the `unsettled` listing and into `settled` |

### 2.5 Not migrated

- **Reconciliation** (`GET reconciliation`, `GET reconciliation/calculate`, `POST reconciliation/file-upload/csv`) — **out of dashboard scope**. The business requirement is still under discussion, and the intent is a separate dedicated app (NestJS or Go, chosen for concurrency and a small memory footprint) that will also own scheduled / background file generation. Revisited only after everything else lands. See D5.

  > **Correction:** the frontend's actual calls (`reconciliation.api.ts`) are `GET reconciliation/recon`, `GET reconciliation/unrecon`, `GET reconciliation/calculate`, and `POST reconciliation/file-upload/csv` — four calls, not three, and the first one is `reconciliation/recon`, not bare `reconciliation`. `reconciliation/unrecon` was missing from this list entirely. Doesn't change the D5 scope decision — still deferred to the dedicated reconciliation app — but the path here was wrong and incomplete. Separately: the standalone `apps/settlerecon` microservice referenced elsewhere in this doc (§2.4's intro) no longer exists in this repo on `dev` (removed per the "Remove SettleRecon Apps" commit) — doesn't affect the dashboard's own `settlement` module, which is self-contained, but the settlerecon `schema.prisma` this doc cites for verification is no longer available to re-check.

- **Region lookup** (`getProvinces`/`getRegencies`/`getDistricts`/`getVillages`) — the frontend calls `emsifa.com/api-wilayah-indonesia` **directly** from the browser, no backend involvement. Nothing to port.
- **CSV export endpoints** — legacy has `GET transactions/{purchase,topup,withdraw,disbursement}/csv`. The frontend doesn't call them yet. Not migrating now; noted here because they're an obvious near-future ask.
- **`:id/detail` endpoints** — legacy has per-transaction detail routes the frontend doesn't call. Same treatment.

### 2.6 Revised totals (2026-08-25 verification pass, `dev` branch; row 53 added 2026-08-28, frontend caller added same day)

The frontend calls **53 endpoints**, not 41: 49 in the dashboard's scope (38 originally tracked + 10 found by the 2026-08-25 pass, rows 39–48, + row 53 once the frontend added its caller) plus the 4 out-of-scope reconciliation calls (§2.5, corrected from 3).

**Row 53 no longer inverts the direction of this inventory.** It used to be the one row that started from the backend rather than a frontend call, with no caller to check against; now that the frontend caller exists (`updateAllowedIps`, commit `9d749a8`), it folds into the same "ported and working" bucket as every other ✅ row below.

| | Count |
|---|---|
| In scope, ported and working as the frontend calls it (rows 15, 16, 39 landed/moved here 2026-08-26; row 53 added 2026-08-28; row 6's only issue was ever a frontend role-scope gap, never a backend defect) | 36 |
| In scope, ported but with a real path-level defect | 0 *(was 2 — rows 15, 16 — as of 2026-08-25; fixed on the frontend 2026-08-26, see §2.1 note)* |
| In scope, not yet ported — fee-calculation dependency; D17's balance-ledger half fixed 2026-10-12 (rows 31, 32, 33, 35) | 4 |
| In scope, stubbed 2026-08-26 — route/DTO real, handler is a deliberate no-op (rows 40–48) | 9 |
| **Total in scope** | **49** |
| Backend-first, awaiting a frontend caller | 0 *(was 1 — row 53, IP allowlist — from 2026-08-28 until the frontend added `updateAllowedIps` the same day)* |
| Out of scope — reconciliation (deferred per D5) | 4 |
| Out of scope — region lookup (frontend calls a third party directly) | 4 |

The role-name drift, the config base-URL disagreement, the merchant-signature path mismatch (rows 15/16/39), and the D1 frontend bug on row 33 were all flagged as live problems on 2026-08-25 and confirmed fixed on the frontend as of 2026-08-26. Separately, on 2026-08-26 rows 39–48 (the 10 previously-🆕 endpoints) got real controllers/DTOs added to `apps/dashboard` — row 39 for real, rows 40–48 as stubs pending real logic (see the callouts at the top of §2 and on the affected rows). What's left un-implemented is now purely rows 31/32/33/35, gated on the D17 decision — everything else the frontend calls has *a* route to hit, even where the business logic behind it still needs writing.

Section 7's progress checklist below still says "35 of 38 ported" — that line predates this pass and reflects the original 38-endpoint count, not the 48 found here. Left as-is since only §2 was in scope for this audit; whoever picks up rows 39–48 should update §7 alongside them.

**For the frontend team, 2026-08-28:** the only change requiring work on your side is **row 53** plus the new `allowedIps` field on row 39's response. Nothing existing broke — `status` gained a field, which is additive. See the row 53 callout in §2.1 for the request/response shapes and the three UI points that matter.

**For the frontend team, updated 2026-10-27 — read D19 first.** Row **24** no longer accepts `?providerName=` (D18). Rows **29, 30, 34, 36, 37, 38** now return the applicable canonical Prisma reference fields listed in D19; the old `externalId`/`referenceId` aliases are gone. The 2026-10-26 cleanup also removed `reconciliationAt` from the dashboard transaction DTOs; remove matching blank columns/CSV fields on the frontend. D18 covers row 24.

**Update (2026-08-28, later same day): row 53 done.** Commit `9d749a8` adds the IP whitelist card and its caller — see the "Update" note appended to the row 53 callout in §2.1 for what was verified and the one gap it turned up (generic validation-error messages hid which entry was malformed, dashboard-wide, not just here — fixed the same day, commit `b7578bf`, see the same callout). Nothing in this doc's scope remains without at least a route to hit; what's left open is D17/D3 (§5) and the 🟡-stubbed handlers (rows 40–48), none of which are new to this pass.

**Update (2026-09-13): re-audited backend, frontend, and this doc against each other end to end.** Every route in `apps/dashboard` was re-listed from the controllers directly (`grep` across every `*.controller.ts`) and matches this inventory exactly — no backend route exists that isn't already a row here, and nothing already-ported regressed. One new gap found, **D21** (§5): the frontend's `39fd47b` ("feat: change withdraw flow, add bank transfer and usdt withdraw. new withdraw approval for admin") added a `withdrawMethod`/`bankName`/`accountNumber` split to the withdraw-create request and response (rows 34, 35) and an `approvalMethod` to the approve request (row 40), none of which the schema or the stub DTO has caught up to yet. Not urgent — rows 35/40 are still gated on D17 regardless — but tracked now rather than found again the next time someone reads this doc against the code. No other new frontend-called endpoint exists beyond the 53 already tracked; confirmed by re-listing `src/api/*.api.ts` and diffing against the previous pass's list.

---

## 3. Module plan

Ported in dependency order. Each is self-contained: `controller` → `service` → `dto/`.

```
apps/dashboard/src/
├── shared/                  # ResponseDto, pagination, exceptions, filters, DTO decorators, DateHelper
├── auth/                    # JWT + local strategies, guards, decorators, POST /login   (endpoint 1)
└── modules/
    ├── permission/          # 2-3
    ├── user/                # 4-6    profile, register-merchant, register-agent
    ├── agent-detail/        # 7-10
    ├── merchant-detail/     # 11-14
    ├── merchant-signature/  # 15-16, 39
    ├── config-agent/        # 17
    ├── config-common/       # 18
    ├── config-fee/          # 19
    ├── config-merchant/     # 20-23
    ├── balance/             # 24-28
    ├── transaction-shared/  #        filter DTO, fee-detail DTO, date-range + fee-total helpers
    ├── purchase/            # 29, 42-44 (42-44 stubbed 2026-08-26)
    ├── topup/               # 30-33  (31/32/33 not yet implemented)
    ├── withdraw/            # 34-35, 40-41  (35 not yet implemented; 40-41 stubbed 2026-08-26)
    ├── disbursement/        # 36, 45-47 (45-47 stubbed 2026-08-26)
    └── settlement/          # 37-38, 48 (48 stubbed 2026-08-26)
```

`login` lives in `auth/` rather than `modules/` because that folder also holds the strategies and guards every other module depends on.

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

**Precision — settled (D4).** The rule across every schema:

| Kind | Prisma column | DTO decorators | Range |
|---|---|---|---|
| **Money** | `Decimal(15, 2) // Money` | `@IsMoney()` / `@ToMoneyString()` | up to 9,999,999,999,999.99 (~10 trillion IDR) |
| **Percentage** | `Decimal(8, 4) // Percentage` | `@IsPercentage()` / `@ToPercentageString()` | capped at 100 by the validator |

Every Decimal column carries a `// Money` or `// Percentage` marker, so the intended scale is greppable rather than inferred. Both decorators default to the right scale — `@IsPercentage()` is 4 decimals unless told otherwise. `@IsMoney()` also caps the integer part at 13 digits to match the column, so an over-wide amount returns a 422 naming the field rather than a Postgres numeric overflow the caller can't act on.

The widths were raised from an earlier `Decimal(10, 2)` / `Decimal(10, 4)`, which capped a single amount at 99,999,999.99 (~100 juta IDR) — a ceiling the accumulating balance-log columns would have reached first.

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

- `@ToJakartaISO()` — `toPlainOnly`; takes a JS `Date` from Prisma and emits ISO with `+07:00` via the app-local `DateHelper` (`shared/helper/date.helper.ts`). It formats explicitly rather than calling Luxon's `toISO()`, which appends milliseconds — and `suppressMilliseconds` only drops them when they happen to be zero, so the shape would vary row to row.
- `@ToJsDateNullable()` — request side; parses an incoming ISO string to a JS `Date` (what Prisma wants), throwing `ApiError.invalidDate()` on garbage. Validation lives inside the transform because class-transformer runs *before* class-validator in Nest's pipe, same as legacy.
- No milliseconds, matching DANA's example. Trivial to switch on later if a SNAP-facing surface ever needs `.SSS`.

Timezone comes from `DateHelper`, which reads `TIMEZONE` (default `Asia/Jakarta`) — already set in `apps/dashboard/.env.example`.

Listing filters use the same helper to widen a range to whole days in that timezone. Taking the raw UTC instant would make `from=2026-08-01` start at 07:00 Jakarta and silently drop that morning's transactions.

### 4.3 Response envelope

Unchanged from legacy — the frontend's `ResponseDto<T>` in `global.type.ts` already matches:

```ts
{ statusCode, status, message, data, pagination, meta, error }
```

`ResponseInterceptor` wraps bare returns; returning a `Page<T>` populates `pagination`. `ResponseStatus` keeps the legacy enum (`CREATED`/`UPDATED`/`SUCCESS`/`ERROR`/`PARTIAL_SUCCESS`).

> **Fixed on the frontend, commit `3f52bf4`** ("refactor: consolidate permission response types with real backend shape") — predates this doc's first audit pass, only just cross-referenced here. This note originally flagged the frontend's local `ResponseStatus` enum as missing `UPDATED`, which the backend emits on every PATCH. `src/api/global.type.ts` now declares `CREATED`/`UPDATED`/`SUCCESS`/`ERROR`/`PARTIAL_SUCCESS` — the full set, matching this backend exactly. Confirmed by reading the current file; no other envelope field drifted.

---

## 5. Decisions

Twenty-four entries (D1–D24), each a real defect or ambiguity found while reading the legacy code — or, from D24 on, a change the backend has made that reaches your side. Most are settled and need nothing from you; eight do, and a ninth (D15) is listed but no longer actually needs your input — see its row.

### Open — needs a decision or action

| # | What | Who acts | Why it matters |
|---|---|---|---|

| **D22** | Dashboard balance reads now use `BalanceSnapshot`, but `checkBalanceAgent()` filters the `MERCHANT` holder type; deferred balance write/admin features also remain unimplemented | **Backend** — fix the holder filter and finish the remaining balance endpoints; frontend — add the reserved-balance field | Agent balance detail can show the wrong holder rows; profit/adjustment workflows remain unavailable |
| **D3** | No authorization is enforced — `@Roles()` / `@CheckPolicies()` are placeholders | **You** (discussing internally) | Any authenticated user can call any endpoint. Must be settled before production |
| **D10** | ~~`prisma migrate` unusable repo-wide~~ — **fixed**; one item remains | **You** | Decide how to baseline: the dev DB has tables (from `db push`) but no migration history |

| **D8** | `GET permissions` serves two opposite needs from one URL | **You** + frontend dev | Every signed-in user gets the full admin menu client-side. UI-only, not a data breach |
| **D19** | Transaction v2 reference columns were not reflected in the dashboard DTOs | Frontend | **Backend fixed 2026-10-27.** DTOs now expose schema names; frontend table/types still need to read the canonical fields |
| **D18** | Transaction v2 dropped `InternalBalanceLog.providerName` and `TopUpTransaction.metadata`, both exposed through the dashboard API | Frontend dev | Backend is fixed and compiling. **Closed 2026-10-27** — frontend removed unsupported provider filter wiring and the top-up metadata UI column; transaction response types and UI are aligned in task 8b |
| **D21** | Frontend shipped a bank/USDT withdraw split and a manual-vs-API approval mode; the schema had no columns for any of it. **As of 2026-10-21, the raw destination fields are now exposed on both listings** — see the D21 and D23 updates below | **You** — naming still needs reconciling with the frontend | Not live yet (rows 34/35/40 aren't real endpoints today), but blocks doing rows 35/40 for real, and one silent symptom already exists on row 34 |

> **D17, D23, D24, and D15 are settled.** D22 is partially delivered; the remaining balance work and agent holder-filter defect are recorded above.

### Settled — no action needed

| # | What | Outcome |
|---|---|---|
| D1 | Frontend's "reject" button posted to `/approve` | **Frontend fixed 2026-08-26** (commit `2df39fa`) — `rejectTransactionTopUp()` now posts to `transactions/topup/reject`, confirmed still correct as of this 2026-10-01 pass. Backend side folded into D22: `transactions/topup/approve` and `/reject` are still both un-ported in `apps/dashboard` (row 33), so nothing calls the fixed frontend code yet — but the frontend bug itself is gone and needs no further action |
| D2 | `agent-detail/dropdown` was public | Fixed — auth required |
| D23 | Merged schema and two DTOs (`WithdrawTransactionDto`, `DisbursementTransactionDto`) still used the pre-rename `recipientName`/`recipientAccount`/`recipientBankCode`/`recipientBankName` columns | **Fixed 2026-10-21** — both DTOs now declare `accountHolderName`/`accountNumber`/`bankCode`, matching the schema. `recipientBankName` dropped outright rather than derived (the frontend never read it, and deriving it needs a new `config.Bank` lookup that doesn't exist yet — a separate feature, not this fix). See the D23 write-up |
| D15 | Aggregate balances excluded PURCHASE while per-holder balances included it | **Resolved 2026-10-26** — aggregate and per-holder endpoints now sum `BalanceSnapshot` buckets, with no transaction-type filter |
| D24 | Settlement timing moved to `MerchantSettlementPolicy`; obsolete interval fields remained in legacy read DTOs | **Resolved 2026-10-26** — config GET DTOs no longer expose `settlementInterval` or `lastSettlementAt`; the frontend had already stopped sending the create field |
| D4 | Decimal precision | Settled: Money `Decimal(15,2)`, Percentage `Decimal(8,4)` |
| D5 | Reconciliation | Out of scope — future dedicated app |
| D6 | `libs/date-time` | Deleted; `DateHelper` moved into the dashboard |
| D7 | Login validation runs after the auth guard | Kept as legacy — outcome is correct, only the status code differs |
| D9 | Intended roles per endpoint | Recorded (enforcement pending D3) |
| D11 | Agent/merchant update threw on `email` | Fixed — split across `auth.User` and the detail table |
| D12 | Soft-deleted rows appeared in lists | Fixed — every query filters `deletedAt` |
| D13 | Array-body endpoints had a different error shape | Fixed — `ParseDtoArrayPipe` |
| D14 | `registerWebhook` was fire-and-forget | Fixed — awaited |
| D16 | Ordering had no tiebreak | Fixed — `createdAt DESC, id DESC` |
| D17 | Legacy balance-ledger write path: writes escaping their transaction, no advisory locks, wrong `merchantId` in the withdraw callback | **Fixed 2026-10-12** — not ported as originally recommended, but superseded by `@app/balance`'s `reserve()`/`post()`, which solves all three more robustly. Live in the purchase and disbursement paths, verified against fixtures and a nightly snapshot-integrity job. See the write-up for what this does and doesn't finish |
| D20 | `BaseFee.code` dropped from the config schema | Fixed — `BaseFeeDto.code` derived from the three columns, so the response is unchanged |

---

### D1 — Frontend `rejectTransactionTopUp` posted to `/approve` → **fixed on the frontend; backend implements both**

`transaction-top-up.api.ts` originally read:

```ts
export function rejectTransactionTopUp(body: StatusTopUp) {
  return kyTransaction.post("transactions/topup/approve", { ... });  // ← should be /reject
}
```

At the time this was written, clicking "reject" in the dashboard **approved the top-up** — real money movement in the wrong direction.

**Decision**: the dashboard implements `POST transactions/topup/approve` *and* `POST transactions/topup/reject` correctly, matching legacy. The frontend one-liner is a separate fix on the frontend dev's side.

**Fixed on the frontend, 2026-08-26 (commit `2df39fa`)** — `rejectTransactionTopUp()` now posts to `transactions/topup/reject`. Re-confirmed by re-reading the current source during this 2026-10-01 pass: still correct, nothing regressed. The backend half is unaffected by this — `apps/dashboard`'s `TopupController` still only implements `GET`, with `POST /approve` and `POST /reject` explicitly commented as not ported. D17, which used to block this, is fixed as of 2026-10-12 (see D22); what's left is implementation effort against a now-proven pattern, tracked under D22 rather than a separate blocker. So the frontend will call the right URL the moment either endpoint exists; it's simply calling it into a 404 today.

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

### D4 — Decimal precision → **Money `Decimal(15,2)`, Percentage `Decimal(8,4)`, everywhere**

Settled and applied across all schemas, with `// Money` / `// Percentage` markers on every Decimal column. See §4.1 for the DTO side and the range each width allows.

The dashboard's merged schema is generated from the source schemas rather than hand-maintained — see §6.1. That automation exists because of this decision: the precision rework landed in `apps/config` and `apps/transaction` while the dashboard's hand-copied schema silently kept the old types.

### D5 — Reconciliation → **out of scope**

Deferred entirely; a separate dedicated app will own it along with scheduled / background file generation. See §2.5.

### D6 — `libs/date-time` → **deleted, moved into the dashboard**

The lib's barrel was also broken (it exported two files that never existed), so nothing could have imported it anyway.

**Decision**: `DateHelper` now lives at `apps/dashboard/src/shared/helper/date.helper.ts` and the lib is gone. Rationale: the transactional backends will each need date handling shaped by whatever their upstream provider / PJP mandates, so a single shared Luxon helper would have been a false abstraction. The dashboard's copy serves only the internal frontend. Removed from `nest-cli.json`, the `tsconfig.json` paths, and the Jest `moduleNameMapper`; all five apps verified building afterwards.

### D7 — Login validation runs *after* the auth guard → **kept as legacy**

`POST /login` carries `@ApiBody({ type: LoginDto })`, but `LoginDto`'s class-validator rules never execute: Nest runs guards before pipes, and `LocalAuthGuard` reads `email`/`password` straight off the raw body. Verified live — posting `{"email":"not-an-email","password":""}` returns **401**, not the 422 the DTO implies.

**Decision**: keep legacy behaviour. The outcome (rejected login) is correct; only the status code differs. Noted so the Swagger contract isn't mistaken for enforced validation.

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

### D10 — `prisma migrate` was unusable repo-wide → **fixed**

Found while setting up a local database to test against. Every `prisma migrate` path failed:

```
Error: The datasource.url property is required in your Prisma config file when using prisma migrate status.
```

Two compounding causes:

1. **No `prisma.config.ts` at the repo root.** Prisma 7 looks for the config in the working directory. Each app had one, but running from root found none — so `datasource.url` was undefined, which `migrate` requires (`generate` doesn't, which is why `prisma:generate:*` kept working and masked the problem).
2. **Passing `--config apps/auth/prisma.config.ts` didn't help**: that file declared `schema: 'apps/auth/prisma/schema.prisma'`, and Prisma resolves it relative to the *config file's own directory*, producing `apps/auth/apps/auth/prisma/schema.prisma`.

**Fix**: paths inside each `prisma.config.ts` are now relative to the config file (`prisma/schema.prisma`, `prisma/migrations`), and every script passes `--config` instead of `--schema`. Verified — all four generate scripts and all three `migrate status` scripts now resolve correctly, each correctly scoped to its own namespace:

```
Loaded Prisma config from apps\auth\prisma.config.ts.
Prisma schema loaded from apps\auth\prisma\schema.prisma.
Datasource "db": PostgreSQL database "pg", schemas "auth" at "localhost:5432"
```

This mattered more than "migrations are blocked": Prisma 7 also removed `--from-url` from `migrate diff`, so the config file is now the only way to reach most schema tooling.

Added along the way: `migrate dev`/`deploy` scripts for `transaction` (which owns tables but had none), and `migrate:status:*` for all three.

**The dashboard is guarded, not merely undocumented.** Omitting the `migrations` block does *not* stop Prisma — it falls back to a default `prisma/migrations` path, which I confirmed by running `migrate status` against the dashboard config and watching it proceed. Since the dashboard's schema spans all three namespaces with no migration history, `migrate dev` there would try to author one migration covering all 29 tables and offer to reset the shared database. So `apps/dashboard/prisma.config.ts` now throws on any `migrate` invocation:

```
apps/dashboard never runs migrations - it owns none of its tables.
Migrate from the owning app instead:
  npm run prisma:migrate:dev:auth …
```

`generate` still works there normally.

**Baselining — done.** The dev database was reset and each app now has an initial migration:

| App | Migration | Tables |
|---|---|---|
| `auth` | `20260818185352_init` | 7 |
| `config` | `20260818185412_init` | 9 |
| `transaction` | `20260818185415_init` | 13 |

All three report *"Database schema is up to date!"*

### D10.1 — Three apps sharing one database collided on migration history

Creating those migrations surfaced a problem that only appears in this architecture. **Prisma puts `_prisma_migrations` in the connection string's default schema**, and none of the three URLs specified one — so all three landed on `public._prisma_migrations`, sharing a single history table.

The result: after `auth`'s migration applied, running `config`'s refused to proceed —

```
The following migration(s) are applied to the database but missing from the
local migrations directory: 20260818185230_init
We need to reset the following schemas: "config"
```

Each app saw the *other* apps' migrations as foreign history and wanted to reset to recover. With three apps this never converges — whichever ran last would always want to wipe.

**Fix**: each app's connection string now carries `&schema=<its own schema>`, which puts its migration history inside its own namespace:

```
auth         → auth._prisma_migrations
config       → config._prisma_migrations
transaction  → transaction._prisma_migrations
```

Verified: all three migrations applied in sequence with no reset prompt, three separate history tables exist, and all 29 tables are present.

The dashboard's URL deliberately has **no** `schema` param — it never migrates, so it has no history to place, and leaving it unset keeps it neutral across all three namespaces. Runtime is unaffected either way: with `multiSchema`, Prisma fully qualifies every table name, so the search path doesn't influence queries. Confirmed by running the dashboard against the rebuilt database — `POST /login` correctly reached `auth.User` and returned `401 Invalid email or password`.

> Worth knowing if a fourth app is ever added against this database: it needs its own `&schema=` too, or it will collide the same way.

> **Regressed and re-fixed, 2026-09-01.** `apps/config/.env.local` and `.env.example` were found carrying `&schema=auth`, copied from the auth app - putting config's CLI back on `auth._prisma_migrations`. `prisma migrate status` for config duly reported auth's four migrations as foreign history and config's own `init` as unapplied; `migrate dev` would have offered to reset, dropping the auth schema. Both files corrected to `&schema=config`, verified by re-running status (*Database schema is up to date*) before applying `20260831153001_base_fee_natural_key`. Runtime was never affected, exactly as this entry predicts - `@@schema()` qualifies every table name - so only the CLI was misled, which is what makes it easy to miss. The hazard is not just a fourth app: **copying an env file between two existing apps re-creates the collision silently.**

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

### D15 — Aggregate balances excluded PURCHASE while per-holder balances included it → **resolved 2026-10-26 by BalanceSnapshot reads**

> **Resolved in code, 2026-10-26:** dashboard aggregate and per-holder reads now use BalanceSnapshot; the old transaction-type filtering inconsistency no longer exists.

The balance log tables are append-only snapshots: each row carries the resulting `balanceActive` / `balancePending`, so the current balance is simply the newest row.

But the two families of endpoint disagree on which rows count:

| Endpoint | `transactionType` filter |
|---|---|
| `GET balance/merchant/:id`, `balance/agent/:id` | **none** — newest row wins |
| `GET balance/aggregate/*` | only `WITHDRAW`, `TOPUP`, `DISBURSEMENT`, `SETTLEMENT_PURCHASE` |

So if a holder's newest row is a `PURCHASE`, the aggregate reads their *previous* row and reports a stale balance — meaning **the sum of the individual balances will not always equal the aggregate**.

Ported unchanged, because which one is right is a business question and changing it moves numbers already shown on the dashboard. My read: the per-holder version looks correct (a snapshot is a snapshot regardless of what caused it) and the aggregate's filter looks like a leftover. If you agree, deleting `AGGREGATE_TRANSACTION_TYPES` from the three aggregate queries in `balance.service.ts` is the whole fix.

**Related, worth knowing before production**: the two per-holder aggregates use Prisma `distinct: ['merchantId']` with `orderBy: createdAt`. Postgres `DISTINCT ON` requires the ordering to lead with the distinct column, which this doesn't — so Prisma cannot push it down and dedupes **in memory after fetching every matching row**. Fine at current volumes; it degrades linearly with balance-log growth. Legacy left the equivalent `DISTINCT ON` SQL in a comment marked *"TODO: Jangan di hapus => Performance"*, which is the ready-made replacement.

> **Update, 2026-10-19 — this resolves itself, no decision needed, once D22's Step 12 ships.** Per `docs/batch/settlement-batching-implementation.md`: once `balance.service.ts` reads `BalanceSnapshot` instead of the three log tables (the fix D22 is already waiting on), there is no `AGGREGATE_TRANSACTION_TYPES` filter left to write — a snapshot is just a number per holder+bucket, with no transaction-type dimension to disagree about. The plan's own words: "summing snapshot rows removes the question." So the "if you agree" above has effectively already been agreed to by the design that's already written down — what's outstanding is shipping Step 12, not a business call. Left in the Open table below because nothing has shipped yet and the current (dead-table-reading) code still has the inconsistency on paper, even though it's moot in practice per D22.

### D16 — Ordering had no tiebreak → **fixed**

Every "latest row" and listing query ordered by `createdAt` alone. Rows written inside one transaction can share a timestamp, and the winner was then arbitrary. All such queries now order by `createdAt DESC, id DESC` — `id` is monotonic on these append-only tables, so the newest row is picked deterministically.

### D17 — The legacy balance-ledger write path has three defects → **fixed, 2026-10-12**

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

> **Fixed, 2026-10-12 (commits `e7aadc5`, `ddb6778`; "Step 5"/"Step 6" of the balance-ledger work tracked in D22).** Not by porting the legacy pattern — by replacing it with `@app/balance`'s `reserve()`/`post()`, which solves the same three defects more robustly than this entry's recommendation did:
>
> 1. **Transaction scoping** — `reserve()` and `post()` both take the caller's transaction client and refuse a root `PrismaClient` (enforced structurally, not by convention — see D22). A payout now moves the merchant's funds to `RESERVED` inside the same transaction as the disbursement row, before any provider is called.
> 2. **The race** — `reserve()`'s row lock and its balance-sufficiency check are one SQL statement (`SELECT ... FOR UPDATE` with the predicate evaluated after the lock), so two concurrent withdrawals for more than the balance cannot both pass. No advisory locks needed; the lock is scoped to the contended row itself.
> 3. **The wrong-merchant-id bug** — both the purchase and disbursement paths now source the holder id from the row already in hand (`purchase.merchantId`, the disbursement's own `userId`) rather than trusting an id echoed back by the fee service, with an explicit code comment on both sites explaining why that distinction matters.
>
> Verified against the seeded fixtures through a full reserve → complete cycle (merchant `AVAILABLE` 245,000 → reserved 104,000 into `RESERVED` → completed, `RESERVED` back to 0, internal fee credited) and cross-checked by a new nightly job (`d5d7613`) that compares every `BalanceSnapshot` against the signed sum of its own `BalanceEntry` rows — zero drift on 23 entries at time of writing.
>
> **This closes D17's three defects for the live purchase and disbursement paths.** It does not, by itself, finish porting `apps/dashboard`'s own three deferred write endpoints (rows 31–33, 35) — those still need their own implementation using this now-proven pattern. See D22 for what that leaves open, including a consequence of this fix that affects today's dashboard: `apps/dashboard`'s balance module reads tables (`MerchantBalanceLog`/`AgentBalanceLog`/`InternalBalanceLog`) that this change confirms, once more, nothing writes to anymore — the live ledger has moved on to `BalanceSnapshot` entirely.

---

### D18 — Transaction v2 dropped two columns the dashboard exposed → **fixed, breaking for the frontend**

The `transaction_v2` schema (commit `3d7e6cc`) removed two columns the dashboard was reading. Neither showed up as a compile error until `prisma:merge:dashboard` re-ran: the merged schema had gone stale, so the generated client still claimed both columns existed. Worth noting as a pattern — **a stale merged schema turns a breaking change into a silent one**, and the dashboard is the only app that can be wrong this way (§6.1).

**1. `InternalBalanceLog.providerName` — dropped.**

The three balance logs are now uniform: holder id, four nullable transaction FKs, amounts, `transactionType`, audit columns. `providerName` existed only on `InternalBalanceLog`.

`GET balance/aggregate/internal` took a `providerName` query param that fed straight into that column's `where` clause. **The param is removed**, along with `FilterAggregateBalanceInternalDto`.

Said plainly: that filter never did what its name implied. Every `InternalBalanceLog` row carries the running *house* total, so narrowing to one provider and taking the newest match returned the whole internal balance as of that provider's last movement — never that provider's share of it. Two providers could return the same figure, or different figures, purely from who moved last. Removing the param removes a misleading answer, not a working feature.

A genuine per-provider house balance would need a different shape: either `providerName` reintroduced deliberately with per-provider running totals, or a sum over the transaction rows each log entry points at. Both are real work, not a query param.

**2. `TopUpTransaction.metadata` — dropped.**

`metadata` was *kept* on `PurchaseTransaction`, `WithdrawTransaction` and `DisbursementTransaction`, and upgraded there to `@db.JsonB` with the comment `// Store Response Upstream`. It was removed from `TopUpTransaction` alone, which is consistent rather than an oversight: a top-up is a manual bank transfer evidenced by `receiptImage`, with no upstream API call, so there is no provider response to store.

`GET transactions/topup` **no longer returns `metadata`**. The other three listings are unchanged.

**What the frontend has to do**

| Endpoint | Change | Action |
|---|---|---|
| `GET balance/aggregate/internal` (row 24) | `?providerName=` removed | Stop sending it. A stale caller is not an error — Nest ignores unknown query params — so it degrades silently to the unfiltered balance, which is what the filter effectively returned anyway |
| `GET transactions/topup` (row 30) | `metadata` gone from each item | Remove it from the topup row type only. Purchase / withdraw / disbursement keep theirs |

Verified: `tsc` clean on all four apps, `eslint` clean on both touched modules, 237 tests passing.

---

### D19 — Transaction v2 renamed every reference column; dashboard DTOs now expose the Prisma fields → **frontend alignment remains**

Found on 2026-09-01 while auditing this doc against the code. **This is the one to read first.**

`transaction_v2` (commit `3d7e6cc`) replaced the reference-identifier scheme on the transaction models. The dashboard's response DTOs initially kept legacy names, and the mismatch was silent because of the DTO construction cast.

**Why it stayed invisible.** The listing services build their DTO with `new XDto({ ...item } as unknown as XDto)`. That cast is there to bridge Prisma `Decimal`/`Date` against the DTO's `string`, but it also erases any check that the row still *has* the fields the DTO declares. `DtoHelper.assign` copies only keys present on the source, so a dropped column leaves the property `undefined` — and `JSON.stringify` omits undefined properties entirely. The field does not arrive as `null`. It does not arrive at all.

Confirmed by constructing `TopupTransactionDto` from a real v2-shaped row:

```
own keys : id, externalId, referenceId, merchantId, ... reconciliationAt, ...
externalId       = undefined
referenceId      = undefined
reconciliationAt = undefined

JSON: {"id":1,"merchantId":27,"providerName":"MOTIONPAY", ... }   <- all three absent
```

**Backend fix (2026-10-27).** The purchase and disbursement DTOs now expose `systemReference`, `merchantReference`, `providerReference`, and `bankReference`, plus nullable `additionalInfo`. The withdrawal DTO exposes `systemReference`, nullable `providerReference` and `bankReference`, and nullable `additionalInfo`; its schema has no `merchantReference`. Top-up exposes only `systemReference` because that is its only reference field in Prisma. Purchase, disbursement, and withdrawal retain their schema-backed `metadata`; top-up does not. Settlement listings use the purchase DTO and therefore expose the purchase schema references. Nullable Prisma fields are represented as nullable API fields. Derived `totalFeeCut` and nested fee details remain response fields computed from fee rows, not transaction table columns.

The old `externalId` and `referenceId` aliases were removed. There is no lossy mapping: `providerReference` is the provider's `referenceNo`, while `merchantReference` and `bankReference` remain separate canonical fields so operators can distinguish their source.

**Frontend follow-up**

| Endpoint | Row | Canonical fields the frontend should read |
|---|---|---|
| `GET transactions/purchase` | 29 | `systemReference`, `merchantReference`, `providerReference`, `bankReference` |
| `GET transactions/topup` | 30 | `systemReference` only |
| `GET transactions/withdraw` | 34 | `systemReference`, `providerReference`, `bankReference` |
| `GET transactions/disbursement` | 36 | `systemReference`, `merchantReference`, `providerReference`, `bankReference` |
| `GET settlement/settled` / `unsettled` | 37, 38 | Purchase reference fields |

These are **rendered table columns**, not incidental type fields. The frontend must update its old `External ID` and `Reference ID` data keys to the canonical fields above; several are wrapped in `CopyableEllipsisText`, since operators copy them to trace transactions with a provider or bank. Until that frontend change lands, those columns read absent legacy response keys and remain blank. (The reconciliation page reads the same old field names but is out of scope per D5.)

`reconciliationAt` was removed from the dashboard transaction DTOs in the 2026-10-26 cleanup; frontend purchase, disbursement, withdrawal, and legacy settlement columns that still read it now render blank and should be removed. The separate reconciliation module is out of scope.

**The rename**

The new scheme is SNAP-aligned, which is the point of it — see `docs/snap-standardization.md`:

| v2 column | Comment in schema | Was |
|---|---|---|
| `systemReference` | *Our System Reference No* | `code` / `orderId` |
| `merchantReference` | *partnerReferenceNo (SNAP)* | ? |
| `providerReference` | *referenceNo (SNAP)* | `externalId` |
| `bankReference` | *reff id from bank* | — (new) |
| `additionalInfo` `JsonB` | *Store NMID, RequestID, anything bank/upstream* | absorbs `nmid` |

The backend DTOs now expose the applicable fields from Prisma directly. **Frontend follow-up:** rename the `dataIndex` values and fields in `src/api/transaction-*.type.ts` and `settlement.type.ts` to these canonical names, then remove the old aliases. Keep the applicable field set per endpoint as listed above; do not add `merchantReference` to withdrawal or provider/bank references to top-up, since those columns do not exist on those Prisma models.

**Also worth fixing, separately**: the `as unknown as XDto` cast is what let a schema change reach production shape unnoticed. Mapping the fields explicitly — or typing the DTO constructor against the Prisma row — would have turned all of this into compile errors, which is how the two in D18 were caught. Those two were caught *only* because they were used in a `where` clause or a typed property access, not in the DTO.

---

### D20 — `BaseFee.code` dropped from the config schema → **fixed; response unchanged, nothing for the frontend**

Recorded because the DTO now declares a field the schema does not have, and that looks like the D19 bug rather than a deliberate choice.

`config.BaseFee.code` held `PROVIDER_PAYMENTMETHOD_TRANSACTIONTYPE` as one pre-joined `@unique` string. It was dropped (migration `20260831153001_base_fee_natural_key`) and replaced by a real constraint on the three columns it was built from:

```prisma
@@unique([providerName, paymentMethodName, transactionType])
```

The column only ever *looked* like a constraint. Nothing checked that `code` agreed with those three fields, so one typo would have created a second row for a triple that is supposed to be unique — and `ProfileProviderService` resolves a merchant's provider through exactly that triple.

**`BaseFeeDto.code` is preserved**, derived in the constructor from the three fields. `GET fee/config` (row 19) and `GET config/merchant/:id` (rows 20–23) return the same shape as before, and `config-merchant`'s "configured first, then by code" sort still works. Nothing to do on the frontend.

The two `orderBy: { code: 'asc' }` clauses became `[{ providerName }, { paymentMethodName }, { transactionType }]` — the same ordering, since the string was built in that order.

> Do not "tidy up" the derivation by deleting `code` from the DTO. It is what keeps rows 19–23 non-breaking; the column is gone, the response field is not.

---

### D21 — Frontend shipped a withdraw bank/USDT split and a manual-vs-API approval mode; the schema has none of it → needs a decision, then a backend fix

Found 2026-09-13 auditing this doc against the frontend. Opposite direction from D19/D18 (backend changed, frontend hadn't caught up): here the **frontend** shipped ahead of the backend. Commit `39fd47b` ("feat: change withdraw flow, add bank transfer and usdt withdraw. new withdraw approval for admin") reshaped the withdrawal create/approve flow and how the listing page reads it. Affects rows 34, 35, 40; row 41 (reject) is untouched.

**What changed, frontend-side:**

| Frontend type | New field | Purpose |
|---|---|---|
| `CreateWithdrawal` (row 35 request) | `withdrawMethod: "BANK" \| "USDT"` | Which rail the payout uses |
| | `bankName?`, `accountNumber?` | Required when `withdrawMethod` is `BANK`; both omitted for `USDT` |
| `StatusWithdrawal` (row 40 request) | `approvalMethod?: "API" \| "MANUAL"` | How the admin clears this one — an automated payout call, or the admin transfers the funds themselves and marks it done |
| `TransactionWithdrawalDto` (row 34 response) | `withdrawMethod`, `bankName`, `accountNumber` | The listing page reads `record.withdrawMethod` to disable the "Approve via API" button for USDT rows |

**USDT collects no wallet address anywhere, by design.** The crypto tab's form asks only for `nominal`; the payout address is exchanged with the admin outside this system entirely, which is exactly why USDT withdrawals are locked to `MANUAL` — the "Approve via API" button is disabled with an explanatory tooltip ("USDT withdrawals require the admin's crypto wallet address to be exchanged with the merchant/agent first...") whenever `withdrawMethod === "USDT"`. Nothing missing here; this is the feature working as designed.

**What the backend has today: none of it.** `WithdrawTransaction` has no `withdrawMethod` column and nothing distinguishing a bank payout from a crypto one. The closest existing columns are `recipientName` / `recipientAccount` / `recipientBankCode` / `recipientBankName` — added alongside `bankReference` for the disbursement/recipient work (§2.3) — which overlap in *purpose* with `bankName`/`accountNumber` but not in *name*, and there's no enum anywhere for BANK vs. USDT.

`StatusWithdrawalDto` (the row 40 stub, `apps/dashboard/src/modules/withdraw/dto/status-withdrawal.dto.ts`) still declares only `withdrawalId`. Sending `approvalMethod` alongside it isn't rejected — `CustomValidationPipe` runs with `whitelist: true` but not `forbidNonWhitelisted`, so class-validator silently strips unknown properties rather than 422ing the request — but the field also isn't recorded anywhere, since the stub handler ignores its body regardless (D17). No frontend-visible symptom there today; it will matter the moment row 40 stops being a stub, since `API` vs `MANUAL` changes what that handler has to do.

**One symptom is live right now, on row 34.** The listing page's "Approve via API" button is *supposed* to disable itself for a USDT withdrawal (`record.withdrawMethod === WithdrawMethod.USDT`). Since this backend never returns `withdrawMethod`, that comparison is always against `undefined`, so the button is **never disabled** — an admin looking at a USDT row sees both approve buttons active, with nothing server-side stopping them from clicking "Approve via API" instead of "Approve Manually". Currently harmless only because row 40 is a no-op stub that does the same nothing regardless of which button was clicked; it stops being harmless the day D17 lands and `approvalMethod` starts driving real behavior.

**This needs your call before rows 35/40 can be built for real**, on one question: does `withdrawMethod` reuse the existing `recipientName`/`recipientAccount`/`recipientBankCode`/`recipientBankName` columns (renaming or repurposing them, plus adding a method enum), or does the schema need dedicated `withdrawMethod`/`bankName`/`accountNumber` columns of its own? The existing four columns already look built for a payout destination — worth checking whether they were sized for exactly this before adding new ones next to them.

**Not yet implemented**, pending that decision — tracked separately from D17 since it's a schema/shape question independent of the balance-ledger correctness issues D17 covers, even though both gate the same two endpoints.

> **Frontend work done, 2026-09-13 (commit `bbdd1ae`, "fix: complete withdrawal CSV export and validate bank account number format").** Two follow-on gaps this entry's own audit turned up (recorded in the frontend's `api-audit-findings-2026-09-13.md`, §2–3) are now fixed there — ahead of D21 landing, not blocked on it:
>
> - **CSV export completed.** The withdrawal page's "Export CSV" button (`src/pages/transaction/withdrawal/index.tsx`) mapped rows to a plain object before exporting, and that mapping predated `39fd47b` — it never picked up `withdrawMethod`, `bankName`, or `accountNumber`. All three are now included, so the export is already correct for the moment this backend starts populating those fields; nothing left to remember once D21 ships.
> - **Bank account number format validated.** The bank-transfer form's `accountNumber` field previously only checked non-empty. It now enforces `BANK_ACCOUNT_NUMBER_REGEXP = /^\d{8,17}$/` (`src/constants/regular-expressions.ts`) — digits only, 8–17 characters, a range chosen to span every major Indonesian bank rather than one fixed length — with a localized error message in both `en-US` and `id-ID`. Client-side only; a matching server-side `@Matches` rule is still open, same as every other piece of validation D21 will need once the schema question is settled.
>
> Neither change touches what's actually open in this entry — the schema still has no `withdrawMethod` column, row 34 still can't tell the listing page which withdrawals are USDT, and the "Approve via API" button still can't disable itself for one (the live symptom two paragraphs up). Both fixes are frontend-only follow-through on gaps its own code review found, not progress on D21's open question.

> **Backend schema update, 2026-09-30 (commit `883a2cb`, "Name payout destinations the way the profile tables already do").** This answers half of the question this entry asked two paragraphs up — "does `withdrawMethod` reuse the existing `recipientName`/`recipientAccount`/`recipientBankCode`/`recipientBankName` columns?" — though not by that commit setting out to answer it; it's a side effect of unrelated cleanup (see D23, which covers why this same commit is also urgent for a different reason).
>
> `WithdrawTransaction`'s three renamed to `accountHolderName`/`accountNumber`/`bankCode`, **all three now nullable**, with the model's own comment stating why: `paymentMethodName` here can be `USDT`, "which has no bank, no account number and no account holder." That is the BANK/USDT discriminator D21 asked for — it already existed as `WithdrawPaymentMethodNameEnum = { TRANSFERBANK, USDT }`, just not under the name `withdrawMethod` the frontend uses, and apparently nobody had connected the two until this pass.
>
> **Still not a full answer, and still nothing `apps/dashboard` can use today** (confirmed: zero files under `apps/dashboard` changed in this range):
> - **Naming mismatch remains.** Frontend wants a field called `withdrawMethod`; the transaction schema calls the equivalent concept `paymentMethodName`. Trivial to alias in the DTO, but someone has to decide whether the dashboard's response field is named after the frontend's existing contract or the backend's existing column — D21's original question, just one layer down.
> - **`bankCode` is not `bankName`.** The frontend's `TransactionWithdrawalDto.bankName` wants a display string ("Bank Central Asia"); the schema stores `bankCode`, a lookup key into `config.Bank` — the same polymorphic-and-not-a-foreign-key column documented on `DisbursementTransaction` (§2.3). Populating `bankName` means a join the dashboard doesn't do today, not a rename.
> - **`approvalMethod` (API vs. MANUAL) still has zero backend representation anywhere** — confirmed by grep across `apps/transaction`, `apps/dashboard`, and every `libs/`. The row-40 stub still only reads `withdrawalId`.
>
> Net effect: the business decision this entry is waiting on just got easier to make (the shape to reuse is now visible), but it's still a decision, not yet a fix, and `apps/dashboard` hasn't started porting it.

> **Update, 2026-10-21 — `apps/dashboard` now exposes the raw columns (fixing D23), but under the schema's names, not the frontend's.** `WithdrawTransactionDto` (row 34) gained `accountHolderName`/`accountNumber`/`bankCode`, nullable, matching the schema exactly. This was done to close D23 (a different entry — the DTO had fallen out of sync with a column rename), not to resolve this one, and it doesn't: the field is still not called `withdrawMethod`, there's still no BANK-vs-USDT enum value in the response (only the raw nullable destination fields, which are merely absent for USDT rather than naming it), and `bankCode` is still a lookup key, not `bankName`. The live symptom on row 34 (the "Approve via API" button never disabling for USDT) is **unchanged** — the frontend's check is `record.withdrawMethod === WithdrawMethod.USDT`, and that field still doesn't exist. What changed is that the raw ingredients D21's eventual fix needs are now visible in one place rather than requiring a schema read to find.
>
> **Unrelated, same day: the withdrawal page's bank dropdown (row 35's UI, `src/pages/transaction/withdrawal/index.tsx`) got a data-quality fix via `common/div?div=BANK`** — it no longer lists the four e-wallet codes as if they were banks (§2.2, row 18). Not part of this entry's scope and doesn't move the naming/discriminator question above; noted here only because it touches the same screen.

---

### D22 — Dashboard balance reads moved to snapshots; remaining balance actions and an agent holder-filter defect are open

> **Update, 2026-10-26:** the read migration has landed. checkBalanceAgent() currently filters holderType: MERCHANT and must be corrected to AGENT; the admin adjustment/profit and deferred write endpoints remain unimplemented.

Found 2026-10-01, cross-checking `.env` and `apps/dashboard` against the rest of the repo for this pass. **D17 undersold the size of this problem.** D17 reads as "the dashboard's 3 deferred write endpoints need their balance-ledger bug fixed before porting." That's still true, but it turns out the *entire* balance-ledger write path — for every transaction type, including ones already live and moving real money — doesn't exist in the current codebase at all.

**What's live today, and doesn't touch a balance row.** `apps/transaction`'s purchase and disbursement paths now have real provider integration (MotionPay QRIS and Transfer/Biller, per the `f5068f1`/`78104cc`/`5546842`/`f6f8841` commits) — these are working features processing real settlements. Both webhook handlers carry the identical comment, verbatim:

```ts
// TODO(balance-ledger): on SUCCESS, append MerchantBalanceLog /
// AgentBalanceLog / InternalBalanceLog rows inside one transaction with
// advisory locks. Blocked on D17 in docs/dashboard-migration.md.
```

(`apps/transaction/src/api-v1/purchase/purchase.webhook.service.ts:209-210`, `.../disbursement/disbursement.webhook.service.ts:202-206`.) Confirmed by grep: **no code anywhere in `apps/transaction` or `apps/config` writes to `MerchantBalanceLog`, `AgentBalanceLog`, or `InternalBalanceLog`.** These three tables — the ones `apps/dashboard`'s balance module (rows 24–28) reads from — have no writer in the current repo. Whatever they contain is either empty or a frozen snapshot from before this gap opened, not a live figure.

**The good news: the replacement already exists, just unused.** Two commits since the last pass — `1b47594` ("Balance Library Template") and `1f334d7` ("Post balance movements through one shared service") — added `libs/balance` (`@app/balance`), a real, carefully-built implementation of exactly what D17 asked for:

- **`BalanceEntry`** (immutable, append-only ledger rows) + **`BalanceSnapshot`** (one row per `(holderType, holderId, bucket)`, folded via `INSERT ... ON CONFLICT DO UPDATE SET amount = amount + EXCLUDED.amount` — an atomic increment, not a read-modify-write).
- **`reserve()`** locks the snapshot row with `SELECT ... FOR UPDATE` *and* checks the amount predicate in the same statement, so Postgres re-evaluates the qual after acquiring the lock — two concurrent withdrawals for more than the balance cannot both pass. This is D17's point 2 (no advisory locks, check-then-act) solved, and arguably more robust than the advisory-lock pattern D17 recommended, since the lock is scoped to the row in contention rather than a global/per-holder key the caller has to remember to take.
- **`post()`** takes the caller's transaction and refuses a root `PrismaClient` (`assertTransactionClient`) — D17's point 1 (writes escaping their transaction) is structurally impossible to reproduce with this API, not just fixed by convention.
- Idempotent via a unique constraint on `(holderType, holderId, bucket, reason, sourceType, sourceId)` — a replayed webhook or a double-clicked approve button hits `P2002` instead of double-crediting.
- **Bucket model is richer than the dashboard's current `balanceActive`/`balancePending` pair**: `BalanceHolderTypeEnum` is `INTERNAL`/`AGENT`/`MERCHANT` (matches rows 24–28 exactly), but `BalanceBucketEnum` is `PENDING`/`AVAILABLE`/`RESERVED` — a `RESERVED` bucket for funds held against an in-flight payout, which `balanceActive`/`balancePending` has no equivalent for.

**But it has zero callers.** Confirmed by grep across every app: nothing imports `@app/balance`. The library is complete, tested-looking, well-documented infrastructure sitting unused — D17's "Not yet implemented, pending that decision" is still accurate, except the thing pending isn't really a *decision* anymore (the three defects are already solved, by a better pattern than the one D17 proposed). What's pending is wiring it into `purchase.webhook.service.ts`, `disbursement.webhook.service.ts`, and, once built, the dashboard's own topup/withdraw write endpoints (rows 31–33, 35, 40, 41).

**What this means for rows 24–28 today**: no change needed to the routes or DTOs — they're still ✅ correct contracts. But every number they return is 0 (or stale) in any environment where real transactions are flowing, which is a materially different and more urgent problem than "the dashboard can't yet write balances for its own deferred endpoints." Flagged on each of those rows in §2.3.

**When `@app/balance` is wired in, rows 24–28 will need a follow-up pass regardless of D17**: the response shape will need to either add a `balanceReserved` field or restructure around the three-bucket model, and `BalanceService` in `apps/dashboard` will need to read from `BalanceSnapshot` instead of the three old Log tables. Worth doing that migration in the same change that wires up the writers, rather than shipping writers to tables the dashboard has already moved off of.

**Recommendation**: treat this as a priority/sequencing call, not a design question — the design is done and looks sound from reading it. The open question is which path gets the shared library wired in first: the live purchase/disbursement webhooks (real money, already shipping, currently silently not tracking balance), or the dashboard's deferred topup/withdraw writes (not live yet, lower urgency by comparison). Either order eventually needs both.

> **Update, 2026-10-12.** Checked again after pulling the latest `dev` commits. Two things changed, neither of which is the wiring itself:
>
> - **The library had a bug that would have blocked wiring it in at all — now fixed (commit `3150b7d`, "Seed balance fixtures, and fix the root-client guard").** `assertTransactionClient()`'s guard checked `'$transaction' in tx` to detect and reject a root `PrismaClient`. Measured against Prisma 7.8: the interactive-transaction client's proxy *also* exposes `$transaction` at runtime even though its type omits it — only `$connect` actually discriminates root from transaction-scoped. So the old check would have thrown "a root PrismaClient was passed" on every call, including correct ones, making `post()`/`reserve()` unusable from inside a real `prisma.$transaction(...)` block. This was never exercised against a live transaction client until this change — which is itself informative: the library sat for two weeks looking finished without anyone having actually run it inside the context it's built for.
> - **It now has its first caller — but only in the dev seeder, not production.** `apps/transaction/prisma/seed/transaction-dev.seed.ts` now calls `BalanceService.post()`/`.reserve()` directly to write `BalanceEntry`/`BalanceSnapshot` fixture rows (commits `a58cd75`, `3150b7d`). The dedicated balance-migration seed step was dropped in favor of this. **It does not seed the old `MerchantBalanceLog`/`AgentBalanceLog`/`InternalBalanceLog` tables at all anymore.** Those are what `apps/dashboard`'s balance module (rows 24–28) still reads from — so as of this commit, a **freshly-seeded local dev database** shows zero balances on those rows too, not only a production one. The "every real environment" framing above now includes dev.
> - `purchase.webhook.service.ts` and `disbursement.webhook.service.ts` still carry the identical `TODO(balance-ledger)` comment, unchanged by any commit in this range (confirmed by diff, not just re-grep) — still zero callers in any live request path.

> **Update, 2026-10-13 — the wiring happened. This entry's title is no longer accurate for the live payment paths; it's now accurate for `apps/dashboard` specifically.** Four more commits landed (`e7aadc5`, `ddb6778`, `d5d7613`, plus the empty `apps/settlement` scaffold in `e7c215b`, unrelated). Checked again, properly this time — grep, not just a diff of file names:
>
> - **The `TODO(balance-ledger)` comments are gone.** Both `purchase.webhook.service.ts` and `disbursement.webhook.service.ts` now call `balanceService.post()`/`.reserve()` for real. Purchase credits merchant/internal/agent legs into `PENDING` on a successful QRIS capture. Disbursement reserves the merchant's funds into `RESERVED` *before* calling the provider, then on the webhook completes the reservation (crediting internal/agent fees into `AVAILABLE`) or returns it in full on failure. This is the fix that closes D17 (see that entry) — not a decision anymore, a shipped implementation.
> - **Verified, not just asserted.** `ddb6778`'s commit message walks through a fixture run end to end: `mAVAIL 245,000.00 → reserved 104,000.00 into mRESV → completed, mRESV back to 0.00, INTERNAL fee credited 7,500.00 → 9,500.00`. A new nightly job (`d5d7613`, `apps/transaction/src/balance-verification`) independently cross-checks every `BalanceSnapshot` against the signed sum of its own `BalanceEntry` rows and reports drift without writing anything — run against the fixtures, zero drift on 23 entries.
> - **`apps/dashboard` itself is still untouched, except for a schema regeneration** (see D23 — the same regen that incidentally fixed that entry's crash risk happened here, as a side effect of an unrelated `auth`/`Role` migration). None of `apps/dashboard/src/modules/{topup,withdraw,balance}` changed. Concretely, that means:
>   - Rows 31–33 and 35 (the dashboard's own deferred topup/withdraw writes) are **still stubs**. The pattern they need now has a proven, live reference implementation to copy (disbursement's reserve/complete/fail), which removes the design uncertainty D17 used to represent — what's left is implementation work, not a decision.
>   - **Rows 24–28 are now in a worse spot than "zero because nothing posts yet."** `apps/dashboard`'s balance module still reads `MerchantBalanceLog`/`AgentBalanceLog`/`InternalBalanceLog` — confirmed, again, that nothing in the entire repo writes to those three tables. The live ledger isn't "about to" move to `BalanceEntry`/`BalanceSnapshot` — it already has, for every transaction type that's live. These rows will return stale or zero figures **permanently**, not provisionally, until `apps/dashboard`'s own balance module is rewritten to query `BalanceSnapshot` by `(holderType, holderId, bucket)` instead.
> - **The three-bucket gap is no longer theoretical.** Real money now sits in `RESERVED` during the window between a payout being initiated and the provider confirming it — `BalanceDto`'s `balanceActive`/`balancePending` pair has no field for that bucket, so a merchant with funds genuinely reserved against an in-flight payout would see them simply missing from any dashboard response built on today's DTO.
> - **D15 is worth re-reading now.** It was "moot until D22 lands, since both read zero today." The backend half of that just stopped being true — purchase now posts real, non-zero `BalanceEntry` rows, with `PURCHASE` excluded from the aggregate query but included in the per-holder one (per D15's original finding). It's still moot *for the dashboard*, since both of the dashboard's queries read the abandoned tables — but the moment rows 24–28 are ported to `BalanceSnapshot`, D15's mismatch becomes a live, user-visible discrepancy on day one if it isn't settled first.
>
> **Recommendation, updated**: the sequencing question this entry asked (which path gets wired first) is answered — the live paths won. The next priority is porting `apps/dashboard`'s balance module to `BalanceSnapshot`, since that's now the only thing standing between rows 24–28 and showing real numbers. Build rows 31–33/35 on the same proven pattern at the same time if the resourcing allows it; there's no longer a reason to sequence them after the balance-read port, since both draw on the same now-stable library.

> **Update, 2026-10-19 — the port already has a written plan; it's Step 12, not yet started.** Read `docs/batch/balance-explained.md` (the mental model) and `docs/batch/settlement-batching-implementation.md` (§"Step 12 — Dashboard") at the user's request, as reference material. Both confirm everything above and add detail worth recording here rather than making anyone cross-reference three documents to rebuild it:
>
> - **The fix is smaller than it sounds.** `balance.service.ts`'s `findFirst` on the three log tables becomes a `findUnique` on `BalanceSnapshot` keyed by `(holderType, holderId, bucket)` — a primary-key lookup replacing an ordered scan, not a rewrite.
> - **This closes D15 too, as a side effect, with no decision needed.** The implementation doc says it outright: "Summing snapshot rows removes the question." `BalanceSnapshot` has no transaction-type filter to disagree about — once both the aggregate and per-holder balance endpoints read it, there is no separate "aggregate excludes PURCHASE" query left to diverge from the per-holder one. D15's "business question for you" has effectively already been answered by this design (sum, don't filter) — what's left is shipping Step 12, not a decision. Updated D15's entry to match.
> - **Two new screens are planned in the same step**, not currently represented anywhere in this doc's inventory because they don't exist yet: an **admin profit view** (`INTERNAL` holder, pending vs. settled profit shown separately, gated `ADMIN`/`SUPER_ADMIN`) and a **manual balance adjustment form** (writes `BalanceAdjustment` + its movement in one transaction, mandatory reason, same two roles, with the adjustment history visible on the same screen — "an adjustment tool without a visible log is how a balance quietly becomes fiction," their words). Worth the frontend knowing these are coming, even though nothing is built yet.
> - **One landmine recorded for whoever builds this**: `BalanceEntry.id` is a `BigInt`, and `JSON.stringify` throws on those — it won't fail at compile time or in a unit test that never serializes, only as a 500 the first time the endpoint is actually called. Convert to string in the DTO. Flagging here so it isn't rediscovered the hard way.
> - **Still nothing started.** Confirmed via `git log` that no commit matching this step exists yet ("`feat(dashboard): read balances from snapshot`" is listed as not-yet-shipped in the implementation doc's own commit-boundary table) — consistent with every check this doc has done so far finding zero changes under `apps/dashboard/src/modules/balance`.

---

### D23 — `apps/dashboard`'s merged schema didn't follow the payout-column rename → **fixed, 2026-10-21**

Found 2026-10-12, re-checking `apps/dashboard` against `apps/transaction` after pulling the latest `dev` commits. This is new since the 2026-10-01 pass — the rename landed 2026-09-30, one day before that pass, but in a part of the schema that pass didn't have reason to re-check.

**What changed, and where.** Commit `883a2cb` ("Name payout destinations the way the profile tables already do") renamed columns on two tables so they'd match `auth.MerchantDetail`/`auth.AgentDetail`'s naming:

| Table | Old column | New column |
|---|---|---|
| `DisbursementTransaction`, `WithdrawTransaction` | `recipientName` | `accountHolderName` |
| | `recipientAccount` | `accountNumber` |
| | `recipientBankCode` | `bankCode` |
| | `recipientBankName` | *(dropped — derivable from `bankCode` via `config.Bank`)* |

The migration (`20260930134813_rename_payout_destination_columns`) is a hand-written `RENAME COLUMN`, specifically to avoid Prisma's default `migrate dev` behavior of treating this as DROP+ADD and destroying every stored payout destination — so the data is safe. The migration's own comment names this doc directly: *"Only `apps/dashboard` ever read [`recipientBankName`] - see docs/engine/dashboard-migration.md."* Worth knowing the doc is being read as a reference by whoever's making these backend changes, not just written for them.

**`apps/dashboard` was not touched.** Confirmed: zero files under `apps/dashboard` appear in the diff between this doc's last update and now. Its merged `prisma/schema.prisma` (built by `prisma:merge:dashboard` from the three source schemas, "DO NOT EDIT," per §3) still declares the old column names for both models, and so does its generated client. That part alone would just be another D19 — stale names, silently absent fields.

**It is not just another D19.** D19's break is silent because the *columns still exist* — the DTO declares a field the query no longer populates, so it comes back `undefined` and the response still serializes. Here, the physical columns are **gone** (`RENAME COLUMN` means the old name doesn't exist anymore, period). Both `withdraw.service.ts` and `disbursement.service.ts` call `findMany()` with no `select` clause, which makes Prisma generate SQL selecting every scalar field in its (stale) model — including the four renamed/dropped ones. Once this migration reaches a Postgres database `apps/dashboard` also queries, every call to `GET transactions/withdraw` (row 34) and `GET transactions/disbursement` (row 36) will throw `column "recipientName" does not exist` (or similar) at the database level — a hard 500, not a response with some fields missing. Row 36 is hit hardest: `DisbursementTransactionDto` explicitly declares and maps all four fields (`recipientName`, `recipientBankCode`, `recipientBankName`, `recipientAccount`) into the API response, so there's no path where this limps along partially working.

**The frontend is not exposed to this directly, and isn't the fix.** Grepped `PG-Dashboard/src` for all four old names: zero hits. The frontend's own `TransactionDisbursementDto`/`TransactionWithdrawalDto` types never declared these fields in the first place, so there's nothing for a frontend dev to update here — this is purely a backend sync step that was missed when the rename shipped.

**Fix, in order:**
1. Re-run `prisma:merge:dashboard` + `generate:dashboard` so the merged schema and generated client match the current `transaction` schema.
2. Update `DisbursementTransactionDto` (`recipientName`→`accountHolderName`, `recipientAccount`→`accountNumber`, `recipientBankCode`→`bankCode`) and decide what happens to `recipientBankName`: either add a `config.Bank` lookup keyed on `bankCode` to derive a display name (matching how the column comment says it's meant to be used now), or drop the field from the response and let the frontend do that lookup itself if it needs the name at all (grep above suggests it currently doesn't).
3. `WithdrawTransaction`'s equivalent columns aren't in the dashboard's `WithdrawTransactionDto` response today (that's D21's gap), but the underlying Prisma model still has to stop referencing the old names or row 34 can't load at all, independent of whether D21 ever gets ported.
4. Re-verify against a database that actually has migration `20260930134813` applied, not just a schema diff — this write-up is from reading the migration and the generated code, not from reproducing the 500 against a live Postgres instance.

> **Update, 2026-10-13 — step 1 happened, as a side effect.** Commit `e7aadc5` (the `machine_principals`/`Role` migration, see D22) re-ran `prisma:merge:dashboard` + `generate:dashboard` for unrelated reasons — confirmed by re-checking `apps/dashboard/prisma/schema.prisma` directly: it now declares `accountHolderName`/`accountNumber`/`bankCode` on both models, with no trace of the old names, and the generated `WithdrawTransaction.ts`/`DisbursementTransaction.ts` regenerated to match (329 and 320 lines changed). **The hard-500 risk this entry opened with is gone.** Step 1 of the fix list above is done, just not on purpose.
>
> **Steps 2 and 3 did not happen — confirmed zero hand-written `apps/dashboard/src` changes in this range.** That downgrades, rather than closes, this entry:
>
> - **Row 34 (withdraw) is now fully clear.** `WithdrawTransactionDto` never declared the renamed fields in the first place (that's D21's separate gap), so there was nothing in its mapping to break. The query now succeeds against the real column names with no code change needed. D23's part of row 34 is done; D19 and D21 still apply there, same as before this entry existed.
> - **Row 36 (disbursement) no longer 500s, but now has a D19-style silent bug instead of a crash.** `DisbursementTransactionDto` still declares `recipientName`/`recipientBankCode`/`recipientBankName`/`recipientAccount`, and `disbursement.service.ts` still builds it via `{...item, ...} as unknown as DisbursementTransactionDto` — a cast that hid this at compile time before, and still does. `item` (the Prisma row) now carries `accountHolderName`/`accountNumber`/`bankCode` instead; the DTO's four old field names end up `undefined` in every response. Lower severity than a 500, but still wrong, and the fix is exactly step 2 above, unchanged.
>
> Net: this entry is no longer urgent. What remains is a contained DTO rename plus a decision on `recipientBankName`'s replacement — a smaller, well-understood piece of the original scope, not tracked separately since it's literally this entry's own step 2.

> **Fixed, 2026-10-21.** Step 2 is done: `DisbursementTransactionDto` (`apps/dashboard/src/modules/disbursement/dto/disbursement-transaction.dto.ts`) now declares `accountHolderName`/`accountNumber`/`bankCode` instead of `recipientName`/`recipientAccount`/`recipientBankCode`. No change needed in `disbursement.service.ts` — it spreads the raw Prisma row (`{ ...item, ... } as unknown as DisbursementTransactionDto`) with no `select`, so once the DTO's field names matched the row's, the existing mapping started working correctly with zero service-level changes.
>
> **`recipientBankName` is dropped, not derived.** The column itself no longer exists under any name (confirmed in schema.prisma — it was removed, not renamed, in the same migration). Deriving a display name would mean a new cross-schema lookup against `config.Bank` keyed on `bankCode` — real new logic, not a DTO/schema alignment, and nothing in `apps/dashboard` does that lookup today (confirmed: no existing bank-code-to-name helper anywhere in `apps/dashboard/src/modules`). Since the frontend never read this field to begin with (re-confirmed: zero references to `recipientBankName` anywhere in `PG-Dashboard/src`), dropping it rather than building a new lookup is the correct scope for this entry — the lookup, if ever wanted, is a separate feature, not a fix.
>
> **`WithdrawTransactionDto` also grew the three fields**, even though D23 never broke it (its DTO never declared the old names). Asked for directly, rather than part of this entry's original scope: the dashboard's withdraw listing (row 34) now exposes `accountHolderName`/`accountNumber`/`bankCode` — nullable, matching the schema (null for USDT, since `WithdrawTransaction`'s columns are nullable where `DisbursementTransaction`'s aren't). This doesn't close D21 — the frontend wants `withdrawMethod`/`bankName` under those names, and a BANK-vs-USDT discriminator isn't exposed here either, both still open — but it means the raw data D21 needs is now visible in the API for the first time, under the schema's own names, for whoever picks that decision up.
>
> Verified: `npx tsc -p apps/dashboard/tsconfig.app.json --noEmit` clean on both files.

---

### D24 — Settlement timing moved to policy; obsolete interval response fields removed 2026-10-26 → **resolved**

> **Resolved in code, 2026-10-26:** this pull removed the obsolete interval fields from both legacy config GET DTOs/services. No frontend migration remains for those response fields.

Backend work 2026-10-13 → 2026-10-16, commits `4215a4f`, `d4ade10`, `0896962` (plus `476f1c7` and `e1d7be1`, which are the attribution half below). This is the backend's Steps 8–9 in
[docs/batch/settlement-batching-implementation.md](../batch/settlement-batching-implementation.md);
nothing in `apps/dashboard/src` changed, so every effect below is either a
contract change you will feel or a table the dashboard now owns the UI for.

**The model.** `Merchant.settlementInterval` was a single integer — minutes
between settlement runs, defaulting to 120. It cannot express what merchants
actually get, so it is replaced by `settlement.MerchantSettlementPolicy` with
four modes:

| Mode | When a payment becomes available |
|---|---|
| `INSTANT` | the moment the payment succeeds |
| `FOLLOW_UPSTREAM` | once the upstream's own settlement time for that method has passed — **the default** |
| `FIXED_DELAY` | N days after the payment, at one time of day ("T+2, released 10:00") |
| `SCHEDULED` | at set times of day ("06:00, 12:00, 18:00, 23:00") |

#### Already shipped, breaking, and silent — act on this one

`CreateMerchantDto.settlementInterval` **no longer exists** (`0896962`).
`CustomValidationPipe` runs `whitelist: true` **without**
`forbidNonWhitelisted`, so a request still sending it gets a **201 with the
field quietly stripped** — no 400, no warning, nothing in a log. If the merchant
registration form still posts `settlementInterval`, it already stopped having
any effect and will not tell you.

There is nothing to send in its place yet: `registerMerchant` now creates a
default policy row itself — `paymentMethodName: '*'`, `mode: FOLLOW_UPSTREAM`,
`effectiveFrom: now()` — in the same transaction as the user and merchant rows.
So the correct frontend change today is to **stop sending the field**, not to
send a mode. A mode selector belongs with the policy screens below.

#### Needs a decision — the read endpoints still serve the dead column

`config-merchant.service.ts` still selects and returns `settlementInterval` and
`lastSettlementAt` ([lines 45–52, 65, 111–112](../../apps/dashboard/src/modules/config-merchant/config-merchant.service.ts:45)),
and `MerchantConfigDto` still declares both ([lines 74, 78, 101, 105](../../apps/dashboard/src/modules/config-merchant/dto/merchant-config.dto.ts:74)).

Those responses are now actively misleading. Registration no longer writes the
column, so **every merchant created from 2026-10-16 onward carries the database
default of 120** regardless of their real terms, and any UI showing "settles
every 120 minutes" is stating something untrue. Step 15 then drops the column
outright, at which point these endpoints break the way D23's did.

Two options, and it is your call which:

- **Strip both fields now.** Breaking for whatever renders them, but it stops
  the API asserting something false, and it is the same work Step 15 forces
  anyway.
- **Leave them until the policy screens exist**, accepting that the number is
  meaningless in the meantime, and do one change that removes the old fields and
  adds the new ones together.

Either way the fields cannot survive Step 15. The second option only defers the
frontend change; it does not avoid it.

#### New tables the dashboard owns the UI for

Five tables now live in a `settlement` Postgres schema, all present in the
merged dashboard schema and reachable from `@dashboard/prisma`:

| Table | What it holds | Who edits it |
|---|---|---|
| `MerchantSettlementPolicy` | per-merchant, per-method terms | **admin, through this dashboard** |
| `UpstreamSettlementWindow` | what each partner published about when *they* pay *us* | **admin, through this dashboard** |
| `BusinessDayCalendar` | holiday overrides, national or per partner | **admin**, once Pakailink is live |
| `SettlementRun` | one unit of scheduled work, claimed by a pod | the settlement app only — read-only here |
| `SettlementBatch` | what one run actually settled | the settlement app only — read-only here |

#### `MerchantSettlementPolicy` — the full shape

```prisma
id                Int       @id @default(autoincrement())
merchantId        Int                                  // auth.User.id, no FK across schemas
paymentMethodName String    @default("*")              // '*' or a PaymentMethodNameEnum value
mode              SettlementModeEnum                   // INSTANT | FOLLOW_UPSTREAM | FIXED_DELAY | SCHEDULED
delayDays         Int?                                 // FIXED_DELAY only
releaseTimes      String[]                             // zero-padded "HH:mm", 24-hour
businessDaysOnly  Boolean   @default(false)            // see the warning below
effectiveFrom     DateTime  @db.Timestamptz(6)
effectiveTo       DateTime? @db.Timestamptz(6)
createdAt/createdBy/updatedAt/updatedBy/deletedAt/deletedBy
@@unique([merchantId, paymentMethodName, effectiveFrom])
```

Per §4.1 and §4.2 of this document, a response DTO types `effectiveFrom` /
`effectiveTo` as `string` carrying ISO 8601 with an explicit `+07:00` offset, and
there is no money on this table.

**`'*'` is a sentinel, not a wildcard search.** `'*'` means "this merchant's
default, every method"; a real method name is an override. It is **NOT NULL**
deliberately — nullable let two default policies coexist for one merchant,
because Postgres treats NULLs as distinct in a unique index, and "most specific
wins" then had no single answer. A form must submit `'*'`, not an empty field.

**Changing a policy means a new row, not an edit.** `effectiveFrom` /
`effectiveTo` exist so changing a merchant's terms today does not rewrite how
last month's batches should have behaved. An edit screen that `UPDATE`s in place
destroys exactly that. Retire the old row by setting `effectiveTo`, then insert
the new one — in one transaction, or a reader can briefly see two active
policies.

#### Validation the schema cannot express — and the backend will throw on

`delayDays` is nullable and `releaseTimes` is an unconstrained array, so the
database will happily accept a `FIXED_DELAY` policy with neither. The settlement
runner then **throws** when it reaches that merchant. These are the real
messages, from
[policy.eligibility.ts](../../apps/settlement/src/policy/policy.eligibility.ts):

| Mode | `delayDays` | `releaseTimes` | Refusal if wrong |
|---|---|---|---|
| `INSTANT` | ignored | ignored | — |
| `FOLLOW_UPSTREAM` | ignored | ignored | `FOLLOW_UPSTREAM needs the UpstreamSettlementWindow for this payment's provider and method` |
| `FIXED_DELAY` | **required**, whole number, ≥ 0 | **exactly one** entry | `FIXED_DELAY needs a whole-number delayDays, got null` · `delayDays cannot be negative` · `FIXED_DELAY needs one entry in releaseTimes, got none` |
| `SCHEDULED` | ignored | **one or more** | `SCHEDULED needs at least one entry in releaseTimes, got none` |

Two more that apply to every mode:

- **Times must be zero-padded 24-hour `HH:mm`.** `"7:00"`, `"24:00"`, `"12:60"`,
  `"10:00:00"` are all rejected: `must be zero-padded HH:mm in 24-hour form, got
  "7:00"`. The form should enforce the same pattern rather than letting a 2am
  batch discover it.
- **`businessDaysOnly: true` refuses outright today**: `businessDaysOnly is set
  on this policy, but the business-day calendar is not implemented`. The holiday
  rules only matter once Pakailink is live and no partner has stated their
  policy yet, so the backend fails loudly rather than silently releasing funds on
  a holiday. **Do not expose that checkbox yet** — ticking it stops that
  merchant settling.

`releaseTimes` order does not matter; the backend sorts it.

#### How a policy is chosen, so a screen can show the one that applies

Most specific first, then effective dating:

```sql
SELECT * FROM "settlement"."MerchantSettlementPolicy"
WHERE "merchantId" = $1
  AND "paymentMethodName" IN ($2, '*')      -- the method, or the default
  AND "effectiveFrom" <= now()
  AND ("effectiveTo" IS NULL OR "effectiveTo" > now())
  AND "deletedAt" IS NULL
ORDER BY ("paymentMethodName" = '*'), "effectiveFrom" DESC
LIMIT 1;
```

An exact method match beats `'*'`. A merchant with no row at all is treated as
`FOLLOW_UPSTREAM` by the runner, so a merchant registered before this landed is
not stranded — but an explicit row is what makes their terms visible and
editable here rather than implied by a default in code.

#### Worked examples, for UI copy and fixtures

A payment captured **2026-10-14 at 23:59** Jakarta, under each mode:

| Policy | Funds available |
|---|---|
| `INSTANT` | 2026-10-14 23:59 — immediately |
| `FIXED_DELAY`, `delayDays: 1`, `releaseTimes: ["10:00"]` | 2026-10-15 10:00 |
| `FIXED_DELAY`, `delayDays: 0`, `releaseTimes: ["10:00"]` | 2026-10-14 10:00 — already past, so immediately |
| `SCHEDULED`, `["06:00","12:00","18:00","23:00"]` | 2026-10-15 06:00 — past the last batch, rolls to tomorrow |
| `FOLLOW_UPSTREAM`, MotionPay QRIS | 2026-10-15 15:00 |
| `FOLLOW_UPSTREAM`, MotionPay E-Wallet | 2026-10-17 23:59:59.999 |

Two behaviours worth reading twice:

- **`FIXED_DELAY` counts calendar days, not 24-hour multiples.** T+1 at 10:00
  means tomorrow at 10:00 whether the payment was at 00:01 or 23:59. A merchant
  paid at 23:59 does **not** wait until the day after.
- **A payment landing exactly on a `SCHEDULED` batch time goes out in that
  batch**, not the next one.

#### `UpstreamSettlementWindow` — several rows per method is normal

```prisma
id, providerName, paymentMethodName
label                String        // "DAILY", "BATCH_1", "BATCH_2"
windowStart          String        // "18:00"   — not consumed yet, see below
windowStartDayOffset Int  @default(0)   // -1 when the window opens the previous day
windowEnd            String        // "12:00"   — not consumed yet
settlementOffset     Int           // 0 same day, 1 = H+1, 3 = H+3
settlementTime       String?       // "15:00", or null when the partner gives no time
businessDaysOnly     Boolean @default(false)
timezone             String  @default("Asia/Jakarta")
effectiveFrom/effectiveTo + the audit six
@@unique([providerName, paymentMethodName, label, effectiveFrom])
```

**Teleanjar settles batch 1 at 13:00 and batch 2 at 19:00, both in force from
the same date** — which is why `label` is in the unique key. A screen assuming
one window per provider + method will not fit them, and the backend will reject
the second row if `label` is left blank on both.

**`settlementTime: null` means end of day, not start.** MotionPay's E-Wallet is
published as "H+3" with no hour; releasing at 00:00 on H+3 would pay the merchant
before the upstream plausibly paid us, so the backend assumes 23:59:59.999.
Worth saying in a tooltip if the field is editable, because "no time" reading as
"latest" is not the obvious interpretation.

**`timezone` is the partner's, not ours.** A partner publishing a schedule in
their own timezone is theirs to state; the day arithmetic for that window is
done in it. Everything on `MerchantSettlementPolicy` is `Asia/Jakarta`, with no
timezone column, because a merchant's terms are a local contractual matter.

**`windowStart` / `windowEnd` are recorded but not yet read.** Eligibility
derives the release moment from the payment's own calendar day plus
`settlementOffset`; choosing *which* window a payment falls into is deferred,
because the boundary rules are still open questions with the partners — Teleanjar
has 18:00 appearing in both batches and 12:00:01–12:00:59 belonging to neither.
Seeded rows carry `"00:00"` for both to mean "the full day"; writing MotionPay's
own `"23:59"` would silently drop the final minute under the half-open
`[start, end)` convention the column documents.

Seeded so far: MotionPay QRIS (T+1, 15:00) and MotionPay E-Wallet /
`DIRECTEWALLET` (H+3, no published time). Partner facts and the questions each
one leaves open are in
[docs/accounting/upstream-settlement-schedules.md](../accounting/upstream-settlement-schedules.md).

#### `SettlementRun` / `SettlementBatch` — read-only here

For the batch-history screen (backend Step 12). Neither is written by this
dashboard; both are written by `apps/settlement`.

```prisma
SettlementRun    id, merchantId, paymentMethodName, dueAt, status, claimedBy,
                 claimedAt, finishedAt, failureReason, attempts, createdAt, createdBy
                 status: PENDING | RUNNING | DONE | FAILED
SettlementBatch  id, runId, sweptFrom, sweptTo, transactionCount,
                 grossAmount, feeAmount, netAmount  (all Decimal(18,2)), postedAt
```

- **One run can produce several batches** — the claim is capped at 500
  transactions, so a busy merchant-day loops.
- **A run finishing `DONE` with no batch is normal, not an error.** Most runs for
  most merchants find nothing to settle.
- **`claimedBy` is a pod identity, not a user id.** A free-text hostname that
  changes on every deploy; do not try to resolve it to a person.
- `grossAmount` / `feeAmount` / `netAmount` are money, so per §4.1 they go on the
  wire as plain strings with two decimals — `"1250000.00"`, not a number.
- `sweptFrom` / `sweptTo` are descriptive, derived from what was actually
  claimed. They are *not* the window the claim selected on; the claim selects by
  `batchSettlementId IS NULL`, never by a time range.

#### `createdBy` / `updatedBy` now mean something — including on rows no person touched

Separate backend work (`476f1c7`, `e1d7be1`) fixed attribution across the
engine. Relevant here if any screen shows who changed a record:

- **Ids 1–20 are machine principals, not people.** 1–10 are `SYSTEM` role,
  11–20 `SCHEDULER`. They cannot log in — their stored password is not a valid
  hash. **Real humans start at 21**, which is `superadmin`.
- **Upstream callbacks are attributed per provider**: MotionPay writes as 2,
  Teleanjar 3, Jatelindo 4. So a transaction row last touched by a payment
  notification shows a machine id, not a person, and "MotionPay's callback" is
  the honest label for it.
- **Merchant API writes now carry the merchant's own `auth.User.id`.** They were
  being written as `null` until `e1d7be1` — the guard put the id in CLS under one
  key while the audit extension read another. Rows written before that fix keep
  their `null`, so any UI must render an unattributed row rather than assume a
  name resolves.
- **Do not pass `createdBy` yourself when writing the three admin-editable
  settlement tables.** They are in the dashboard's `AUDITED_MODELS`, so the
  Prisma extension stamps the signed-in admin from the request context
  automatically. Writing it by hand overrides the real actor.

#### What this does *not* change — D22 is still exactly where it was

No file under `apps/dashboard/src/modules/{balance,topup,withdraw}` was touched.
Rows 24–28 still read `MerchantBalanceLog` / `AgentBalanceLog` /
`InternalBalanceLog`, which still have no writer anywhere in the repo.

It does make the port more urgent rather than less. Settlement is the thing that
moves a merchant's money from `PENDING` to `AVAILABLE`, and once Steps 10–11
land, balances will move between buckets on a schedule. `BalanceDto`'s
`balanceActive` / `balancePending` pair has no field for `RESERVED` today; after
settlement is live it will also have no way to express "settled and spendable"
versus "captured but not yet released", which is the distinction merchants will
start asking about the moment their money stops arriving every 120 minutes.

#### One thing we could hand you, if it is useful

`settlementReleaseAt(payment, policy, window)` already computes the exact moment
a given payment's funds become available — the same function the settlement
runner uses, so a "funds available at" column would agree with reality by
construction rather than by a second implementation. It is pure, timezone-correct
in `Asia/Jakarta`, and covered by 51 tests.

It currently lives in `apps/settlement/src/policy/`, so the dashboard cannot
import it. Moving it to a `libs/` package is small work — say the word if a
per-transaction release time is something the UI wants, and it is worth doing
before two implementations of the arithmetic exist.

#### What to do, in order

**Frontend, now — the only thing that is actually broken:**

1. Stop sending `settlementInterval` from the merchant registration form. It is
   already being discarded silently; removing it changes no behaviour, it just
   stops the payload lying.
2. Check whether anything renders `settlementInterval` or `lastSettlementAt`
   from `GET` merchant config. If it does, that number is wrong for every
   merchant created after 2026-10-16 and the field disappears entirely at Step
   15. Flag what you find so the decision below can be made with the full list.

**You — one decision, then one scheduling call:**

3. **Decide** whether `config-merchant`'s read DTOs drop `settlementInterval` /
   `lastSettlementAt` now or at Step 15. Dropping now is a small breaking change
   and stops the API asserting something untrue; deferring means one combined
   change later, with a wrong number shown until then.
4. **Sequence** the policy admin screens. Nothing settles on the new schedule
   until backend Step 11, so there is real slack — but every merchant registered
   between now and then gets a default `FOLLOW_UPSTREAM` policy that nobody can
   see or change through the UI.

**Backend, already done, listed so you can verify rather than trust:**

5. Schema, migration (`20261015074210_settlement_policy_and_windows`), the
   policy row on registration, the MotionPay window seed, and
   `settlementReleaseAt` with 51 tests. The dashboard's merged schema and
   generated client are regenerated, so `@dashboard/prisma` already types all
   five tables — you can start a screen against them today without waiting on us.

**Not in scope of this entry, still open from before:** D22 (port the balance
module off the abandoned log tables) remains the highest-value dashboard work,
and settlement landing makes it more visible, not less.

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

> Reminder: the dashboard **never migrates** — its `prisma.config.ts` throws on any `migrate` invocation, and no `prisma:migrate:*:dashboard` script exists. Each owning app migrates its own tables. See D10.

## 7. Progress

- [x] Frontend endpoint inventory (41 called, 38 in scope, mapped to legacy modules)
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

**35 of 38 endpoints ported.** Every read the dashboard needs is done; what remains is the write path.

### Why the 3 write endpoints are still open

Two reasons — one structural, one blocking.

**Structural:** each pulls in a subsystem the dashboard doesn't have yet.

| Endpoint | Depends on |
|---|---|
| `POST transactions/topup` | **Fee calculation.** Legacy calls config-service over TCP (`calculateTopupFeeConfigTCP`) to split a nominal into merchant / agent / provider / internal cuts. The dashboard has no TCP, so this means porting config's fee calculators — the four ~95%-duplicated services the earlier audit flagged for consolidation. |
| `POST transactions/topup/approve` | **The balance ledger** — now `@app/balance`'s `post()`/`reserve()`, not the append-only `MerchantBalanceLog`/`AgentBalanceLog`/`InternalBalanceLog` inserts this row originally described. See the update below. |
| `POST transactions/withdraw` | Both of the above. |

`POST topup/reject` is a one-line status update and could land immediately, but shipping reject without approve isn't useful.

**Blocking, originally D17 — fixed 2026-10-12, no longer blocking in the way this paragraph describes.** Reading the legacy write path turned up three defects that affect money. Porting faithfully would reproduce them; correcting them changes financial behaviour — that needed a decision before this code could be written. It got one: `@app/balance`'s `reserve()`/`post()` (D22) solves all three, proven live in the purchase and disbursement paths (D17). What was a decision is now a known, working pattern with a reference implementation two files away (`disbursement-common.service.ts`'s `reserveTransaction`/completion/failure methods) — these three endpoints are blocked on implementation effort now, not on waiting for a call to be made.

Also unresolved as of this doc's last full pass, and it changes the ledger arithmetic: **for a WITHDRAW, is `netNominal` greater or smaller than `nominal`?** Legacy records `changeAmount: nominal` but debits `balanceActive.minus(netNominal)`, which is only correct if withdrawal fees are added on top rather than deducted. That matches the earlier audit's note ("deducted for PURCHASE/TOPUP, added on top for WITHDRAW/DISBURSEMENT") but was worth confirming rather than assuming — backwards, it leaks the fee to the merchant on every withdrawal. **Confirmed correct for DISBURSEMENT** by `ddb6778`'s implementation and its commit message ("`netNominal` is `nominal` plus fees for a disbursement, where the pay-in side subtracts them... reserving `nominal` would have let every payout overdraw the merchant by exactly the fee") — WITHDRAW is architecturally the same payout direction, so the same answer should hold, but this is inferred from DISBURSEMENT's now-shipped behavior, not yet proven by a WITHDRAW implementation that doesn't exist yet.

The controllers carry a comment at the spot where each endpoint belongs.

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
>
> **Superseded.** Those rows were hand-made before the seeders existed, and the role
> names predate ROLE being cut to six. A local database now comes from
> `npm run prisma:seed:auth:dev` then `npm run prisma:seed:config:dev` (auth first -
> config resolves its ids from `auth.User`). See [§8](#8-seeding).

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

### Standing checks

- `nest build` clean for **all five apps** (dashboard + the four transactional ones — confirms the shared-lib changes didn't regress anything).
- `eslint` clean (0 errors, 0 warnings) across `apps/dashboard` and `libs/configuration`.
- App boots; every route maps; Redis connects; Prisma reaches Postgres.
- DTO decorators tested against a **real Prisma `Decimal`**: `10000.5` → `"10000.50"`, `9750` → `"9750.00"`, 4-dp percentage `2.5` → `"2.5000"`, `Date(2026-08-10T10:32:41Z)` → `"2026-08-10T17:32:41+07:00"`. Validation rejects too many decimals, negatives, over-wide amounts, and percentages over 100.

> Two things worth remembering:
> - Prisma's `Decimal` is a **different class** from the app's `decimal.js` — `instanceof` returns false across the two. The money transform converts via `toString()` for exactly this reason.
> - `nest build` can report an error and **still emit output**. A red build here does not guarantee `dist/` is stale, which can mislead while debugging.

### Dependencies added

`@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `passport-local`, `argon2`, plus `@types/passport-jwt` / `@types/passport-local` — the same set legacy uses. `JWT_*` variables added to `apps/dashboard/.env.example` and `.env.local`; the access-token secret must match the auth service's, since the dashboard verifies tokens that service issues.

---

## 8. Seeding

Two seeders, one per schema-owning app. The dashboard has none — it owns no tables.

```bash
npm run prisma:seed:auth          # engine only
npm run prisma:seed:auth:dev      # engine + dev fixtures
npm run prisma:seed:config        # engine only
npm run prisma:seed:config:dev    # engine + dev fixtures
```

**Order matters.** Config resolves `config.Agent.id` / `config.Merchant.id` from
`auth.User` by email, so auth runs first. There is no cross-schema foreign key to
enforce this — Prisma cannot express one across `multiSchema` clients — so the
seeds check explicitly: the config engine tier throws with the command to run,
and the dev tier skips with a message. Neither writes rows pointing at users that
do not exist.

### Two tiers

| Tier | Contents | Safe in production |
|---|---|---|
| **engine** | auth: 6 roles, 5 system + 10 scheduler + 5 reserved accounts, `superadmin@pg.id`, `agentinternal@pg.id`. config: 91 banks, Agent Internal's `config.Agent` row, the INTERNAL provider, payment methods. | yes |
| **dev** | auth: 4 agents + 4 merchants + signatures. config: third-party providers, their config rows, provider fee config, fee overrides, shareholder splits. | **no** — refuses to run under `NODE_ENV=production` |

Engine is the data the system cannot boot without. Dev is everything ported from
the legacy seed to make a fresh local database usable.

Every step is an upsert, so re-running fills in what is missing and never
overwrites a value corrected in the database. Verified: three consecutive full
runs leave identical row counts.

### Things worth knowing

**Agent Internal is engine data.** Merchants are onboarded by an agent, and the
internal team signs in as `agentinternal@pg.id` to do it. Without its
`config.Agent` row, `registerMerchant`'s `registrarIsAgent` lookup misses and no
`AgentShareholder` row is written — a silent failure, because the merchant is
still registered successfully. It lands on id 22 on a fresh database, but the
seed looks the id up by email rather than hardcoding it: nothing enforces that id,
so a stale hardcode would not error, it would just point at nothing.

**Permissions are deliberately not seeded.**

**Only INTERNAL is an engine provider.** INTERNAL is the house provider —
transactions settled by us rather than routed out — so it exists everywhere.
Everything else in `ProviderNameEnum` is a commercial integration that exists in
an environment because a contract was signed and credentials were issued, so the
dev tier seeds those. It is derived by subtraction rather than listed, so a new
provider added to the enum lands in dev automatically. Note that
`BaseFee.providerName` is a real foreign key to `Provider.name`, which is why the
dev tier writes its providers before its fee rows.

**Provider fee rates are dev-only, and invented.** Real rates are commercial terms
from a signed agreement and must be entered through the dashboard's fee-config
screens. A production database carrying plausible-looking but fictional rates is
worse than one carrying none — nothing fails loudly, the fees are simply wrong and
every settlement quietly mis-splits.

**The bank list was de-duplicated.** The legacy list held 97 entries under 91
distinct codes, and `Bank.code` is the primary key — it would have thrown P2002
partway through. Renamed banks collapsed to one entry; Bank NTB / Bank SulutGo were
split across 127 / 128.

**`--dev` needs a `--` separator.** `prisma db seed` spawns the seed as a child
process and only forwards arguments after `--`. The npm scripts therefore end in a
bare `--`, which looks like a typo but is load-bearing: without it the flag is
swallowed and the dev tier is skipped *silently* rather than erroring.

`prisma migrate reset` also runs these, via `migrations.seed`. It passes no
arguments, so a reset restores engine data only — the right default for a command
that just wiped the database.
