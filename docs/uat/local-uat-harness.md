# The Local UAT Harness

No background assumed. This is the "how do I watch my own system work"
document for `apps/uat-local` — what it is, why it is shaped the way it is, and
how to build the fake upstream provider that makes it useful.

The goal it serves is a specific one, and worth stating before any design:

> **Start the whole system on one machine, let it run unattended, and watch a
> purchase and a payout go all the way through — with no real provider, no real
> money, and no manual clicking.**

Everything below follows from that sentence. In particular, "all the way
through" is the constraint that decides the design, because the interesting
half of both flows is *asynchronous*: the provider answers later, by callback,
and almost every way this system can be wrong lives in that second half.

---

## 1. Why the obvious approach does not work

The natural first instinct is to swap the upstream client out by dependency
injection: define an interface, bind it to a token, and return a mock when
`NODE_ENV=test`.

```ts
/// apps/transaction/src/upstream/jatelindo/jatelindo.module.ts — DON'T
{
  provide: JATELINDO_KEY_TRANSFER,
  useFactory: (appConfig: AppConfig, /* … */) =>
    appConfig.IS_TEST
      ? new JatelindoTransferMock(disbursementWebhookService)
      : new JatelindoTransferService(authService, requestAuth),
}
```

This runs into a wall immediately, and it is a structural wall rather than a
Nest quirk. The mock has to do two jobs that point in **opposite directions**:

| Job | Direction | What it needs |
|---|---|---|
| Fake **client** — replace the outbound call | `api-v1 → upstream` | nothing; it *is* the upstream |
| Fake **provider** — originate the inbound callback | `callback → api-v1` | `DisbursementWebhookService`, which lives in `api-v1` |

So the mock, living in `upstream/`, must import from `api-v1/`. But `api-v1/`
already imports `upstream/` — the purchase and disbursement services call the
upstream clients. The two modules now import each other, and Nest cannot
resolve either. `forwardRef` on both sides silences the error without fixing
the cycle.

**This is already written down in the codebase.** The doc block on
[callback.module.ts](../../apps/transaction/src/callback/callback.module.ts:8)
describes exactly this trap, and the whole reason `src/callback/` exists as a
third module is to avoid it:

> A provider callback needs two things: the adapter that understands that
> provider's wire format, and the business service that knows what a payment
> means. Putting the route in `MotionPayModule` makes `upstream/` depend on
> `api-v1/` — and `api-v1/` already depends on `upstream/` […] `forwardRef`
> would silence that without fixing it.

The mock reintroduces the cycle that module was created to break.

### The deeper reason

The cycle is a symptom. The real problem is that **a DI mock models the
provider as a part of our process, and a provider is not one.** Jatelindo has
no dependency edge into `apps/transaction` at all — it is on the far side of a
socket. It learns about a payout from an HTTP request and reports the outcome
with an HTTP request of its own. It has never heard of
`DisbursementWebhookService`.

Anything that respects that shape cannot have a cycle, because there is no edge
to make one from.

---

## 2. The design: `uat-local` is the outside world

Put the fake provider **outside `apps/transaction`**, in `apps/uat-local`, and
let it talk over HTTP like the real one.

That gives `uat-local` a single coherent job, which is what makes it stop being
confusing: **it is everything that is not us.** Two roles, both external, each
in its own module:

```
apps/uat-local/src/
├─ app/                      # existing — health, config, bootstrap
├─ database/                 # existing — read the DBs to assert on them
├─ merchant/                 # "a customer of ours"  → calls transaction's merchant API
│  ├─ merchant.module.ts
│  ├─ purchase.cron.ts
│  └─ disbursement.cron.ts
└─ provider/                 # "Jatelindo and MotionPay" → serve their API, send callbacks
   ├─ provider.module.ts
   ├─ provider.store.ts
   ├─ scenario.ts
   ├─ callback.dispatcher.ts
   ├─ jatelindo/
   │  ├─ jatelindo.fake.controller.ts
   │  └─ jatelindo.payload.ts
   └─ motionpay/
      ├─ motionpay.fake.controller.ts
      └─ motionpay.payload.ts
```

The traffic then forms a loop with no cycle in it, because every edge is a
network call rather than an import:

```
  uat-local/merchant  ──POST /v1/transfer/bank──────────▶  transaction:3003
                                                                  │
                                            POST /Host/Transfer/… │
                                                                  ▼
  uat-local/provider  ◀───────────────────────────────────  (real client code,
          │                                                  real signing)
          │  @Cron, seconds later
          └──POST /callback/jatelindo/transfer──────────▶  transaction:3003
                                                                  │
                                                                  ▼
                                                     DisbursementWebhookService
                                                        balance, settlement
```

---

## 3. What `apps/transaction` has to change: nothing

This is the part worth pausing on, because it is where almost all the work
disappears.

