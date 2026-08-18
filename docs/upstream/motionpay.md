# MotionPay (Flash Mobile) — QRIS & Transfer Upstream

Sources, both extracted from the live OpenAPI documents behind the docs site (Stoplight Elements), so the field tables below are the specs' own rather than a transcription of rendered HTML:

- <https://api-doc.flashmobile.id/qris#/> — "QRIS Service 2.6" (extracted 12 Aug 2026)
- <https://api-doc.flashmobile.id/transfer#/> — "Transfer Service 2.6" (extracted 13 Aug 2026)

**Scope of this document and of the code in [apps/transaction/src/upstream/motionpay](../../apps/transaction/src/upstream/motionpay):**

- **QRIS pay-in** — Authentication, Create QRIS Payment, Get QRIS Status. **Working in sandbox.**
- **Transfer payout** — Authentication, Account Inquiry, Fund Transfer, Check Transfer Status, Check Balance, plus the callback payload shape. **Implemented, not yet exercised against sandbox.**

The inbound webhook *receivers* for both products are still out of scope — see §14.

> **⚠️ QRIS and Transfer are two different products that share only a brand.** Different host, different token endpoint, different response envelope, different status vocabulary, possibly different credentials. Sections 1–10 cover QRIS; §11 onward covers Transfer. Do not assume anything carries across — the table in §11.1 lists every difference.

---

## 1. Overview

Flash Mobile, **in collaboration with MotionPay**, exposes a QRIS API to merchants acquired by Flash. Worth being precise about the naming, because it shows up inconsistently across the integration:

- The **API host and docs** are Flash Mobile (`flashmobile.id`), and transaction IDs are prefixed `FM-`.
- **MotionPay** is the acquirer/switch underneath — it appears as `acquirer_name: "MOTIONPAY"` in responses and as `ID.MOTIONPAY.WWW` inside the QRIS payload itself.

So in our system the provider is registered as `MOTIONPAY`, but every URL, credential, and support contact is Flash Mobile's.

REST, JSON request/response bodies, standard verbs. There is a Krakend API gateway in front (visible as `X-Krakend` response headers), which matters for error handling — see §6.

### Service list (per the docs)

| Service | Status here |
|---|---|
| Generate Authentication | **Implemented** |
| Create QR Payment — Dynamic | **Implemented** |
| Get Payment Status | **Implemented** |
| Callback Format | Listed in the docs, but **no callback endpoint or payload schema is defined anywhere in the spec.** Not implemented. See §7. |

### Environments

The spec's `servers` block and the docs site's own `config.js`:

| Environment | Base URL |
|---|---|
| Sandbox | `https://sandbox-app.flashmobile.id` |
| Production | `https://app.flashmobile.id` |

> **✅ Resolved 13 Aug 2026 — use `.id`.** The prose section of the same document gives `.co.id` (and so does its cURL sample), contradicting the `servers` block. Tested directly: **`sandbox-app.flashmobile.co.id` does not resolve at all** (DNS failure), while `sandbox-app.flashmobile.id` authenticates successfully. The `.co.id` references in the docs are wrong — ignore them.

The base URL is still read from `MOTIONPAY_BASE_URL` rather than hardcoded, so production can be pointed without a code change.

There are also `SECURE_SANDBOX` / `SECURE_LIVE` hosts (`sandbox-secure.flashmobile.id` / `secure.flashmobile.id`) in the site config. No QRIS endpoint in this spec uses them; ignore unless told otherwise.

---

## 2. Authentication

`POST {baseUrl}/priv/v1/pg/token`

Credentials come from the Flash merchant dashboard: a **Client Key** and a **Secret Key**. Sandbox and production have separate key pairs.

### Request body

| Field | Required | Type | Description |
|---|---|---|---|
| `client_key` | Required | String | Client ID from the merchant dashboard |
| `server_key` | Required | String | Secret Key from the merchant dashboard |

```json
{
  "client_key": "<client_credential_key>",
  "server_key": "<server_credential_key>"
}
```

### Response

| Field | Type | Description |
|---|---|---|
| `token` | String | OAuth 2.0 bearer token for all subsequent QRIS calls |

```json
{
  "status": { "code": 200, "message": "Token received." },
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MDI0NjQ1OTcsIm1lcmNoYW50X2lkIjoiMzciLCJtZXJjaGFudF9uYW1lIjoiRkxBU0ggTU9CSUxFIiwibWVyY2hhbnRfdXVpZCI6IjAwMDAwMDExIn0.…"
  },
  "meta": {}
}
```

