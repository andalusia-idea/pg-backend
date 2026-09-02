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

### 2.1 From auth-service → `modules/`

Two more columns since the last pass: **Issue & Responsible** (populated only where Status isn't a clean ✅ — states what's wrong and whether Frontend, Backend, or Both own the fix) and **Request Body / Requirement** (populated only for not-yet-built or mis-shaped endpoints — the request shape and behavior the backend needs to implement).

| # | Method | Path | Legacy module | Frontend caller | Role | Status | Issue & Responsible | Request Body / Requirement |
|---|---|---|---|---|---|---|---|---|
| 1 | POST | `login` | `auth` | `postLogin` | Public | ✅ Matches | — | — |
| 2 | GET | `permissions` | `permissions` | `getPermissionByAuthInfo`, `fetchPermissionAll` | Any authenticated (see D8) | ✅ Matches | — | — |
| 3 | GET | `permissions/:id` | `permissions` | `fetchPermissionById` | Any authenticated | ✅ Matches | — | — |
| 4 | GET | `user/profile` | `users` | `getUserProfile` | Any authenticated (own profile) | ✅ Matches | — | — |
| 5 | POST | `user/admin/register-merchant` | `users` | `createMerchant` | `AGENT` (backend `@Roles`, frontend route `/acc-management/create-merchant`) | ✅ Matches | — | — |
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
> **One gap found doing this check, not specific to row 53:** a malformed entry's 422 (`ApiError.validationFailed`) puts the per-field message that actually names the offending value under `error.fields["allowedIps.N"]`, but the frontend's global `handleErrorResponse()` (`src/utils/ky/error-response.ts`) only ever reads the top-level `message`/`errorMsg` — which for this error type is just the generic `"Request validation failed"`. So today, entering a malformed IP shows the merchant a toast that doesn't say *which* entry was wrong, contradicting this callout's "a malformed entry is a 422 naming the offending value" premise from the UI's side. This isn't new to row 53 — `handleErrorResponse` never reads `error.fields` for *any* endpoint, so every class-validator 422 across the dashboard has the same gap; row 53 is just the first place this doc's cross-check happened to exercise it. **Frontend.** Flagged here rather than fixed, since it's a change to the shared error handler, not this one feature.

### 2.2 From config-service

| # | Method | Path | Legacy module | Frontend caller | Role | Status | Issue & Responsible | Request Body / Requirement |
|---|---|---|---|---|---|---|---|---|
| 17 | GET | `agent/:agentId/merchants` | `agent` | `getAgentMerchants` | `SUPER_ADMIN` (agent detail page) | ✅ Matches | — | — |
| 18 | GET | `common/div?div=` | `common` | `getCommonByDiv` | Any authenticated — dropdown data (bank/provider/payment-method) reused across the create-agent, create-merchant, config-fee and provider pages | ✅ Matches | — | — |
| 19 | GET | `fee/config` | `fee` | `getBaseFee` | `SUPER_ADMIN`, `MERCHANT` (provider page + config-fee) | ✅ Matches | — | — |
| 20 | GET | `merchant/:merchantId/interval` | `merchant` | `getMerchantInterval` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` (merchant detail / create-merchant) | ✅ Matches | — | — |
| 21 | GET | `merchant/:merchantId/config` | `merchant` | `getMerchantConfig` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` (merchant detail + config-fee) | ✅ Matches | — | — |
| 22 | POST | `merchant/:merchantId/provider` | `merchant` | `upsertMerchantFee` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |
| 23 | POST | `merchant/:merchantId/agent-shareholder` | `merchant` | `upsertMerchantAgentShareholder` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |

### 2.3 From transaction-service

