# Rate Limiting

How the merchant Public API throttles requests, why it is built rather than borrowed, and what to change when the numbers turn out wrong.

Implemented 28 Aug 2026. Companion to [merchant-signature.md](merchant-signature.md).

---

## 1. What rate limiting is

A cap on how many requests a caller may make in a window. Two motivations that get conflated but pull in different directions:

- **Protecting yourself** — one runaway client must not exhaust CPU, database connections, or Redis.
- **Protecting a shared resource downstream** — the one that actually matters here, see §2.

### The algorithms

| Algorithm | How | Trade-off |
|---|---|---|
| **Fixed window** | Count per calendar minute, reset at the boundary | Trivial (`INCR` + `EXPIRE`). A caller can spend a full budget at 10:00:59 and another at 10:01:00 — briefly double the rate. |
| **Sliding window log** | Store a timestamp per request, count those in the last N seconds | Exact, but memory grows with traffic. |
| **Sliding window counter** | Weight the current window against the previous one | Good approximation, no boundary burst, more moving parts. |
| **Token bucket** | Bucket of N tokens refilling at R/sec; each request spends one | Allows deliberate bursts then settles to R. Needs Lua for atomicity. |

**We use a fixed window.** The boundary burst is real and documented below; it is acceptable because the limit is set with headroom rather than exactly at a hard ceiling, and because the alternative costs complexity we would rather spend elsewhere. Revisit if the upstream cap ever becomes tight enough that a 2× spike matters.

---

## 2. Why manapay needs it: the upstream quota

Every merchant transaction becomes a MotionPay call, and **MotionPay's limits apply to manapay as a whole, not per-merchant.**

So one merchant with a retry-loop bug does not merely cost CPU — it can consume the shared upstream quota and get **every other merchant** throttled, or manapay's credentials blocked. That is the failure this exists to prevent.

The nginx ingress already carries `limit-rps: 20`, which is per-IP and protects the cluster. It cannot help here: one merchant on one IP, staying comfortably under 20 rps, can still be 100% of manapay's upstream traffic. Fairness between merchants is not something nginx can express.

> ⚠️ **The configured limit is currently a guess.** Ask MotionPay what their per-partner cap is and set `MERCHANT_SIGNATURE_RATE_LIMIT_MAX_REQUESTS` below it with headroom. Until then the default of 120/minute is a placeholder chosen to be generous.

---

## 3. Why not `@nestjs/throttler`

The package is good and its extension surface is genuinely sufficient — `getTracker` for custom identity, `generateKey` for the key format, `throwThrottlingException` for a custom error, and a `ThrottlerStorage` interface for Redis. The reason we did not use it is placement, not capability.

**The count must happen after the signature verifies.** `X-Client-Id` is an unauthenticated header — anyone can send it. Counting before verification means a stranger can spray requests carrying a real merchant's client id and exhaust *their* quota: a denial-of-service weapon aimed at our own customers, built by us. So the budget may only be spent by a caller who proved they hold the secret.

That verification happens in `apps/auth`, over TCP, inside `validateSignature`. Which leaves two options for the package:

1. **Throttle before the signature guard** — wrong keying, spoofable, and duplicates what nginx already does per-IP.
2. **Throttle after it, in `apps/transaction`** — needs `getTracker` to pull the verified client id back out of CLS (coupling two guards through async-local storage), a custom Redis `ThrottlerStorage`, and `throwThrottlingException` overridden to emit our envelope.

Under option 2 we would be overriding the tracker, the key, the storage, and the exception. What remains of the package is the fixed-window algorithm — about ten lines. Meanwhile the check has a natural home two lines from the nonce claim, in a class that already holds the Redis handle, the config, and the fail-open/fail-closed conventions.

**`@nestjs/throttler` is still the right tool for `apps/dashboard`**, where JWT gives you an authenticated user before any custom guard runs, and per-endpoint limits on login are exactly its sweet spot. Different shape of problem, different answer.

---

## 4. How it works

