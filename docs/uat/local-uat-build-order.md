# Build Order: the Local UAT Harness

Companion to [local-uat-harness.md](local-uat-harness.md). That document is the
design and the reasoning; this one is the order to build it in.

**The one rule: do not start a step until you have seen the previous step's
sighting.** Every step below ends with something observable - a response body, a
row, a log line. That is not ceremony. The whole point of this harness is to
watch the system work with your own eyes, and a harness built three steps deep
before anything is checked fails in a way where you cannot tell which of the
three steps broke it. Each sighting narrows the next failure to one step's worth
of code.

Steps 0-2 add no features at all. They are the ones that cost an evening if
skipped, because each hides itself as a different problem: a boot error that
looks like bad code, a 400 that looks like an auth failure, a connection refused
that looks like a crash.

---

## Where the tree stands (9 Nov 2026)

Verified against the working tree. **Steps 0-2 are done. Start at Step 3.**

| Step | State |
|---|---|
| 0 - compile errors | Done. `npx tsc --noEmit -p tsconfig.json` is clean, and `JatelindoTransferInterface` / `jatelindo.contract.dto` are gone from the tree |
| 1 - boot under `NODE_ENV=test` | Done. `/health` comes from [libs/health](../../libs/health/src/health.controller.ts) for auth, config and transaction, and from a local controller in dashboard, settlement and uat-local |
| 2 - the two loopback traps | Done. uat-local binds `127.0.0.1` at [main.ts:44](../../apps/uat-local/src/main.ts:44), and both allowlists are filled in [apps/transaction/.env.test](../../apps/transaction/.env.test) |
| 3 - onboard the merchant | Sighting 3 met 3 Nov against the seeded `merchant1`, in `test/merchant.onboard.spec.ts`. **Being redone through the real admin path, and that is where the work is** - see below |
| 4 - the fake MotionPay provider | Not started. `test/upstream.spec.ts` is a one-line stub |

All of it is on `dev`, through PR #3 (`7d9a6c3`) and the commits around it:
`c4a6504` bound the harness and filled the allowlists, `8657115` corrected what
`BlockList` does with IPv4-mapped addresses, `55e127d` added the merchant signer.

Sighting 1 was green - six 200s - on 3 Nov. That one line is from the log rather
than re-measured: the stack is not running today, so everything else above was
read off the tree instead.

`apps/uat-local` is no longer a bare scaffold, though it is close: `AppModule`
with `ScheduleModule.forRoot()`, a `DatabaseModule` wiring the auth, config and
transaction Prisma clients, `GET /app`, `GET /health`, and
`merchant/merchant-signer.ts` - a pure `signRequest` helper, with no controller
and no module of its own. Still no `provider/`; that is Step 4.

**Step 3 below is no longer the plan.** It says to onboard the seeded
`merchant1@example.com` by hand, which is how Sighting 3 was first met. The tree
has moved past that: `test/agent-onboard.spec.ts` logs in as `superadmin` and
registers `AGENTS` through `POST /api/v1/user/admin/register-agent`, then
`test/merchant-onboard.spec.ts` logs in as `agentinternal` and registers
`MERCHANTS` through `register-merchant`. That is a better harness than the step
describes - it exercises the onboarding path a real merchant takes, which the
named principals landing on 5 Nov is what made possible - so the step is the
thing that is out of date, not the tree.

Both run under the root jest config, which picks up `*.spec.ts` anywhere.
`test:e2e` in `package.json` is **not** the way in: it points at
`./apps/pg/test/jest-e2e.json`, a path that does not exist.

**What the open `it('fee config')` has to do, because it is not one call.**
Registering a merchant does not give it fees, and routing *is* the fee row:
`profile-provider.service.ts` resolves a provider from the merchant's own
`MerchantFee`, so a freshly registered merchant 403s out of `resolveProvider`
until one exists. `POST /super-admin/base-fee` covers only the provider side of
that. Watch the second hazard there too - that resolve is a `findFirstOrThrow`
with **no `orderBy`**, so two rows matching one (paymentMethod, transactionType)
pairing make the chosen provider depend on Postgres row order.

