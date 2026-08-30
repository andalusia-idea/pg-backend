# Merchant API — Response Codes

The response contract for manapay's merchant Public API (`/open/v1/*`). This is the reference for the merchant-facing documentation, and the source of truth is [`libs/microservice/src/merchant.exception.ts`](../libs/microservice/src/merchant.exception.ts).

Status: implemented as of 27 Aug 2026 (Steps 8–10 of [merchant-signature-implementation.md](merchant-signature-implementation.md)).

---

## 1. The envelope

Every response — success or failure — carries the same three fields:

```json
{
  "responseCode": "2000000",
  "responseMessage": "Successful",
  "serverTime": "2026-08-27T10:15:30.123Z",
  "data": { }
}
```

| Field | Type | Notes |
|---|---|---|
| `responseCode` | String(7) | See §2 |
| `responseMessage` | String(≤150) | Human-readable; **do not branch on this**, branch on `responseCode` |
| `serverTime` | ISO-8601 | Always present, success and failure alike |
| `data` | object \| null | Success only — the endpoint's payload |

**Why `serverTime` on success too**: it lets a merchant compare clocks at any time rather than only after being rejected for skew. The `/open/v1/ping` endpoint exists for exactly this.

**Why `data` rather than SNAP's per-service field name**: SNAP names the payload per service (`virtualAccountData`, `accountInfos`). That would mean inventing a field name for every endpoint, and risks a business field one day colliding with `responseCode`. A fixed `data` key is a deliberate simplification — one shape to parse, for every endpoint.

---

## 2. How `responseCode` is built

Adopted from SNAP:

```
responseCode = HTTP status (3) + service code (2) + case code (2)
```

`2000000` = HTTP 200, service `00`, case `00`.

### Service codes

| Range | Meaning |
|---|---|
| `00` | Cross-cutting — authentication, signature, transport. SNAP writes this slot as `any`. |
| `90`–`99` | manapay business services. **Reserved, not yet assigned.** |
| `01`–`81` | **Never use.** This is SNAP's own service registry (`11` = Balance Inquiry, `47` = Generate QR MPM, …). Emitting one of these would be read as that SNAP service by anyone who knows the standard. |

The `90`+ range was chosen precisely so the two registries cannot be confused. Assign codes there via `@MerchantSuccessCode('90', '00')` when a business endpoint needs its own.

---

## 3. Success

| Code | HTTP | Message | When |
|---|---|---|---|
| `2000000` | 200 | Successful | Any cross-cutting endpoint (e.g. `/open/v1/ping`) |
| `200`+`9x`+`yy` | 200 | Successful | Business endpoints, once assigned |

---

## 4. Failure — signature and authentication

All emitted by `MerchantSignatureGuard` or by auth's verification, service code `00`.

| Code | HTTP | Reason | Message | What the merchant should do |
|---|---|---|---|---|
| `4010001` | 401 | `MISSING_HEADER` | Missing mandatory header | Send all four headers. The message names which are absent. |
| `4010002` | 401 | `MALFORMED_SIGNATURE` | Invalid X-Signature format, expected 128 hex characters (HMAC-SHA512) | Almost always the wrong algorithm — SHA-256 produces 64 hex characters, SHA-512 produces 128. |
| `4010003` | 401 | `MALFORMED_NONCE` | Invalid X-Nonce format, expected a UUID or hex string | See §6 for the accepted alphabet. |
| `4010004` | 401 | `TIMESTAMP_SKEW` | Invalid X-Timestamp, expected ISO-8601 with a UTC offset near server time | Compare their clock against `serverTime` in the same response. A **missing UTC offset** is rejected here too. |
| `4010005` | 401 | `UNKNOWN_CLIENT` | Unknown X-Client-Id | Wrong or stale client id. |
| `4010006` | 401 | `CLIENT_SUSPENDED` | Merchant credentials are not active | Contact manapay — this is an account state, not an integration bug. |
| `4010007` | 401 | `SECRET_KEY_NOT_GENERATED` | No secret key has been generated for this merchant | Generate one in the dashboard. |
| `4010008` | 401 | `INVALID_SIGNATURE` | Invalid X-Signature | The MAC did not match under the current or previous secret. Check the canonical string construction. |
| `4010109` | 401 | `IP_NOT_ALLOWED` | Request origin is not in this merchant IP allowlist | The signature was **valid** — only the origin was wrong. Check the allowlist in the dashboard, or that the calling host's egress IP has not changed. |
| `4290000` | **429** | `RATE_LIMITED` | Too many requests, slow down and retry after the window resets | Back off for the number of seconds in the `Retry-After` header, then retry with a fresh nonce and timestamp. |
| `4090000` | **409** | `REPLAYED_NONCE` | X-Nonce already used, re-sign the request with a new nonce | **Not a credential problem.** Generate a fresh nonce and re-sign. |

### Two deliberate deviations from SNAP

**Split codes where SNAP lumps.** SNAP puts "Unknown Client" and "Verify Client Secret Fail" together under a single `401 00 Unauthorized. [reason]`. We give them distinct codes because the support saving is large and the disclosure is nil: `clientId` is a UUIDv4, so it is not enumerable, and an attacker already knows whether they hold a valid secret.