Note this endpoint's success code is **`200`**, unlike the payment endpoints which use **`0`** (§6).

### Token lifetime — and how we handle it

> **The document contradicts itself — and the answer is 7 days.** The endpoint description says **30 days**; the response field table says **7 days**; the doc's own Notes flag the discrepancy. Measured against the sandbox on 13 Aug 2026: a token issued that day carried `exp` = 2026-08-20, i.e. **exactly 7 days**. The "30 days" claim is wrong.

The client does not rely on that measurement. **The token is a JWT** — its payload carries an `exp` claim (visible decoded in the sample above), so the client decodes `exp` and caches until then, minus a safety margin. That stays correct if MotionPay changes the TTL later.

The client also de-duplicates concurrent token fetches (a single in-flight promise is shared) so a burst of purchases at cold start issues one token request, not N.

Per the docs, a merchant only needs one token per session/until expiry — it is not per-transaction.

---

## 3. Create QRIS Payment (dynamic)

`POST {baseUrl}/payment/api/v1/qris/payment`

### Headers

| Header | Required | Value |
|---|---|---|
| `Content-Type` | Required | `application/json` |
| `Authorization` | Required | `Bearer ` + token from §2 |

### Request body

| Field | Required | Type | Description |
|---|---|---|---|
| `terminal_id` | Required | String(16) | Terminal ID — docs say "usually same as `external_id`" |
| `external_id` | Required | String(16) | Unique transaction ID from the merchant |
| `amount` | Required | Integer | Min **1,000**, max **10,000,000** |
| `description` | Optional | String | Free-text transaction description |
| `session_time` | Required | Integer | QR expiry in **minutes**, minimum 1 |
| `fullname` | Required | String | Customer name — may be an empty string |
| `email` | Required | String | Customer email — may be an empty string |
| `phone_number` | Required | String | Customer phone — may be an empty string |

```json
{
  "terminal_id": "PRODUCT-01",
  "external_id": "2023-02",
  "amount": 1000,
  "description": "Description of transaction",
  "session_time": 3,
  "fullname": "John Doe",
  "email": "email@email.com",
  "phone_number": "081510076749"
}
```

`fullname` / `email` / `phone_number` are marked Required but explicitly allowed to be empty strings — i.e. the key must be present, the value need not be meaningful. Our schema requires the key and permits `""`.

### Response

| Field | Type | Description |
|---|---|---|
| `transaction_id` | String | Flash transaction identifier (`FM-…`) — the handle for status lookups |
| `external_id` | String | Echo of the request `external_id` |
| `amount` | Integer | Transaction amount |
| `qr_string` | String | QRIS payload to render as a QR image — **only generated if the merchant is registered in the PTEN switch** |
| `type` | String | `QRIS_DYNAMIC` |
| `status` | String | `PENDING` \| `SUCCESS` \| `FAILED` |
| `description` | String | Human-readable status description, e.g. `"Waiting for Payment"` |
| `created_date` | String | Creation timestamp |
| `session_time` | Integer | Echo of expiry minutes |

```json
{
  "status": { "code": 0, "message": "Transaction Successfully Created." },
  "data": {
    "transaction_id": "FM-6b8eb98488dc52e299d53479384",
    "external_id": "20c67336-dcea-42d8-a",
    "amount": 1100,
    "qr_string": "00020101021226590016ID.MOTIONPAY.WWW0116936008160000060802080000014603…",
    "type": "QRIS_DYNAMIC",
    "status": "PENDING",
    "description": "Waiting for Payment",
    "created_date": "2025-03-25T05:09:05+00:00",
    "session_time": 10
  },
  "meta": {}
}
```

The docs' response table also lists `email`, `phone_number`, and `full_name`, but **neither sample response actually returns them.** Treat them as optional.

---

## 4. Get QRIS Status

`GET {baseUrl}/payment/api/v1/qris/payment-status/{transaction_id}`

`{transaction_id}` is the `FM-…` value from §3 — **not** our `external_id`. There is no documented lookup-by-`external_id`, so the Flash transaction ID must be persisted when the payment is created.

### Headers

| Header | Required | Value |
|---|---|---|
| `Authorization` | Required | `Bearer {access_token}` |

### Response

