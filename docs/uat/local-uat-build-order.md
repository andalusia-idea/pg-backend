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

## Where the tree stands (18 Nov 2026)

Verified against the working tree and a live stack. **Steps 0-9 are done. Start
at Step 10.**

The harness is now in the state Step 10 wants: `UAT_SWITCHBOARD_ENABLED=true`
and the purchase cron running at six a minute, so the traffic settlement reads
carries the full band mix rather than only successes.

| Step | State |
|---|---|
| 0 - compile errors | Done. `npx tsc --noEmit -p tsconfig.json` is clean, and `JatelindoTransferInterface` / `jatelindo.contract.dto` are gone from the tree |
| 1 - boot under `NODE_ENV=test` | Done. `/health` comes from [libs/health](../../libs/health/src/health.controller.ts) for auth, config and transaction, and from a local controller in dashboard, settlement and uat-local |
| 2 - the two loopback traps | Done. uat-local binds `127.0.0.1` at [main.ts:44](../../apps/uat-local/src/main.ts:44), and both allowlists are filled in [apps/transaction/.env.test](../../apps/transaction/.env.test) |
| 3 - onboard the merchant | Done, but **not as this step describes it** - see the notes below. The ordered chain in `test/inject/` (steps 01-07) registers agents, merchants, base fees, merchant fees, settlement policies and signing credentials through the real admin path. Sighting 3 lives in `test/merchant-signature.spec.ts` |
| 4 - the fake MotionPay provider | Done, `8bb4947`. QRIS only: Transfer and Biller are not reachable in production, confirmed with the provider, so there is nothing to imitate |
| 5 - the merchant's webhook receiver | Done, `d75ec42` |
| 6 - the callback dispatcher | Done, `1011732`. Sighting 6 met 17 Nov: created 15:06:02, settled 15:06:20 - eighteen seconds, untouched |
| 7 - the merchant crons | Done, `7935cc1`, but **the purchase half only**. Sighting 7 met 17 Nov: six a minute for six minutes, 42 settled, 210 fee rows and 126 balance legs nobody typed, and the entries-vs-snapshot invariant exact on all four holders. No payout cron: Step 7 asks for it second, and it had to wait for 8c to repoint `JATELINDO_TRANSFER_BASE_URL` off the provider's real dev host |
| 8 - Jatelindo | Done. 8a and 8b were already done by the inject chain **and both of their premises are now false** - see the step. 8c is the fake; 8d collected its bug and it was worse than advertised; 8f is a second bug the step produced on its own, now fixed too. Sighting 8 met 18 Nov: created 02:40:45, settled 02:41:00 |
| 9 - turn the switchboard on | Done, 18 Nov, and it really was the one env line - `scenarioFor` has stamped every band since Step 4, so no code changed. Sighting 9 met: ten amounts, ten outcomes, each matching the `scenario` the fake logged. One finding, 9a: `CREATE_TIMEOUT` leaves a row whose `providerReference` was never written, so the provider's SUCCESS callback can never match it and the purchase stays PENDING for ever |
| 10 - watch settlement | Not started |

Steps 0-2 landed on `dev` through PR #3 (`7d9a6c3`) and the commits around it:
`c4a6504` bound the harness and filled the allowlists, `8657115` corrected what
`BlockList` does with IPv4-mapped addresses, `55e127d` added the merchant signer.

**Steps 3-6 landed 11-17 Nov.** The inject chain is `bcb6f06` and `b3a57bc`
with the steps before them; `8bb4947` is the fake provider, `d75ec42` the
merchant's receiver, `1011732` the dispatcher. One finding came out of Step 5
and is worth knowing before reading the balance tables: `36e7fb3` stops both
movement builders creating a zero-amount leg for a `0.0000%` agent
shareholder - which `registerMerchant` writes onto every merchant - because
`assertPositiveMoney` refused it and rolled back a captured payment. See
[docs/batch/balance-explained.md](../batch/balance-explained.md).

Sighting 1 was green - six 200s - on 3 Nov. That one line is from the log rather
than re-measured: the stack is not running today, so everything else above was
read off the tree instead.