**Resolved 2026-11-11, and `test/` is now split in two.** `test/inject/` holds
the ordered data-injection steps - numbered by filename, run by
`npm run test:inject` - and the specs beside it assert behaviour. See
`apps/uat-local/test/inject/README.md`.

Sighting 3 moved out of the 248-line `merchant.onboard.spec.ts` into
**`test/merchant-signature.spec.ts`**, where it belongs: it is the first
behaviour check rather than an onboarding step. The secret rotation, the webhook
registration, the `clientId` read, the signed `POST /open/v1/test` and the
replay all carried over, and a tampered-signature case was added. Measured
2026-11-11 against a live stack: Sighting 3 answers **HTTP 201 `2000000`** with
the merchant's own `userId`, the replay **409 `4090000`** "X-Nonce already
used", and a signature with one hex digit flipped **401 `4010008`** "Invalid
X-Signature" - the last of which has to be distinguished from `4010002`,
the *format* complaint, because lengthening a signature is refused on shape
before the HMAC is ever compared.

**One sentence in Step 1 has gone stale, and it is harmless.** Sighting 1 says
every app binds `'localhost'` outside production, which Step 2b then changed for
uat-local. The probe loop still passes, and so will Appendix A's
`http://localhost:3010/motionpay`: curl tries every address the resolver
returns, and Node does the same - `net.getDefaultAutoSelectFamily()` is `true`
on the Node 24 here, measured on this machine - so a *name* falls back from
`::1` to `127.0.0.1`. An **IP literal** gets no such fallback, which is the
whole reason Step 2b matters.

---

## Step 0 - Clear the last two compile errors

**Goal.** A clean typecheck. Two lines and an empty directory.

**0a. The dead contract import.**
`apps/transaction/src/upstream/jatelindo/transfer/jatelindo-transfer.service.ts`
still refers to the deleted `jatelindo.contract.dto.ts`. Drop both halves:

- line 35, `import { JatelindoTransferInterface } from '../dto/jatelindo.contract.dto';`
- the `implements JatelindoTransferInterface` on the class declaration below it

Everything else in that file stays. `systemReference: params.systemReference`
is a real fix - `UpstreamTransferResponseSchema` requires the field and the
service was never setting it - and `private` on `accountInquiry` / `payment` is
correct, since nothing outside the class calls them.

**0b. The supertest import.** `apps/uat-local/test/app.e2e-spec.ts` has
`import * as request from 'supertest'`, which is not callable under this repo's
`esModuleInterop`:

```ts
import request from 'supertest';
```

**0c. The empty directory.** `apps/transaction/src/upstream/jatelindo/mock/`
has no files left in it but is still on disk. Git will not notice it either
way, which is exactly why it is worth deleting now rather than finding it in
three weeks:

```bash
rmdir apps/transaction/src/upstream/jatelindo/mock
```

> **Sighting 0.** `npx tsc --noEmit -p tsconfig.json` prints nothing.
>
> Worth a commit of its own before Step 1 - it is the point where the DI-mock
> attempt is fully unwound and the tree builds, and that is a useful thing to
> be able to come back to.

---

## Step 1 - Make the whole stack start under `NODE_ENV=test`

**Goal.** Six windows, six running apps, against `pgtest`. Still no new
features.

**1a. The dashboard cannot reach `pgtest` yet.** It is the only app that still
hardcodes its env files, at
[app.module.ts:83](../../apps/dashboard/src/app/app.module.ts:83):

```ts
envFilePath: ['apps/dashboard/.env.local', 'apps/dashboard/.env'],
```

so `NODE_ENV=test` does nothing to it. Three changes, and all three are needed
together:

1. switch it to `envFilePath('dashboard')`, like the other five apps;
2. create `apps/dashboard/.env.test` (Appendix A has the key list);
3. add the missing `dotenv -v NODE_ENV=development --` to the `start:dashboard`
   script in `package.json`. The other four app scripts already have it. Once
   the dashboard reads `envFilePath`, an unset `NODE_ENV` resolves to
   `apps/dashboard/.env.undefined` - see
   [env-file-path.ts](../../libs/configuration/src/env-file-path.ts) - so
   `npm run start:dashboard` would stop working the moment change 1 lands.

