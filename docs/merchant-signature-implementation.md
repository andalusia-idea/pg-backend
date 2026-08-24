# Merchant Signature — Implementation Guide

Companion to [merchant-signature.md](merchant-signature.md), which covers *why*. This one is the build order.

Written 20 Aug 2026 against the monorepo's actual state: `apps/transaction/src/{api,merchant-signature}/` are empty directories, `apps/auth/src/merchant-signature/` only implements `findMerchantWebhookUrl`, and `AUTH_CMD.MERCHANT_SIGNATURE_VALIDATION` exists marked `// TODO`.

Steps are ordered so each one is independently verifiable and nothing is left half-wired between steps. Steps 1–9 are the working system; 10–13 harden and finish it.

---

## Step 0 — Lock five decisions first

These are cheap to decide now and expensive to change once merchants are signing against them.

| Decision | Recommended | Notes |
|---|---|---|
| Timestamp tolerance | **±300s** (±60s if the nonce check is deferred — see §11 of the design doc) | Goes in `libs/configuration`, not a constant |
| Nonce TTL | **600s** | Must be ≥ the full accepted band, which is 2× tolerance since a clock can be fast or slow — otherwise a request becomes replayable once its nonce expires while its timestamp is still valid |
| Rotation grace window | **24h** | How long `secretKeyPrevious` stays accepted |
| Signed path includes global prefix? | **No** — strip it | See Step 7's gotcha; this is the highest-risk detail in the whole build |
| Body hashing | **Raw bytes only** | Confirmed 23 Aug 2026 — see below |
| Signature algorithm | **HMAC-SHA512** ✅ *decided* | SNAP's symmetric default. 128-char signature. `X-Sign-Alg: HMAC-SHA512` |
| Secret format | **32 bytes as 64 hex chars, used as-is** ✅ *decided* | No base64, no decode step — the merchant passes the string straight to HMAC |
| Canonical delimiter & order | **`METHOD:PATH:NONCE:BODYHASH:TIMESTAMP`** ✅ *decided* | SNAP's order with the nonce in the access-token slot. The `:` obliges the guard to format-validate the nonce (Step 8) |

**On body hashing — decided, raw-only.** Earlier drafts of this guide specified dual-accept (verify against both a raw-byte hash and an RFC8785-canonicalized hash) so legacy merchants signing canonically wouldn't break at cutover. **There are no live merchants on the legacy API**, so there is nothing to migrate and that complexity is simply not built: no `canonicalize` dependency, one hash per request, one code path.

The merchant contract is therefore: **hash the exact bytes you are about to send.** No key ordering requirement, no normalization — just don't re-serialize between signing and sending. This is how Stripe, Midtrans, and Xendit work, and it needs no library in any language.

One consequence worth noting: the `algorithm` column (design doc §6) was partly justified as the mechanism for migrating merchants between hashing schemes. With raw-only there's nothing to migrate between, so it's now **optional** — its remaining value is keeping the door open for per-merchant asymmetric signing later (design doc §4). Safe to defer.

---

## Step 1 — Schema ✅ rotation fields done

`apps/auth/prisma/schema.prisma`, model `MerchantSignature`. All additive, no data migration needed.

**Landed** (migration `20260823130232_merchant_signature_secret_key_rotation`):

```prisma
secretKeyPrevious  String?                        // renamed from previousSecretKey
secretKeyRotatedAt DateTime? @db.Timestamptz(6)   // bounds the grace window
```

**Deferred, still available when needed:**

```prisma
algorithm     String    @default("HMAC-SHA512")   // optional — see Step 0
webhookSecret String?                             // with Step 13
lastUsedAt    DateTime? @db.Timestamptz(6)        // ops nicety
```

Then `prisma migrate dev`, and regenerate the client.

> **🔴 The dashboard has its own generated schema over the same tables.** `apps/dashboard/prisma/schema.prisma` is produced by `merge-schema.js` from the auth/config/transaction schemas. Changing the auth schema without re-running the merge leaves dashboard code writing to columns that no longer exist — which is exactly what happened on the first attempt at this step:
>
> ```bash
> npm run prisma:merge:dashboard && npm run prisma:generate:dashboard
> ```
>
> Then check callers: `generateSharedSecretKey` had to be updated for the rename **and** to stamp `secretKeyRotatedAt: new Date()` — without that stamp the column is written by nothing and the grace window can never open.