Every upstream client already resolves its host from configuration and appends
a path constant — `baseURL: this.jatelindoConfig.TRANSFER_BASE_URL` at
[jatelindo-transfer.auth.service.ts:163](../../apps/transaction/src/upstream/jatelindo/transfer/jatelindo-transfer.auth.service.ts:163),
`baseURL: this.motionPayConfig.QRIS_BASE_URL` at
[motionpay-qris.auth.service.ts:83](../../apps/transaction/src/upstream/motionpay/qris/motionpay-qris.auth.service.ts:83).
Both are read with `getOrThrow`, and `.env.test` already carries its own copy
of every key.

So the entire integration is a few lines in `apps/transaction/.env.test`:

```ini
JATELINDO_TRANSFER_BASE_URL="http://localhost:3010/jatelindo"
MOTIONPAY_QRIS_BASE_URL="http://localhost:3010/motionpay"

# Now worth setting, because the fake provider really does come from here.
# Both addresses, comma-separated: `isIpAllowed` matches by exact family, and
# a callback over IPv6 loopback presents `request.ip` as `::1`.
JATELINDO_CALLBACK_ALLOWED_IPS="127.0.0.1,::1"
MOTIONPAY_CALLBACK_ALLOWED_IPS="127.0.0.1,::1"
```

No interface, no DI token, no `useFactory`, no `IS_TEST` branch anywhere in the
transaction app.

### Why that matters beyond tidiness

**1. No test path in production code.** `if (appConfig.IS_TEST) return new
JatelindoTransferMock(…)` means the deployed binary contains a route from a
real merchant's payout request to a fake. One mis-set `NODE_ENV` and the system
acknowledges disbursements that never happened. Keeping the mock in a different
application removes that possibility instead of guarding against it.

**2. You test what you ship.** A DI mock replaces `createTransfer`, so it skips
token minting, request signing, TypeBox response validation, the response-code
mapping, `UpstreamTransferException` and its `outcomeUnknown` flag, the callback
controller, the IP allowlist, and `ProviderPrincipalInterceptor`. All of that is
code written by hand, and none of it runs. Pointing the real client at a fake
host exercises every line of it.

**3. The failure modes become reachable.** This is the big one, and §5 is about
it.

> **The one real cost:** the fake provider has to speak the wire format, which
> is more work upfront than returning an `UpstreamTransferResponseDto`. Two
> things make it cheap. The auth routes can accept anything — return a
> token-shaped envelope and check nothing; the client still *runs* its signing
> code, nobody verifies it. And the payload shapes are small, documented in
> [docs/upstream/jatelindo.md](../upstream/jatelindo.md) and
> [docs/upstream/motionpay.md](../upstream/motionpay.md), and reproduced in §6.

> **Hand-write the payloads in `uat-local`; do not import the schemas from
> `apps/transaction`.** It looks like duplication and that is the point: a fake
> provider that shares our parser cannot catch a wrong parser. If both sides
> agree on the same mistake, the test passes and the mistake ships.
> Independence is the feature.

---

## 4. The scenario switchboard

A harness that behaves randomly is hard to watch, because nothing you see can
be reproduced. One that always succeeds is worse, because the happy path is the
one case already known to work.

The trick that resolves both: **let the amount select the behaviour.** The fake
merchant still randomises amounts, so the run is varied — but the last two
digits of the amount say what the provider will do, so every outcome is
readable off the log line that caused it, and any case can be reproduced on
demand by sending that amount.

```ts
/// apps/uat-local/src/provider/scenario.ts
///
/// `as const` object plus a derived union rather than a TS `enum`: the values
/// cross a network boundary and get compared as strings.
export const SCENARIO = {
  SUCCESS: 'SUCCESS',
  FAILED_BY_CALLBACK: 'FAILED_BY_CALLBACK',
  REJECTED_AT_CREATE: 'REJECTED_AT_CREATE',
  EXPIRED: 'EXPIRED',
  DUPLICATE_CALLBACK: 'DUPLICATE_CALLBACK',
  OUT_OF_ORDER: 'OUT_OF_ORDER',
  NEVER_DELIVERS: 'NEVER_DELIVERS',
  UNKNOWN_REFERENCE: 'UNKNOWN_REFERENCE',
  CREATE_500: 'CREATE_500',
  CREATE_TIMEOUT: 'CREATE_TIMEOUT',
} as const;
export type Scenario = (typeof SCENARIO)[keyof typeof SCENARIO];

/// Cumulative upper bounds on `amount % 100`, so the happy path stays the
/// common case and the interesting ones still turn up often enough to watch.
const BANDS: readonly { readonly upTo: number; readonly scenario: Scenario }[] =
  [
    { upTo: 69, scenario: SCENARIO.SUCCESS },
    { upTo: 74, scenario: SCENARIO.FAILED_BY_CALLBACK },
    { upTo: 77, scenario: SCENARIO.REJECTED_AT_CREATE },
    { upTo: 81, scenario: SCENARIO.EXPIRED },
    { upTo: 85, scenario: SCENARIO.DUPLICATE_CALLBACK },
    { upTo: 89, scenario: SCENARIO.OUT_OF_ORDER },
    { upTo: 92, scenario: SCENARIO.NEVER_DELIVERS },
    { upTo: 95, scenario: SCENARIO.UNKNOWN_REFERENCE },
    { upTo: 97, scenario: SCENARIO.CREATE_500 },
    { upTo: 99, scenario: SCENARIO.CREATE_TIMEOUT },
  ];

export function scenarioFor(amount: number): Scenario {
  const key = Math.trunc(Math.abs(amount)) % 100;
  return BANDS.find((band) => key <= band.upTo)?.scenario ?? SCENARIO.SUCCESS;
}
```