**Step 7 landed 17 Nov and Step 8 on 18 Nov.** `7935cc1` is the purchase cron;
Step 8's fake, its callback payload and the `DisbursementResponse[0]` fix came
with it. Two findings came out of Step 8 and both are about a payout that does
not complete: the empty-array read marked an accepted `A01` as FAILED, which is
the one transition the response-code table exists to prevent, and a payout that
fails at create never releases the merchant's `RESERVED` balance at all. Both
are fixed; the second one is 8f, and it brought the first spec this service has
ever had with it.

`apps/uat-local` is no longer a bare scaffold, though it is close: `AppModule`
with `ScheduleModule.forRoot()`, a `DatabaseModule` wiring the auth, config and
transaction Prisma clients, `GET /app`, `GET /health`, and
`merchant/merchant-signer.ts` - a pure `signRequest` helper, with no controller
and no module of its own. Still no `provider/`; that is Step 4.

That paragraph described 9 Nov. The app now carries `provider/` - the fake
MotionPay QRIS service **and the fake Jatelindo transfer service**, the scenario
switchboard, the in-memory store shared by both, and the callback dispatcher
that delivers for both - plus `merchant/` (the signer, the webhook receiver and
its store, and the purchase cron) and `config/`, a `UatConfig` in the
`libs/configuration` shape kept in the app because nothing outside it has any
business reading those keys.

The two fakes share the store and the dispatcher and no helper of their own.
That is deliberate rather than untidy: they imitate unrelated providers, so each
hand-writes its own payload shapes and its own response codes. A fake that read
our parser could not catch a wrong parser, and a helper both reached for would
be the start of a harness where changing one silently changes the other.

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
>    and one per agent, **including an agent whose share is `0.00`**;
> 4. the balance tables carry a movement crediting `MERCHANT 27`, `INTERNAL 0`
>    and `AGENT 23` into the `PENDING` bucket - three legs, and **no leg for
>    the provider's cut**, which is deducted upstream and never lands in a
>    balance we track;
> 5. the payin webhook arrives in the `uat-local` window.
>
> Five observations, all from one randomly-amounted purchase nobody typed. If
> you only ever get this far, the harness has already paid for itself.
>
> **Corrected 17 Nov 2026.** Item 4 read *"crediting merchant1 and Agent
> Internal"*. Agent Internal is agent 22, which `registerMerchant` writes onto
> every merchant at `0.0000%` - and since `36e7fb3` a zero share deliberately
> gets **no** balance leg, because `assertPositiveMoney` refuses one and the
> throw rolled back a payment that had genuinely arrived. So the movement for
> `merchant1` is three legs, not four: the merchant, our own `INTERNAL` cut,
> and `agent1` on its 100% share. Agent Internal still gets a fee *detail* row
> at `0.00`, which is why item 3 now says so - the audit trail keeps every
> party, only the balance drops the zeros.

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

> **8a and 8b were already done, and both of their premises are now false.**
> Measured against pgtest on 18 Nov 2026, after the inject chain. The original
> text is kept below because the hazard 8b names is still real and still worth
> reading - it just is not triggered here. The only work left in this step was
> 8c and 8d.

**What the tree actually holds.** `config.BaseFee` carries a `JATELINDO` /
`TRANSFERBANK` / `DISBURSEMENT` row (id 3) and four `TRANSFEREWALLET_*` rows,
written through the real admin path by `02.base-fee.spec.ts` rather than coming
from `DEV_BASE_FEES`. `05.merchant-fee.spec.ts` then gives **every** merchant a
`MerchantFee` pointing at each of them, so all four merchants route their bank
and wallet payouts to `JATELINDO` and only `QRIS` / `PURCHASE` goes to
MotionPay. The Jatelindo client is reached on the first payout anyone sends.

That makes the old 8a reading dangerous rather than merely stale: it says the
client is unreachable, which is the reason someone might think it safe to point
a cron at that rail while `JATELINDO_TRANSFER_BASE_URL` still held the
provider's real dev host. It did not, and that is why Step 7 ships with
`UAT_DISBURSEMENT_PER_MINUTE=0`.

