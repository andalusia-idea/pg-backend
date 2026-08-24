# Merchant Signature — Design Guidance

Status: written 20 Aug 2026 as guidance; **updated 23 Aug 2026 to record decisions made and code landed.** Steps 1–2 of the [implementation guide](merchant-signature-implementation.md) are built — schema rotation fields and `libs/signature`. Sections marked *decided* are settled; the rest is still design.

Scope: the `Authorization`-equivalent header signature that merchants use to authenticate against manapay's own Public API (`/open/v1/payin/*`). This is the **manapay ↔ merchant** boundary — per [snap-standardization.md §3.2](snap-standardization.md), that boundary is very likely *outside* SNAP's regulatory scope, so this is manapay's own design to make. That's a freedom, not a gap: this document is about designing it deliberately rather than inheriting it.

Sources: legacy `C:\prelion\pg\auth-service` + `transaction-service`, the current [apps/auth/prisma/schema.prisma](../apps/auth/prisma/schema.prisma), and the team's merchant-facing PDF ("1.1 Manapay Payin"). Claims about legacy behavior below were verified by running the actual code, not by reading it — the two most serious findings only show up when you execute it.

---

## 1. TL;DR

- **The published PDF describes a security control that does not exist.** It tells merchants their nonce is checked for replay within a 10-minute window. In the code that check is a `// TODO`. Replay protection is currently **timestamp-only, with a 2-hour window** — not the "few minutes" the doc claims. This is the single most important finding here.
- **Two verified crash/correctness bugs** (§3): a wrong-length signature throws `RangeError` → HTTP 500 instead of 401, and the PDF's documented `x-signature` length of "8 - 256" actively invites merchants to trigger it. Separately, hashing the *parsed DTO* instead of the raw body means any unknown field a merchant sends silently breaks their signature.
- **Stay symmetric. You are not cutting a corner.** SNAP's own per-transaction signature is symmetric `HMAC_SHA512(clientSecret, ...)`. Its asymmetric RSA half exists *only* to authenticate the OAuth token request. No token endpoint → no reason for RSA. Your instinct here matches the standard's own design (§4).
- **Keep the 5-field canonical string, fix what's under it.** The legacy scheme's *shape* is sound — a real nonce, no token round-trip. The problems are in enforcement, not design. *(Delimiter and algorithm were later aligned to SNAP — `:` and HMAC-SHA512; see §4 and §5.2.)*
- **The biggest structural change to make: move validation out of business logic into a global guard, and hash raw bytes instead of the parsed DTO.** In legacy it's called by hand at 9+ call sites, each re-deriving the request path from route params — meaning query strings are silently dropped and a forgotten call site is an unauthenticated endpoint. Splitting the dashboard into its own app makes this much cleaner than it was: `apps/transaction` can carry one unconditional guard instead of an opt-in decorator (§7).
- **Without a shared nonce store, this subsystem is not complete** — 9 of 11 requirements land without Redis, but replay rejection isn't one of them (§11).
- **Webhook signing is undesigned.** The PDF issues merchants a "Webhook Secret key" and then never specifies a signature anywhere. Outbound webhooks are currently unauthenticated in both directions (§9).

### Terminology

This document uses "hash", "MAC", and "signature" in specific senses. They get used loosely elsewhere, so:

| Term | Who can produce it | Who can verify | What it proves |
|---|---|---|---|
| **Hash** — `sha256(msg)` | anyone | anyone | **Integrity only.** An attacker who edits the message just recomputes the hash. Useless for authentication on its own. |
| **MAC** (Message Authentication Code) — `hmac(secret, msg)` | anyone holding the secret | anyone holding the secret | **Integrity + authenticity.** The message wasn't altered, and it came from someone with the secret. |
| **Digital signature** — RSA / Ed25519 | private-key holder only | anyone with the public key | Integrity + authenticity + **non-repudiation** — the verifier could not have produced it. |

**`X-Signature` in this design is a MAC, not a digital signature.** HMAC stands for *Hash-based Message Authentication Code*. Calling it a "signature" is a mild misnomer that Stripe, AWS, and most PSPs share, so the header name stays — but the distinction is exactly why symmetric signing gives no non-repudiation (§4): with a shared secret the verifier can produce the same tag, so "the merchant must have sent this" isn't provable.

**Never hand-roll `sha256(secret + message)`.** SHA-256 is a Merkle–Damgård construction and is vulnerable to *length extension*: an attacker who sees `sha256(secret || msg)` and knows the secret's length can compute a valid tag for `msg || padding || anything` **without knowing the secret**. HMAC's nested double-hash with padded keys exists specifically to close that hole. Always use `crypto.createHmac`.

**The two are nested here, deliberately:**

```
bodyHash        = sha256(raw request bytes)                 <- plain hash, no secret
canonicalString = METHOD : PATH : NONCE : bodyHash : TIMESTAMP
X-Signature     = HMAC-SHA512(secretKey, canonicalString)   <- the MAC
```

`bodyHash` isn't authenticated on its own — it inherits authenticity from sitting *inside* the MAC'd string. Standard pattern: hash the large payload, MAC a small fixed-size summary of the request. Same guarantee, without running HMAC over megabytes.

("Canonical string" above means this 5-field signing string. Unrelated to RFC8785 *JSON canonicalization*, which this design does not use — see §5.3.)

