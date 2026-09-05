# Merchant Open API — build plan

**Scope**: the outward-facing HTTP API merchants integrate against, and its path down to MotionPay.
**Status**: Purchase QRIS built end-to-end, blocked on MotionPay. Everything after it is designed but unwritten.
**Owner**: solo dev · **Started**: 2026-09-01

Related docs — read these rather than duplicating them here:

| Doc | What it owns |
|---|---|
| [merchant-signature.md](merchant-signature.md) | How a merchant authenticates. Design and rationale |
| [merchant-signature-implementation.md](merchant-signature-implementation.md) | The 13-step build order for auth. Steps 1–12 done, 13 (webhooks) held |
| [merchant-api-response-codes.md](merchant-api-response-codes.md) | Every `responseCode` a merchant can receive. **The merchant-facing reference** |
| [upstream/motionpay.md](upstream/motionpay.md) | MotionPay's wire contract, probe results, and open questions |
| [snap-standardization.md](snap-standardization.md) | Why the envelope looks the way it does, and how much of SNAP we adopt |
| [throttler.md](throttler.md) | Rate limiting |
| [tls.md](tls.md) | Transport |

---

## 1. Where things stand

| Phase | Product | Code | Integration | Blocker |
|---|---|---|---|---|
| **1** | Purchase QRIS | ✅ complete | ✅ **working** | Create + status verified end-to-end against sandbox 2026-09-02 |
| **2** | Disbursement TRANSFER_BANK | ⬜ not started | 🔴 blocked | Our public IP is not whitelisted by Flash |
| **3** | Disbursement EWALLET | ⬜ not started | 🔴 same as phase 2 | Shares the transfer endpoint |
| **4** | Purchase status query | ⬜ not started | — | Needs phase 1 live |
| **5** | Provider callbacks (QRIS) | ✅ complete | 🟡 partial | Endpoint live and verified. Needs the URL registered with Flash + their egress IPs |
| **6** | Merchant webhooks | ⬜ not started | — | Needs phase 5 |

**Purchase QRIS is no longer blocked** — the create-payment 400 resolved on MotionPay's side and was re-verified end-to-end on 2026-09-02. Payout is still blocked on IP whitelisting. §6 is the remaining ask list.

---

## 2. The request path

One merchant call, end to end. Every arrow is a place something can fail, and every failure has to end up as one SNAP-shaped envelope.

```
merchant
  │  POST /v1/qr/qr-mpm-generate
  │  X-Client-Id, X-Timestamp, X-Nonce, X-Signature
  ▼
apps/transaction  ── MerchantSignatureGuard ──► apps/auth (TCP)
  │                                               verify signature, IP, rate limit, nonce
  │  ◄──────────────────────────────────────────  userId
  │
  │  MerchantBodyPipe          validate body → 400 in the SNAP envelope
  │  PurchaseController        userId from CLS
  ▼
PurchaseService
  │
  ├─► apps/config (TCP)   findProfileProvider   which provider for this merchant + QRIS + PURCHASE
  ├─► apps/config (TCP)   calculateFee          split nominal into 4 cuts
  │
  ├─► DATABASE            reserve the row       claims merchantReference, status PENDING
  │
  ├─► MotionPay (HTTPS)   createQRIS            the only outbound network call
  │
  └─► DATABASE            record the result     providerReference, qrString, expiresAt
  │
  ▼
MerchantResponseInterceptor   wrap in { responseCode, responseMessage, serverTime, data }
  │
  ▼
merchant
```

Later, when the customer actually pays — or the QR expires:

```
MotionPay
  │  POST /callback/motionpay/qris        unauthenticated, no signature
  ▼
MotionPayQrisCallbackController
  │  IP allowlist            defence in depth
  │  WebhookLog              evidence first, matched or not
  ▼
MotionPayQrisCallbackService
  │
  ├─► MotionPay (HTTPS)   getQrisStatus    ◄── the authenticated re-read.
  │                                            The callback body is a trigger,
  │                                            never a source of truth
  ├─► apps/config (TCP)   calculateFee     only once payment is confirmed
  │
  └─► DATABASE            settle           status, paidAt, netNominal,
                                            feeDetails, metadata merge
```

Failures leave via `MerchantExceptionFilter`, which catches `MerchantException` **and its subclasses** — so `TransactionException` renders through the same filter with no extra registration.

---

## 3. What is built: Purchase QRIS

### Files