**8b's hazard is untriggered, not absent.**
[profile-provider.service.ts:54](../../apps/config/src/profile-provider/profile-provider.service.ts:54)
still resolves with `findFirstOrThrow` and **no `orderBy`**, so two
`MerchantFee` rows for one (payment method, transaction type) pairing would
still make the provider depend on Postgres row order. The inject chain writes
exactly one row per pairing per merchant, so nothing is ambiguous today. Keep
it that way; one provider per pairing per merchant.

**merchant3 is still the right merchant, for the opposite reason.** 8b said to
use it *because* it has no `AgentShareholder` rows. It has four - agent 22 at
`0.0000%` plus 23, 25 and 26 at 30/30/40 - and its `feeAgentFixed` is `30.00`,
which is what makes it the best payout on the tree: the agent cut splits three
ways and the 0% shareholder produces a `0.00` share that
[the zero-leg fix](../batch/balance-explained.md) has to drop. The merchant with
nothing to split is **merchant4**, whose agent fee is `0.00` and whose only
shareholder is the 0% one - and whose fee service emits no `AGENT` fee detail
at all, so it does not exercise the skip.

### 8e. Funding the merchant, which Step 8 needs and does not mention

`reserve()` draws on `AVAILABLE`, and a pay-in credits `PENDING`. Nothing moves
one to the other except the settlement runner - so a freshly seeded merchant
cannot pay out at all, and Sighting 8 is unreachable until settlement has run
once for it. That is Step 10's machinery arriving early; it needs no code, only
the wait.

How long the wait is depends on the merchant's own policy, which
`06.merchant-settlement-policy.spec.ts` sets differently for each on purpose:

| Merchant | Mode | First `AVAILABLE` after a purchase |
|---|---|---|
| merchant1 | `FOLLOW_UPSTREAM` | 15:00 Jakarta the next day - MOTIONPAY/QRIS is `settlementOffset: 1` |
| merchant2 | `SCHEDULED` 6-hourly + `FIXED_DELAY` | up to six hours |
| merchant3 | `SCHEDULED`, twelve release times | up to an hour |
| merchant4 | `INSTANT` | the next enqueuer tick, so ten minutes |

So: send the merchant a QRIS purchase, let Step 6's dispatcher settle it, and
wait for the window. **merchant4 is the one to use when you just want to see a
payout work**; merchant3 is the one to use when you want to see the fee split.
Keep the amount's last two digits in `00`-`69` so the purchase does not land in
a band the switchboard is holding.

---

**The original 8a and 8b, for the reasoning rather than the instructions:**

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

> **Collected 18 Nov 2026**, and it is worse than "a `TypeError` instead of a
> handled error". `DisbursementService.send` catches it, `recordFailure` finds
> no `UpstreamTransferException` to read, so `outcomeUnknown` falls back to
> `false` and the row is marked **FAILED** - for a transfer the provider
> answered `A01 REQUESTED` to. `A01` is one of the three codes the spec marks
> `Need Check = Y`, and the doc block on
> `JATELINDO_STATUS_BY_RESPONSE_CODE` says exactly why that must never become
> terminal: *a merchant told their payout failed will retry, paying the
> recipient twice*. So the empty array fails in the one direction the whole
> response-code table exists to prevent.
>
> Fixed by reading it as absent rather than fatal:
> `DisbursementResponse[0]?.transactionNumber ?? null`, with a warning when it
> fires. `bankReference` is nullable on `UpstreamTransferResponseSchema` and
> both MotionPay payout clients already send `null` - it is a reconciliation
> reference, not an outcome, and `jpaReferenceNo` identifies the transfer
> either way. The same `[0]` read on `LoginResponse` in
> `jatelindo-transfer.auth.service.ts` was already guarded by a
> `length <= 0` check, so this was the one place it was missed.
>
> The probe stays, behind `UAT_JATELINDO_EMPTY_DISBURSEMENT` - off by default,
> point it at one request. A flag rather than a scenario band because the bands
> are the pay-in vocabulary and are keyed on an amount the *merchant* chooses,
> and this is not a mood the provider is ever in.