`MerchantSignatureRedis.consumeRateLimit(clientId, endpoint)`, called from `validateSignature` after the signature and origin checks, before the nonce claim.

### The key

```
merchant-signature:rate:{clientId}:{endpoint}:{windowNumber}
```

**Window number is part of the key** rather than state inside the value, so a new window is simply a new key and expiry does the cleanup — nothing to reset, nothing to sweep.

**Endpoint is part of the key** so a burst of status polling cannot consume the budget a merchant needs for payments.

### The script

```lua
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return { hits, redis.call('TTL', KEYS[1]) }
```

**`INCR` and `EXPIRE` must be one atomic step.** Split across two round trips, a crash or dropped connection between them leaves a counter with **no TTL** — it never resets, and that merchant is throttled permanently with no obvious cause. Redis evaluates a Lua script atomically, which closes the gap. The `TTL` read in the same script is what lets us answer with an accurate `Retry-After`.

### Ordering inside `validateSignature`

```
signature verified
  → IP allowlist        (local, no I/O)
  → rate limit          (Redis)
  → nonce claim         (Redis)
```

Each position is deliberate:

- **After the signature** — so the budget belongs to whoever holds the secret (§3).
- **After the IP check** — that one is a local array test with no round trip, so it rejects more cheaply.
- **Before the nonce claim** — a throttled request must not burn its nonce. Otherwise the merchant's retry once the window resets returns `REPLAYED_NONCE`, which reads as an entirely different fault and sends them debugging the wrong thing.

### Failure behaviour

**Fails closed.** A Redis error propagates rather than being swallowed, same as `claimNonce` and unlike the signature cache. This protects a shared upstream quota; answering "under the limit" when the counter is unreachable would let a runaway merchant through precisely when the system is already unhealthy.

---

## 5. What the merchant sees

```
HTTP 429
Retry-After: 17

{
  "responseCode": "4290000",
  "responseMessage": "Too many requests, slow down and retry after the window resets",
  "serverTime": "2026-08-28T10:15:30.123Z"
}
```

`4290000` follows SNAP's `429 00 Too Many Requests` — see [merchant-api-response-codes.md](merchant-api-response-codes.md).

**`Retry-After` is not decoration.** It is the only machine-readable way to tell a client when to come back; without it a naive retry loop tightens under throttling and turns a rate limit into an outage for that merchant. The value comes from the window's actual remaining TTL, not a constant.

---

## 6. Configuration

| Variable | Default | Notes |
|---|---|---|
| `MERCHANT_SIGNATURE_RATE_LIMIT_MAX_REQUESTS` | `120` | Per merchant, per endpoint, per window |
| `MERCHANT_SIGNATURE_RATE_LIMIT_WINDOW_SECONDS` | `60` | Fixed window length |

Both live on `MerchantSignatureConfig` — grouped with the rest of the merchant-signature domain rather than in a config of "things that happen to be durations", so a constraint between them has somewhere to live if one appears.

---

## 7. Known limitations

**Boundary burst.** Fixed window means up to 2× the nominal rate across a window edge. Set limits with headroom; move to a sliding window or token bucket if an upstream cap ever makes that spike matter.

**Per-pod nothing, per-Redis everything.** The counter is in Redis, so it is correct across both replicas. There is no in-process fallback — by design, since a per-pod counter would silently permit `2 × limit` on a two-replica deployment.

**No burst allowance.** A merchant legitimately batching 50 orders at closing time is treated the same as a retry loop. If that becomes a real complaint, token bucket is the fix — it is what allows a deliberate burst followed by a sustained lower rate.

**Unauthenticated floods are nginx's problem.** By design: this layer never counts a request whose signature did not verify, so a spray of garbage is bounded by `limit-rps: 20` at the ingress and by nothing here. That is the correct division, but it means the two layers must be tuned as a pair.

---

*Related: [merchant-signature.md](merchant-signature.md) (the verification design), [merchant-api-response-codes.md](merchant-api-response-codes.md) (the response contract), [tls.md](tls.md).*