So `Rp 50.072` fails by callback, `Rp 50.084` delivers its callback twice, and
`Rp 50.091` never reports at all. Send `…99` by hand and you get a timeout
every time.

---

## 5. What this tests that a DI mock cannot

The scenarios are not decoration. Each one is something that happens in
production and currently has no test anywhere.

| Scenario | What the fake does | What is actually being tested |
|---|---|---|
| `SUCCESS` | callback with `A00` / `Payment Received` | the happy path, balance entries, settlement eligibility |
| `FAILED_BY_CALLBACK` | callback with `T40` | does a late failure release the reservation? |
| `REJECTED_AT_CREATE` | `T40` on the create call | `UpstreamTransferException` with `outcomeUnknown: false`, row marked FAILED |
| `EXPIRED` | `FAILED` + `Order expired` + past `expired_date`, no `paid_date` | `isExpiry` in `motionpay.helper.ts`, and that EXPIRED ≠ FAILED downstream |
| `DUPLICATE_CALLBACK` | sends the same SUCCESS twice | **idempotency.** The most likely real bug in this system |
| `OUT_OF_ORDER` | FAILED, then SUCCESS for the same reference | does a terminal state stay terminal? |
| `NEVER_DELIVERS` | accepts, then goes silent forever | the stuck-PENDING case reconciliation is meant to catch |
| `UNKNOWN_REFERENCE` | callback for a `traceNumber` we never issued | 200 with no write, no crash, and a log that says why |
| `CREATE_500` | HTTP 500 from the create call | transport-failure handling |
| `CREATE_TIMEOUT` | sleeps past `JATELINDO_TIMEOUT_MS`, then answers | `outcomeUnknown: true` — the row must **stay PENDING**, never FAILED |

Two of these deserve to be called out.

**`DUPLICATE_CALLBACK` is the one to build first.** Every real provider resends
callbacks — on their own retry timer, after a network blip, sometimes for no
visible reason. A DI mock that calls `handle()` once can never produce it. If
handling the same SUCCESS twice writes two balance entries, a merchant's
balance is wrong by the amount of the transaction, and nothing in the system
currently proves it does not.

**`CREATE_TIMEOUT` tests a deliberate design decision.** The comment at
[jatelindo-transfer.service.ts:110](../../apps/transaction/src/upstream/jatelindo/transfer/jatelindo-transfer.service.ts:110)
says it plainly — *"if the call never got an answer, the money may already have
left"* — so the row must stay PENDING rather than FAILED, because a merchant
told their payout failed will retry and pay the recipient twice. That is a
one-line rule standing between us and a double payment, and the only honest way
to check it is to actually hang the connection.

> **One thing the harness will find on day one.** The real client reads
> `payment.DisbursementResponse[0].transactionNumber` at
> [jatelindo-transfer.service.ts:149](../../apps/transaction/src/upstream/jatelindo/transfer/jatelindo-transfer.service.ts:149)
> without checking the array is non-empty. The TypeBox schema permits `[]`, so
> a provider answering `A01` with an empty `DisbursementResponse` throws a
> `TypeError` deep inside the client instead of a handled upstream error. Point
> a fake at it that returns `[]` and you see it immediately. That is the kind of
> finding this harness exists for.

---

## 6. The provider module, sketched

Code to type against, not code to paste. The shapes come from the real schemas;
the behaviour is deliberately simple. Imports are spelled out in the first
snippet and elided in the later ones.

### 6.1 The store

One map, and a **queue of outcomes still to deliver** per transaction. That
single idea covers duplicate, out-of-order and never-delivers without a branch
for each: they are just different queues.