The dashboard's DSN is deliberately **not** schema-qualified: it uses the
merged schema over all three, so `.env.test` carries
`postgresql://…/pgtest?TimeZone=Asia/Jakarta` with no `&schema=`.

**1b. `scripts/test-start-all.js` is missing two apps.** The dashboard, because
onboarding goes through it, and `uat-local`:

```js
const apps = [
  'auth',
  'config',
  'transaction',
  'settlement',
  'dashboard',
  'uat-local',
];
```

Order matters, and `uat-local` goes **last**: the fake provider has to be
listening before transaction makes its first upstream call, transaction has to
be listening before the merchant cron fires, and the merchant cron needs a
secret that does not exist until onboarding has run.

**1c. `scripts/test-db-all.js` is already correct.** Its three apps - auth,
config, transaction - are the three that own migrations. `apps/settlement` has
no `prisma/` directory at all, and the dashboard reads the other three's
schemas rather than owning one.

> This corrects item 6 of §7 in the design doc, which suggested adding
> settlement. There is nothing to add.

**1d. Settlement boots fine under test.** Worth saying because it looks like it
should not: `apps/settlement/.env.test` has its four AUTH and CONFIG DSNs
commented out, and `SettlementConfig` reads them with `getOrThrow`. But all
four providers are also commented out in
[database.module.ts:29](../../apps/settlement/src/database/database.module.ts:29),
and that module's own doc block explains why the DSNs are commented to match -
`getOrThrow` cannot fire for a key nothing reads. The only other getter
settlement uses, `POD_NAME`, is a plain `get` with a hostname fallback.
Leave all of it as it is.

> **Sighting 1.** `node scripts/test-db-all.js`, then
> `node scripts/test-start-all.js`. Six windows come up. Then one probe per
> app:
>
> ```bash
> for p in 3000 3001 3002 3003 3004 3010; do
>   curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:$p/health"
> done
> ```
>
> **Six 200s.** `/health` and not `/open/v1/ping`: the merchant signature guard
> covers `/open/v1/*`, so a bare ping answers 401 and says nothing about the
> stack. And over `localhost`, never `127.0.0.1` - every app binds `'localhost'`
> outside production, which Node resolves on this machine to `::1` only.
>
> A 200 here is more than an open port, because each body names what that app
> reached: auth, config and transaction report Redis, three TCP peers and both
> Prisma pools; settlement reports Redis and the two transaction pools;
> uat-local reports Redis and all six per-schema pools; the dashboard reports
> Redis and its two pools, from a local controller rather than `@app/health`,
> since it holds no TCP client to anything. The dashboard's Swagger at
> `http://localhost:3000/swag-rwz` loads as well. If a window dies, it dies
> now, with nothing of yours in the stack to blame.

---

## Step 2 - The two loopback traps

**Goal.** Fix two things that will otherwise cost you an evening each, before
anything depends on them. Both were measured on this machine, not inferred.

**2a. `register-webhook-url` rejects `localhost`.** `RegisterWebhookUrlDto`
puts `@IsUrl()` on both fields, and `validator` 13.15.35 defaults to
`require_tld: true`, so:

| URL | `isURL` |
|---|---|
| `http://localhost:3010/merchant/webhook/payin` | **false** |
| `http://127.0.0.1:3010/merchant/webhook/payin` | true |
| `http://uat.local:3010/merchant/webhook/payin` | true |

Register the webhook URLs as **`127.0.0.1`**, not `localhost`. A 400 here reads
like an auth problem and sends you back to re-check the bearer token.

**2b. `uat-local` is not listening on `127.0.0.1`.**
[main.ts:40](../../apps/uat-local/src/main.ts:40) passes `'localhost'` as the
bind address outside production, and on this machine Node resolves that to
`::1` **only**:

```
bound: {"address":"::1","family":"IPv6","port":3999}
127.0.0.1 -> ERROR ECONNREFUSED
::1       -> ok
localhost -> ok
```

Either trap alone is harmless. Together they deadlock: 2a forces the stored
webhook URL to be `127.0.0.1`, and 2b means nothing answers there. Bind the
harness explicitly in the test profile - `'127.0.0.1'`, or `'0.0.0.0'` if you
ever want to reach it from another device:

```ts
/// A fixed bind address, not `localhost`, because the webhook URL stored in
/// auth.MerchantSignature has to be an IP literal - `@IsUrl()` rejects
/// `localhost` - and `listen(port, 'localhost')` binds ::1 only.
const host = appConfig.IS_PRODUCTION ? '0.0.0.0' : '127.0.0.1';
await app.listen(appConfig.PORT, host);
```

Our own outbound calls can keep using `localhost` - it resolves to the same
`::1` the other apps bind - so `TRANSACTION_BASE_URL=http://localhost:3003`
works as written.

**2c. If you set the callback allowlists, they need both addresses.** They are
**comma**-separated, not semicolon (`motionpay.config.ts:98`,
`jatelindo.config.ts:48`), and `isIpAllowed` matches each entry within its own
family through Node's `BlockList`. `BlockList` *does* normalise IPv4-mapped
IPv6 - `::ffff:203.0.113.5` matches an entry of `203.0.113.5`, and
[merchant-ip.spec.ts:57](../../libs/microservice/src/merchant-ip.spec.ts:57)
tests it - but `::1` is a real IPv6 address rather than a mapped IPv4 one. So a
callback arriving over IPv6 loopback presents `request.ip` as `::1`, which an
allowlist of `127.0.0.1` alone rejects:

```ini
MOTIONPAY_CALLBACK_ALLOWED_IPS="127.0.0.1,::1"
JATELINDO_CALLBACK_ALLOWED_IPS="127.0.0.1,::1"
```

> This corrects §3 of the design doc, which gives `127.0.0.1` alone.

Leaving them empty is also fine - empty means unrestricted - and each callback
then logs a warning saying so. Setting them is better: it is the one chance to
see that code path do something before production, where it is the callback's
only authentication.

> **Sighting 2.** No sighting of its own. You will see 2a and 2b in Step 3,
> where they would otherwise have cost you the evening.

---

## Step 3 - Onboard the fake merchant, by hand

**Goal.** A merchant with a secret and two registered webhook URLs, and the
first signed request accepted. No provider involved yet.

**What the seed already gives you.** `authDevSeed` creates
`merchant1@example.com` … `merchant4@example.com`, password `password123456789`,
each with a `MerchantSignature` row holding a generated `clientId` - but
`secretKey`, `payinUrl` and `payoutUrl` are all null. `configDevSeed` then adds
`MerchantFee` rows for **merchant1 and merchant2 only**. Merchants 3 and 4 have
no fee rows, so they get a 403 from `resolveProvider` - which makes merchant3
the clean place to put Jatelindo in Step 8.

Use **merchant1**: its agent share is zero and its whole internal cut goes to
Agent Internal, so the first fee breakdown you read has the fewest moving parts.

**The three calls.** The dashboard's global prefix is `/api/v1`:

1. `POST /api/v1/login` with `{ email, password }` → bearer token;
2. `GET /api/v1/merchant-signature/generate-secret-key` → the secret, in the
   response body, **shown once**;
3. `POST /api/v1/merchant-signature/register-webhook-url` with
   `{ payinUrl, payoutUrl }` on `http://127.0.0.1:3010/...` - see Step 2a.

**Do not copy the credentials into `.env`.** The secret is stored in plaintext
at `auth.MerchantSignature.secretKey`
([merchant-signature.service.ts:63](../../apps/dashboard/src/modules/merchant-signature/merchant-signature.service.ts:63)),
and `apps/uat-local` already has the auth Prisma client wired. So the merchant
module can read `clientId` and `secretKey` from the database when it needs
them, and the harness survives a database reset plus re-onboard with no
copy-paste and no stale `.env`.