**SNAP's `tokenType` uses the term too**: `"Bearer"` means possession is authorization (steal the token, you're in), while `"Mac"` means the token ships with a MAC key that must sign every subsequent request (stealing the token alone gets you nothing). That distinction is why the `"Mac"` variant is the one genuinely interesting reason to consider a token layer — see §4.

---

## 2. Is the PDF still accurate?

You asked whether the merchant-facing doc still matches the code. Mostly — the core scheme is faithfully documented. But there are seven divergences, and two of them matter a lot.

| PDF says | Legacy code actually does | Verdict |
|---|---|---|
| 5 headers: `x-client-id`, `x-timestamp`, `x-nonce`, `x-signature`, `x-sign-alg` | Same five, all required | ✅ match |
| Canonical string = 5 lines joined by `\n`: METHOD, PATH, TIMESTAMP, NONCE, SHA256(body) | Same | ✅ match |
| `signature = HMAC_SHA256(base64_decode(secretKey), stringToSign).hexLowerCase()` | Same | ✅ match |
| Nonce "cached for 10 minutes, any duplicate within this timeframe will be rejected" | **Not implemented.** `// TODO Nonce (Redis)` in `merchant-signature.service.ts:114` | ❌ **documents a control that does not exist** |
| "Request must be within a few minutes of server time" | `isTimestampValid(ts, toleranceSeconds = 7200)` → **2 hours**. The function's own JSDoc says "Default tolerance: 10 minutes" — so code, docstring, and PDF all disagree | ❌ ~24× wider than documented |
| `x-signature` length "8 - 256" | Must be **exactly 64** hex chars or the request 500s (§3.1) | ❌ doc invites a crash |
| `x-sign-alg` "Must be `hmac-sha256`" | Header presence is required; **the value is never read or validated** | ⚠️ doc stricter than code |
| PATH "Include query string if present" | Call sites rebuild the path from route params — `` `/open/v1/payin/purchase/${transactionId}` `` — so **query strings never reach the signature** | ❌ documented behavior unimplementable |
| Body: "canonicalized before hashing follow RFC8785" **and** "Hash the exact JSON string sent (preserve spaces/formatting)" | Canonicalizes (which by definition discards formatting) | ❌ **the PDF contradicts itself**; the first statement is the true one |
| Empty body → hash `""` | Also maps `{}` → `""`, where RFC8785 would give `"{}"` | ⚠️ edge case divergence |
| Credentials include a "Webhook Secret key" | No webhook signature is specified anywhere in the doc, and none is verified in code | ❌ dangling credential |
| Sandbox base URL | "TBC" | ⚠️ still unset |

**What to do with the PDF**: don't reissue it as-is. Three of these (nonce, timestamp window, signature length) describe stronger or different security properties than the system actually has, which is worse than documenting nothing — a merchant could reasonably rely on them. The fix direction below makes the *documented* behavior true rather than weakening the doc to match the code.

---

## 3. Verified defects in the legacy implementation

Ordered by severity. Items 3.1 and 3.2 were confirmed by executing the real code paths.

### 3.1 🔴 Wrong-length signature → HTTP 500, not 401 (verified)

`CryptoHelper.verifySignature` guards the input with `/^[0-9a-f]+$/i` — which validates hex *characters* but not *length* — then calls `crypto.timingSafeEqual`, which throws when buffer lengths differ. Running the exact legacy function:

```
valid sig  -> true
len   2 -> THREW RangeError: Input buffers must have the same byte length
len   8 -> THREW RangeError: Input buffers must have the same byte length
len  63 -> THREW RangeError: Input buffers must have the same byte length
len  66 -> THREW RangeError: Input buffers must have the same byte length
empty   -> false
UPPER   -> true
```

Any merchant sending a signature that isn't exactly 64 hex chars gets an unhandled exception instead of a clean auth failure. The published doc's "8 - 256" length range makes this a *documented* input range that reliably 500s. Fix: length-check before comparing, return `false`.

(Also note `UPPER -> true`: uppercase hex is accepted even though the doc says lowercase. Harmless, but the spec should say so explicitly rather than leave it to `Buffer.from` semantics.)

### 3.2 🔴 Body hash is computed over the parsed DTO, not the request bytes (verified)

The controller passes `@Body() body: CreatePurchaseRequestApi` — a class-validated, class-transformed object — into the signature check. So the server hashes *its reconstruction* of the body, not what the merchant actually sent. Verified:

```
wire      : {"amount":100000,"currency":"IDR","extra":"x","orderId":"ORD-1"}
after DTO : {"amount":100000,"currency":"IDR","orderId":"ORD-1"}
MATCH?    : false
```

If validation strips one unknown field, the signature fails — and the merchant gets "Signature is invalid", not "unknown field `extra`". That is an extremely expensive error to debug from the merchant's side, and it's exactly the kind of thing a warung-tier integrator will not self-diagnose. It also means the signature does **not** actually attest to the received bytes, which is the entire point of body hashing.

Related: `canonicalizeBody` short-circuits `{}` to `''`, diverging from the RFC8785 rule the PDF documents (`{}` → `"{}"`), so a merchant POSTing an empty object and following the doc literally fails.

### 3.3 🔴 Nonce is never checked — replay is possible for 2 hours

Nothing consumes `x-nonce`. Combined with the 7200-second timestamp tolerance, a captured request can be replayed verbatim for two hours. For `POST /open/v1/payin/purchase` that means duplicate transaction creation. `orderId` uniqueness may catch some of it at the DB layer depending on constraints — but that's an accident of schema design, not an auth control, and it wouldn't help on non-idempotent endpoints.