**Verify**: the generated `MerchantSignature` type in *both* `apps/auth/src/generated/prisma/models/` and `apps/dashboard/src/generated/prisma/models/` carries the new fields, and all four apps typecheck.

**Note on `credentials Json`**: it's already on the model and gets returned through the legacy validation DTO, but nothing in the signature path obviously consumes it. Trace what reads it before designing around it — untyped JSONB on an auth-critical table is where undocumented coupling hides.

---

## Step 2 — `libs/signature` ✅ done

Built at [`libs/signature/src/hmac-signature.ts`](../libs/signature/src/hmac-signature.ts), 61 tests in [`hmac-signature.spec.ts`](../libs/signature/src/hmac-signature.spec.ts). Pure functions, no NestJS, no I/O:

```ts
generateClientId(): string                    // UUID v4 — no internal id embedded
generateSecretKey(): string                   // 32 bytes as 64 hex chars, used as-is
generateNonce(): string                       // UUID v4 — cannot contain ':'
sha256Hex(input: string | Buffer): string
EMPTY_BODY_SHA256: string                     // sha256('')
buildCanonical({ httpMethod, endpoint, nonce, bodyHash, timestampIso }): string
buildSignature({ secretKey, canonical }): string
verifySignature({ secretKey, canonical, signatureReceived }): boolean
isTimestampWithin({ timestampIso, toleranceSeconds, now? }): boolean
```

("Canonical" here means the 5-field signing string — unrelated to RFC8785 JSON canonicalization, which this build does not use.)

What the tests lock down, each corresponding to a bug that exists in legacy or a trap found while building:

1. **`verifySignature` length-checks before comparing.** `crypto.timingSafeEqual` throws `RangeError` on mismatched buffer lengths — that is what turned a bad signature into an HTTP 500 in legacy. Nine malformed inputs (short, long, odd-length, empty, non-hex, SHA-256-length) each assert `false` **and** `not.toThrow()`.
2. **`buildCanonical` takes a `bodyHash`, never a body object.** Four tests take real wire strings, re-serialize them, and assert the hash changes — integer-like keys reorder, `1.50` → `1.5`, `1e3` → `1000`, whitespace vanishes. If someone later "simplifies" the server back to `JSON.stringify(parsedBody)`, those fail with the reason attached.
3. **`isTimestampWithin` requires an explicit UTC offset.** Without one, `new Date` resolves against the *server's* local zone, so the same string means different instants on a WIB host and a UTC host — a latent bug that only appears when a container moves. Rejected as malformed rather than as skew. The suite passes identically under `TZ=UTC`, `TZ=Asia/Jakarta`, and `TZ=America/New_York`, which is the property that matters.
4. **`EMPTY_BODY_SHA256`** is exported rather than inlined — merchants will ask for it, and a GET simply passes `sha256Hex('')`.
5. **Uppercase hex is accepted** by `verifySignature` (`Buffer.from(str,'hex')` is case-insensitive). A test documents this rather than endorsing it: if lowercase must be enforced, that's the guard's job, not the crypto layer's.