**`REPLAYED_NONCE` is 409, not 401.** This follows SNAP's own `409 00 Conflict` for a reused `X-EXTERNAL-ID`. A 401 would send the merchant to audit credentials that are fine; 409 tells them what actually happened — a duplicate — and that a fresh nonce fixes it.

### On `IP_NOT_ALLOWED` and check ordering

The allowlist is checked **after** the signature verifies, never before. That ordering is what gives the code its meaning: `4010109` can only be reached by a caller who *proved* they hold the merchant's secret, so it reads as "this key is being used from somewhere it should not be" — the highest-fidelity credential-compromise signal the system produces, and worth an alert. (`X-Client-Id` travels in every request and is not secret; `secretKey` is.)

Checking origin first would reject the same request, but you would never learn a secret had leaked.

The cost of that ordering, stated plainly: an attacker holding a stolen secret and calling from an unlisted address learns the secret is valid. That is a real disclosure, judged the lesser loss — an attacker who lifted a key from a config file generally assumes it works, whereas the detection signal exists in only one of the two orderings.

IP allowlisting is **opt-in per merchant** and empty by default. Most merchants sit on dynamic connections where pinning an address would guarantee an outage.

### On `RATE_LIMITED` and `Retry-After`

Also checked **after** the signature verifies, and for the same class of reason: `X-Client-Id` is an unauthenticated header, so counting before verification would let a stranger exhaust a real merchant's budget by spoofing their id. The budget is spent only by callers who proved they hold the secret.

A `429` always carries a **`Retry-After`** header giving the seconds until the window resets. Honour it — without backing off, a retry loop tightens under throttling and converts a temporary limit into a sustained outage for that merchant.

Limits are **per merchant, per endpoint, per window**, so heavy status polling cannot consume the budget needed for payments. See [throttler.md](throttler.md).

---

## 5. Failure — system

| Code | HTTP | When | What the merchant should do |
|---|---|---|---|
| `5030000` | 503 | Signature verification could not be performed — auth unreachable, timed out, or failed internally | **Retry with a fresh nonce and timestamp.** |
| `5000000` | 500 | A guarded route the signing scheme cannot describe | Report it — this is our bug, not theirs. |

**Why an outage is 503 and never 401.** Answering "your signature is invalid" during an incident sends every merchant to debug signing code that is fine, and — worse — tells well-behaved clients to *stop retrying* transactions that would have succeeded. 503 means "retry later", which is the truth. The message is deliberately generic; the real cause is logged inside auth.

**Retries need a fresh nonce.** A timeout does not tell you whether the request was processed. If auth claimed the nonce before the response was lost, replaying the identical signed request returns `4090000` and looks like a different bug. Always re-sign.

---

## 6. Header format rules

| Header | Rule |
|---|---|
| `X-Client-Id` | As issued. |
| `X-Timestamp` | ISO-8601 **with a mandatory UTC offset** (`Z` or `±HH:MM`). Fractional seconds 1–9 digits accepted. Must be within ±5 minutes of server time (configurable). |
| `X-Nonce` | 8–128 characters from `A–Z a–z 0–9 . _ ~ -`. Unique **per attempt**. |
| `X-Signature` | Exactly 128 hex characters. Case-insensitive on input. |

### On the timestamp offset

A timestamp without an offset is rejected as *malformed*, not as skew. Without one, `new Date` resolves against the **server's** local zone — so the same string would mean different instants on a WIB host and a UTC host, and a merchant's requests could start failing purely because a container moved. Rejecting it turns a latent environment bug into a clear error at integration time.

### On the nonce alphabet

The one hard requirement is **no `:`** — the signed canonical string is colon-delimited, so a colon-bearing nonce could shift a field boundary and let one signature authorise a different request. Everything else in the alphabet is conservatism: whitespace and control characters have no business in a header value.

UUIDs, plain counters (`00000001`), hex, and merchant references (`ORD-000001`) are all accepted.

> ⚠️ **A nonce must be unique per attempt, not per order.** An order number is a poor nonce: retrying the same order needs a *new* nonce, or it is rejected as a replay. Idempotency is `orderId`'s job — the nonce only guarantees a request cannot be replayed.

---

## 7. Adding a business endpoint

1. Assign a service code from `90`+ and record it in §2.
2. Decorate the handler with `@MerchantEndpoint()` — this applies signature verification **and** the success envelope together. They are composed because applying one without the other is always a mistake.
3. If the endpoint needs its own success code, add `@MerchantSuccessCode('90', '00')`.
4. For business failures, extend `MerchantException` with a factory alongside `fromMerchantSignature`, and add the code to §4 or a new section here.

Keep this document and `merchant.exception.ts` in step. The published merchant documentation is generated from this table, and a code that exists in one but not the other is how a contract quietly drifts.

---

*Related: [merchant-signature.md](merchant-signature.md) (design rationale), [merchant-signature-implementation.md](merchant-signature-implementation.md) (build order), [snap-standardization.md](snap-standardization.md) (why only the envelope is adopted from SNAP).*