> **Sighting 8.** A payout from merchant3 reaches the Jatelindo fake, comes
> back `A01` → `PENDING`, and settles on the next dispatcher tick via
> `POST /callback/jatelindo/transfer`. Then the empty-array case throws, in
> your own harness, on purpose.

**Met 18 Nov 2026.** Four payouts, two rails, nothing touched after the POST.

| | merchant | rail | `nominal` | `netNominal` | outcome |
|---|---|---|---|---|---|
| 1 | merchant4 | `TRANSFERBANK` | 75,000 | 76,700 | created 02:40:45, SUCCESS 02:41:00 |
| 2 | merchant4 | `TRANSFERBANK` | 75,077 | 76,777 | refused `T40` at create → FAILED. See 8f |
| 3 | merchant3 | `TRANSFERBANK` | 120,000 | 121,730 | created 03:00:52, SUCCESS 03:01:10 |
| 4 | merchant3 | `TRANSFEREWALLET_DANA` | 60,000 | 60,510 | SUCCESS, wallet addressed by `phoneNo` |

Payout 3 is the one worth reading in full, because it is the first live
exercise of the **payout half** of the zero-leg fix (`36e7fb3`), which until
now had only been typechecked. Seven `DisbursementFeeDetail` rows -
MERCHANT 121,730, PROVIDER 1,500, INTERNAL 200 and one per shareholder at
`0.00 / 9.00 / 9.00 / 12.00` - and seven `BalanceEntry` rows: the two
`PAYOUT_RESERVED` legs, then `MERCHANT 29 RESERVED DEBIT 121,730`,
`INTERNAL AVAILABLE CREDIT 200` and three agent credits. **Agent 22's `0.00`
share is itemised in the fee rows and has no balance leg**, which is exactly
the shape the fix asks for. `1,483,125 - 121,730 = 1,361,395` AVAILABLE,
`RESERVED 0.00`, and `120,000 + 1,500 + 200 + 30 = 121,730` accounts for every
rupiah that left.

The whole-tree nightly check - sum the entries, compare to the snapshot - was
exact on all sixteen holder/bucket rows afterwards, **including the stranded
`MERCHANT 30 RESERVED 76,777.00`**. That is the point of 8f: the invariant is
not the thing that will tell you.

Also proved in passing, and worth knowing before Step 10: a seeded merchant's
first `AVAILABLE` balance really does arrive on its own. merchant4's `INSTANT`
policy settled a 500,000 purchase within one enqueuer tick, and merchant3's
`SCHEDULED` policy settled three of them on its 03:00 Jakarta release - the
first `SettlementBatch` rows on the tree, and the first balances to move bucket
with nobody asking.

**8f. One bug nobody knew about, which the step produced on its own.**

Send a payout whose amount ends `75`-`77` - the `REJECTED_AT_CREATE` band - and
the fake refuses it with `T40`. That is a *verified* rejection, so the row is
correctly marked FAILED. But the merchant's money does not come back.

`reserveTransactionAndBalance` moves `netNominal` from `AVAILABLE` to
`RESERVED` before the provider is called. On failure,
`DisbursementService.recordFailure` calls `markFailedFrom` → `markFailed`,
which updates the row's status and **posts no balance movement at all**.
`buildPayoutFailed` is the correct release and is correct, but its only caller
is `postPayoutOutcome`, whose only caller is
`DisbursementWebhookService.settle` - the callback path. A payout that dies at
create never reaches it, and the gross amount sits in `RESERVED` for ever.

Measured: disbursement 2, merchant 30, `netNominal` 76,777.00. Row FAILED, two
`PAYOUT_RESERVED` entries and nothing else, snapshot left
`RESERVED 76,777.00`. **The nightly entries-vs-snapshot check passes on this** -
both sides agree - which is the case `buildPayoutCompleted`'s own comment warns
about. Nothing writes `transaction.BalanceAdjustment` today either, so there is
no recovery path at all.