| # | Method | Path | Legacy module | Frontend caller | Role | Status | Issue & Responsible | Request Body / Requirement |
|---|---|---|---|---|---|---|---|---|
| 24 | GET | `balance/aggregate/internal` | `balance` | `getBalanceInternal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` (home dashboard) | ⚠️ **Changed 2026-09-01** — the `?providerName=` param is gone | **Frontend.** Stop sending `providerName`. Harmless if you don't — Nest ignores unknown query params — but the filter it fed never worked as named. See D18 | — |
| 25 | GET | `balance/aggregate/merchant` | `balance` | `getBalanceMerchant` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |
| 26 | GET | `balance/aggregate/agent` | `balance` | `getBalanceAgent` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ✅ Matches | — | — |
| 27 | GET | `balance/merchant/:merchantId` | `balance` | `getBalanceMerchantById` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` (merchant detail balance widget) | ✅ Matches | — | — |
| 28 | GET | `balance/agent/:agentId` | `balance` | `getBalanceAgentById` | `SUPER_ADMIN` (agent detail balance widget) | ✅ Matches | — | — |
| 29 | GET | `transactions/purchase` | `purchase` | `getTransactionPurchase` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ⚠️ **Changed 2026-09-01** — `externalId` and `referenceId` no longer returned | **Backend + frontend.** Columns renamed in transaction v2; the DTO was never updated, so both render blank. See D19 | — |
| 30 | GET | `transactions/topup` | `topup` | `getTransactionTopUp` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ⚠️ **Changed 2026-09-01** — `metadata` (D18) plus `externalId`, `referenceId`, `reconciliationAt` (D19) no longer returned | **Backend + frontend.** Four blank columns on the top-up page — the worst-hit listing. See D18 and D19 | — |
| 31 | POST | `transactions/topup` | `topup` | `createTransactionTopUp` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🚧 Not ported (D17 / fee-calc dependency) | **Backend.** Blocked on porting config's fee-calculation services (currently ~95%-duplicated across four legacy services) — see §7 | POST `transactions/topup`. Frontend sends `CreateTopUp = { userId: number, receiptImage: string, nominal: number }`. Requirement: split `nominal` into merchant/agent/provider/internal cuts via the fee calculator, write the pending top-up row |
| 32 | POST | `transactions/topup/approve` | `topup` | `approveTransactionTopUp` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🚧 Not ported (D17 / balance-ledger dependency) | **Backend.** Blocked on the balance-ledger rework (advisory locks + transaction-scoping) from D17 — needs your decision there first | POST `transactions/topup/approve`. Frontend sends `StatusTopUp = { topupId: number }`. Requirement: mark approved, write `MerchantBalanceLog`/`AgentBalanceLog`/`InternalBalanceLog` rows inside one transaction with advisory locks, per the corrected D17 pattern |
| 33 | POST | `transactions/topup/reject` | `topup` | `rejectTransactionTopUp` — see D1, fixed 2026-08-26 | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🚧 Not ported (backend only, now — see note below) | **Backend.** Blocked on D17 like the other two topup write endpoints. The frontend's D1 bug (posting to `/approve` instead of `/reject`) is fixed — commit `2df39fa`, confirmed by re-reading `transaction-top-up.api.ts`, which now posts to `transactions/topup/reject` correctly. Once the backend ships `/reject`, this call will work with no further frontend change needed | POST `transactions/topup/reject`. Frontend sends `StatusTopUp = { topupId: number }`. Requirement: flip status to rejected only — no ledger write, unlike approve |
| 34 | GET | `transactions/withdraw` | `withdraw` | `getTransactionWithdrawal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ⚠️ **Changed 2026-09-01** — `externalId`, `referenceId`, `reconciliationAt` no longer returned | **Backend + frontend.** See D19 | — |
| 35 | POST | `transactions/withdraw` | `withdraw` | `createTransactionWithdrawal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🚧 Not ported (D17 / fee-calc + balance-ledger dependency) | **Backend.** Blocked on both fee-calculation and the balance-ledger work — see §7 | POST `transactions/withdraw`. Frontend sends `CreateWithdrawal = { userId: number, nominal: number }`. Requirement: insufficient-balance check must be lock-guarded per D17 (not check-then-act), then write the pending withdrawal row |
| 36 | GET | `transactions/disbursement` | `disbursement` | `getTransactionDisbursement` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | ⚠️ **Changed 2026-09-01** — `externalId` and `referenceId` no longer returned | **Backend + frontend.** See D19 | — |
| 40 | POST | `transactions/withdraw/approve` | *(none)* | `approveTransactionWithdrawal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** — see note below | **Backend.** Route/DTO/response shape are real; the handler is a no-op pending D17 | POST `transactions/withdraw/approve`. Frontend sends `StatusWithdrawal = { withdrawalId: string }` — note `withdrawalId` is typed `string` here vs. `topupId: number` on the topup side (row 32), worth reconciling. Requirement: same balance-ledger shape as topup approve, including the D17 fix for the `merchantId: withdraw.id` bug in the callback path |
| 41 | POST | `transactions/withdraw/reject` | *(none)* | `rejectTransactionWithdrawal` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 40 | POST `transactions/withdraw/reject`. Body: `StatusWithdrawal = { withdrawalId: string }`. Requirement: flip status only, no ledger write — same shape as topup reject (row 33) |
| 42 | POST | `transactions/purchase/resend-callback` | *(none)* | `resendPurchaseCallback` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Route/DTO/response shape are real; the handler is a no-op pending the provider-integration work | POST `transactions/purchase/resend-callback`. Body: `PurchaseCallbackAction = { purchaseId: string }`. Requirement: re-fire the provider webhook callback for that purchase — needs the provider-integration layer this dashboard doesn't otherwise touch |
| 43 | POST | `transactions/purchase/refresh-status` | *(none)* | `refreshPurchaseStatus` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 42 | POST `transactions/purchase/refresh-status`. Body: `{ purchaseId: string }`. Requirement: re-poll the provider for this purchase's current status and update the row |
| 44 | POST | `transactions/purchase/notify-merchant` | *(none)* | `notifyPurchaseMerchant` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 42 | POST `transactions/purchase/notify-merchant`. Body: `{ purchaseId: string }`. Requirement: re-send this purchase's webhook to the merchant's registered `payinUrl` (see rows 16/39 for where that URL comes from) |
| 45 | POST | `transactions/disbursement/resend-callback` | *(none)* | `resendDisbursementCallback` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 42, disbursement side | POST `transactions/disbursement/resend-callback`. Body: `DisbursementCallbackAction = { disbursementId: string }`. Requirement: re-fire the provider webhook callback for that disbursement |
| 46 | POST | `transactions/disbursement/refresh-status` | *(none)* | `refreshDisbursementStatus` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 45 | POST `transactions/disbursement/refresh-status`. Body: `{ disbursementId: string }`. Requirement: re-poll the provider for this disbursement's current status |
| 47 | POST | `transactions/disbursement/notify-merchant` | *(none)* | `notifyDisbursementMerchant` | `SUPER_ADMIN`, `AGENT`, `MERCHANT` | 🟡 **Stubbed 2026-08-26** | **Backend.** Same as row 45 | POST `transactions/disbursement/notify-merchant`. Body: `{ disbursementId: string }`. Requirement: re-send this disbursement's webhook to the merchant's registered `payoutUrl` |