> This supersedes §7 items 2 and 7 of the design doc, which put
> `UAT_MERCHANT_CLIENT_ID` / `UAT_MERCHANT_SECRET` in `.env.test`. Reading
> them is strictly less to go wrong - and it is also a reminder that these
> secrets are readable to anything with a database connection, which is the
> open production risk, not a harness detail.

**Keep onboarding out of `npm test`.** The root jest config matches
`.*\.spec\.ts$`. Name the file `*.onboard-spec.ts` and give it its own config
next to `jest-e2e.json`, with `testRegex: ".onboard-spec.ts$"` and its own npm
script - `-spec.ts` does not match `.spec.ts`, so the root run leaves it alone.
This is the same trick the existing e2e config uses, and it matters because
onboarding needs a live stack, which a unit run does not have.

**Write the signer by hand.** Do not import `@app/signature` into `uat-local`.
A merchant that signs with our own helper cannot catch a bug in our own
helper - the same argument the design doc makes in §2 about not importing the
TypeBox schemas. The rules, from
[hmac-signature.ts:76](../../libs/signature/src/hmac-signature.ts:76) and
[merchant-signature.guard.ts:72](../../apps/transaction/src/api-v1/signature/merchant-signature.guard.ts:72):

| Element | Rule |
|---|---|
| canonical string | `METHOD:endpoint:nonce:bodyHash:timestampIso`, joined with `:` |
| `endpoint` | `req.url` verbatim, query string included. Transaction sets no global prefix, so nothing is stripped |
| `bodyHash` | lowercase hex SHA-256 of the **exact bytes sent**. Serialise once, hash that string, send that string |
| empty body | `EMPTY_BODY_SHA256`, the SHA-256 of the empty string |
| signature | HMAC-SHA512, lowercase hex, 128 characters |
| headers | `x-client-id`, `x-timestamp`, `x-nonce`, `x-signature`, all four required, none repeated |
| `x-timestamp` | ISO-8601 **with** offset (`Z` or `±HH:MM`), within ±300s of server time |
| `x-nonce` | `^[A-Za-z0-9._~-]{8,128}$`, no colon, **new on every attempt** |
| content-type | must start `application/json` on any POST, even with no body |

> **Sighting 3.** A signed `POST /open/v1/test` returns
> `{ "merchantUserId": <merchant1's id> }`. That one response proves the
> signature guard, the nonce store, the auth TCP hop, the CLS principal and
> the response interceptor - with no provider, no upstream and no callback
> anywhere in the picture. It is the single highest-value checkpoint in this
> document.
>
> If it fails, the body hash is the usual culprit: re-serialising the parsed
> object instead of hashing the bytes you sent.

---

## Step 4 - The fake MotionPay provider, create only

**Goal.** A QR string that came out of your own fake, and a `PENDING` row.

Build `src/provider/` from §6 of the design doc, but only the parts this step
needs: `scenario.ts`, the store, and the MotionPay controller's two routes. No
dispatcher yet.

**Routes.** The client appends `MOTIONPAY_QRIS_ENDPOINT`
([motionpay.constant.ts:1](../../apps/transaction/src/upstream/motionpay/helper/motionpay.constant.ts:1))
to the base URL, so with
`MOTIONPAY_QRIS_BASE_URL="http://localhost:3010/motionpay"` the fake serves:

- `POST /motionpay/priv/v1/pg/token`
- `POST /motionpay/payment/api/v1/qris/payment`

Leave `/payment/api/v1/qris/payment-status` a stub for now - nothing calls it
since `503a602`.

**The envelope asymmetry is the first thing that bites.** The token endpoint
signals success with `code: 200`; the payment endpoints with `code: 0`. Get it
backwards and the client rejects a response that looks perfectly fine in the
log.

> **Sighting 4.** Re-run the signed purchase from Step 3 against
> `POST /v1/qr/qr-mpm-generate` with
> `{ amount, merchantReference, expireSeconds }` - `expireSeconds` between 600
> and 86400. You get back a `qrString` your own fake minted, and
> `PurchaseTransaction` has a `PENDING` row carrying the `providerReference`
> the fake chose. Two windows now tell one story.