> **Fixed 18 Nov 2026.** `markFailed` now writes the status and posts
> `buildPayoutFailed` as one transaction, and **the transition out of PENDING is
> what authorises the release**: `updateMany` with `status: PENDING` in its
> `where` means only the call that actually moved the row may hand the money
> back, so two concurrent failures cannot release twice.
> `BalanceEntry`'s `(holderType, holderId, bucket, reason, sourceType, sourceId)`
> unique key is the backstop, and the webhook's `TERMINAL_STATUSES` guard
> already stops a late callback settling a row this finished.
>
> It still does not throw. The caller is on an error path with a merchant-facing
> exception already chosen, so a throw would replace a precise 502 with a 500 -
> and a rolled-back transaction leaves the row PENDING with its reservation
> held, which is the recoverable state rather than the stranded one.
>
> Measured side by side in `pgtest`, which is the clearest way to read it:
>
> ```
> sourceId  bucket     direction  amount     reason
> 2         AVAILABLE  DEBIT      76777.00   PAYOUT_RESERVED   <- before the fix
> 2         RESERVED   CREDIT     76777.00   PAYOUT_RESERVED      two legs, stranded
>
> 5         AVAILABLE  DEBIT      51777.00   PAYOUT_RESERVED   <- after the fix
> 5         RESERVED   CREDIT     51777.00   PAYOUT_RESERVED
> 5         AVAILABLE  CREDIT     51777.00   PAYOUT_FAILED        four legs, net zero
> 5         RESERVED   DEBIT      51777.00   PAYOUT_FAILED
> ```
>
> Both are `T40` refusals of a `…77` amount. Afterwards merchant 30's AVAILABLE
> is unchanged at 341,023.00 and its RESERVED is 76,777.00 - disbursement 2's
> leftover and nothing else.
>
> **The fix does not reach back.** Disbursement 2 is still stranded, and a
> payout that failed before this change stays stranded wherever one exists. Only
> `pgtest` has any: the dev database has no `DisbursementTransaction` rows at
> all, so there is nothing to backfill outside the harness - and `pgtest` is
> rebuilt by `test-db-all` anyway. Left in place as the before-and-after
> exhibit.
>
> `disbursement-common.service.spec.ts` is new and guards it: seven cases over
> the release, the atomicity, the PENDING gate and the swallowed failure. Five
> of the seven fail against the previous code, which is the point - the other
> two pass vacuously, because code that never posts a movement cannot post a
> second one. It is also the first spec for any service that imports a generated
> Prisma client; see the virtual mock at the top of the file for why that took a
> workaround rather than a `moduleNameMapper` entry.

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

**Met 18 Nov 2026**, and it needed no code at all - `scenarioFor` has stamped
every band since Step 4, so the step really was the one env line. Ten amounts
on a 50,000 base, sent by hand with the purchase cron stopped so the table
could be read. Every band matched the `scenario` the fake logged for it, which
is the sighting's own wording.

| Amount | Band | Create answered | Final status | Callbacks | Legs | Fee rows |
|---|---|---|---|---|---|---|
| 50,000 | `SUCCESS` | 201 `2009000` | SUCCESS | 1 | 3 | 5 |
| 50,072 | `FAILED_BY_CALLBACK` | 201 `2009000` | FAILED | 1 | 0 | 0 |
| 50,076 | `REJECTED_AT_CREATE` | 502 `5029000` | FAILED | 0 | 0 | 0 |
| 50,080 | `EXPIRED` | 201 `2009000` | **EXPIRED** | 1 | 0 | 0 |
| 50,084 | `DUPLICATE_CALLBACK` | 201 `2009000` | SUCCESS | **2** | 3 | 5 |
| 50,088 | `OUT_OF_ORDER` | 201 `2009000` | **FAILED** | **2** | 0 | 0 |
| 50,091 | `NEVER_DELIVERS` | 201 `2009000` | PENDING | 0 | 0 | 0 |
| 50,094 | `UNKNOWN_REFERENCE` | 201 `2009000` | PENDING | 0 | 0 | 0 |
| 50,096 | `CREATE_500` | 502 `5029000` | FAILED | 0 | 0 | 0 |
| 50,099 | `CREATE_TIMEOUT` | 504 `5049000` after **15,020ms** | PENDING | 0 | 0 | 0 |