| Field | Type | Description |
|---|---|---|
| `transaction_id` | String | Flash transaction identifier |
| `external_id` | String | Merchant transaction ID |
| `amount` | Integer | Transaction amount |
| `qr_string` | String | QR payload |
| `type` | String | `QRIS_DYNAMIC` \| `QRIS_STATIC` |
| `status` | String | `PENDING` \| `SUCCESS` \| `FAILED` |
| `description` | String | Status description |
| `created_date` | String | Creation time |
| `updated_date` | String | Last update time |
| `expired_date` | String | Expiry time |
| `paid_date` | String | Payment time |
| `channel` | String | `QRIS` |
| `customer_pan` | String | Customer PAN |
| `merchant_pan` | String | Merchant PAN |
| `rrn` | String | Retrieval Reference Number — **only populated when `SUCCESS`** |
| `from_info` | String | Issuer identifier / company name |
| `acquirer_name` | String | Acquirer name (`MOTIONPAY`) |
| `order_id` | String | Acquirer-side transaction identifier |

```json
{
  "status": { "code": 0, "message": "Transaction Found." },
  "data": {
    "transaction_id": "FM-6b8eb98488dc52e299d53479384",
    "external_id": "20c67336-dcea-42d8-a",
    "amount": 1100,
    "type": "QRIS_DYNAMIC",
    "status": "SUCCESS",
    "description": "Payment Received",
    "created_date": "2025-03-25T05:09:05+00:00",
    "updated_date": "2025-03-25T05:09:05+00:00",
    "expired_date": "2025-03-25T05:10:05+00:00",
    "paid_date": "2025-03-25T05:10:05+00:00",
    "channel": "QRIS",
    "customer_pan": "936008160030000162",
    "merchant_pan": "9360081600000608",
    "rrn": "56a852b0ca69",
    "from_info": "MOTIONPAY",
    "acquirer_name": "MOTIONPAY",
    "order_id": "20231206181219450108844"
  },
  "meta": null
}
```

Transaction not found:

```json
{
  "status": { "code": 400, "message": "Invalid transaction id value" },
  "data": null,
  "meta": null
}
```

> **⚠️ The "Required" column here is not trustworthy.** Every field is marked Required, but the spec's own `PENDING` example omits `paid_date` entirely and returns `""` for `customer_pan`, `merchant_pan`, `rrn`, `from_info`, and `acquirer_name`. Our schema therefore requires only the fields that are genuinely always present and treats the settlement-detail fields as optional. Validating them as required would reject every pending transaction.

`rrn` is the field to reconcile QRIS transactions on — it is the Retrieval Reference Number, the same key ASPI's QRIS MPM bulletin designates for merchant/customer reconciliation (see [snap-standardization.md §8](../snap-standardization.md)).

---

## 5. Response envelope

Every endpoint returns the same three-part envelope:

```json
{ "status": { "code": <int>, "message": "<string>" }, "data": <object|null>, "meta": <object|null> }
```

`meta` is `{}` in some samples and `null` in others, with no documented meaning — ignore it.

---

## 6. Status codes and error handling

| Code | Message | Meaning |
|---|---|---|
| `200` | Token received | Token issued successfully (**auth endpoint only**) |
| `0` | Transaction Successfully Created / Found | Success (**payment endpoints**) |
| `400` | Invalid Request Data | Malformed request, or transaction not found on status lookup |
| `401` | Unauthorized / Authentication Failed | Bad credentials or expired token |
| `422` | Failed Processing Data | QR string generation failed |

Two things that matter for implementation:

**Success is not one value.** The token endpoint signals success with `200`; the payment endpoints signal it with `0`. A shared "is this OK?" check across all three endpoints would be wrong. Our client checks per-endpoint.

**HTTP status is not the source of truth.** The failure example returns `status.code: 400` inside an **HTTP 200** body. With Krakend fronting the API, transport-level success says nothing about logical success. Our client always branches on the envelope's `status.code`, and treats a non-2xx HTTP status as a separate transport failure.

### Undefined response codes — documented business rule

The docs specify what to do with any code not in the table above, and it is a real business rule rather than a suggestion:

1. Record the transaction as **`Pending`**.
2. Leave it pending until the **daily reconciliation** run on the next business day.
3. Reconciliation yields the final status — `Success` or `Failed`.

So an unrecognized code must **not** be mapped to failure. Our status mapper returns `PENDING` for anything unrecognized, which is both the documented behavior and the safe direction for a payment system (never mark unpaid as paid, never mark paid as failed).

---

## 7. Open questions / integration risks

Ordered by how much they can hurt.