---

## Step 5 - The merchant's webhook receiver

**Goal.** Somewhere for the payin and payout notifications to land. Ten minutes
of work, deliberately placed **before** the dispatcher.

Two plain controllers under `src/merchant/`:

- `POST /merchant/webhook/payin`
- `POST /merchant/webhook/payout`

**No verification needed, because we send these unsigned.**
`PurchaseWebhookService.notifyMerchant` posts the body with no signature
headers at all. Log the payload, count it, return 200.

**Why before the dispatcher.** Step 6 ends in `settle()`, whose last act is
`notifyMerchant` - and that call is deliberately non-fatal, so a missing
receiver produces an error log reading *"transaction IS settled, merchant was
not notified"* and nothing else. You would be unable to tell that from a real
delivery failure. Build the receiver first and the absence of that line is
meaningful.

> **Sighting 5.** `curl -X POST http://127.0.0.1:3010/merchant/webhook/payin`
> with any JSON body shows up in the `uat-local` window. Confirms Step 2b at
> the same time: if this is `ECONNREFUSED`, the bind address is still
> `localhost`.

---

## Step 6 - The callback dispatcher

**Goal.** The first purchase that settles end to end. This is the step the whole
harness exists for.

Add the dispatcher and the payload builders from §6.4 and §6.5 of the design
doc. It posts to `POST http://localhost:3003/callback/motionpay/qris` on a
`CronExpression.EVERY_10_SECONDS` schedule with `waitForCompletion: true`.

Set `MOTIONPAY_CALLBACK_ALLOWED_IPS="127.0.0.1,::1"` now - see Step 2c - so the
allowlist is exercised rather than skipped.

Start with the `SUCCESS` band only. Get one clean settlement before letting the
switchboard pick anything else.

> **Sighting 6.** Within ten seconds of a purchase, in this order:
>
> 1. the transaction window logs *"QRIS transaction settled from callback"*;
> 2. `PurchaseTransaction.status` is `SUCCESS` with a non-null `paidAt`;
> 3. `PurchaseFeeDetail` has one row per party - merchant, provider, internal,
>    and one per agent;
> 4. the balance tables carry a movement crediting merchant1 and Agent Internal
>    into the `PENDING` bucket, and **no leg for the provider's cut** - that is
>    deducted upstream and never lands in a balance we track;
> 5. the payin webhook arrives in the `uat-local` window.
>
> Five observations, all from one randomly-amounted purchase nobody typed. If
> you only ever get this far, the harness has already paid for itself.

---

## Step 7 - The merchant crons

**Goal.** Traffic without you. Purchases first, then payouts.

Two crons in `src/merchant/`, signing with the Step 3 signer:

- `POST /v1/qr/qr-mpm-generate` - `{ amount, merchantReference, expireSeconds }`
- `POST /v1/transfer/bank` - `{ amount, merchantReference, accountNumber,
  bankCode }`, plus optional `accountHolderName` and `note`

A 200 on the transfer means **accepted, not paid** - `data.status` is normally
`PENDING` and the real outcome arrives on `payoutUrl`. A merchant cron that
treats the 200 as success is testing the wrong contract.

Add the purchase cron, watch it for a few minutes, then add the disbursement
cron. Both at once and a failure belongs to either.

> **Sighting 7.** Leave it running for ten minutes and come back to a table of
> settled transactions with fee rows and balance movements, none of which you
> typed. This is the thing you described wanting: watching it be fine.

---

## Step 8 - Jatelindo: the config gap first, then the fake

**Goal.** A payout over a second provider. The config work comes first because
without it the fake is never called and you will be debugging a working system.

**8a. Nothing routes to Jatelindo today.** `DEV_BASE_FEES` in
`config-dev.seed.ts` is MOTIONPAY for every rail, plus one INTERNAL row.
Routing is the merchant's `MerchantFee` row - `resolveProvider` asks config,
which reads the fee and returns `baseFee.providerName`. So a bank payout from
merchant1 goes to **MotionPay**, and the Jatelindo client is simply never
reached.