> **Rows 40–47, stubbed 2026-08-26.** All eight now have a real controller method, request DTO (with class-validator rules matching the frontend's existing types exactly), and response envelope in `apps/dashboard` — `WithdrawController`/`WithdrawService`, `PurchaseController`/`PurchaseService`, `DisbursementController`/`DisbursementService`. Each service method is a deliberate no-op (`void dto; return Promise.resolve();`, commented `TODO(backend)`): the controller returns `ResponseDto` with `UPDATED` (40/41, a real status transition once implemented) or `SUCCESS` (42–47, a triggered action) so the frontend can wire up its success/error handling against a real shape, but nothing is written to the database and no provider is called yet. Rows 40/41 (withdraw approve/reject) are confirmed wired to real, distinct buttons in `src/pages/transaction/withdrawal/index.tsx` (`useApproveWithdrawal`/`useRejectWithdrawal`) — clicking them now gets a success response instead of a 404, but the withdrawal's status won't actually change until the D17-gated logic replaces the stub. Same caveat for the purchase/disbursement resend-callback / refresh-status / notify-merchant trio and their pages. Verified: `npm run build:dashboard` succeeds and `eslint` is clean on all five touched modules; every other endpoint in this doc is untouched.

### 2.4 From settlerecon-service

Settlerecon's *provider integrations* (Inacash/PDN/Pakaidonk/Payhere/Zipay) stay out of scope. But settlement reads the **same `transaction` Postgres schema** dashboard already maps (verified: settlerecon's legacy `schema.prisma` declares `schemas = ["transaction"]`), so it is portable without touching provider code.