```ts
/// apps/uat-local/src/provider/provider.store.ts
import { Injectable } from '@nestjs/common';
import { SCENARIO, Scenario } from './scenario';

export const RAIL = {
  PURCHASE: 'PURCHASE',
  DISBURSEMENT: 'DISBURSEMENT',
} as const;
export type Rail = (typeof RAIL)[keyof typeof RAIL];

export const PROVIDER = {
  JATELINDO: 'JATELINDO',
  MOTIONPAY: 'MOTIONPAY',
} as const;
export type Provider = (typeof PROVIDER)[keyof typeof PROVIDER];

/// Our own vocabulary, not the providers'. Each payload builder translates
/// this into its provider's wire codes — the same translation the real
/// callback services perform in the opposite direction.
export const OUTCOME = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];

export interface FakeTransaction {
  readonly provider: Provider;
  readonly rail: Rail;
  /** Our reference, as the provider received it: traceNumber / external_id. */
  readonly systemReference: string;
  /** Theirs, which we invent: jpaReferenceNo / transaction_id. */
  readonly providerReference: string;
  readonly amount: number;
  readonly scenario: Scenario;
  readonly createdAt: number;

  /// Mutable delivery state.
  /** Outcomes still to send, in order. Empty = nothing more will arrive. */
  pending: Outcome[];
  /** Epoch ms; the dispatcher ignores this row until then. */
  deliverAt: number;
  /** Failed POST attempts for the head of `pending`. */
  attempts: number;
}

/// How many callbacks each scenario produces, and in what order.
const DELIVERY_PLAN: Readonly<Record<Scenario, readonly Outcome[]>> = {
  [SCENARIO.SUCCESS]: [OUTCOME.SUCCESS],
  [SCENARIO.FAILED_BY_CALLBACK]: [OUTCOME.FAILED],
  [SCENARIO.EXPIRED]: [OUTCOME.EXPIRED],
  [SCENARIO.DUPLICATE_CALLBACK]: [OUTCOME.SUCCESS, OUTCOME.SUCCESS],
  [SCENARIO.OUT_OF_ORDER]: [OUTCOME.FAILED, OUTCOME.SUCCESS],
  [SCENARIO.UNKNOWN_REFERENCE]: [OUTCOME.SUCCESS],
  [SCENARIO.NEVER_DELIVERS]: [],
  /// Rejected or broken at create time: there is nothing to report later.
  [SCENARIO.REJECTED_AT_CREATE]: [],
  [SCENARIO.CREATE_500]: [],
  /// The dangerous one: the client gave up, but the transfer still succeeds.
  [SCENARIO.CREATE_TIMEOUT]: [OUTCOME.SUCCESS],
};

type NewTransaction = Omit<
  FakeTransaction,
  'pending' | 'deliverAt' | 'attempts' | 'createdAt'
>;

@Injectable()
export class ProviderStore {
  private readonly rows = new Map<string, FakeTransaction>();

  accept(input: NewTransaction): FakeTransaction {
    const row: FakeTransaction = {
      ...input,
      createdAt: Date.now(),
      pending: [...DELIVERY_PLAN[input.scenario]],
      deliverAt: Date.now() + randomDelayMs(),
      attempts: 0,
    };
    this.rows.set(row.providerReference, row);
    return row;
  }

  byProviderReference(reference: string): FakeTransaction | undefined {
    return this.rows.get(reference);
  }

  /** Rows with something to deliver whose delay has elapsed. */
  due(now = Date.now()): FakeTransaction[] {
    return [...this.rows.values()].filter(
      (row) => row.pending.length > 0 && row.deliverAt <= now,
    );
  }

  forget(reference: string): void {
    this.rows.delete(reference);
  }
}

/// 2-10s. Long enough that PENDING is visible in the dashboard, short enough
/// to watch a few hundred transactions over a lunch break.
function randomDelayMs(): number {
  return (2 + Math.floor(Math.random() * 9)) * 1_000;
}
```

> **In memory on purpose.** The store dies with the process, which is honest:
> a fresh `test-db-all` run wants a fresh provider too. If a restart ever needs
> to survive, give `uat-local` its own schema rather than borrowing one of
> ours — a fake provider writing into our tables stops being a fake provider.

### 6.2 The Jatelindo fake

The controller prefix plus the route must reproduce `JATELINDO_ENDPOINT`
exactly, because the real client builds those paths from
[jatelindo.constant.ts:3](../../apps/transaction/src/upstream/jatelindo/helper/jatelindo.constant.ts:3).
With `JATELINDO_TRANSFER_BASE_URL="http://localhost:3010/jatelindo"`, the five
routes below land where the client is looking.

