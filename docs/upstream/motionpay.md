# MotionPay (Flash Mobile) — QRIS Upstream

Source: <https://api-doc.flashmobile.id/qris#/> — "QRIS Service 2.6", OpenAPI `3.0.0`, doc version `1.0.0`.
Extracted 12 Aug 2026 from the live OpenAPI document behind the docs site (Stoplight Elements), so the field tables below are the spec's own, not a transcription of rendered HTML.

**Scope of this document and of the code in [apps/transaction/src/upstream/motionpay](../../apps/transaction/src/upstream/motionpay):** QRIS **purchase (pay-in)** only — Authentication, Create QRIS Payment, Get QRIS Status. Payouts, disbursement, and the callback/webhook receiver are out of scope for now.

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