| # | Method | Path | Legacy module | Frontend caller | Role | Status | Issue & Responsible | Request Body / Requirement |
|---|---|---|---|---|---|---|---|---|
| 37 | GET | `settlement/settled` | `settlement` | `getSettleData` | `SUPER_ADMIN` (settlement page) | ⚠️ **Changed 2026-09-01** — `externalId` and `referenceId` no longer returned | **Backend + frontend.** Reads `PurchaseTransaction`, so it inherits row 29's breakage. See D19 | — |
| 38 | GET | `settlement/unsettled` | `settlement` | `getUnsettleData` | `SUPER_ADMIN` | ⚠️ **Changed 2026-09-01** — same as row 37 | **Backend + frontend.** See D19 | — |
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
| In scope, not yet ported — pending D17 / fee-calculation (rows 31, 32, 33, 35) | 4 |
| In scope, stubbed 2026-08-26 — route/DTO real, handler is a deliberate no-op (rows 40–48) | 9 |
| **Total in scope** | **49** |
| Backend-first, awaiting a frontend caller | 0 *(was 1 — row 53, IP allowlist — from 2026-08-28 until the frontend added `updateAllowedIps` the same day)* |
| Out of scope — reconciliation (deferred per D5) | 4 |
| Out of scope — region lookup (frontend calls a third party directly) | 4 |

The role-name drift, the config base-URL disagreement, the merchant-signature path mismatch (rows 15/16/39), and the D1 frontend bug on row 33 were all flagged as live problems on 2026-08-25 and confirmed fixed on the frontend as of 2026-08-26. Separately, on 2026-08-26 rows 39–48 (the 10 previously-🆕 endpoints) got real controllers/DTOs added to `apps/dashboard` — row 39 for real, rows 40–48 as stubs pending real logic (see the callouts at the top of §2 and on the affected rows). What's left un-implemented is now purely rows 31/32/33/35, gated on the D17 decision — everything else the frontend calls has *a* route to hit, even where the business logic behind it still needs writing.

Section 7's progress checklist below still says "35 of 38 ported" — that line predates this pass and reflects the original 38-endpoint count, not the 48 found here. Left as-is since only §2 was in scope for this audit; whoever picks up rows 39–48 should update §7 alongside them.

**For the frontend team, 2026-08-28:** the only change requiring work on your side is **row 53** plus the new `allowedIps` field on row 39's response. Nothing existing broke — `status` gained a field, which is additive. See the row 53 callout in §2.1 for the request/response shapes and the three UI points that matter.

**For the frontend team, 2026-09-01 — read D19 first.** Six rows changed shape: **24** (`?providerName=` removed, harmless), **29, 30, 34, 36, 37, 38** (`externalId` and `referenceId` absent from every item; `reconciliationAt` too on 30 and 34; `metadata` too on 30). None of it is additive and none of it errors — the fields simply stop arriving, so the affected table columns render blank rather than throwing. **Do not start renaming yet:** one old→new column mapping is still open (D19), and the backend DTOs change once it is settled. D18 covers row 24.