`libs/redis` already exists in the monorepo and is currently unused. This is what it's for.

### 3.4 🟠 Validation lives in business logic, not in a guard

`MerchantSignatureHeadersGuard` only checks that the five headers are *present*. Actual verification happens inside each API method:

```ts
const merchantSignature = await this.merchantSignatureClient.signatureValidationTCP({
  headers, body: '', method: HttpMethodEnum.GET,
  path: `/open/v1/payin/purchase/${transactionId}`,   // hand-rebuilt at every call site
});
if (!merchantSignature || !merchantSignature.isValid) throw ApiError.invalidMerchantSignature();
```

repeated at 9+ sites across `purchase.1.api.ts`, `disbursement.1.api.ts`, `balance.1.api.ts`. Consequences:

- **A forgotten call is a silently unauthenticated endpoint.** `@MerchantApi()` makes the JWT and roles guards stand down (`jwt-auth.guard.ts:47`), so the signature check is the *only* thing standing there — and it's opt-in per method.
- **The path is reconstructed, not observed.** Query strings are lost (contradicting the doc), and any drift between the literal string and the real route silently changes what's being signed.
- **Every call site can get the method/body wrong independently** and nothing catches it.

### 3.5 🟠 `previousSecretKey` is written but never read

`generateSecretKey` moves the old key to `previousSecretKey`, but `validateSignature` only ever tries `secretKey`. So rotation is a hard cutover: the instant a merchant clicks "generate", every in-flight and not-yet-redeployed request of theirs starts failing. The column exists to provide a grace window and currently provides nothing. (Already flagged in the migration plan; repeating here since it's core to this subsystem.)

### 3.6 🟠 The HTTP fallback path puts the request body in a query string

`MerchantSignatureAuthClient.signatureValidation` does `axios.get(url, { params: filter })` where `filter` includes the full `body`. On the HTTP fallback path, merchant request bodies are serialized into a URL — landing in access logs, proxy logs, and any intermediary. Bodies also blow past URL length limits. The TCP path (`signatureValidationTCP`) is fine; the fallback is not.

Fixing §5's design removes this entirely: send a **body hash**, never a body.

### 3.7 🟡 Smaller items

- **`x-sign-alg` is required but ignored.** A required-but-unread field is worse than neither — it implies a negotiation that doesn't exist. **Resolved 23 Aug 2026: the header is dropped**, not validated. Pinned to one constant it carries no information, and its presence invites a future `createHmac(request.signAlg, …)` — the flaw behind JWT's `alg` attacks. Signature length already identifies the algorithm (SHA-256 → 64 hex, SHA-512 → 128), so diagnosis is preserved. If per-merchant algorithms ever land, the authority is the server-side `algorithm` column, never a client claim.
- **`secretKey` is stored in plaintext.** HMAC needs the plaintext at verify time so it can't be hashed like a password, but it can be encrypted at rest. Note legacy declared an `ENCRYPTION_KEY` env var that no code ever referenced — that's the gap it was presumably meant for.
- **`clientId` leaks the internal user ID**: `generateClientId` returns `` `${userId}-${uuidv4}` ``. Minor, but it hands out an internal primary key and makes IDs enumerable-ish. Prefer an opaque random identifier.
- **A DB round-trip per merchant request.** `findUnique({ where: { clientId } })` on every call. Indexed and cheap, but cacheable (§7) — relevant given the performance priority on this path.
- **`credentials Json` on `MerchantSignature`** is returned through the validation DTO but its purpose isn't obvious from the signature code. Audit what actually reads it before carrying it forward.

---

## 4. The design question: how much SNAP should this adopt?

You framed symmetric-only as the pragmatic-but-weaker choice. Worth correcting that framing, because it changes the decision:

> **SNAP's own per-transaction signature is symmetric.** Its default scheme ("Type 1") is `HMAC_SHA512(clientSecret, stringToSign)` using a shared secret. The RSA/`SHA256withRSA` half of SNAP exists for exactly one purpose: authenticating the **OAuth token request** to `/access-token/b2b`. If there is no token endpoint, the asymmetric key has no job.

So "symmetric HMAC per request" isn't a downgrade from SNAP — it *is* what SNAP does for the transaction calls themselves. Your instinct was right, and it's defensible to a partner or auditor on the standard's own terms.

### What symmetric actually costs you

One honest tradeoff, worth knowing even though I don't think it changes the decision: with a shared secret, **manapay can compute any signature a merchant can**. If a merchant ever disputes a transaction ("I never sent that"), the signature alone can't settle it, because both parties could have produced it. Asymmetric signing gives real non-repudiation — manapay would hold only the public key and be structurally incapable of forging.

For an aggregator holding merchant funds, that's a genuine consideration. But it's a *dispute-resolution* property, not a request-security one, and it's better addressed with audit logging than by pushing keypair management onto warung-tier integrators. Recommendation: **stay symmetric by default**, and if a large merchant ever demands non-repudiation, offer asymmetric as an opt-in per-merchant mode (the `algorithm` column in §6 leaves that door open).

### What NOT to borrow from SNAP

| SNAP does | Recommendation | Why |
|---|---|---|
| OAuth2 `client_credentials` token, 15-min TTL, re-fetched constantly | **Skip.** Keep direct per-request signing | Adds a mandatory network round-trip before every merchant's first call, plus token caching logic on *their* side. Pure integration friction for your merchant tier, and latency on the hot path. |
| RSA keypair + `SHA256withRSA` for the token call | **Skip** | Only exists to protect the token endpoint you're not building. |
| HMAC-**SHA512** | ~~Keep SHA256~~ → **Adopted SHA512** *(23 Aug 2026)* | Original argument was that SHA512 adds no security margin here and doubles the header to 128 chars. Both still true, neither is a correctness issue — following SNAP's symmetric default was chosen instead. Decided. |
| `:` as the `stringToSign` delimiter | ~~Keep `\n`~~ → **Adopted `:`** *(23 Aug 2026)*, conditional | `:` appears inside ISO-8601 timestamps and URLs, so field boundaries are ambiguous unless every other field excludes colons. **The condition: the guard must reject any nonce that isn't a UUID or hex string.** Without that, `endpoint=/a` + `nonce=b:c` and `endpoint=/a:b` + `nonce=c` produce one canonical string, so a signature for one authorises the other. With it, `:` is safe — method and body hash can't contain colons by construction and the timestamp is last. |
| Replay defense via `X-EXTERNAL-ID` unique-per-day | **Keep the nonce** (once implemented) | Same storage cost, tighter window, simpler semantics. Your `orderId` already covers the business-idempotency role that `X-EXTERNAL-ID` doubles as. |

### Considered and rejected: a symmetric token layer

Asked directly (20 Aug 2026): *if SNAP uses asymmetric for the token call and symmetric for transactions, what about adding a token layer that's symmetric on both sides?*

The security value of SNAP's two-layer design isn't that one layer is asymmetric — it's that the two layers use **independent credentials**. The RSA key gets a token; the `clientSecret` signs transactions; the token is embedded in the transaction `stringToSign`. An attacker holding only one credential can do nothing. That property is reproducible with two symmetric secrets — but **not with one**, and with one secret a token layer is pure ceremony: whoever can mint a token can already sign transactions.

Two secrets is technically the stronger arrangement, but the gain is conditional on storing them differently (SNAP implies this; it doesn't mandate it). Merchants at this tier will keep both in the same `.env` on the same host, where two secrets ≈ one secret with extra steps.

**Decision: no token layer, single secret, per-request signing.** The costs are concrete — a mandatory round-trip before a merchant's first call, token caching and expiry handling in every merchant integration, token state on the server — and the benefit doesn't materialize at this tier. It also matches what merchants' developers already know from Stripe/Midtrans/Xendit.

Two things worth recording so this isn't re-derived later:

- **What the token layer would genuinely buy**: SNAP's `tokenType: "Mac"` variant issues a short-lived **session key** alongside the token. If merchants signed with that instead of their long-term secret, `apps/transaction` could verify locally and the per-request TCP hop to `apps/auth` (§7) disappears. Real architectural win, paid for in merchant-side complexity — reconsider only if that hop ever measures as a bottleneck against a Redis-cached lookup.
- **The one thing merchants actually want from a token endpoint** is a way to test credentials before attempting a real transaction. A signed `GET /open/v1/ping` returning server time delivers that for a fraction of the cost, and doubles as the clock-skew diagnostic §5.4 calls for.

### Where asymmetric would actually pay off (not now, but know why)

Not crypto strength — HMAC-SHA512 (or SHA-256) is entirely adequate. The property is that **a verifier cannot forge**. Symmetric verification requires the same secret used for signing, which forces a choice in §7: either `transaction` calls `auth` on every request (contained, costs a hop) or merchant secrets get replicated into `transaction` (no hop, wider blast radius). Asymmetric escapes the dilemma — `transaction` holds public keys, verifies locally, and is structurally incapable of producing a valid merchant signature. It also gives genuine non-repudiation in a dispute.

That makes asymmetric a reasonable **per-merchant opt-in for large merchants later** (the `algorithm` column in §6 is what keeps that door open), and a poor default for the warung tier this product is built for.

### What IS worth borrowing

- **Validate the algorithm header strictly** against a single allowed value, the way SNAP pins its scheme. Fixes §3.7.
- **Key versioning.** SNAP's key-management requirements call for "clear master key versioning." You have the raw material (`secretKeyPrevious`) — §8 turns it into a real rotation story.
- **A machine-readable error vocabulary.** SNAP's `responseCode`/`responseMessage` convention is genuinely good for integrator experience. Merchants need to distinguish "clock skew" from "wrong secret" from "replayed nonce" — today they all surface as "Signature is invalid" (§5.4).

---

## 5. Recommended target scheme

Deliberately close to what merchants already implement — this is a fix-and-tighten, not a redesign they have to relearn.

### 5.1 Headers

| Header | Required | Value |
|---|---|---|
| `Content-Type` | yes | `application/json` |
| `X-Client-Id` | yes | opaque merchant client ID |
| `X-Timestamp` | yes | ISO-8601 **with offset**, e.g. `2026-08-20T10:15:30+07:00` |
| `X-Nonce` | yes | UUID v4 or hex. Unique per request. **Must be format-validated** — see §5.2 |
| `X-Signature` | yes | **exactly 128** lowercase hex chars (HMAC-SHA512) |

Header names are case-insensitive per HTTP. Document one canonical casing and accept any.

### 5.2 Canonical string

Implemented in [`libs/signature`](../libs/signature/src/hmac-signature.ts). Field order follows SNAP's symmetric signature, with the nonce standing in for SNAP's access token since this API issues none:

```
METHOD : PATH_WITH_QUERY : NONCE : SHA256_HEX(raw_request_body_bytes) : TIMESTAMP
```

1. **`PATH_WITH_QUERY` comes from the actual request**, not from reassembled route params — so query strings are included exactly as the merchant doc always claimed.
2. **The body hash covers raw bytes**, not a re-serialization of the parsed body (§5.3).
3. **The `:` delimiter obliges the guard to validate the nonce format.** A nonce containing a colon could shift a field boundary and make two different requests produce one canonical string. UUID or hex only — `generateNonce` emits UUID v4, and there's a test pinning that it contains no colon, but the *inbound* check is the guard's job.

Empty body (GET) → `SHA256("")` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, exported as `EMPTY_BODY_SHA256`. State it explicitly in the merchant doc — it's the single most common integration stumbling block.

```
X-Signature = HMAC_SHA512(secretKey, canonicalString) → lowercase hex
```

**The secret is used as-is — there is no decoding step.** `generateSecretKey()` returns 32 bytes of entropy as 64 lowercase hex characters, and that string is handed to the merchant and passed straight to HMAC. Every HMAC API takes a string key directly (`hash_hmac` in PHP, `createHmac` in Node, `hmac.new` in Python), so requiring a decode first would add a step whose only failure mode is a silent "invalid signature". Legacy base64-encoded the secret and then base64-decoded it before signing; that round trip is gone.

### 5.3 Raw bytes vs. canonical JSON — decided: raw bytes

**Hash the raw request body bytes.** Drop RFC8785 canonicalization entirely.

**Confirmed 23 Aug 2026: there are no live merchants on the legacy API**, so this is not a breaking change and needs no migration window — the dual-accept scheme earlier drafts described is not being built.

The merchant-facing rule is *"hash the exact bytes you are about to send."* There is **no key-ordering requirement** — a merchant may order keys however they like, as long as they don't re-serialize between signing and sending.

| | Raw bytes | Canonical JSON (today) |
|---|---|---|
| Merchant does | `sha256(the exact string I'm about to POST)` | implement RFC8785, then hash |
| Robustness | signature attests to received bytes — always | breaks if any field is stripped/coerced (§3.2) |
| Dependency | none | `canonicalize` on both sides, must match exactly |
| Performance | one hash pass | canonicalize + serialize + hash per request |
| Familiarity | same model as Stripe, Midtrans, Xendit | unusual; integrators must read carefully |

Canonicalization solves key-reordering by intermediaries — a problem that essentially doesn't occur when a merchant signs the exact string they're about to send. It costs real fragility and a per-request serialization pass on your hot path in exchange.

The trade it makes is worth stating plainly, since it's the one thing merchants must get right: raw-byte hashing breaks if something re-serializes the JSON between signing and sending (typically: signing a serialization, then handing the *object* to an HTTP client that stringifies it again). Canonical hashing tolerates that, but requires both sides to implement RFC8785 identically — and number formatting, unicode escaping, and empty-object handling are all places implementations diverge. Legacy already shipped one such divergence (`{}` hashed as `""` rather than `"{}"`). For merchants on PHP/Node with no RFC8785 library at hand, "hash the string you're sending" is the far more reliable instruction.

### 5.4 Validation order, and telling merchants what went wrong

Fail fast, cheap checks first, and return a *distinguishable* reason:

**In the guard (`apps/transaction`)** — cheap, local, no I/O. Everything here is decidable without knowing the merchant's secret, so rejecting it locally means garbage never costs a network hop:

1. Headers present → `MISSING_HEADER` (name it)
2. `X-Signature` is 128 lowercase hex → `MALFORMED_SIGNATURE` *(this is §3.1's fix — must come before any comparison)*. Name the expected length **and** algorithm in the message: digest length identifies the algorithm, so this is also what a merchant who implemented SHA-256 sees
3. `X-Nonce` is a UUID or hex string → `MALFORMED_NONCE` *(required by the `:` delimiter — see §5.2)*
4. Timestamp is ISO-8601 **with an explicit offset** and within **±5 min** → `TIMESTAMP_SKEW`, and **echo server time in the response** so merchants can self-diagnose clock drift. `isTimestampWithin` rejects a missing offset as malformed rather than treating it as skew: without one, `new Date` resolves against the *server's* local zone, so the same request would mean different instants on a WIB host and a UTC host

**In `apps/auth`** — everything that needs the secret or shared state:
6. Client ID resolves, status `ACTIVE` → `UNKNOWN_CLIENT` / `CLIENT_SUSPENDED`
7. HMAC matches `secretKey`, else `secretKeyPrevious` within the grace window (§8) → `INVALID_SIGNATURE`
8. **Last**: nonce unseen (Redis `SET NX`, TTL 10 min) → `REPLAYED_NONCE`

**The nonce check goes last, after the signature verifies.** Consuming it earlier lets unauthenticated traffic write arbitrary keys into Redis, so only requests that already proved knowledge of the secret get to touch the nonce store. HMAC is microseconds — there is no cost to verifying first.

**Why the split** (refined 23 Aug 2026 while building Step 3): steps 1–5 need nothing but the request itself, so putting them in the guard means a malformed or hostile request is rejected without a TCP hop — which matters under load, since an attacker can generate garbage far faster than valid signatures. It also lets the TCP contract be *strictly* typed: `signature` is pinned to exactly 128 hex and `bodyHash` to 64 lowercase hex, so anything failing that schema is a guard bug rather than a merchant error, and fails loudly instead of being classified politely. Had auth owned the format checks, the schema would have to accept malformed input in order to classify it.

The rules themselves aren't duplicated — both sides call the same `libs/signature` primitives.

Steps 4 and 5 exist because a malformed input would otherwise surface as a confusing downstream failure: a colon-bearing nonce as a signature mismatch, an offset-less timestamp as clock skew.

All of these should be HTTP 401 with a stable machine-readable code in the body. Do **not** collapse them into one opaque message: "Signature is invalid" for what is actually a 3-minute clock drift is the top integration-support cost in every payment API. The distinction leaks nothing useful to an attacker — they already know whether they possess a valid secret.

**±5 min tolerance + 10 min nonce TTL is deliberate**: the nonce must be remembered for at least as long as a timestamp stays acceptable, or a request becomes replayable once its nonce expires. 10 minutes covers the full ±5 window with margin — and it happens to make the PDF's existing "cached for 10 minutes" claim true.

---

## 6. Schema changes

Current model as of 23 Aug 2026 — the rotation fields have landed:

```prisma
model MerchantSignature {
  clientId           String    @unique
  secretKey          String?
  secretKeyPrevious  String?                       // renamed from previousSecretKey
  secretKeyRotatedAt DateTime? @db.Timestamptz(6)  // added
  credentials        Json      @default("{}") @db.JsonB
  status             MerchantSignatureStatusEnum
  payinUrl           String?   @db.VarChar(512)
  payoutUrl          String?   @db.VarChar(512)
  ...
}
```

Note the dashboard carries a *generated merged* schema (`apps/dashboard/prisma/schema.prisma`) covering the same physical tables — any change here needs `npm run prisma:merge:dashboard && npm run prisma:generate:dashboard`, or the dashboard writes to columns that no longer exist.

Remaining suggested additions, all additive:

| Field | Purpose |
|---|---|
| ~~`secretKeyRotatedAt DateTime?`~~ | ✅ **Added.** Bounds the `secretKeyPrevious` grace window (§8). Without it the old key would be valid forever — and note it must be *stamped on every rotation*, or the fallback can never apply. |
| `algorithm String @default("HMAC-SHA512")` | **Optional.** Makes the scheme per-merchant data rather than a global constant. Its original justification (migrating merchants between body-hashing schemes) is moot now that raw-only ships from the start (§5.3); what remains is keeping the door open for per-merchant asymmetric signing later (§4). Safe to defer. |
| `webhookSecret String?` | The PDF already promises merchants one (§9). It has no column today. Must be distinct from `secretKey` — different direction, different blast radius. |
| `lastUsedAt DateTime?` | Cheap, high-value for ops: spot dormant credentials and confirm a rotation actually took effect. |

Worth reconsidering rather than just adding:

- **`secretKey` at rest.** Encrypt it (application-level, key from `libs/configuration`). It can't be hashed — HMAC needs the plaintext — but encryption meaningfully changes what a database dump is worth. This is also where legacy's orphaned `ENCRYPTION_KEY` finally earns its place.
- **`credentials Json`** — audit what reads this before carrying it into the new model. Untyped JSONB on an auth-critical table is a place where undocumented coupling accumulates.
- **`payinUrl` / `payoutUrl`** live here, which is reasonable, but note they're webhook-delivery config rather than signature material. Fine to keep; just don't let the model become "everything merchant-integration-related."

---

## 7. Where validation should run

**Confirmed 20 Aug 2026**: `@MerchantApi()` / `@SystemApi()` no longer exist anywhere in the monorepo. JWT, roles, and `@PublicApi()` guards now live exclusively in `apps/dashboard`. `apps/transaction/src/api/` and `apps/transaction/src/merchant-signature/` are empty placeholder directories — nothing is implemented yet. This section is written for that topology, not the legacy one.

### 7.1 Split the apps, invert the default

Splitting the dashboard out is what makes the signature story clean, and it changes the guard's polarity:

| | Legacy (one mixed app) | Now |
|---|---|---|
| Auth styles per app | JWT *and* signature in the same controller surface | dashboard = JWT only; transaction = signature only |
| How signature applied | `@MerchantApi()` **opt-in**, per handler | **global guard**, opt-out |
| Failure mode | forget the decorator → unauthenticated endpoint | forget the opt-out → endpoint 401s loudly |

That inversion is the entire point. Legacy's worst property was that the safe path required remembering something; here, forgetting produces a noisy failure instead of a silent hole. Register the guard with `APP_GUARD` in the transaction app's module rather than decorating handlers.

### 7.2 Three things the global guard must handle

1. **Skip non-HTTP contexts.** A globally-registered NestJS guard also fires for TCP `@MessagePattern` handlers — which have no HTTP headers and would fail every internal call. Gate on `context.getType() !== 'http'` → allow. This is the one mistake that will look like "microservices randomly broke."
2. **An opt-out decorator** for the routes in `apps/transaction` that legitimately aren't merchant-signed: `HealthModule`'s endpoints, `/metrics`, `/swag-rwz`, upstream callbacks from MotionPay (authenticated differently — see §9), and the `upstream/motionpay/*` manual test controllers. Name it for what it means (`@NoMerchantSignature()`), not `@PublicApi()` — these routes aren't public, they're *differently* authenticated, and the name should stop someone reaching for it casually.
3. **Guards run before pipes.** NestJS order is middleware → guards → interceptors → pipes → handler, so the guard sees the request before `AjvPipe` touches it. That's the correct order here: authenticate, then validate shape.

### 7.3 Fastify + Ajv: two specifics that matter

**Ajv is an argument for raw-byte hashing, not against it.** [`AjvPipe`](../libs/microservice/src/ajv-validation.pipe.ts) is configured with `removeAdditional: true` and `coerceTypes: true`. That is precisely the §3.2 landmine, now present in the new codebase: if the body hash were ever computed after the pipe, every merchant who sends one extra field would get "invalid signature" instead of a useful error, and every coerced `"100"` → `100` would too. Hashing raw bytes in the guard sidesteps both, and lets Ajv keep stripping and coercing freely — the two concerns stop interfering.

**Fastify parses JSON before the guard sees it**, so `request.body` is already an object and the raw bytes are gone. Capture them at the content-type-parser level in `apps/transaction/src/main.ts` and stash them on the request, then parse as normal — no extra dependency needed, and it's a handful of lines. Prototype this early: it's the one piece of the design with real framework-integration risk, and if it doesn't work cleanly, §5.3 (raw-byte hashing) doesn't either.

Two things to get right while doing it: apply the parser **only** to the merchant API routes if possible (or accept a small retained buffer everywhere), and set a body size limit — you're now holding the raw body in memory alongside the parsed one.

### Keep verification inside `apps/auth`

The secret should never leave the auth service. So the guard (running in `transaction`) should **hash the body locally and send only the hash** over TCP:

```
{ clientId, timestamp, nonce, signature, method, pathWithQuery, bodyHash }
```

Small, fixed-size, no request bodies crossing a service boundary — which also eliminates §3.6's query-string leak by construction. `AUTH_CMD.MERCHANT_SIGNATURE_VALIDATION` already exists in [microservice.constant.ts](../libs/microservice/src/microservice.constant.ts) marked `// TODO`; this is its contract.

That leaves one TCP hop per merchant request. Given the performance priority, the instinct is to eliminate it by caching secrets in `transaction` — **don't**. Copying the secret into a second service doubles the places it can leak and makes suspension/rotation eventually-consistent. Instead cache *inside auth*: `clientId → {secretKey, secretKeyPrevious, secretKeyRotatedAt, status, userId}` in `libs/redis`, short TTL, explicitly invalidated on rotate/suspend. That removes the DB round-trip (§3.7) while keeping the secret in one service, and leaves a local TCP hop that's worth its cost.

Redis then does double duty here — nonce store and secret cache — which is a good reason to stand it up properly for this subsystem rather than piecemeal.

---

## 8. Key rotation

Make `secretKeyPrevious` real (§3.5):

1. On rotate: `secretKeyPrevious = secretKey`, `secretKey = <new>`, `secretKeyRotatedAt = now()`.
2. On verify: try `secretKey`. On failure, if `secretKeyRotatedAt` is within the grace window, try `secretKeyPrevious`.
3. Grace window: **24 hours** is a reasonable default — long enough for a merchant to redeploy, short enough to bound exposure. Make it configurable.
4. After the window, `secretKeyPrevious` is ignored (and ideally nulled by a scheduled job).

Two details worth getting right:

- **Both attempts must be constant-time**, and a match on the previous key must not be distinguishable from a match on the current one by timing or response.
- **Log which key matched.** A merchant still using the old key 20 hours in is about to have an outage; that's worth an alert, and it's invisible without the log line.

This directly serves the "merchant can regenerate from the dashboard whenever they want" workflow you described — today that workflow is a self-inflicted outage.

---

## 9. The other direction: webhook signatures

The PDF hands merchants a **"Webhook Secret key — Key for validation webhook / notification from Manapay"**, then never specifies how to use it. Section 5 documents the webhook payload with no signature header, and the schema has no column for such a key. So today the promise is undelivered in three places at once.

This matters more than it looks: an unsigned webhook means anything that can reach a merchant's callback URL can tell them a payment succeeded. That's a fraud vector against *your merchants*, delivered through *your* integration.

Recommendation: use the **same canonical-string construction, inverted** — manapay signs, merchant verifies. Same `X-Signature`/`X-Timestamp`/`X-Nonce` headers, keyed on `webhookSecret` rather than `secretKey`. One scheme, two directions, one document to write, one implementation for merchants to understand.

Note the symmetry with the *upstream* side: MotionPay's callback to manapay has no authentication either ([upstream/motionpay.md §14](upstream/motionpay.md)), and the legacy audit found zero signature verification on any of the four legacy provider callbacks. A single generic "verify an inbound HMAC-signed webhook" helper plus its outbound counterpart covers manapay→merchant, MotionPay→manapay, and any future upstream. Worth building once, deliberately.

---

## 10. Suggested sequencing

Ordered so that nothing merchant-visible breaks until the invisible fixes are already in.

**Phase 1 — invisible, no merchant impact.** Fix the signature length check (§3.1). Drop `X-Sign-Alg` entirely (§3.7). Narrow the timestamp window 7200s → 300s *(technically merchant-visible if anyone's clock is badly off — announce it, and ship §5.4's server-time echo first so they can self-diagnose)*. Wire up `secretKeyPrevious` (§8). The nonce check (§3.3) belongs here too and makes the published doc true rather than changing it — if it's deferred, see §11 for what has to compensate in the meantime.

**Phase 2 — structural, still no contract change.** Move validation into a guard (§7). Switch the TCP payload to a body hash (§3.6). Add Redis caching. Add the schema columns (§6). At this point hash the raw body but keep canonicalizing as a fallback comparison, so nothing breaks yet.

**Phase 3 — webhooks.** Design and ship outbound signing (§9), then reuse the same primitive for inbound provider callbacks.

*(Earlier drafts had a phase here for migrating merchants from canonical to raw-byte body hashing. With no live merchants, raw-only ships from the start and there is nothing to migrate — see §5.3.)*

**Then reissue the merchant PDF** — once the documented behavior and actual behavior finally agree. Add the empty-body hash constant, the error-code table from §5.4, and a worked end-to-end example (real secret, real canonical string, real resulting signature) that a merchant can paste into a test to check their implementation. That single example prevents more support tickets than the rest of the document combined.

---

## 11. Is it complete? — definition of done

Nothing is implemented in the monorepo yet, so this is the checklist to measure against. The honest headline: **without a shared nonce store, merchant signature is not complete — it's functional but knowingly replay-vulnerable.**

| # | Requirement | Needs Redis? | Complete without it? |
|---|---|---|---|
| 1 | Canonical string + HMAC-SHA512 verification ✅ *built, Step 2* | no | ✅ |
| 2 | Signature length-checked before compare (§3.1) | no | ✅ |
| 3 | `X-Sign-Alg` removed; signature length identifies the algorithm | no | ✅ |
| 4 | Timestamp window enforced, server time echoed on skew | no | ✅ |
| 5 | Raw-byte body hashing via Fastify parser (§7.3) | no | ✅ |
| 6 | Global guard + opt-out decorator, non-HTTP contexts skipped (§7.2) | no | ✅ |
| 7 | Distinguishable error codes (§5.4) | no | ✅ |
| 8 | `secretKeyPrevious` rotation grace window (§8) | no | ✅ |
| 9 | Body hash (not body) sent over TCP to auth (§3.6) | no | ✅ |
| 10 | **Nonce replay rejection** | **yes** | ❌ **the gap** |
| 11 | Secret cache to remove the per-request DB hit (§3.7) | yes | ⚠️ perf only, not correctness |

So 9 of 11 land without touching Redis. Deferring it is a reasonable call — but two things have to be true while it's deferred:

**Narrow the timestamp window, since it becomes the *only* replay defense.** ±5 min is sized to pair with a nonce store; without one, that's a 10-minute window in which any captured request can be replayed verbatim — including `POST /open/v1/payin/purchase`. Tighten to ±1–2 min until the nonce check exists, and accept that a few merchants with bad clocks will feel it.

**Do not "temporarily" use an in-memory `Map`.** The k8s manifests run `maxReplicas: 2`, so an in-process nonce cache is wrong the moment it scales: a replayed request routed to the other pod sails through. It would also read as complete in code review while providing nothing. If Redis genuinely needs to wait but you want correctness sooner, a Postgres table with a unique constraint on `(clientId, nonce)` plus a TTL cleanup job is slower but actually correct — an atomic insert is a real replay check in a way a per-pod Map is not.

**Worth knowing: Redis is already wired into all four apps**, including transaction, via `RedisModule` in each `app.module.ts`. So item 10 is not blocked on infrastructure — only on writing the check (a `SET NX` with a TTL matching the timestamp window). That's a small piece of work sitting behind a much larger one, which is worth weighing before deferring it far.

**Until item 10 ships, the merchant PDF must not claim nonce replay protection** (§2). Ship the code and the doc together, or the doc is describing a control that doesn't exist — which is exactly the situation this whole review started from.

---

## 12. Open questions

1. **What reads `MerchantSignature.credentials`?** It's returned by `validateSignature` and threaded into the validation DTO alongside `nmid`, but its purpose isn't clear from the signature path alone. Worth tracing before it's carried into the new model.
2. **Is `orderId` uniquely constrained per merchant in the DB?** It's currently the only thing resembling replay protection on `POST /purchase`. Once the nonce check lands this matters less, but it should be a deliberate constraint rather than an implicit one.
3. **Does any live merchant currently send a query string** on the GET endpoints? If yes, they're signing something the server never validates (§3.4), and Phase 2 will change their behavior.
4. **Sandbox environment** is "TBC" in the doc. Merchants can't safely develop a signing implementation against production — this is worth resolving alongside the doc reissue.
5. **Do you want per-merchant clock-skew tolerance?** Some POS/warung devices keep genuinely bad time. A global ±5 min may be too tight for a small tail of merchants; the `MerchantSignature` row is the natural place for an override if so.

---

*Legacy references: `auth-service/src/shared/helper/crypto.helper.ts`, `auth-service/src/modules/merchant-signature/merchant-signature.service.ts`, `auth-service/src/microservice/auth/guard/merchant-signature-headers.guard.ts`, `transaction-service/src/modules/api/v1/*.1.api.ts`. Current model: [apps/auth/prisma/schema.prisma](../apps/auth/prisma/schema.prisma). Related: [snap-standardization.md](snap-standardization.md), [upstream/motionpay.md](upstream/motionpay.md).*