Two things deliberately *not* in the lib: `.toLowerCase()` on digests (Node's `digest('hex')` is always lowercase — verified over 40,000 digests; the invariant is pinned by a regex assertion instead), and any falsy-body handling (there is no body parameter left to be falsy).

**Still open from this step**: nothing. Note `isTimestampWithin` is date math, not a crypto primitive — it lives here because it's part of signature *validation*.

---

## Step 3 — TCP contract

`libs/microservice/src/dto/merchant-signature.dto.ts` — extend alongside the existing `FilterMerchantWebhookUrlSchema`, same TypeBox + `as const` idiom the file already uses.

Request (transaction → auth):

```ts
clientId, timestamp, nonce, signature, signAlg,
method, path,      // path already prefix-stripped, query included
bodyHash           // SHA256 of the raw request bytes
```

Response (auth → transaction):

```ts
isValid: boolean
userId: number
reason: MerchantSignatureFailureReason | null   // discriminated failure code
serverTime: string                              // ISO-8601, always — for skew diagnosis
```

**Send hashes, never the body.** The legacy HTTP fallback did `axios.get(url, { params: filter })` with the full body in `filter`, putting merchant request bodies into URL query strings and every access log along the way. Hashes are fixed-size and make that mistake structurally impossible.

Failure reasons as an `as const` object (per [[feedback-typebox-enum-style]]): `MISSING_HEADER`, `UNSUPPORTED_ALG`, `MALFORMED_SIGNATURE`, `TIMESTAMP_SKEW`, `REPLAYED_NONCE`, `UNKNOWN_CLIENT`, `CLIENT_SUSPENDED`, `INVALID_SIGNATURE`.

Then add the cmd to `libs/microservice/src/microservice.constant.ts` — `AUTH_CMD.MERCHANT_SIGNATURE_VALIDATION` already exists, just drop the `// TODO`.

---

## Step 4 — Verification service in `apps/auth`

`apps/auth/src/merchant-signature/merchant-signature.service.ts` — add `validateSignature()` next to the existing `findMerchantWebhookUrl`.

**Order matters. Use this order, not design-doc §5.4's** (which listed nonce before HMAC — corrected there too, but this is the authoritative sequence):

1. `signAlg === 'HMAC-SHA512'` → else `UNSUPPORTED_ALG`
2. Signature is 128 lowercase hex → else `MALFORMED_SIGNATURE`
3. Timestamp within tolerance → else `TIMESTAMP_SKEW`
4. Look up `clientId` (slave replica is fine) → else `UNKNOWN_CLIENT`; status `ACTIVE` → else `CLIENT_SUSPENDED`
5. HMAC verify against `secretKey`; if that fails and `secretKeyRotatedAt` is inside the grace window, retry with `secretKeyPrevious` → else `INVALID_SIGNATURE`
6. **Only now** consume the nonce (Step 10) → else `REPLAYED_NONCE`

**Why nonce goes last**: consuming it before the signature verifies lets unauthenticated traffic write arbitrary keys into Redis. Verify first, and only authenticated requests touch the nonce store. HMAC is microseconds — there's no cost to doing it first.

**Log which key matched.** A merchant still matching on `secretKeyPrevious` 20 hours into a 24-hour grace window is about to have an outage, and that's invisible without the log line.

Header presence (`MISSING_HEADER`) is checked in the guard, not here — it never reaches this service.

**Verify**: unit tests per failure reason, plus the rotation grace window (old key accepted inside it, rejected outside).

---

## Step 5 — Wire the message pattern

`apps/auth/src/merchant-signature/merchant-signature.controller.ts` — add a `@MessagePattern({ cmd: AUTH_CMD.MERCHANT_SIGNATURE_VALIDATION })` handler with `AjvPipe`, exactly mirroring the existing `MERCHANT_SIGNATURE_WEBHOOK_URL` handler.

**Verify**: with auth running, send a TCP message directly (or a temporary test controller) and confirm a hand-computed signature validates.

---

## Step 6 — TCP client

`libs/microservice/src/client/merchant-signature.auth.client.ts`, following [`fee-calculate.config.client.ts`](../libs/microservice/src/client/fee-calculate.config.client.ts) exactly — `firstValueFrom` + `timeout(MICROSERVICE_CALL_TIMEOUT_MS)`.

**Fail closed.** If auth is unreachable, the call must reject and the request must 401/503 — never fall through to "assume valid." Worth an explicit test, because a timeout that silently returns `undefined` and gets truthiness-checked somewhere upstream is exactly how an auth bypass gets shipped.

Export from `libs/microservice/src/client/index.ts`.

---

## Step 7 — Raw body capture (Fastify)

`apps/transaction/src/main.ts`. Register the parser on the adapter **before** `NestFactory.create`:

```ts
const adapter = new FastifyAdapter({ bodyLimit: 1_000_000 });
adapter.getInstance().addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (_req, body: string, done) => {
    try {
      done(null, body === '' ? {} : JSON.parse(body));
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);
```

Fastify exposes the raw string to the guard — attach it to the request in the parser (`(req as any).rawBody = body`) or read it via Fastify's own mechanism; either way the guard needs the exact bytes, not the parsed object.

Three gotchas:

- **`JSON.parse('')` throws.** An empty POST body must become `{}` (or stay empty) rather than 500ing.
- **Set `bodyLimit`.** You're now holding the raw string alongside the parsed object.
- **🔴 The global prefix.** This is the one most likely to make every signature fail at once. `setGlobalPrefix` is currently commented out in `main.ts`, but the k8s/nginx rules expect `/api/v1/...`, and the merchant PDF tells merchants to sign the path *without* it (`/open/v1/payin/purchase`). So when the prefix is enabled, `request.url` is `/api/v1/open/v1/payin/purchase` while the merchant signed `/open/v1/payin/purchase`. **The guard must strip the prefix before building the canonical path**, and there must be a test pinning this with the prefix enabled. Decide it now (Step 0), write it down in the merchant doc, and never change it.

**Verify**: temporary route echoing `rawBody` and `sha256(rawBody)`; confirm it matches a hash computed independently over the same bytes, including a body with unusual whitespace.

---

## Step 8 — Guard + opt-out decorator

`apps/transaction/src/merchant-signature/` — the empty directory this belongs in.

```
merchant-signature.guard.ts
no-merchant-signature.decorator.ts
merchant-signature.module.ts
```

Guard logic:

1. `ctx.getType() !== 'http'` → **return true**. A globally-registered guard also fires on TCP `@MessagePattern` handlers, which have no HTTP headers. Miss this and every internal microservice call breaks in a way that looks unrelated.
2. `@NoMerchantSignature()` metadata present → return true.
3. Extract the five headers; any missing → 401 `MISSING_HEADER` naming them.
4. Compute `bodyHash` from the raw bytes, strip the global prefix from `request.url`, call auth.
5. Invalid → 401 with the reason code and `serverTime`. Valid → attach `{ userId, clientId }` to the request for handlers to consume.

Name the decorator `@NoMerchantSignature()`, not `@PublicApi()` — those routes aren't public, they're differently authenticated, and the name should discourage casual reuse.

Add a `@CurrentMerchant()` param decorator to read what the guard attached, so handlers never re-derive identity from headers.

**Verify**: unit tests for the non-HTTP bypass, the opt-out bypass, each 401 path, and the success path attaching `userId`.

---

## Step 9 — Register globally, protect the first endpoint

In `apps/transaction/src/app/app.module.ts`:

```ts
{ provide: APP_GUARD, useClass: MerchantSignatureGuard }
```

Then immediately apply `@NoMerchantSignature()` to everything in transaction that isn't merchant-facing, or they all start 401ing:

- `HealthModule` endpoints and `/metrics`
- Swagger (`/swag-rwz`)
- the `upstream/motionpay/*` manual test controllers
- upstream callback receivers (authenticated differently — Step 13)

Then build **one** real endpoint in `apps/transaction/src/api/` — `GET /open/v1/ping`, returning server time behind a valid signature. That's the smallest possible end-to-end proof, and it doubles as the credential-test/clock-skew endpoint merchants actually want from a token endpoint (design doc §4).

**Verify — this is the real milestone.** With auth + transaction running: a correctly signed request to `/open/v1/ping` returns 200; tampering with any single byte of body, path, timestamp, or nonce returns 401; a missing header returns 401 naming it; a health-check request still works unsigned.

At this point the system works. Everything below hardens it.

---

## Step 10 — Nonce replay rejection (Redis)

`libs/redis` exposes a raw `ioredis` instance via the `REDIS_KEY` symbol, and `RedisModule` is already imported in `apps/auth`. Inside `validateSignature`, as **step 6** (after HMAC verification):

```ts
const ok = await redis.set(`msig:nonce:${clientId}:${nonce}`, '1', 'PX', ttlMs, 'NX');
if (ok !== 'OK') return { isValid: false, reason: 'REPLAYED_NONCE', ... };
```

`SET NX` is atomic, so this is correct across replicas — which matters, because the k8s manifests run `maxReplicas: 2`.

**Do not substitute an in-memory `Map`.** With two pods, a replay routed to the other pod sails straight through, while the code reads as complete in review. If Redis genuinely has to wait, a Postgres table with a unique constraint on `(clientId, nonce)` plus a TTL cleanup job is slower but actually correct.

Decide the Redis-unavailable behavior explicitly: **fail closed** (reject) is the right default for a payment API. Make it a deliberate, documented choice, not an accident of where the `try/catch` landed.

**Verify**: replaying a byte-identical request returns `REPLAYED_NONCE` on the second attempt; two different nonces both succeed; the key expires after TTL.

---

## Step 11 — Secret cache (performance)

Cache `clientId → { secretKey, secretKeyPrevious, secretKeyRotatedAt, status, userId, algorithm }` in Redis **inside `apps/auth`**, short TTL (30–60s), invalidated explicitly on rotate and on status change.

**Cache in auth, not in transaction.** Copying merchant secrets into a second service doubles where they can leak and makes suspension eventually-consistent. Caching inside auth removes the per-request DB round-trip while leaving the secret in exactly one service — the remaining local TCP hop is ~1ms and buys that containment.

**Verify**: a suspended merchant is rejected within the TTL window; a rotated key works immediately (explicit invalidation, not TTL expiry).

---

## Step 12 — Rotation

Dashboard-side (`apps/dashboard`), since this is a merchant-facing dashboard action, not part of the transaction hot path:

1. Generate 32 random bytes, base64.
2. `secretKeyPrevious = secretKey`, `secretKey = <new>`, `secretKeyRotatedAt = now()`.
3. Invalidate the Step 11 cache entry.
4. **Return the plaintext exactly once** — never readable again.
5. Scheduled job nulls `secretKeyPrevious` past the grace window.

**Verify**: the old key works inside the grace window and fails outside it; both paths are constant-time and indistinguishable in response shape and timing.

---

## Step 13 — Webhooks, then reissue the merchant doc

**Outbound signing** (manapay → merchant): same canonical construction inverted, keyed on `webhookSecret` from Step 1. Reuse `libs/signature`.

**Inbound verification**: the same primitive covers MotionPay → manapay callbacks, which today have **no authentication at all** ([upstream/motionpay.md §14](upstream/motionpay.md)) — anything that can reach the endpoint can claim a payout succeeded. Until MotionPay provides a signing scheme, re-verify every callback with `checkTransferStatus` before letting it move a balance. Build the generic helper once and it covers manapay→merchant, MotionPay→manapay, and any future upstream.

**Then reissue the merchant PDF**, and not before. The current one documents nonce replay protection that doesn't exist, a 2-hour window as "a few minutes," and an `x-signature` length range that reliably 500s. It can only be corrected once Steps 1–10 make the documented behavior true. Add the empty-body hash constant, the failure-code table from Step 3, and one fully worked example — real secret, real canonical string, real resulting signature — that a merchant can paste into a test. That single example prevents more support tickets than the rest of the document combined.

---

## Suggested commit boundaries

| Commit | Steps | Independently shippable? |
|---|---|---|
| `feat(auth): merchant signature schema + crypto lib` | 1–2 | yes, dormant |
| `feat(microservice): signature validation TCP contract` | 3, 6 | yes, dormant |
| `feat(auth): signature verification service` | 4–5 | yes, callable, unused |
| `feat(transaction): raw body capture` | 7 | yes, no behavior change |
| `feat(transaction): signature guard + ping endpoint` | 8–9 | **behavior change** — the cutover |
| `feat(auth): nonce replay rejection` | 10 | yes |
| `perf(auth): secret cache` | 11 | yes |
| `feat(dashboard): secret rotation` | 12 | yes |
| `feat: webhook signing` | 13 | yes |

Steps 1–7 are all dormant — nothing changes behavior until Step 9 registers the guard. That's deliberate: it means the risky commit is small, isolated, and trivially revertable.

---

*Design rationale: [merchant-signature.md](merchant-signature.md). Verified legacy defects: §3 there. Related: [snap-standardization.md](snap-standardization.md), [upstream/motionpay.md](upstream/motionpay.md).*