0. **🔴 BLOCKER — Create QRIS Payment returns `400 "Invalid request data"` for every payload, including MotionPay's own documented sample.** Verified against the sandbox on 13 Aug 2026 with merchant **ANDAPAY** (`merchant_id` 59240, `merchant_uuid` 00059102).

   What was tested and what it proves:

   | Probe | Result | What it rules out |
   |---|---|---|
   | `POST /priv/v1/pg/token` | ✅ token issued | Credentials and base URL are correct |
   | `GET payment-status/FM-doesnotexist` **with** token | `400 "Invalid transaction id value"` | The QRIS API is reachable, the path is right, **and our token is accepted** — it returns that endpoint's own distinct error |
   | `POST payment` with **no** token | `401 "Header Authorization is missing"` | The auth layer differentiates correctly |
   | `POST payment` with **garbage** token | `401 "Invalid token: …"` | Our real token is genuinely being validated, not ignored |
   | `POST payment`, documented sample body | `400 "Invalid request data"` | — |
   | `POST payment`, body `{}` | `400 "Invalid request data"` | — |
   | `POST payment`, body `zzz` (**not even JSON**) | `400 "Invalid request data"` | **Conclusive: the body is never evaluated.** Valid JSON, empty JSON, and non-JSON all produce a byte-identical error |
   | Path variants (`/api/v1/qris/payment`, `/payment/v1/…`) | `404 page not found` | Our path is the only one that exists |
   | Extra fields (`type`, `qr_type`, `currency`, `callback_url`, `merchant_id`), `amount`/`session_time` as strings, amounts 1 000–10 000 000 | all `400`, unchanged | Not a missing or mistyped field |

   **This is not a payload problem and not a client bug** — a validation error that is identical for a valid body, an empty body, and a non-JSON body is not validation.

   **Most likely cause:** the sandbox merchant is not provisioned for QRIS on the **PTEN switch**. The docs state twice that this endpoint is "only available for merchants already registered in the PTEN switch" and that `qr_string` "will only be generated if merchant is PTEN" — a merchant-entitlement rejection surfacing as a generic 400 fits every observation above. Cannot be confirmed from our side.

   **Action: ask MotionPay/Flash support** whether merchant `59240` / `00059102` (ANDAPAY) is PTEN-registered and enabled for QRIS dynamic payment in sandbox. The table above is the evidence to send them. Nothing in our code changes until they answer.

1. **`external_id` is documented as String(16), but our transaction code does not fit.** The monorepo's correlation key is `{timestampMs}{type}{method}{provider}-{userId}[-random]` — the millisecond timestamp alone is 13 characters, so the full code is far over 16. Compounding it, MotionPay's *own* samples violate their stated limit (`"20c67336-dcea-42d8-a"` is 20 characters, and `"PSTMN{{uuid}}"` expands well past 16). **Needs confirmation: is 16 the real limit, or stale documentation?** If it is real, we need a separate short reference for MotionPay and a mapping back to our transaction code — which changes what gets persisted. Until this is settled, our client does not silently truncate; it validates and fails loudly.
2. ~~**Base URL `.id` vs `.co.id`**~~ — **resolved 13 Aug 2026**: `.id` is correct, `.co.id` does not resolve. See §1.
3. **No callback contract.** "Callback Format" is advertised as a service but no endpoint, payload, or signature scheme is defined in the spec. For a pay-in flow, the callback is normally how `SUCCESS` arrives — polling `payment-status` is the fallback, not the design. Ask MotionPay for the callback spec, and specifically **how the callback is authenticated** (signature? IP allowlist? shared secret?). This matters: the legacy codebase's provider callbacks verified nothing at all, which the migration audit flagged as a must-fix.
4. **No `EXPIRED` status.** `session_time` sets a QR expiry and the status response has an `expired_date`, yet `status` only has `PENDING`/`SUCCESS`/`FAILED`. Our internal `TransactionStatusEnum` has a distinct `EXPIRED`. Unclear whether an expired QR reports `FAILED` or stays `PENDING` forever. Our mapper currently leaves it as reported and derives nothing from `expired_date` — confirm the real behavior.
5. **Timestamp formats are inconsistent.** Samples show both ISO-8601 with offset (`"2025-03-25T05:09:05+00:00"`) and a space-separated form (`"2023-12-06 18:12:19"`) with no timezone. The second form is ambiguous about zone — presumably WIB (UTC+7), but that is an assumption. Our DTOs keep these as strings and do not parse them into `Date` at the client boundary, so no silent timezone error can occur; parse deliberately at the point of use once the format is confirmed.
6. **`qr_string` is conditional.** It is "only generated if merchant is PTEN". If our merchant registration is incomplete, a `PENDING` transaction can come back with no QR to show the customer. Our schema treats `qr_string` as required on create and fails loudly rather than returning a payment with nothing to render — better a clear error than a blank QR screen.
7. **Amount is an integer.** IDR minor units are not used — `1000` means Rp 1.000. Our internal amounts are `Decimal`. Conversion must reject any fractional value rather than rounding it, and enforce the 1,000–10,000,000 bounds before the call.