**8b. Use merchant3, not a second row on merchant1.**
[profile-provider.service.ts:54](../../apps/config/src/profile-provider/profile-provider.service.ts:54)
resolves with `findFirstOrThrow` and **no `orderBy`**. Two `MerchantFee` rows
for the same (payment method, transaction type) pairing therefore make the
provider depend on Postgres row order - a harness whose routing changes after a
`VACUUM` is worse than no harness. One provider per pairing per merchant.

So: add a `JATELINDO` / `TRANSFERBANK` / `DISBURSEMENT` `BaseFee`, and a
`MerchantFee` for merchant3 pointing at it, through
`POST /api/v1/merchant/:merchantId/provider` - which despite its path takes fee
rows, as its own summary says. Keep merchant3's agent fee at zero: it has no
`AgentShareholder` rows, and a non-zero agent cut with no shareholders to split
it between has nowhere to go.

**8c. Then the fake.** With
`JATELINDO_TRANSFER_BASE_URL="http://localhost:3010/jatelindo"` and
`JATELINDO_ENDPOINT` from
[jatelindo.constant.ts:3](../../apps/transaction/src/upstream/jatelindo/helper/jatelindo.constant.ts:3),
the controller is `@Controller('jatelindo/Host/Transfer')` with
`Session/Login`, `Account/BalanceInquiry`, `Transaction/Inquiry`,
`Transaction/SingleTransfer` and a stubbed `Transaction/Status`. §6.2 of the
design doc has it written out, including the response-code mapping: `A00`
succeeds, `A01` / `E99` / `E18` are pending, everything else fails.