```ts
/// apps/uat-local/src/provider/jatelindo/jatelindo.fake.controller.ts
import { Body, Controller, Logger, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PROVIDER, ProviderStore, RAIL } from '../provider.store';
import { SCENARIO, scenarioFor } from '../scenario';

/// Jatelindo's own codes, from the spec's response-code table. Repeated here
/// deliberately — see the note in §3 about not sharing the parser.
const CODE = {
  PROCESSED: 'A00',
  REQUESTED: 'A01',
  REJECTED: 'T40',
} as const;

const envelope = (responseCode: string, message: string) => ({
  responseCode,
  message,
  description: message,
});

@Controller('jatelindo/Host/Transfer')
export class JatelindoFakeController {
  private readonly logger = new Logger(JatelindoFakeController.name);

  constructor(private readonly store: ProviderStore) {}

  /// Accepts anything. The client still mints and signs — nobody checks.
  @Post('Session/Login')
  login() {
    return {
      LoginResponse: [{ token: `fake-${randomUUID()}` }],
      status: envelope(CODE.PROCESSED, 'Login success'),
    };
  }

  @Post('Account/BalanceInquiry')
  balanceInquiry() {
    return {
      BalanceInquiryResponse: [
        {
          accountBalance: '900000000.00',
          reservedAmount: '0.00',
          member: { name: 'UAT', username: 'uat' },
          account: { name: 'UAT Pool', id: '1' },
        },
      ],
      status: envelope(CODE.PROCESSED, 'Success'),
    };
  }

  /// Beneficiary-name validation lives here in the real provider, so this is
  /// where to simulate "account not found" when that path needs covering.
  @Post('Transaction/Inquiry')
  inquiry(@Body() body: { accountNo: string; name: string }) {
    return {
      inquiryInfo: {
        accountName: body.name || 'UAT BENEFICIARY',
        accountNo: body.accountNo,
        bankName: 'UAT BANK',
        customerAdmin: '0',
      },
      referenceID: `inq-${randomUUID()}`,
      status: envelope(CODE.PROCESSED, 'Success'),
    };
  }

  @Post('Transaction/SingleTransfer')
  async singleTransfer(
    @Body() body: { traceNumber: string; amount: string; accountNo: string },
  ) {
    const amount = Number(body.amount);
    const scenario = scenarioFor(amount);
    const providerReference = `JPA${Date.now()}${Math.floor(Math.random() * 1000)}`;

    this.logger.log({
      msg: 'Fake Jatelindo single transfer',
      traceNumber: body.traceNumber,
      amount,
      scenario,
    });

    /// Transport-level failures, before any envelope is built.
    if (scenario === SCENARIO.CREATE_500) {
      throw new Error('fake Jatelindo: upstream unavailable');
    }
    if (scenario === SCENARIO.CREATE_TIMEOUT) {
      /// Longer than JATELINDO_TIMEOUT_MS. The client must abandon the request
      /// and report outcomeUnknown — while this transfer still goes on to
      /// succeed by callback, which is exactly what makes it dangerous.
      await sleep(20_000);
    }

    /// `T40` maps to FAILED, so the client raises a verified rejection and the
    /// row is marked FAILED with `outcomeUnknown: false`.
    if (scenario === SCENARIO.REJECTED_AT_CREATE) {
      return {
        DisbursementResponse: [],
        traceNumber: body.traceNumber,
        jpaReferenceNo: providerReference,
        status: envelope(CODE.REJECTED, 'Transaction rejected'),
      };
    }

    const row = this.store.accept({
      provider: PROVIDER.JATELINDO,
      rail: RAIL.DISBURSEMENT,
      systemReference: body.traceNumber,
      providerReference,
      amount,
      scenario,
    });

    /// `A01 REQUESTED` — accepted, outcome to follow by callback. The normal
    /// answer, and it maps to PENDING.
    return {
      DisbursementResponse: [
        {
          transactionType: { name: 'SINGLE_TRANSFER' },
          traceNumber: row.systemReference,
          sourceAccount: { fromName: 'UAT Pool', fromUsername: 'uat' },
          transactionNumber: `TRX${row.providerReference}`,
          destinationAccount: {
            accountName: 'UAT BENEFICIARY',
            accountNo: body.accountNo,
            bankName: 'UAT BANK',
          },
        },
      ],
      traceNumber: row.systemReference,
      jpaReferenceNo: row.providerReference,
      status: envelope(CODE.REQUESTED, 'Transaction requested'),
    };
  }

  /// The authenticated status read. Stubbed on purpose — see the note below.
  @Post('Transaction/Status')
  transactionStatus(@Body() body: { traceNumber: string }) {
    return {
      traceNumber: body.traceNumber,
      jpaReferenceNo: '',
      TransactionStatusResponse: [],
      status: envelope(CODE.PROCESSED, 'Success'),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

> `Transaction/Status` is a stub because nothing calls it today —
> `confirmWithProvider` was removed in `503a602`. Filling it in now would mean
> writing a fake for a caller that does not exist. It needs a lookup by
> `traceNumber`, which means the store wants a second index; add both together
> when a confirmation step comes back.

### 6.3 The MotionPay fake

Same pattern, different envelope. Note the asymmetry the real code documents at
[motionpay.constant.ts:140](../../apps/transaction/src/upstream/motionpay/helper/motionpay.constant.ts:140):
the token endpoint signals success with `code: 200`, the payment endpoints with
`code: 0`. Getting that backwards is the first thing to check if the client
rejects the fake's response.

```ts
/// apps/uat-local/src/provider/motionpay/motionpay.fake.controller.ts
@Controller('motionpay')
export class MotionPayFakeController {
  private readonly logger = new Logger(MotionPayFakeController.name);

  constructor(private readonly store: ProviderStore) {}

  @Post('priv/v1/pg/token')
  token() {
    return {
      status: { code: 200, message: 'Success' },
      data: { token: `fake-${randomUUID()}` },
    };
  }