The three worth reading closely:

- **`DUPLICATE_CALLBACK` settled once.** Two callbacks, both acknowledged 200,
  both kept in `WebhookLog` as evidence - and three balance legs, not six. The
  terminal-status guard did its job, and the webhook log holding two rows while
  the ledger holds one movement is exactly the shape that lets you tell "the
  provider sent it twice" from "we counted it twice".
- **`OUT_OF_ORDER` ended FAILED**, which is the right answer and the
  uncomfortable one. The FAILED landed at `20:49:20.116` and the SUCCESS ten
  seconds later at `20:49:30.031`; the second was ignored on the terminal-status
  guard, so nobody was credited for a payment the provider's *last* word called
  successful. Correct under the current contract - a terminal state is
  terminal - but it is the case to re-read if a provider ever genuinely corrects
  itself. The ten-second gap is `advance()`'s reschedule; without it the two
  would arrive in the same tick and ordering would stop being observable.
- **`NEVER_DELIVERS` never appears in the dispatcher log at all.** Its delivery
  plan starts empty, so `due()` never returns it and the row simply sits
  PENDING. Nothing sweeps it up. That is the honest answer to *"what closes out
  a transaction nobody ever told us about"*, and it is still nothing.

`UNKNOWN_REFERENCE` behaved as designed: the callback arrived carrying
`transaction_id: GHOST-5e21fc57-…`, was recorded in `WebhookLog` with
`transactionId: null`, and touched no transaction - while the real purchase,
which *does* hold its own `providerReference`, stayed PENDING.

### 9a. `CREATE_TIMEOUT` leaves a row no callback can ever match

The design doc frames this band as *"the client gave up, but the transfer still
goes on to succeed by callback - which is exactly what makes it dangerous"*. On
the QRIS rail it is worse than that, and specifically so.

The client timed out at 15,020ms and `isTransportFailure` was true, so
`purchase-qris.service.ts` correctly refused to assert a failure and left the
row PENDING - that part is right. But the throw happens before
`recordUpstreamResult`, so **`providerReference` is never written**, and
`purchase.webhook.service.ts` finds a purchase by `findPurchase(payload.providerReference)`
and nothing else. The fake then delivered the SUCCESS at `20:49:20.131` and got
a 200:

```
WebhookLog 1889   transactionId=null   providerReference='FM-1794948547465-0008'
                  external_id='UAT-S9-CREATE_TIMEOUT-…'   status='SUCCESS'
```

So the QR exists upstream, a customer can scan and pay it, the provider reports
the payment, and we log *"QRIS callback for an unknown transaction"* and do
nothing. The row stays PENDING for ever and the merchant is never credited.
That is the failure `createPurchase`'s own doc block says the write-first
ordering exists to prevent - *"a customer can scan and pay a QR we have no
record of"* - arriving through a door that ordering does not cover. The row
exists; it is the *reference* that is missing.

**There is no safe fallback from the callback alone**, which is why this is
written down rather than patched. The callback's `external_id` is the
**merchant's** reference, not ours - `MotionPayQrisService.createQRIS` says so
outright, and `MotionPayQrisCallbackService` carries it into *both*
`systemReference` and `merchantReference` with a `// TODO Check lagi nanti`
beside it. `merchantReference` is unique only per merchant
(`@@unique([merchantId, merchantReference])`) and the callback names no
merchant, so matching on it could credit the wrong one. Nor can the provider be
asked: the only lookup MotionPay documents is by `transaction_id`, the one value
we never received.

Recovery is therefore the next day's reconciliation file, keyed on
`external_id` - which is what that field is for, and which does not exist yet.
Worth settling before production, and the `TODO` in the callback service is
pointing at it.