---

## 8. What is implemented here

| File | Role |
|---|---|
| [motionpay.constant.ts](../../apps/transaction/src/upstream/motionpay/motionpay.constant.ts) | Endpoint paths, envelope status codes, wire status/type values, amount bounds |
| [dto/motionpay-auth.dto.ts](../../apps/transaction/src/upstream/motionpay/dto/motionpay-auth.dto.ts) | Token request/response schemas |
| [dto/motionpay-qris.dto.ts](../../apps/transaction/src/upstream/motionpay/dto/motionpay-qris.dto.ts) | Create-payment and status schemas |
| [motionpay-auth.service.ts](../../apps/transaction/src/upstream/motionpay/motionpay-auth.service.ts) | Token acquisition, JWT-`exp`-derived caching, in-flight dedup, authorized request helper |
| [motionpay.service.ts](../../apps/transaction/src/upstream/motionpay/motionpay.service.ts) | `createQrisPayment` / `getQrisStatus`, envelope checks, status mapping |
| [motionpay.controller.ts](../../apps/transaction/src/upstream/motionpay/motionpay.controller.ts) | Manual test endpoints exposed in Swagger — see §9 |
| [motionpay.module.ts](../../apps/transaction/src/upstream/motionpay/motionpay.module.ts) | Module wiring; imported by the transaction `AppModule` |

Shared pieces in `libs/`:

| File | Role |
|---|---|
| `libs/configuration/src/motionpay.config.ts` | `MOTIONPAY_*` env vars — **no credential is hardcoded** |
| `libs/upstream/src/*` | Provider-agnostic upstream primitives: response schema assertion, normalized purchase result, `UpstreamException` |

Credentials are read from env only. The legacy PDN integration hardcoded its key ID, webhook secret, and Ed25519 private key directly in the service file (and duplicated the private key in a comment block) — that is exactly what this deliberately does not do.

### Required environment variables

```bash
MOTIONPAY_BASE_URL="https://sandbox-app.flashmobile.id"   # confirm .id vs .co.id first
MOTIONPAY_CLIENT_KEY="<from Flash merchant dashboard>"
MOTIONPAY_SERVER_KEY="<from Flash merchant dashboard>"
MOTIONPAY_TIMEOUT_MS=15000              # optional, default 15000
MOTIONPAY_TOKEN_SKEW_SECONDS=300        # optional, default 300 — renew this early
```

---

## 9. Testing it from Swagger

`MotionPayModule` is imported by the transaction app's `AppModule`, so the endpoints appear in Swagger at **`/swag-rwz`** under the tag **"Upstream · MotionPay (manual test)"**.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `upstream/motionpay/token` | Verify credentials + base URL. Returns the decoded expiry only — never the token itself. |
| `POST` | `upstream/motionpay/qris` | Create a dynamic QRIS payment — **raw wire contract**. |
| `GET` | `upstream/motionpay/qris/{transactionId}` | Look up status by MotionPay's `FM-…` id. |

Suggested order: call `token` first to confirm credentials, then `qris` to create one, then feed the returned transaction id into the status endpoint.

The create endpoint takes **MotionPay's own request body verbatim** (`MotionPayCreateQrisRequestSchema`) and returns their response verbatim — nothing of ours maps in either direction, so their documented example can be pasted straight in. Swagger pre-loads it as the "documented" example:

```json
{
  "terminal_id": "PRODUCT-01",
  "external_id": "2023-02",
  "amount": 1000,
  "description": "Description of transaction",
  "session_time": 3,
  "fullname": "John Doe",
  "email": "email@email.com",
  "phone_number": "081510076749"
}
```

Things to know while testing:

- **Nothing is persisted.** These endpoints call MotionPay directly — no transaction row, no ledger entry, no balance movement. They exercise the upstream client in isolation.
- **Unknown fields are silently dropped, not rejected.** The request schema sets `additionalProperties: false` and `AjvPipe` runs with `removeAdditional: true`. If you are trialling an undocumented field, loosen the schema first — otherwise it never reaches MotionPay and you get a false negative.
- **Upstream failures return HTTP 502** with MotionPay's own `status.code` and message in the `context` field, rather than a bare 500. That detail is the whole point while integrating.
- **Keep the `transaction_id`** from the create response — MotionPay documents no lookup by `external_id`, so it is the only handle for a status check.
- The paths above are shown without a prefix because `setGlobalPrefix` is currently commented out in [main.ts](../../apps/transaction/src/main.ts). With it enabled they become `/api/v1/upstream/motionpay/…`, which is what the nginx and k8s ingress rules expect.
- `MotionPayService.createQrisPayment` (the normalized, domain-shaped method the real purchase flow should call) is untouched and still validates responses — only this test endpoint bypasses it via `createQrisPaymentRaw`.
- **Blocked in production.** The endpoints are unauthenticated and, against live credentials, would create real upstream QRIS transactions our system has no record of, so they return 403 when `NODE_ENV=production`. Delete the controller or move it behind the real auth guards once the purchase flow in `src/api` supersedes it.
- To probe MotionPay's real `external_id` limit (open question #1 in §7), raise `MOTIONPAY_EXTERNAL_ID_MAX_LENGTH` in `motionpay.constant.ts` — that single constant drives both the request-body validation and the service-side assertion.

---

# Part II — Transfer Service (payout)

Source: <https://api-doc.flashmobile.id/transfer#/> — "Transfer Service 2.6", extracted 13 Aug 2026.

Flash Transfer sends money from a **prepaid merchant deposit** to Indonesian bank accounts and e-wallets in real time. The deposit is debited on every call, so an empty deposit means failed payouts rather than an overdraft.

## 11. How Transfer differs from QRIS

This is the section to re-read before assuming any QRIS knowledge carries over.

| | QRIS (pay-in) | Transfer (payout) |
|---|---|---|
| Sandbox host | `sandbox-app.flashmobile.id` | **`sandbox-secure.flashmobile.id`** |
| Production host | `app.flashmobile.id` | **`secure.flashmobile.id`** |
| Token endpoint | `/priv/v1/pg/token` | **`/auth/v2/access-token`** |
| Token response envelope | `status: { code, message }` | **`status: <number>`, `message`, `description`** |
| Service response envelope | `status: { code: <number>, message }` | **`status: { success: <bool>, code: "<string>", message }`** |
| Success code | `0` (payments), `200` (token) | **`"0001"`** — a zero-padded string |
| Status keyed by | MotionPay's `transaction_id` | **our `external_id`** |
| Amount bounds | 1.000 – 10.000.000 | **10.000 – 50.000.000** |
| `external_id` max | 16 (disputed) | **50** |
| IP whitelisting | not mentioned | **required** |
| Extra header | — | **`x-server-key`** (see §13.1) |

Three envelope shapes exist across the two products, which is why none of the QRIS schemas are reused:

```
QRIS service     -> status: { code: 0,       message: "..." }
Transfer token   -> status: 200, message: "success", description: "..."
Transfer service -> status: { success: true, code: "0001", message: "..." }
```

### 11.1 Prerequisite: IP whitelisting — 🔴 currently blocking

The docs state it plainly: merchants must provide their public IP to a Flash representative to be whitelisted before sandbox or production calls will work. This is a people step, not a code step, and it blocks the very first call.

**Verified blocking as of 13 Aug 2026.** Probed from this machine with the existing MotionPay credentials:

| Request | Result | Reading |
|---|---|---|
| `POST sandbox-secure…/auth/v2/access-token` | **403**, `text/html` | — |
| `GET sandbox-secure…/transfer/api/v1/balance` | **403**, `text/html` | — |
| `GET sandbox-secure…/` (bare root) | **403**, `text/html` | Every path on the host returns the same HTML 403 → this is an **edge/WAF block, not an application response**. Classic IP-allowlist rejection. |
| `POST sandbox-app…/auth/v2/access-token` | **200**, token issued | Auth is reachable on the app host, and the **QRIS credentials work for Transfer** (same merchant, ANDAPAY 59240) |
| `GET sandbox-app…/transfer/api/v1/balance` | **404** | The transfer service endpoints are **not** on the app host |