  @Post('payment/api/v1/qris/payment')
  createQris(
    @Body() body: { external_id: string; amount: number; session_time: number },
  ) {
    const scenario = scenarioFor(body.amount);

    this.logger.log({
      msg: 'Fake MotionPay create QRIS',
      externalId: body.external_id,
      amount: body.amount,
      scenario,
    });

    if (scenario === SCENARIO.CREATE_500) {
      throw new Error('fake MotionPay: upstream unavailable');
    }
    if (scenario === SCENARIO.REJECTED_AT_CREATE) {
      return { status: { code: 422, message: 'Unprocessable' }, data: null };
    }

    const row = this.store.accept({
      provider: PROVIDER.MOTIONPAY,
      rail: RAIL.PURCHASE,
      systemReference: body.external_id,
      providerReference: `FM-${Date.now()}`,
      amount: body.amount,
      scenario,
    });

    return {
      status: { code: 0, message: 'Success' },
      data: {
        transaction_id: row.providerReference,
        external_id: row.systemReference,
        amount: row.amount,
        /// Not a valid QR, and it does not need to be — nothing in the system
        /// parses it. Make it obviously fake so it is never mistaken for one.
        qr_string: `00020101021226FAKEUAT${row.providerReference}`,
        type: 'QRIS_DYNAMIC',
        status: 'PENDING',
        session_time: body.session_time,
        created_date: wib(new Date()),
      },
    };
  }

  @Get('payment/api/v1/qris/payment-status/:transactionId')
  status(@Param('transactionId') transactionId: string) {
    const row = this.store.byProviderReference(transactionId);
    if (!row) {
      return { status: { code: 404, message: 'Not found' }, data: null };
    }

    return {
      status: { code: 0, message: 'Success' },
      data: {
        transaction_id: row.providerReference,
        external_id: row.systemReference,
        amount: row.amount,
        status: row.pending.length === 0 ? 'SUCCESS' : 'PENDING',
      },
    };
  }
}
```

### 6.4 The callback dispatcher

One cron for both providers. It is the piece that makes the harness
asynchronous, and where the delivery protocol gets honoured.

```ts
/// apps/uat-local/src/provider/callback.dispatcher.ts
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { FakeTransaction, Outcome, PROVIDER, ProviderStore } from './provider.store';
import { SCENARIO } from './scenario';
import { jatelindoTransferCallback } from './jatelindo/jatelindo.payload';
import { motionPayQrisCallback } from './motionpay/motionpay.payload';

/// Mirrors what the providers document: three attempts, then the callback is
/// dropped permanently. Their interval is five minutes; seconds here, because
/// the point is to watch it happen.
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 15_000;
/// A resend is not instant, but it should not need a coffee break either.
const RESEND_AFTER_MS = 5_000;

@Injectable()
export class CallbackDispatcher {
  private readonly logger = new Logger(CallbackDispatcher.name);

  constructor(
    private readonly http: HttpService,
    private readonly store: ProviderStore,
    private readonly config: UatConfig,
  ) {}