| File | Role |
|---|---|
| `apps/transaction/src/api-v1/purchase/purchase.controller.ts` | Route, body pipe, success code |
| `apps/transaction/src/api-v1/purchase/purchase.dto.ts` | Request schema, `data` payload schema, envelope schema |
| `apps/transaction/src/api-v1/purchase/purchase.service.ts` | The flow |
| `apps/transaction/src/api-v1/purchase/purchase.module.ts` | Wiring |
| `apps/transaction/src/api-v1/signature/merchant-body.pipe.ts` | Validation that speaks the SNAP envelope |
| `libs/microservice/src/transaction.exception.ts` | Business failures for transaction endpoints |
| `libs/microservice/src/transaction.enum.ts` | The failure list |
| `libs/upstream/src/upstream.dto.ts` | Provider-neutral purchase request/response |
| `apps/transaction/src/upstream/motionpay/motionpay-qris.service.ts` | MotionPay's wire format |

### The endpoint

```
POST /v1/qr/qr-mpm-generate
```

```jsonc
// request
{
  "amount": { "value": "10000.00", "currency": "IDR" },
  "merchantReference": "ORDER-0001",   // your own order id, unique per merchant
  "expireSeconds": 600                  // floored to whole minutes downstream
}
```

```jsonc
// 200
{
  "responseCode": "2009000",
  "responseMessage": "Successful",
  "serverTime": "2026-09-01T08:21:05.503Z",
  "data": {
    "transactionId": "1772001455392PQRMTNPY-27-a1b2",   // our systemReference
    "merchantReference": "ORDER-0001",
    "status": "PENDING",
    "qr": {
      "qrString": "00020101021226…",
      "expiresAt": "2026-09-01T08:31:05.503Z"
    }
  }
}
```

### The one design decision that matters

**The database row is written *before* MotionPay is called, and updated after.**

The obvious ordering — call the provider, then record what came back — has a failure mode that costs real money:

> The QR is created upstream. The insert then fails (duplicate reference, DB blip, pod restart). A customer scans and pays a QR **we have no record of**. Nothing reconciles it. Nobody is billed correctly.

Writing first inverts the failure. The worst case becomes a `PENDING` row with no QR: visible, queryable, harmless, and resolvable by reconciliation. **We would rather explain a transaction that does not exist than lose one that does.**

It also makes idempotency free. `@@unique([merchantId, merchantReference])` is claimed by the insert itself, so a merchant retrying the same reference is rejected atomically. A read-then-write check would let two concurrent retries both pass and both create a QR upstream.

This is why `PurchaseTransaction.providerReference` and `expiresAt` are **nullable** — we genuinely do not have them at insert time, and a placeholder would be a value someone later has to tell apart from a real one. Migration `20260901081731_purchase_reserve_before_upstream`.

**Apply this same ordering to every phase below.** It is the single most important pattern in this document.

### Why not wrap the whole thing in `prisma.$transaction`?

The natural objection, and worth answering properly because the reasoning generalises:

> Put everything in one interactive transaction. Call the upstream first — if it fails, nothing is inserted and there is no orphaned record. If it succeeds, insert the purchase and its fee cuts. Atomic.

It does not work, and the reason it does not work is the same reason the ordering above exists.

**Rollback cannot un-create a QR.** `$transaction` gives ACID over *rows in our database*. MotionPay is not enrolled in it. A rollback undoes our `INSERT`; it does nothing whatsoever to their QR. So if the upstream call succeeds and the insert then fails — duplicate reference, DB blip, pod restart — we are exactly back to a payable QR with no record. The transaction boundary gives the *feeling* of all-or-nothing while the one side effect that costs money sits outside the guarantee.

Three further problems, all operational:

**It holds a database connection open across a vendor's network call.** At N concurrent purchases we occupy N connections for the whole of MotionPay's latency. When MotionPay slows down our pool drains, and then *every* feature that touches the database stalls — not just purchases. A vendor's bad afternoon becomes our outage.

**Prisma aborts at 5 seconds regardless.** Verified against our own database:

```
ABORTED after 6300 ms
code: P2028
"A query cannot be executed on an expired transaction. The timeout for this
 transaction was 5000 ms, however 6061 ms passed since the start"
```

So a slow MotionPay produces the orphaned QR *and* a rolled-back transaction. Raising `timeout` to survive it only makes the connection-pool problem worse.

**Postgres holds locks for the transaction's lifetime**, which blocks VACUUM and bloats the table. Minor beside the rest, but it is why "just make the transaction longer" is never the answer.

> **The rule:** an irreversible external side effect can never sit inside a transaction boundary. Commit the reversible thing first, then do the irreversible one.

### What reserve-first actually buys — and what it does not

It does **not** eliminate orphans. It inverts which kind we can produce:

| Ordering | Orphan it can produce | Cost |
|---|---|---|
| Call upstream first | Payable QR, no record | Money we cannot reconcile |
| **Reserve first** | Record, no QR | A `PENDING` row that expires harmlessly |