Conclusions:

1. **The transfer service lives on `secure.`**, exactly as the OpenAPI `servers` block says. The cURL samples pointing at `sandbox-app` are wrong — this resolves open question #6 below, and note it is the *opposite* outcome to the QRIS `.co.id` case, so the samples cannot be trusted either way.
2. **Our public IP is not whitelisted.** That is the only thing standing between this implementation and a working call.
3. **Separate Transfer credentials are probably not needed** — the QRIS pair authenticated successfully against the transfer token endpoint.

Practical consequence: your workstation's public IP and the K3s node's egress IP are different addresses. Send Flash both, or testing works in one place and fails in the other.

## 12. Authentication

`POST {transferBaseUrl}/auth/v2/access-token` — body `{ client_key, server_key }`, same field names as QRIS.

```json
{
  "status": 200,
  "message": "success",
  "description": "Token received.",
  "data": { "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
  "meta": {}
}
```

Note `status` is a **bare number** here — checking `parsed.status.code` (the QRIS pattern) would throw. The sample credentials look structurally different from the QRIS pair (`FM-0077-…` / `FMPA-…`), which suggests Transfer is issued its own keys; our config falls back to the QRIS keys when the transfer-specific ones are unset, so either arrangement works.

The token is a JWT, so the same `exp`-derived caching applies as for QRIS.

## 13. Endpoints

### 13.1 The `x-server-key` header

Undocumented in every header table, but it appears as a parameter on Check Transfer Status and Check Balance, and in MotionPay's own balance cURL sample:

```bash
curl --location --request GET '.../transfer/api/v1/balance' --header 'x-server-key: ziAwN1NMZQXB_VTBNO2lPAU5ywE' --header 'Authorization: Bearer {token}'
```

Our client sends it on **all** transfer calls. An ignored extra header is harmless; a missing required one is a 401 that is tedious to diagnose. Worth confirming with their team whether it is actually required.

### 13.2 Account Inquiry — `POST /transfer/api/v1/inquiry`

Validates a beneficiary before sending money.

| Field | Required | Type | Notes |
|---|---|---|---|
| `bank_code` | Required | String, "3" | See §13.6 — the stated length is wrong |
| `bank_account` | Required | String, 16 | |
| `external_id` | Required | String, 50 | Unique per merchant transaction |

A failed lookup is **HTTP 200** with `status.success = false`, `status.code = "0003"`, and `name: ""` — not an error status. Our client returns `valid: false` rather than throwing, because a wrong account number is a business outcome the caller must decide about, not an upstream fault.

### 13.3 Fund Transfer — `POST /transfer/api/v1/payment`

| Field | Required | Type | Notes |
|---|---|---|---|
| `recipient_bank` | Required | String, "3" | |
| `recipient_account` | Required | String, 16 | |
| `recipient_name` | Optional | String, 45 | |
| `amount` | Required | Integer | **10.000 – 50.000.000** |
| `note` | Required | String, 64 | |
| `external_id` | Required | String, 64 → "max 50 characters" | Contradictory in the same row; we enforce 50 |

**The expected happy path is `"0002" / On Process`, not `"0001"`.** Settlement is asynchronous. Treating only `0001` as success would fail nearly every real payout, so our client throws only on an outright `0003`.

### 13.4 Check Transfer Status — `GET /transfer/api/v1/status/{external_id}`

Keyed by **our** `external_id` — the reverse of QRIS, which is keyed by MotionPay's transaction id. Worth remembering when writing reconciliation.

Returns both `data.status` (`SUCCESS`/`PENDING`/`FAILED`) and the envelope's `status.code` (`0001`/`0002`/`0003`). Our client trusts the envelope code, since it is the documented vocabulary and is always present.

### 13.5 Check Balance — `GET /transfer/api/v1/balance`

Returns `{ disbursement_id, deposit }`. `deposit` is the remaining prepaid balance in rupiah. This is the cheapest call that proves the whole Transfer chain works — credentials, host, IP whitelisting — without moving money. Start here.

### 13.6 Bank codes — the stated length is wrong

`bank_code` is documented as `String, 3`, but the published list contains **4-character** codes (`013S`, `114S`, `542S` — the Syariah variants) and **word** codes (`LINKAJA`, `SHOPEEPAY`, `GOPAY`, `OVO`, `DANA`). A `maxLength: 3` rule would reject valid destinations.