### 9b. Then the cron, with the switchboard left on

The ten cases above were sent by hand with the purchase cron stopped. Turning
it back on is what the harness looks like from here: `randomAmount` stops
clamping to the `SUCCESS` band the moment the switchboard is on, so the
generator starts producing the mix on its own. Thirty-seven purchases over five
and a half minutes:

| Band | Purchases | Statuses reached |
|---|---|---|
| `SUCCESS` | 24 | PENDING, SUCCESS |
| `EXPIRED` | 4 | EXPIRED |
| `FAILED_BY_CALLBACK` | 4 | FAILED |
| `NEVER_DELIVERS` | 2 | PENDING |
| `OUT_OF_ORDER` | 1 | FAILED |
| `CREATE_500` | 1 | FAILED |
| `UNKNOWN_REFERENCE` | 1 | PENDING |

65% success, which is the 70% the band widths were chosen for. Every band that
came up reached the status its scenario calls for, with no hand-picked amounts
involved. The three that did not appear - `REJECTED_AT_CREATE`,
`DUPLICATE_CALLBACK`, `CREATE_TIMEOUT` - are three or four digits wide out of a
hundred, so thirty-seven draws missing them is unremarkable; all three were
exercised by hand above.

One effect worth predicting before it surprises someone: a cron tick that draws
a `CREATE_TIMEOUT` amount holds its own HTTP request for the full twenty
seconds, and `waitForCompletion` means that tick does not overlap the next. So
roughly one tick in fifty runs long and the rate dips for half a minute. That
is the scenario being honest about what a hung provider costs a single-threaded
generator, not a fault in the cron.

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
# Zero, not 3. There is no payout cron yet - see the Step 7 row above - and
# raising this before one exists does nothing.
UAT_DISBURSEMENT_PER_MINUTE=0
UAT_AMOUNT_MIN=10000
UAT_AMOUNT_MAX=500000

# The scenario switchboard. False delivers only the SUCCESS band, which is
# Step 6. Anything but the literal "true" is false, so a typo holds at Step 6
# rather than releasing ten scenarios at once. Step 9 flipped it, and the
# file now carries `true`; set it back to false to get a quiet table again.
UAT_SWITCHBOARD_ENABLED=true

# The empty-array probe for the Jatelindo fake, which is Step 8d. True makes
# an accepted single transfer answer A01 with an empty DisbursementResponse.
# Point it at one request; it is not a mood the provider is ever in.
UAT_JATELINDO_EMPTY_DISBURSEMENT=false
```

**Every key above is live as of Step 8** and read by `UatConfig`, except
`UAT_DISBURSEMENT_PER_MINUTE`, which exists on the class and has no injector
yet - it is waiting for the payout cron. `UAT_AMOUNT_MIN` / `UAT_AMOUNT_MAX`
feed the purchase cron's random amount, which keeps the last two digits inside
the `SUCCESS` band while the switchboard is off; flipping the switchboard opens
them to the full range.

Both `.env.test` files need the app **restarted** after an edit:
`nest start --watch` watches sources, not env files. Touching the app's
`main.ts` after writing the env is enough, and in that order - the other way
round picks up the code and leaves the old value in place, which reads as the
flag not working.

> **Restarting `uat-local` orphans every callback in flight.** `ProviderStore`
> is a `Map` in the process, by design - *"the store dies with the process,
> which is honest"* - so a restart loses every row whose callback has not been
> delivered, and those transactions stay `PENDING` for ever. Nothing sweeps
> them up; that is Step 9's `NEVER_DELIVERS` lesson arriving by accident.
> Measured: twelve of the Step 7 cron's purchases were orphaned this way during
> Step 8's five restarts, all of them in the `SUCCESS` band. Harmless, but if
> you want a clean table afterwards, set `UAT_PURCHASE_PER_MINUTE=0` before a
> run of env edits rather than after.

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
| 8 | a second provider routes, and **two** real latent bugs | Jatelindo's actual behaviour |
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