**Update (2026-08-28, later same day): row 53 done.** Commit `9d749a8` adds the IP whitelist card and its caller — see the "Update" note appended to the row 53 callout in §2.1 for what was verified and the one gap it turned up (generic validation-error messages hide which entry was malformed, dashboard-wide, not just here). Nothing in this doc's scope remains without at least a route to hit; what's left open is D17/D3 (§5) and the 🟡-stubbed handlers (rows 40–48), none of which are new to this pass.

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
    ├── topup/               # 30-33  (31/32/33 pending D17)
    ├── withdraw/            # 34-35, 40-41  (35 pending D17; 40-41 stubbed 2026-08-26)
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

> Minor mismatch, no action needed: the frontend's local `ResponseStatus` enum is missing `UPDATED`, which the backend does emit on PATCH. Since the frontend only reads `data`, it's harmless — worth a one-line frontend addition whenever convenient.

---

## 5. Decisions

Twenty entries (D1–D20), each a real defect or ambiguity found while reading the legacy code. Most are settled and need nothing from you; eight do. Sorted by number below — this table is the triage.

### Open — needs a decision or action

| # | What | Who acts | Why it matters |
|---|---|---|---|
| **D17** | Three defects in the legacy balance ledger: writes escaping their transaction, no advisory locks, and a wrong `merchantId` in the withdraw callback | **You** — confirm the corrected port | **Live in production today.** Also blocks the 3 remaining write endpoints |
| **D1** | Frontend's "reject" button posts to `/approve` | Frontend dev | **Live in production today.** Rejecting a top-up currently approves it |
| **D3** | No authorization is enforced — `@Roles()` / `@CheckPolicies()` are placeholders | **You** (discussing internally) | Any authenticated user can call any endpoint. Must be settled before production |
| **D10** | ~~`prisma migrate` unusable repo-wide~~ — **fixed**; one item remains | **You** | Decide how to baseline: the dev DB has tables (from `db push`) but no migration history |
| **D15** | Aggregate balances filter out `PURCHASE`; per-holder balances don't | **You** — business question | The sum of individual balances won't always match the aggregate shown on the dashboard |
| **D8** | `GET permissions` serves two opposite needs from one URL | **You** + frontend dev | Every signed-in user gets the full admin menu client-side. UI-only, not a data breach |
| **D19** | Transaction v2 renamed every reference column; the four listing DTOs still declare the old names, so `externalId` / `referenceId` are silently absent from every response | **You**, then backend + frontend | **Live now.** 21 table columns across 5 pages render blank. Needs your call on one old→new mapping before the DTOs can be fixed |
| **D18** | Transaction v2 dropped `InternalBalanceLog.providerName` and `TopUpTransaction.metadata`, both exposed through the dashboard API | Frontend dev | Backend is fixed and compiling. Two response/param shapes changed — see the table at the end of D18 |

> **D17 and D1 are not migration issues.** Both are defects in the code running in production right now, found while reading it. They're worth acting on independently of this port.

### Settled — no action needed

| # | What | Outcome |
|---|---|---|
| D2 | `agent-detail/dropdown` was public | Fixed — auth required |
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
| D20 | `BaseFee.code` dropped from the config schema | Fixed — `BaseFeeDto.code` derived from the three columns, so the response is unchanged |

---

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

### D19 — Transaction v2 renamed every reference column; the dashboard DTOs still expose the old names → **needs a decision, then a backend fix**

Found on 2026-09-01 while auditing this doc against the code. **This is the one to read first.**

`transaction_v2` (commit `3d7e6cc`) replaced the reference-identifier scheme on all four transaction models. The dashboard's response DTOs were never updated, and **nothing failed** — not the compiler, not the tests, not eslint.

**Why it stayed invisible.** The listing services build their DTO with `new XDto({ ...item } as unknown as XDto)`. That cast is there to bridge Prisma `Decimal`/`Date` against the DTO's `string`, but it also erases any check that the row still *has* the fields the DTO declares. `DtoHelper.assign` copies only keys present on the source, so a dropped column leaves the property `undefined` — and `JSON.stringify` omits undefined properties entirely. The field does not arrive as `null`. It does not arrive at all.

Confirmed by constructing `TopupTransactionDto` from a real v2-shaped row:

```
own keys : id, externalId, referenceId, merchantId, ... reconciliationAt, ...
externalId       = undefined
referenceId      = undefined
reconciliationAt = undefined

JSON: {"id":1,"merchantId":27,"providerName":"MOTIONPAY", ... }   <- all three absent
```

**What the frontend loses**

| Endpoint | Row | Fields missing from every item |
|---|---|---|
| `GET transactions/purchase` | 29 | `externalId`, `referenceId` |
| `GET transactions/topup` | 30 | `externalId`, `referenceId`, `reconciliationAt`, `metadata` (last one is D18) |
| `GET transactions/withdraw` | 34 | `externalId`, `referenceId`, `reconciliationAt` |
| `GET transactions/disbursement` | 36 | `externalId`, `referenceId` |
| `GET settlement/settled` / `unsettled` | 37, 38 | `externalId`, `referenceId` |

These are **rendered table columns**, not incidental type fields. In `PG-Dashboard` they appear as `dataIndex` entries titled "External ID" and "Reference ID" — several wrapped in `CopyableEllipsisText`, i.e. values operators copy out to trace a transaction with the provider or the bank. 21 column definitions across the purchase, top-up, withdrawal, disbursement and settlement pages render blank. (The reconciliation page reads the same field names but is out of scope per D5, so it is unaffected by this backend.)

`reconciliationAt` survives on `PurchaseTransaction` and `DisbursementTransaction` and was dropped only from `TopUpTransaction` and `WithdrawTransaction`, so rows 29/36/37/38 keep that column.

**The rename**

The new scheme is SNAP-aligned, which is the point of it — see `docs/snap-standardization.md`:

| v2 column | Comment in schema | Was |
|---|---|---|
| `systemReference` | *Our System Reference No* | `code` / `orderId` |
| `merchantReference` | *partnerReferenceNo (SNAP)* | ? |
| `providerReference` | *referenceNo (SNAP)* | `externalId` |
| `bankReference` | *reff id from bank* | — (new) |
| `additionalInfo` `JsonB` | *Store NMID, RequestID, anything bank/upstream* | absorbs `nmid` |

`externalId` → `providerReference` is unambiguous: both mean "the provider's identifier for this transaction."

**`referenceId` is not.** The old column was `referenceId String?` with no comment, and v2 offers two plausible homes — `merchantReference` (SNAP `partnerReferenceNo`) or `bankReference`. **This needs your answer before the DTO is changed.** Publishing the wrong column under a heading operators use to trace money is worse than publishing a blank one, so the DTOs are deliberately left untouched pending that call.

**Then, backend**: expose the new columns on all four DTOs. Several are genuinely new information the frontend has no way to show today — `bankReference`, `additionalInfo`, `merchantReference`, and on withdraw the whole recipient block (`recipientName`, `recipientAccount`, `recipientBankCode`, `recipientBankName`) plus `settlementAt`.

**Then, frontend**: rename the `dataIndex` values and the fields in `src/api/transaction-*.type.ts` and `settlement.type.ts` to match whatever mapping is settled.

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
| `POST transactions/topup/approve` | **The balance ledger** — advisory locks around append-only inserts into `MerchantBalanceLog` / `AgentBalanceLog` / `InternalBalanceLog`. |
| `POST transactions/withdraw` | Both of the above. |

`POST topup/reject` is a one-line status update and could land immediately, but shipping reject without approve isn't useful.

**Blocking: D17.** Reading the legacy write path turned up three defects that affect money. Porting faithfully would reproduce them; correcting them changes financial behaviour. That needs your call before any of this code gets written.

Also unresolved, and it changes the ledger arithmetic: **for a WITHDRAW, is `netNominal` greater or smaller than `nominal`?** Legacy records `changeAmount: nominal` but debits `balanceActive.minus(netNominal)`, which is only correct if withdrawal fees are added on top rather than deducted. That matches the earlier audit's note ("deducted for PURCHASE/TOPUP, added on top for WITHDRAW/DISBURSEMENT") but is worth confirming rather than assuming — backwards, it leaks the fee to the merchant on every withdrawal.

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