The full list lives in [motionpay-bank-code.constant.ts](../../apps/transaction/src/upstream/motionpay/motionpay-bank-code.constant.ts) and is served by the test controller at `upstream/motionpay/transfer/bank-codes`. Unknown codes are **warned about, not rejected** — the list is a snapshot, and MotionPay adding a bank should not become our outage.

Also note e-wallets share the namespace with banks, so a "bank transfer" here can actually be a wallet top-up.

## 14. Callback

MotionPay POSTs to a URL registered in their merchant dashboard:

```json
{
  "data": {
    "transaction_id": "7176C9C558E794D5F263B07246A656D6A8A5B5A29B9BB013",
    "external_id": "82b2d513-b910-47ad-a35b-fcd6f82d",
    "id": "7672",
    "fm_user_reference_number": null,
    "user_reference_number": null
  },
  "status": { "success": true, "code": "0001", "message": "Success" }
}
```

`MotionPayTransferService.mapCallback` normalizes this shape. The receiving controller is **not** implemented.

> **🔴 The callback has no documented authentication.** No signature, no shared secret, no HMAC — the URL is simply registered in a dashboard. Anything that can reach the endpoint can post a "success" for an arbitrary `external_id`.
>
> Do not let a callback drive a balance movement until either (a) MotionPay confirms an authentication mechanism, or (b) every callback is independently re-verified with `checkTransferStatus` before it is trusted. (b) is implementable today and is the safer default regardless. This is the same gap the migration audit flagged across all four legacy provider integrations — worth not repeating.

## 15. Status codes

| Code | Message | Meaning |
|---|---|---|
| `0001` | Success | Settled |
| `0002` | PENDING / On Process | Accepted, settling asynchronously |
| `0003` | Failed | Rejected |

| HTTP | Meaning |
|---|---|
| 400 | Invalid parameter format |
| 401 | Invalid or expired token |
| 402 | Access Forbidden — merchant request invalid |
| 422 | Invalid parameter entity format |
| 500 | Server error |

Same undefined-code rule as QRIS: anything unrecognized must be held as **Pending** until next-business-day reconciliation. Our mapper does that, which for a payout is also the only safe default — guessing "failed" risks a double-send, guessing "success" risks releasing funds that never moved.

## 16. Testing Transfer from Swagger

Tag **"Upstream · MotionPay Transfer (manual test)"**.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `upstream/motionpay/transfer/token` | Verify credentials + IP whitelisting |
| `GET` | `upstream/motionpay/transfer/balance` | Remaining deposit — **safest first call** |
| `POST` | `upstream/motionpay/transfer/inquiry` | Validate a beneficiary account |
| `POST` | `upstream/motionpay/transfer/payment` | ⚠️ **Moves real money** |
| `GET` | `upstream/motionpay/transfer/status/{externalId}` | Poll a transfer |
| `GET` | `upstream/motionpay/transfer/bank-codes` | Local reference list, no upstream call |

Suggested order: **token → balance → inquiry → payment → status**. The first two prove the chain without moving anything; if IP whitelisting is missing, `token` is where it surfaces.

Same conventions as the QRIS test controller: request bodies are MotionPay's verbatim wire contract with their documented example pre-loaded, nothing is persisted, upstream failures come back as HTTP 502 with the provider's own message, and every endpoint returns 403 when `NODE_ENV=production`.

**`payment` debits the real deposit.** It is blocked in production, but against sandbox credentials it still exercises a real transfer. Check `balance` before and after.

## 17. Transfer open questions

1. **🔴 BLOCKER — the public IP is not whitelisted.** Confirmed by probe, see §11.1. Nothing else can be tested until Flash whitelists it. Send them **both** your workstation IP and the K3s node's egress IP.
2. ~~**Are Transfer credentials separate from QRIS?**~~ — **resolved**: the QRIS pair authenticated fine against the transfer token endpoint. `MOTIONPAY_TRANSFER_CLIENT_KEY` / `_SERVER_KEY` can stay unset; they fall back to the QRIS pair.
3. **Is `x-server-key` actually required?** Undocumented in the header tables, present in the samples. We always send it. Untestable until #1 clears.
4. **Callback authentication** — see §14. The most serious of these, and independent of #1.
5. **`external_id` length**: "String, 64" and "max 50 characters" in the same row. We enforce 50.
6. ~~**Host contradiction**~~ — **resolved**: `secure.` is correct (the `servers` block), the cURL samples are wrong. The app host 404s every `/transfer/api/v1/*` path. See §11.1.