That is the entire trade. We are not making failure impossible; we are choosing which failure we are prepared to explain.

One residual case remains by design: the upstream call succeeds, then `recordUpstreamResult` fails. We have the row — so we know the transaction exists — but no `providerReference`. That method logs loudly and deliberately **does not throw**: telling the merchant it failed would make them retry and create a second QR for one order. Reconciliation repairs it, because `external_id` is our own reference on the provider's side.

### Where atomicity *is* correct

The instinct behind the `$transaction` idea is right — it is only the scope that is wrong. "These must land together" genuinely applies to the **purchase row and its fee detail**: a purchase with no fee breakdown cannot be settled. That is already atomic:

```ts
feeDetails: { create: this.feeDetails(fee) },
```

Prisma runs a nested create as a single transaction. So we get atomicity exactly where it is achievable — across rows in our own database — and nowhere it is not.

### Error handling contract

`TransactionException` extends `MerchantException`, so the existing `@Catch(MerchantException)` filter renders it — Nest selects filters with `instanceof`. Service code `90`, the range reserved for manapay business services (SNAP's own registry uses 01–81, so ours cannot be confused with it).

| Situation | Code | HTTP | Why |
|---|---|---|---|
| Body fails schema | `4009001` | 400 | Field named in the message |
| Required field absent | `4009002` | 400 | Different mistake from the above, so a different code |
| No fee config for merchant + QRIS | `4039000` | 403 | Credentials are fine — this is our onboarding gap. A 401 would send them to debug working signing code |
| `merchantReference` reused | `4099000` | 409 | Usually a retry of a request that **already succeeded** |
| Provider answered and refused | `5029000` | 502 | Their rejection text is logged, not forwarded |
| Provider did not answer | `5049000` | 504 | **The dangerous one — see below** |
| Our dependency unreachable | `5039000` | 503 | Request was not processed |
| Our bug | `5009000` | 500 | Never describes anything the merchant did |

**On the timeout.** A `504` is the only code where we do not know what happened — the QR may exist and only the reply was lost. The transaction is deliberately left `PENDING`, never `FAILED`: marking it failed asserts something unknowable, and a customer paying a QR we called failed is the worst outcome available. The merchant is told to query before retrying.

---

## 4. Discoveries — what was wrong and why it mattered

Recorded because several of these are patterns that will recur in phases 2 and 3.

### 4.1 Fixed in the purchase flow

| Finding | Effect | Fix |
|---|---|---|
| **`merchantReference` was globally `@unique`** | The first merchant to use `ORDER-001` would permanently block every other merchant from that string | `@@unique([merchantId, merchantReference])` |
| **`session_time = expireSeconds % 60`** | Modulo, not divide. The 600s minimum became `session_time: 0` — every QR requested zero minutes of validity | `Math.floor(/ 60)` |
| **`expiresAt: new Date().toISOString()`** | A TODO that returned *now*, so every QR looked already expired | Derived from the floored minutes, before the request goes out |
| **`AjvPipe(CreateQrisResponseSchema)`** on the body | Validated the request against the **response** schema | `MerchantBodyPipe(CreateQrisRequestSchema)` |
| **`AjvPipe` throws `BadRequestException`** | Not caught by `MerchantExceptionFilter`, so a malformed body answered in Nest's default shape while every other failure on the same route spoke SNAP | `MerchantBodyPipe` throws `TransactionException` |
| **`.slice(0, 16)` on `external_id`** | Silent truncation. That value is how callbacks and next-day reconciliation find the transaction — truncated, it does not fail, it stops matching | Uses the existing `assertExternalIdLength`, which fails loudly |
| **`toWholeRupiah` / `assertExternalIdLength` written but unused** | The guards existed and were bypassed | Both now on the call path |
| **`assertUpstreamSchema` signature reorder** | Applied to one call site out of six; the transaction app did not compile | All six migrated |

### 4.3 Timestamps: trust the measurement, not the document

The v2.7 spec states that MotionPay's timestamps are WIB despite the `+00:00` they print, and that no conversion is needed. Taken at face value that means `"2026-09-02T09:16:26+00:00"` is 09:16 Jakarta, i.e. `02:16Z`.

**Measuring it says otherwise.** Three creates, comparing `created_date` against our own clock at the instant of the request: sub-second skew when the offset is trusted, exactly `-7.0h` when treated as WIB. The offset is truthful; the note is wrong.

The lesson is not "the spec lies" — it is that **a claim about timezone semantics is checkable, and on money data it should be checked before it is coded against.** A seven-hour error here fails silently: every value still looks like a plausible timestamp, and it would only surface as a reconciliation that will not balance.

Two things came out of it:

- `parseMotionPayTimestamp` takes a **mode**. Default `offset` (measured), with `wib` kept because production may yet match the document.
- `assertTimestampMode` re-checks on **every create**, where `created_date` describes a transaction we just made and our own clock is ground truth. If MotionPay switches behaviour, a log line says so that day.

I initially implemented the WIB correction on the strength of the spec alone. That would have introduced the exact seven-hour error it was meant to prevent. Probing first would have been cheaper than probing second.

### 4.2 Patterns worth carrying forward

- **A helper that exists but is not called is worse than no helper** — it reads as protection that is not there. Two of the above were exactly this.
- **Silent truncation is the worst failure mode in a payment system.** It does not error; it produces a value that stops matching weeks later during reconciliation, when nobody remembers why.
- **Validate the request against the request schema.** Obvious written down, invisible in a diff.
- **Every error path on a merchant route must produce the same envelope.** One route answering in two shapes is precisely what the envelope exists to prevent.
- **A provider's stated timezone offset is a claim, not a fact — and a checkable one.** Measure before coding against it, then keep measuring. §4.3.
- **An unauthenticated inbound webhook is a trigger, not data.** Re-read the truth over a channel you control. §10.

---

## 5. Open decisions — yours to make

Ordered by how much they block.

### D1 — MotionPay's real `external_id` limit 🟡

Documented as String(16). Our `systemReference` is far longer, and MotionPay's **own samples exceed 16** (`"20c67336-dcea-42d8-a"` is 20).

Currently: we send `merchantReference` and **fail loudly** above 16 rather than truncating. That means a merchant sending a UUID reference gets a `502` — a poor experience for what is really an input problem.

Three options once MotionPay answers:

| If the limit is | Do this |
|---|---|
| Really 16 | Cap `merchantReference` at 16 in the request schema, so merchants get a clean `4009001` instead of a `502`. Or generate a short provider-side reference and map it back — more code, but frees merchants to use any reference |
| Higher | Raise `MOTIONPAY_EXTERNAL_ID_MAX_LENGTH` — that one constant drives both the request schema and the assertion |
| Unbounded | Same, set generously |

**Do not leave it as-is.** The current state is correct but the error is misattributed.

### D2 — `DisbursementTransaction.merchantReference` has the same global-unique bug 🟡

Not fixed, because phase 2 has not started. **Fix it in the phase 2 schema migration**, not before — one migration rather than two.

### D3 — Merchant-facing base path 🟢

The purchase route is `v1/qr/qr-mpm-generate`; the test route is `/open/v1/test`. Inconsistent leading slash and no shared prefix. `setGlobalPrefix` is commented out in `main.ts` because the signature canonical must match the path the merchant signed.

Decide the public shape now, before merchants integrate — changing it later breaks every signature. Suggested: `/open/v1/<product>/<action>`.

### D4 — Should `EXPIRED` be derived? 🟢

MotionPay has no `EXPIRED` status; ours does. A QR past `expiresAt` will presumably sit `PENDING` forever. Either a scheduled job flips them, or the status endpoint derives it on read. Decide when phase 4 lands.

---

## 6. 🔴 What to ask MotionPay

**This is the list for your conversation.** Both phases are blocked here, not on our code.

### 6.1 QRIS — create-payment returns `400` for everything

Verified 13 Aug 2026, merchant **ANDAPAY** (`merchant_id` 59240, `merchant_uuid` 00059102). Full probe table in [upstream/motionpay.md §7](upstream/motionpay.md).

The conclusive result: a **valid body, an empty body `{}`, and a non-JSON body `zzz` all return byte-identical `400 "Invalid request data"`.** A validation error that does not vary with the body is not validation — the body is never evaluated.

Token issuance works. `payment-status` with a bad id returns that endpoint's own distinct error, proving the token is accepted. Path variants return `404`, proving our path is the only one that exists.

**Ask:**
1. Is merchant `59240` / `00059102` **PTEN-registered and enabled for QRIS dynamic payment in sandbox**? Their docs say twice that this endpoint is only available to PTEN-switch merchants, and that `qr_string` is only generated for PTEN merchants. A merchant-entitlement rejection surfacing as a generic `400` fits every observation.
2. If not PTEN — what is the enrolment process and the lead time?
3. Is there a sandbox merchant that *is* provisioned, so we can validate the integration meanwhile?

Send them the probe table. Nothing in our code changes until they answer.

### 6.2 Transfer — our IP is not whitelisted

Confirmed by probe. Nothing on the payout side can be tested until Flash whitelists us.

**Ask:** whitelist **both** the workstation IP and the K3s node's egress IP. Get the production egress IP whitelisted at the same time — it will be needed and the lead time is the same.

### 6.3 The callback contract — ✅ received, two things still needed

Answered by QRIS Service v2.7. The handler is built (§10). Two asks remain:

1. **Your egress IP ranges**, so `MOTIONPAY_CALLBACK_ALLOWED_IPS` can be set. The callback has no signature, so this is its only transport-level authentication. Until it is set the endpoint accepts any origin.
2. **Confirm there is genuinely no signature option** — not a header we missed, not something available on request. Their spec advises validating `transaction_id` against our own records, which does not authenticate anything: that value is not secret, and a forged `SUCCESS` credits a merchant balance. We have mitigated by re-reading the authoritative status over an authenticated call, but a signature would be better and is worth asking for directly.

### 6.4 Smaller confirmations

| Question | Why it matters |
|---|---|
| ~~Real `external_id` max length~~ | **Answered: 21.** Constant updated. Still shorter than a UUID, so D1 stands |
| ~~Does an expired QR report `FAILED`?~~ | **Answered: `FAILED` with `description: "Order expired"`.** Handled |
| Timestamp semantics | **The spec says WIB-despite-the-offset; the sandbox says the offset is truthful.** We follow the measurement and check it on every create. Ask them to correct the doc or confirm production differs. §4.3 |
| Transfer: is `0002 / On Process` really the happy path for create? | Our client assumes yes. Treating only `0001` as success would fail almost every real payout |
| ~~`terminal_id` semantics~~ | **Fixed.** Now `MOTIONPAY_TERMINAL_ID`; it is embedded in the QR payload, so a per-transaction value was writing a different "terminal" into every QR |
| Per-sub-merchant `terminal_id`? | We send one aggregator-level value. If Flash can register a terminal per sub-merchant, their reporting could distinguish our merchants — worth asking |

---

## 7. Phase 2 — Disbursement TRANSFER_BANK

Payout to a bank account, funded from the Flash prepaid deposit.

### What already exists

`MotionPayTransferService` is written and typechecks. It has `accountInquiry`, `fundTransfer`, `checkTransferStatus`, `checkBalance`. **It has never made a successful call** — the IP blocker.

Transfer differs from QRIS in ways that will bite if assumed away:

| | QRIS | Transfer |
|---|---|---|
| Host | `app.` | `secure.` |
| Token endpoint | `/priv/v1/pg/token` | `/auth/v2/access-token` |
| `status.code` type | **number** (`0`) | **string** (`'0001'`) |
| `external_id` max | 16 | 50 |
| Amount bounds | 1 000 – 10 000 000 | 10 000 – 50 000 000 |
| Status lookup key | *their* `transaction_id` | **our** `external_id` |
| Happy path on create | `0` | **`0002` / On Process**, not `0001` |

E-wallets share the bank-code namespace, so "bank transfer" here can also be a wallet payout — which is why phase 3 is mostly configuration.

### Steps

**2.1 — Schema.** Mirror the purchase changes on `DisbursementTransaction`:

```prisma
merchantReference String            // drop the global @unique
providerReference String?  @unique  // nullable: unknown until the provider answers
paidAt            DateTime?
@@unique([merchantId, merchantReference])
```

Then `npm run prisma:migrate:dev:transaction`, `prisma:generate:transaction`, `prisma:merge:dashboard`, `prisma:generate:dashboard`.

> The dashboard merge is not optional. A stale merged schema turns a breaking change into a silent one — see D19 in [dashboard-migration.md](dashboard-migration.md) for what that cost last time.

**2.2 — Provider-neutral DTOs.** Add to `libs/upstream/src/upstream.dto.ts`:

```ts
DisbursementUpstreamRequestSchema   // systemReference, userId, providerName,
                                    // merchantReference, amount, bankCode,
                                    // accountNumber, accountHolderName?, note
DisbursementUpstreamResponseSchema  // providerReference, status, nominal,
                                    // message, metadata
```

Keep the business layer free of MotionPay's wire shape. Adding a second provider must mean writing a mapper, not touching the flow.

**2.3 — Request/response DTOs** in `apps/transaction/src/api-v1/disbursement/disbursement.dto.ts`. Follow the purchase split exactly: a request schema, a `data` schema, and an envelope schema for documentation. The handler returns **only** `data`.

**2.4 — Add the failure codes.** In `transaction.enum.ts` / `transaction.exception.ts`, add a `DISBURSEMENT: '91'` service code and the cases QRIS does not have:

| Case | Code | HTTP | Note |
|---|---|---|---|
| `INVALID_BENEFICIARY` | `4009102` | 400 | Account inquiry says the account does not exist |
| `INSUFFICIENT_BALANCE` | `4039101` | 403 | Our Flash deposit is short — **our** problem, not the merchant's, but they must know the payout will not happen |
| `UNSUPPORTED_BANK_CODE` | `4009103` | 400 | Not in MotionPay's list |

Reuse everything else. Add the rows to [merchant-api-response-codes.md](merchant-api-response-codes.md) in the same pass.

**2.5 — The service.** Same ordering as purchase, with one addition:

```
resolveProvider          merchant + TRANSFERBANK + DISBURSEMENT
calculateFee             feeCalculateClient.disbursement(...)
accountInquiry           ◄── NEW: validate the beneficiary BEFORE reserving
reserveTransaction       claims merchantReference, status PENDING
fundTransfer             the outbound call
recordUpstreamResult     providerReference, status
```

**Why inquiry comes first:** a payout to a wrong account number is not recoverable the way a failed pay-in is. Money leaves. Validating first costs one round trip and turns an unrecoverable loss into a `4009102`. `accountInquiry` returns `valid: false` rather than throwing — a wrong account is a normal business outcome, so check the flag, do not rely on absence of an exception.

**Do not skip the reserve step because inquiry already ran.** The unique index is still what makes concurrent retries safe.

**2.6 — Status is asynchronous.** Unlike QRIS, `fundTransfer` returning `0002 / On Process` is success-so-far, not settlement. The transaction stays `PENDING` until a callback or a status poll resolves it. Do not map `0002` to `SUCCESS`.

**2.7 — Controller + module**, mirroring purchase. `@MerchantSuccessCode(MERCHANT_SERVICE_CODE.DISBURSEMENT)`.

**2.8 — Verify**: four apps typecheck, tests, eslint, prettier. Then the doc rows.

### Checklist

- [ ] 2.1 Schema + migration + all four regenerations
- [ ] 2.2 Provider-neutral disbursement DTOs
- [ ] 2.3 API request/response DTOs
- [ ] 2.4 Service code `91` + failure cases + response-code doc
- [ ] 2.5 `DisbursementService` — inquiry → fee → reserve → transfer → record
- [ ] 2.6 Confirm `0002` handling with MotionPay (§6.4)
- [ ] 2.7 Controller + module
- [ ] 2.8 Verification pass

---

## 8. Phase 3 — Disbursement EWALLET

**Mostly configuration, not new code.** E-wallets go through the same `fundTransfer` endpoint with a wallet code in the `recipient_bank` field.

What actually differs:

- **`paymentMethodName` is `TRANSFEREWALLET`**, which changes the fee lookup — a different `BaseFee` row, so a different provider/internal/agent split.
- **Account inquiry may not be supported** for wallets. Confirm with MotionPay (add to §6.4). If it is not, the beneficiary-validation step in 2.5 has to be skipped for wallets — and that is a real risk increase worth flagging to the business, not a code detail.
- **The bank-code list is shared.** Unknown codes are warned about, not rejected, deliberately: the list is a snapshot and MotionPay adding a wallet should not become our outage.

### Steps

- [ ] 3.1 Confirm with MotionPay whether inquiry works for wallet codes
- [ ] 3.2 Seed the `BaseFee` rows for `TRANSFEREWALLET` + `DISBURSEMENT`
- [ ] 3.3 Branch on `paymentMethodName` in the disbursement service — the routing lookup already takes it
- [ ] 3.4 If inquiry is unsupported, make the skip explicit and commented, not implicit
- [ ] 3.5 Verification pass

---

## 9. Phase 4 — Status query

Merchants need to ask "what happened to this transaction?" — and after a `5049000` timeout, they are explicitly told to.

- [ ] 4.1 `POST /v1/qr/qr-mpm-query` (or GET by `merchantReference`)
- [ ] 4.2 Read our row first. Only poll the provider when we are `PENDING` and the row is older than some threshold — polling on every query hands merchants a way to generate provider load for us
- [ ] 4.3 Rate-limit separately from create. The per-endpoint key already supports this, so a merchant polling hard cannot exhaust the budget they need for payments
- [ ] 4.4 Decide the `EXPIRED` derivation (D4)

---

## 10. Phase 5 — Provider callbacks ✅ built

Contract received 2026-09-01 (QRIS Service v2.7). Full wire details in [upstream/motionpay.md §6.5](upstream/motionpay.md).

### The security problem, and what we do about it

MotionPay publishes **no callback signature**. Their spec says so, and recommends validating `transaction_id` against your own database instead — which is not a control. A `transaction_id` is not secret, and a forged `SUCCESS` credits a merchant balance.

**So the callback body is never trusted.** It is a trigger, not data:

1. **Record it** to `WebhookLog` — whatever it says, matched or not. An unmatched callback is the single most interesting one to keep.
2. **Find our transaction** by `transaction_id`.
3. **Ask MotionPay ourselves** with an authenticated Get Payment Status call.
4. **Act on that answer only.**

One extra GET per callback converts an unauthenticated push into an authenticated pull. `MOTIONPAY_CALLBACK_ALLOWED_IPS` sits in front as defence in depth — **currently empty, which means unrestricted**, and the handler logs a warning on every request until Flash give us their egress ranges.

### Behaviour

| Situation | HTTP | Why |
|---|---|---|
| Settled successfully | 200 | Done |
| Origin not in the allowlist | **200** | Not an acknowledgement — a refusal to let a spoofer schedule three more rounds of work with one request |
| Unknown transaction | 200 | We will not know that id in five minutes either |
| Already terminal | 200 | Idempotency; a retry must not re-run fees or move a balance twice |
| Malformed payload | 200 | Their retry sends the same bad body three more times |
| Could not reach MotionPay to confirm | **500** | Exactly what their retry schedule exists for |

MotionPay retries a non-200 **3 times at 5-minute intervals**, then drops it permanently. So the 200/500 choice is the whole protocol: ask for a retry only when retrying could help. Anything lost after that window is the settlement sweep's problem, which is why polling is required rather than optional.

### Fees are calculated here, not at creation

Deliberate, and a change from the original design. A QR that expires never earns anything, so computing at creation writes fee rows for transactions that will never settle. `netNominal` stays at its `0.00` default while the row is PENDING — unambiguous, since a pending purchase has by definition earned nothing.

The trade: a fee-service outage during a callback leaves a paid transaction with no breakdown. The handler therefore **still moves the row to SUCCESS** and logs the gap loudly rather than failing — refusing to record a payment because the fee service is down is strictly worse. Batch settlement re-derives what is missing.

### `metadata` accumulates, it does not overwrite

One JSON object keyed by event:

```jsonc
{
  "CREATE_QRIS":   { /* what MotionPay returned when the QR was made */ },
  "CALLBACK_QRIS": { /* the raw notification, including customer_pan */ },
  "STATUS_QRIS":   { /* the authenticated re-read we actually acted on */ }
}
```

A disputed payment is argued from all three. The callback arriving must never erase what we sent to create the QR, so the update merges rather than assigns. `CREATE_QRIS_ERROR` records why a create attempt failed, so a FAILED row explains itself.

### EXPIRED

MotionPay has no expired status — expiry arrives as `FAILED` with `description: "Order expired"`. `mapMotionPayStatus` requires **both** signals before mapping to our `EXPIRED`: the wording, *and* the expiry instant having passed with no `paid_date`. Prose alone is too fragile to key a money decision on. This closes D4.

### Files

| File | Role |
|---|---|
| `apps/transaction/src/callback/motionpay-qris.callback.controller.ts` | Route, payload check, 200/500 decision |
| `apps/transaction/src/callback/motionpay-qris.callback.service.ts` | Verify-by-pull, idempotency, settlement |
| `apps/transaction/src/upstream/motionpay/motionpay.helper.ts` | WIB parsing, status mapping, metadata keys |
| `apps/transaction/src/upstream/motionpay/motionpay.helper.spec.ts` | 13 tests, incl. the seven-hour assertion |

### Still open

- [ ] **Register the callback URL** at Flash: Product Configuration → QRIS. Path is `POST /callback/motionpay/qris`
- [ ] **Get Flash's egress IPs** and set `MOTIONPAY_CALLBACK_ALLOWED_IPS`. Until then the endpoint accepts any origin
- [ ] **Balance ledger** — marked `TODO(balance-ledger)` in the settle path. Blocked on D17; money is not moved by this handler yet
- [ ] **Settlement sweep** — the batch job that resolves anything the callback never delivered, and backfills fees where the fee service was down

---

## 11. Phase 6 — Merchant webhooks

We call the merchant when their transaction settles. `MerchantSignature.payinUrl` / `payoutUrl` already exist, and step 13 of [merchant-signature-implementation.md](merchant-signature-implementation.md) covers the design — held, not cancelled.

- [ ] 6.1 Sign our outbound webhook with the merchant's secret, same canonical scheme as inbound. They must be able to verify us as we verify them
- [ ] 6.2 Retry with backoff; cap attempts; record every one
- [ ] 6.3 A merchant's endpoint being down must not block our settlement path — queue, do not call inline
- [ ] 6.4 Give merchants a replay endpoint so a missed webhook is self-service

---

## 12. Adding a second provider

`ProviderNameEnum` already reserves INACASH, PDNT1, ZIPAY, PAKAIDONK. When one lands:

1. Write a `<provider>-<product>.service.ts` that maps to and from the **provider-neutral DTOs** in `libs/upstream/src/upstream.dto.ts`. Nothing else should change.
2. Add a `case` to the service's `callProvider` switch. The `default` branch already throws `internalError()` and logs — routing to a provider with no client is our configuration bug, not the merchant's.
3. Seed `BaseFee` rows for the new provider. `@@unique([providerName, paymentMethodName, transactionType])` means one row per combination.
4. **Close the `MerchantFee` uniqueness gap first — see below.**

### The gap the second provider makes real

`ProfileProviderService.findProfileProvider` resolves a merchant's route with:

```ts
findFirstOrThrow({ merchantId, transactionType, paymentMethodName, ... })
```

`BaseFee` now has `@@unique([providerName, paymentMethodName, transactionType])`, so that triple identifies **one BaseFee per provider**. But nothing constrains how many `MerchantFee` rows a merchant has. A merchant configured with `MOTIONPAY_QRIS_PURCHASE` *and* `INACASH_QRIS_PURCHASE` matches two rows, and `findFirst` with no `orderBy` returns whichever Postgres hands back first — which can change after a VACUUM or a plan flip.

Today this cannot bite: there is one real provider. **The day a second one is onboarded it becomes a live non-determinism in payment routing**, and the 6-hour profile cache freezes whichever row it happened to get.

Two ways to close it, and the choice is a business decision:

| If two providers for one method+type is... | Then |
|---|---|
| a **configuration error** | Add `@@unique([merchantId, transactionType, paymentMethodName])` to `MerchantFee`. Needs a composite FK to express, since those two columns live on `BaseFee` — carry them on `MerchantFee` and make the FK reference them, so Postgres itself guarantees they match |
| deliberate **provider failover** | Add `priority Int` and `orderBy: { priority: 'asc' }, take: 1` |

Constrain now either way: adding a unique constraint later means finding and resolving every duplicate in live data first, and duplicates accumulate silently because nothing complains. Dropping one later is a one-line migration.

---

## 13. Standing rules

Things that apply to every phase, learned the expensive way.

1. **Reserve before you call.** Database row first, provider second, update third. An irreversible external side effect can never sit inside a transaction boundary - `$transaction` will not save you, because rollback cannot un-create a QR. §3.
2. **Never truncate an identifier.** Fail loudly. A truncated reference does not error — it stops matching, weeks later.
3. **A timeout is not a failure.** Leave it `PENDING`. Asserting `FAILED` on something unknowable is how a paid transaction gets written off.
4. **Validate the beneficiary before money moves.** Pay-in mistakes are recoverable; payout mistakes are not.
5. **One envelope, every path.** If a route can answer in two shapes, the envelope has already failed.
6. **Provider vocabulary never reaches a merchant.** Log their rejection text, return ours. Merchants must not end up parsing strings we do not control.
7. **Regenerate the dashboard schema after every transaction/config schema change.** `prisma:merge:dashboard && prisma:generate:dashboard`. A stale merge turns a breaking change silent.
8. **Fees are calculated at settlement, not at creation.** A QR that expires never earns anything. The cost is that a fee-service outage leaves a paid transaction without its breakdown - so record the payment anyway and let the settlement sweep backfill. Never refuse to record money that moved.
9. **Never trust an unauthenticated callback body.** Log it, then re-read the truth over an authenticated channel. §10.
10. **Measure provider timezone behaviour, do not read it.** Documentation about offsets has been wrong here; a create response plus your own clock settles it in seconds, and a standing check catches the day it changes. §4.3.

---

## 14. Immediate next actions

**You, with MotionPay** (nothing proceeds without these):

1. §6.1 — PTEN registration for merchant 59240. Send the probe table.
2. §6.2 — IP whitelisting, workstation + K3s egress + production egress.
3. §6.3 — their **egress IP ranges** for the callback allowlist, and confirmation that no signature option exists.
4. §6.4 — the four smaller confirmations.

**You, in code** (not blocked, do while waiting):

5. D3 — settle the public URL shape before any merchant integrates.
6. Phase 2 steps 2.1-2.5. The transfer client is written; the API layer around it is not, and none of that work needs MotionPay to answer.
7. ~~Fix `terminal_id` and re-probe the create-payment 400~~ — **done 2026-09-02. Both resolved; QRIS create and status verified end-to-end.**
8. Register `POST /callback/motionpay/qris` on the Flash dashboard, then pay a sandbox QR to exercise the callback for real.
9. Ask MotionPay to correct §Important Notes on timestamps, or confirm production differs from sandbox (§6.4).

**When their docs arrive**, hand them over — the deltas land in [upstream/motionpay.md](upstream/motionpay.md), and anything that changes the merchant contract lands here and in [merchant-api-response-codes.md](merchant-api-response-codes.md).