**8d. Collect the bug you already know about.** The `DisbursementResponse[0]`
read in `buildTransferResponse`
([jatelindo-transfer.service.ts:148](../../apps/transaction/src/upstream/jatelindo/transfer/jatelindo-transfer.service.ts:148),
after Step 0's edit) has no non-empty check, and the TypeBox schema permits
`[]`. Make the fake answer one `A01` with `DisbursementResponse: []` and you
get a `TypeError` inside the client instead of a handled upstream error. Fix it
once you have watched it happen - a bug you have seen is worth more than a bug
you were told about.

> **Sighting 8.** A payout from merchant3 reaches the Jatelindo fake, comes
> back `A01` → `PENDING`, and settles on the next dispatcher tick via
> `POST /callback/jatelindo/transfer`. Then the empty-array case throws, in
> your own harness, on purpose.

---

## Step 9 - Turn the switchboard on

**Goal.** The nine non-happy paths, one at a time.

Wire `scenarioFor(amount)` in and walk the bands from §4 of the design doc.
Because the scenario is keyed off the amount's last two digits, every outcome is
reproducible from the log line that caused it: `…99` always times out, `…84`
always delivers twice.

Suggested order, easiest to diagnose first:

1. `REJECTED_AT_CREATE` - the error path on create, nothing async
2. `FAILED_BY_CALLBACK` - a terminal status that is not SUCCESS
3. `EXPIRED` - needs all three of MotionPay's expiry signals together
4. `DUPLICATE_CALLBACK` - the terminal-status idempotency guard
5. `OUT_OF_ORDER` - FAILED then SUCCESS; the second must be ignored
6. `UNKNOWN_REFERENCE` - logged as evidence, no transaction touched
7. `CREATE_500`, `CREATE_TIMEOUT` - the client's own error handling
8. `NEVER_DELIVERS` - the one that proves nothing sweeps up a stuck PENDING

`NEVER_DELIVERS` deserves its own note. It is not a provider bug, it is the
question "what closes out a transaction nobody ever told us about", and the
honest answer today is nothing does. Seeing a row sit `PENDING` forever is the
most useful thing on this list.

> **Sighting 9.** Ten amounts, ten different outcomes, each one matching the
> `scenario` field logged by the fake.

---

## Step 10 - Watch settlement

**Goal.** Watch the second half of the system - the part that reads what Steps
6-9 wrote.

Settlement runs on its own crons against the same `pgtest`. With real traffic
behind it you can watch `SettlementRun` rows appear, get claimed with a
`claimedBy` naming the process, and move the day's `PENDING` balances to
`AVAILABLE`. [docs/batch/](../batch/) describes the pipeline and was reviewed
against the code on 2 Nov 2026.

What this *cannot* show you is two pods racing for the same run. The
`FOR UPDATE SKIP LOCKED` claim exists for that case, and one process cannot
produce it.

> **Sighting 10.** A settlement run claims work it found, and a balance moves
> bucket without you asking it to.

---

## Appendix A - Every env change, in one place

**`apps/transaction/.env.test`** - repoint the two upstreams at the fake and
switch the allowlists on:

```ini
MOTIONPAY_QRIS_BASE_URL="http://localhost:3010/motionpay"
JATELINDO_TRANSFER_BASE_URL="http://localhost:3010/jatelindo"
MOTIONPAY_CALLBACK_ALLOWED_IPS="127.0.0.1,::1"
JATELINDO_CALLBACK_ALLOWED_IPS="127.0.0.1,::1"
```

Keep the real sandbox URLs in a comment next to them. The whole argument for
this design is that the only difference between harness and sandbox is these
lines, and that is easier to believe when both are visible.

**`apps/uat-local/.env.test`** - add:

```ini
TRANSACTION_BASE_URL=http://localhost:3003
DASHBOARD_BASE_URL=http://localhost:3000

# Which seeded merchant the harness acts as. Credentials are read from
# auth.MerchantSignature at use time, not stored here - see Step 3.
UAT_MERCHANT_EMAIL=merchant1@example.com

UAT_PURCHASE_PER_MINUTE=6
UAT_DISBURSEMENT_PER_MINUTE=3
UAT_AMOUNT_MIN=10000
UAT_AMOUNT_MAX=500000
```

**`apps/dashboard/.env.test`** - new file. Copy `.env.local` and change: `PORT`
stays 3000, `NODE_ENV=test`, and the two DSNs point at `pgtest` with no
`&schema=`. `JWT_ACCESS_TOKEN_SECRET` must match whatever issues the tokens you
present. The rest - Redis, the `MERCHANT_SIGNATURE_*` tolerances, the three
`*_TTL_SECONDS` - carries over unchanged.

---

## Appendix B - What each sighting actually proves

Worth keeping straight, so the harness is not trusted for more than it shows.

| Sighting | Proves | Does not prove |
|---|---|---|
| 1 | six apps boot against `pgtest` and reach Redis and their pools | anything about behaviour |
| 3 | the whole merchant-auth path, end to end | that a real merchant's SDK signs the same way |
| 4 | the client speaks the provider's create contract **as we read it** | that the provider agrees with our reading |
| 6 | fees, balances and the merchant webhook, from one real callback | that the callback was genuine - nothing verifies it |
| 7 | the system survives sustained traffic | concurrency; it is one process |
| 8 | a second provider routes, and a real latent bug | Jatelindo's actual behaviour |
| 9 | our handling of nine failure modes | that these are the nine that happen |
| 10 | settlement reads what transaction wrote | the multi-pod claim path |

Two of those gaps are worth saying plainly, because they are open production
risks rather than harness limitations:

- **Nothing verifies a callback.** `503a602` removed `confirmWithProvider`, so a
  provider callback is acted on unverified, and both IP allowlists ship empty.
  Step 2c turns them on locally; production still needs either them or a
  signature check.
- **Merchant secrets are readable.** Step 3 reads `secretKey` straight out of
  the database because it is stored in plaintext, and the Redis cache holds it
  in plaintext too. Convenient here; worth fixing before production.

The dispatcher's 500-retry handling also stays unexercisable for now: with
`confirmWithProvider` gone, nothing returns `retry: true`, so `askRetry` is dead
in both webhook services and the `500` branch in all four callback controllers
is unreachable. The harness is built for it - `CREATE_TIMEOUT` plus a flaky
`Transaction/Status` are the two cases that will prove it - the moment a
confirmation step comes back.