  /// Ten seconds, not a minute: a minute is too slow to sit and watch, and
  /// `waitForCompletion` stops a slow pass overlapping the next one.
  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'uat-provider-callbacks',
    waitForCompletion: true,
  })
  async dispatch(): Promise<void> {
    /// Sequential on purpose. Out-of-order delivery is a scenario to trigger
    /// deliberately, not an accident of `Promise.all` scheduling.
    for (const row of this.store.due()) {
      await this.deliver(row);
    }
  }

  private async deliver(row: FakeTransaction): Promise<void> {
    const outcome = row.pending[0];
    const { url, body } = this.envelope(row, outcome);

    try {
      const response = await firstValueFrom(
        this.http.post(url, body, {
          baseURL: this.config.TRANSACTION_BASE_URL,
          timeout: 10_000,
          /// Read the status ourselves rather than letting axios throw: a 500
          /// here is a protocol message, not an error.
          validateStatus: () => true,
        }),
      );

      /// 500 means "transient on our side, please retry" — the one case where
      /// a real provider sends the same callback again.
      if (response.status >= 500) {
        row.attempts += 1;
        if (row.attempts >= MAX_ATTEMPTS) {
          this.logger.warn({
            msg: 'Giving up on callback after max attempts',
            providerReference: row.providerReference,
            attempts: row.attempts,
          });
          row.pending.shift();
          return;
        }
        row.deliverAt = Date.now() + RETRY_AFTER_MS;
        return;
      }

      /// Anything else is an acknowledgement. Move to the next outcome, if the
      /// scenario has one.
      this.logger.log({
        msg: 'Callback delivered',
        provider: row.provider,
        scenario: row.scenario,
        systemReference: row.systemReference,
        outcome,
        httpStatus: response.status,
      });

      row.pending.shift();
      row.attempts = 0;

      if (row.pending.length > 0) {
        row.deliverAt = Date.now() + RESEND_AFTER_MS;
      } else {
        this.store.forget(row.providerReference);
      }
    } catch (error) {
      row.attempts += 1;
      row.deliverAt = Date.now() + RETRY_AFTER_MS;
      this.logger.error({
        msg: 'Callback POST failed',
        providerReference: row.providerReference,
        attempts: row.attempts,
        error,
      });
    }
  }

  private envelope(row: FakeTransaction, outcome: Outcome) {
    /// The one scenario that lies about identity: a callback for a reference
    /// we never issued. Everything else about it is well-formed, so what is
    /// under test is the lookup miss, not the parser.
    const reference =
      row.scenario === SCENARIO.UNKNOWN_REFERENCE
        ? `GHOST-${randomUUID()}`
        : row.providerReference;

    if (row.provider === PROVIDER.JATELINDO) {
      return {
        url: '/callback/jatelindo/transfer',
        body: jatelindoTransferCallback(row, outcome, reference),
      };
    }

    return {
      url: '/callback/motionpay/qris',
      body: motionPayQrisCallback(row, outcome, reference),
    };
  }
}
```

### 6.5 The payload builders

Small, boring, and the only place that knows a provider's vocabulary.

```ts
/// apps/uat-local/src/provider/jatelindo/jatelindo.payload.ts
export function jatelindoTransferCallback(
  row: FakeTransaction,
  outcome: Outcome,
  providerReference: string,
) {
  /// A00 → SUCCESS, T40 → FAILED, per the spec's response-code table.
  /// Jatelindo has no expiry concept for a payout, so EXPIRED cannot arise on
  /// this rail and anything non-SUCCESS is a rejection.
  const responseCode = outcome === OUTCOME.SUCCESS ? 'A00' : 'T40';

  return {
    DisbursementResponse: [
      {
        transactionType: { name: 'SINGLE_TRANSFER' },
        traceNumber: row.systemReference,
        sourceAccount: { fromName: 'UAT Pool', fromUsername: 'uat' },
        transactionNumber: `TRX${row.providerReference}`,
        destinationAccount: {
          accountName: 'UAT BENEFICIARY',
          accountNo: '1234567890',
          bankName: 'UAT BANK',
        },
      },
    ],
    traceNumber: row.systemReference,
    jpaReferenceNo: providerReference,
    status: {
      responseCode,
      message:
        outcome === OUTCOME.SUCCESS
          ? 'Transaction processed'
          : 'Transaction failed',
      /// Carries the scenario name into the transaction logs, so a surprising
      /// row can be traced back to what produced it.
      description: `UAT ${row.scenario}`,
    },
  };
}
```

```ts
/// apps/uat-local/src/provider/motionpay/motionpay.payload.ts
///
/// MotionPay timestamps are Jakarta wall-clock whatever offset they print, so
/// emit plain `YYYY-MM-DD HH:mm:ss` in WIB and let the real parser read it.
/// See parseMotionPayTimestamp in motionpay.helper.ts.
export function motionPayQrisCallback(
  row: FakeTransaction,
  outcome: Outcome,
  providerReference: string,
) {
  const now = new Date();

  /// The provider has no EXPIRED status. An expiry is a FAILED whose
  /// description says so, with the expiry passed and nothing paid — `isExpiry`
  /// requires all three, so a fake that sets only one proves nothing.
  if (outcome === OUTCOME.EXPIRED) {
    return {
      transaction_id: providerReference,
      external_id: row.systemReference,
      amount: row.amount,
      status: 'FAILED',
      description: 'Order expired',
      expired_date: wib(new Date(now.getTime() - 60_000)),
      created_at: wib(new Date(row.createdAt)),
    };
  }

  const success = outcome === OUTCOME.SUCCESS;

  return {
    transaction_id: providerReference,
    external_id: row.systemReference,
    amount: row.amount,
    qris_type: 'QRIS_DYNAMIC',
    status: success ? 'SUCCESS' : 'FAILED',
    description: success ? 'Payment Received' : `UAT ${row.scenario}`,
    created_at: wib(new Date(row.createdAt)),
    updated_at: wib(now),
    /// Omitted rather than nulled when nothing was paid. `paid_date` is read
    /// straight into `paidAt`, and a payment time on an unpaid transaction is
    /// what makes a balance wrong.
    ...(success ? { paid_date: wib(now) } : {}),
    rrn: `UAT${Date.now()}`,
    acquirer_name: 'UAT ACQUIRER',
  };
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1_000;

export function wib(date: Date): string {
  return new Date(date.getTime() + WIB_OFFSET_MS)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}
```

### 6.6 The module

A leaf. It imports `HttpModule` and nothing of ours — which is the whole point
of the design, and the test that it has been followed.

```ts
/// apps/uat-local/src/provider/provider.module.ts
@Module({
  imports: [HttpModule],
  controllers: [JatelindoFakeController, MotionPayFakeController],
  providers: [ProviderStore, CallbackDispatcher],
})
export class ProviderModule {}
```

If anything in `provider/` ever needs an import from `apps/transaction`, that
is the signal the fake has stopped being a fake.

---

## 7. Wiring it up

> The ordered version of this, with a verification step after each change,
> is [local-uat-build-order.md](local-uat-build-order.md). Where the two
> disagree, the build order is newer — in particular, the merchant
> credentials in items 2 and 7 below are better read from
> `auth.MerchantSignature` than copied into `.env.test`.

1. **A config class for the harness.** Follow the `libs/configuration` pattern —
   a small `UatConfig` with `getOrThrow` getters for `TRANSACTION_BASE_URL`,
   `DASHBOARD_BASE_URL` and the merchant credentials. The dispatcher takes it
   by constructor injection like every other config consumer.

2. **`apps/uat-local/.env.test`** — where to send callbacks, and how hard the
   fake merchant should push:

   ```ini
   TRANSACTION_BASE_URL=http://localhost:3003
   DASHBOARD_BASE_URL=http://localhost:3000

   # Fake merchant credentials, written by the Jest onboarding run.
   UAT_MERCHANT_CLIENT_ID=
   UAT_MERCHANT_SECRET=

   UAT_PURCHASE_PER_MINUTE=6
   UAT_DISBURSEMENT_PER_MINUTE=3
   UAT_AMOUNT_MIN=10000
   UAT_AMOUNT_MAX=500000
   ```

3. **`apps/transaction/.env.test`** — the two base URLs and the two allowlists
   from §3.

4. **`apps/uat-local/src/app/app.module.ts`** — add `ProviderModule` and
   `MerchantModule`. `ScheduleModule.forRoot()` is already registered.

5. **`scripts/test-start-all.js`** — `uat-local` is missing from the app list:

   ```js
   const apps = ['auth', 'config', 'transaction', 'settlement', 'uat-local'];
   ```

   Start it **last**. The fake provider must be listening before transaction
   makes its first call, transaction must be listening before the merchant cron
   fires, and the merchant cron needs credentials that do not exist until
   onboarding has run.

6. **`scripts/test-db-all.js`** — already correct. Its three apps are the
   three that own migrations; `apps/settlement` has no `prisma/` directory and
   the dashboard reads the other three's schemas rather than owning one.

7. **Onboarding, by hand, once per reset.** The Jest run against the dashboard
   API creates the merchant, its API key and its settlement policy, then writes
   `UAT_MERCHANT_CLIENT_ID` / `UAT_MERCHANT_SECRET` into
   `apps/uat-local/.env.test`. Keeping this out of the cron loop is right —
   onboarding is a one-off with real decisions in it, and a cron that silently
   re-onboards hides the failure when it stops working.

### The merchant side, briefly

`merchant/` is the easier half: two crons signing requests with the merchant
HMAC and calling the real merchant API —
`POST /v1/qr/qr-mpm-generate` for a purchase, `POST /v1/transfer/bank` and
`POST /v1/transfer/ewallet` for a payout. It needs the same signing the
merchant documentation describes in
[docs/merchant/merchant-signature.md](../merchant/merchant-signature.md), which
means it also exercises `MerchantEndpoint` and the signature guard — a second
surface a DI mock never touches.

The amount is random within `UAT_AMOUNT_MIN`…`UAT_AMOUNT_MAX`, which is what
feeds the switchboard in §4.

### Reading the logs

Every fake-provider line carries `scenario`, so a tail of the `uat-local`
window says what is being exercised, and the matching transaction window says
how it was handled. The two amounts to keep in your head: `…99` times out,
`…84` delivers twice.

---

## 8. What this still does not test

Worth being explicit, so the harness is not trusted for more than it proves.

- **The real providers' actual behaviour.** The fake implements the spec as we
  read it. Where our reading is wrong, the fake is wrong in the same direction
  and the error is invisible. Sandbox runs against the real upstreams stay
  necessary; this replaces the tedium, not the verification.
- **Signature and token verification.** The auth routes accept anything, so a
  signing bug a real provider would reject passes here. Tightening the fake to
  verify with the test keys is the one extension worth doing early.
- **The 500-retry protocol, for now.** The dispatcher honours it, but nothing
  on the receiving side can currently ask for a retry: `503a602` removed
  `confirmWithProvider`, which deleted the only path returning `retry: true`,
  so `askRetry` is dead in both webhook services and the `500` branch in all
  four callback controllers is unreachable. The harness is ready for it — when
  a confirmation step returns, `CREATE_TIMEOUT` plus a flaky
  `Transaction/Status` are the two cases that prove it works.
- **Concurrency and multi-pod behaviour.** One fake provider, one process. The
  `FOR UPDATE SKIP LOCKED` claims in settlement exist for two pods racing,
  which this cannot produce.
- **Anything about money being real.** Nothing here proves a bank would move
  funds. It proves our own accounting stays consistent with what a provider
  told us — which is the half we are responsible for.
