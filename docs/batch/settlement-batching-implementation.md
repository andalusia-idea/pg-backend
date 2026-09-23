# Settlement Batching — Implementation Guide

Companion to [settlement-batching.md](settlement-batching.md), which covers
*why*. This one is the build order.

Written 22 Sep 2026 against the monorepo's actual state: `apps/transaction/src/api-v1/`
has `purchase`, `disbursement`, `ping` and `signature` (no withdraw or topup —
those are dashboard-side and stubbed), both webhook services carry a
`TODO(balance-ledger)`, and no balance row is written anywhere in the monorepo
today.

Steps are ordered so each is independently verifiable and nothing is left
half-wired between them. **Steps 1–6 need no new app** — they land in
`apps/transaction` and `libs/`, and they are the ones that fix money bugs. The
new `apps/settlement` does not appear until Step 7, when there is actually
something for it to run.

> **Three corrections to the design doc, found while planning the build.** Each
> is explained where it comes up: there are **no advisory locks** (Step 2), there
> is **no `CHECK (amount >= 0)`** (Step 2), and `sourceType` is **its own enum**
> rather than `TransactionTypeEnum` (Step 1).

---

## Step 0 — Lock these decisions first

Cheap now, expensive once there are balance rows.

| Decision | Recommended | Notes |
|---|---|---|
| Money type | **`Decimal(18,2)`** | Never `BIGINT` minor units. Transaction tables stay `(15,2)`; only balance tables widen |
| Buckets | **`PENDING` / `AVAILABLE` / `RESERVED`** | Separate rows, never columns |
| Holder types | **`MERCHANT` / `AGENT` / `INTERNAL`** | All three get a running balance |
| Internal holder id | **`0`**, as a named constant | One house total. If per-provider profit is ever wanted, that is a sum over `*FeeDetail`, not a second holder |
| Where balance lives | **`transaction` schema** | Written by both transaction and settlement apps, through one shared lib |
| Where runs/batches live | **`settlement` schema** | Owned solely by `apps/settlement` |
| Concurrency control | **Atomic `increment` + sorted row updates.** No advisory locks | See Step 2 — the locks in legacy existed for a pattern we are not using |
| Overdraw control | **Conditional `UPDATE … WHERE amount >= x`**, not a `CHECK` constraint | See Step 2 |
| Batch size cap | **500 transactions per batch** | A run creates more batches if more remain. Keeps one transaction bounded |
| Entry id type | **`BigInt`** | `JSON.stringify` throws on `BigInt` — never expose it raw in a DTO |

---

## Step 1 — Schema

`apps/transaction/prisma/schema.prisma`. Purely additive — nothing is dropped
until Step 15.

### Enums

```prisma
enum BalanceHolderTypeEnum {
  MERCHANT
  AGENT
  INTERNAL

  @@schema("transaction")
}

enum BalanceBucketEnum {
  PENDING    /// Payment succeeded; not settled to the holder yet
  AVAILABLE  /// Spendable now
  RESERVED   /// Committed to a payout that is in flight

  @@schema("transaction")
}

enum BalanceDirectionEnum {
  CREDIT
  DEBIT

  @@schema("transaction")
}

enum BalanceReasonEnum {
  PAYIN_CAPTURED
  MERCHANT_SETTLED
  PAYOUT_RESERVED
  PAYOUT_COMPLETED
  PAYOUT_FAILED
  TOPUP_APPROVED
  PAYIN_REVERSED
  MANUAL_ADJUSTMENT
  OPENING_BALANCE

  @@schema("transaction")
}

/// Deliberately NOT `TransactionTypeEnum`.
///
/// Two reasons. `TransactionTypeEnum.SETTLEMENT_PURCHASE` is being deleted
/// (Step 15), so reusing it would tie the balance tables to a value with no
/// future. And the idempotency key below needs `ADJUSTMENT` and `OPENING` as
/// distinct sources - without them, two manual adjustments against the same
/// purchase would collide on the unique constraint and the second would fail.
enum BalanceSourceTypeEnum {
  PURCHASE
  DISBURSEMENT
  WITHDRAW
  TOPUP
  ADJUSTMENT
  OPENING

  @@schema("transaction")
}
```

### Tables

```prisma
model BalanceEntry {
  id BigInt @id @default(autoincrement())

  holderType BalanceHolderTypeEnum
  holderId   Int
  bucket     BalanceBucketEnum

  direction BalanceDirectionEnum
  amount    Decimal @db.Decimal(18, 2) /// ALWAYS positive

  reason     BalanceReasonEnum
  sourceType BalanceSourceTypeEnum
  sourceId   Int
  batchId    Int?

  createdAt DateTime @default(now()) @db.Timestamptz(6)
  createdBy Int      @db.Integer() /// NOT NULL - see "Attribution" below

  /// Idempotency. A replayed webhook, a re-run batch or a double-clicked
  /// admin button fails the insert instead of double-crediting.
  ///
  /// `bucket` is in the key because one movement writes two rows - a
  /// MERCHANT_SETTLED debits PENDING and credits AVAILABLE for the same
  /// source. Without it those two would collide with each other.
  @@unique([holderType, holderId, bucket, reason, sourceType, sourceId])
  @@index([holderType, holderId, bucket, id])
  @@index([batchId])
  @@schema("transaction")
}

model BalanceSnapshot {
  holderType BalanceHolderTypeEnum
  holderId   Int
  bucket     BalanceBucketEnum

  amount Decimal @db.Decimal(18, 2)

  /// The newest entry folded into `amount`. This is what makes the nightly
  /// check in Step 4 exact rather than approximate: it sums entries up to
  /// this id, so concurrent writes during the check cannot make it disagree.
  lastEntryId BigInt

  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  @@id([holderType, holderId, bucket])
  @@schema("transaction")
}

model BalanceAdjustment {
  id Int @id @default(autoincrement())

  holderType BalanceHolderTypeEnum
  holderId   Int
  bucket     BalanceBucketEnum
  direction  BalanceDirectionEnum
  amount     Decimal @db.Decimal(18, 2)

  /// Mandatory. An adjustment nobody can explain is indistinguishable from
  /// an error, six months later.
  reason String  @db.VarChar(500)
  /// Free-form pointer at whatever the evidence is - a chat thread, a ticket,
  /// an upstream export filename.
  evidence String? @db.VarChar(500)

  createdAt DateTime @default(now()) @db.Timestamptz(6)
  createdBy Int      @db.Integer()

  @@index([holderType, holderId])
  @@schema("transaction")
}
```

`BalanceAdjustment` exists so `MANUAL_ADJUSTMENT` entries have a real
`sourceId`. Without it, the unique constraint makes a holder adjustable exactly
once per source, forever.

### Two things the design doc got wrong

**There is no `version` column.** It was there for optimistic locking, which is
only needed if you read a balance and then write it back. Step 2 never does
that.

**There is no `CHECK (amount >= 0)`.** It looks right and it would break
reversals: a refund on a payment the merchant already spent legitimately drives
`AVAILABLE` negative, and a constraint would block the refund rather than
record it. Overdraw is prevented on the *payout* path instead, in Step 2, where
it belongs.

### Attribution — do NOT add these to `AUDITED_MODELS`

The instinct is to add all three to `AUDITED_MODELS` in
[audit.extension.ts](../../apps/transaction/src/database/audit.extension.ts:5),
next to `MerchantBalanceLog`. **Don't** — it breaks two ways, both found by
doing it:

**It throws on `BalanceSnapshot`.** The extension's create path calls
`creationAuditFields()`, which returns `createdAt` *unconditionally* — only
`createdBy` is guarded by the CLS check. `BalanceSnapshot` has neither column,
so the first `upsert` in Step 2 injects an unknown argument and Prisma rejects
it. Not a null, not a wrong value: a hard `PrismaClientValidationError` on the
very first balance write.

**It silently overrides explicit attribution.** `mergeData` spreads the audit
fields last (`{ ...data, ...fields }`), so the extension wins over anything the
caller passed. With two mechanisms writing one column on a money table, the
implicit one takes precedence — the wrong way round.

So: `createdBy` is **NOT NULL and passed explicitly** by `libs/balance`. The
generated type is `createdBy: number`, which means TypeScript refuses an
unattributed balance entry at every call site — a stronger guarantee than an
ambient CLS value that is easy to forget to set, and cron jobs are exactly where
ambient context is least reliable.

The extension stays for ordinary CRUD, where a request context is genuinely
present.

> **🔴 The dashboard has a generated schema over the same tables.** Miss this and
> dashboard code writes to columns that do not exist:
>
> ```bash
> npm run prisma:merge:dashboard && npm run prisma:generate:dashboard
> ```

**Verify**: `npx prisma migrate dev`, then the generated `BalanceEntry` type
appears in both `apps/transaction/src/generated/prisma/models/` and
`apps/dashboard/src/generated/prisma/models/`, and all four apps typecheck.

---

## Step 2 — `libs/balance`

The single posting implementation. Both `apps/transaction` and
`apps/settlement` use it; neither reimplements it. This is what keeps the
legacy two-writers problem from returning.

```
libs/balance/src/
  balance.constant.ts     INTERNAL_HOLDER_ID, bucket ordering
  balance.movement.ts     the movement catalogue (pure, no I/O)
  balance.service.ts      post() + reserve()
  balance.module.ts
  index.ts
```

### 2.1 Movements are data, not code

A movement is a list of legs. Keeping it declarative means the catalogue can be
read in one screen and unit-tested without a database.

```ts
export interface BalanceLeg {
  holderType: BalanceHolderTypeEnum;
  holderId: number;
  bucket: BalanceBucketEnum;
  direction: BalanceDirectionEnum;
  amount: Decimal; // always positive
}

export interface BalanceMovement {
  reason: BalanceReasonEnum;
  sourceType: BalanceSourceTypeEnum;
  sourceId: number;
  batchId?: number;
  legs: BalanceLeg[];
}
```

`MERCHANT_SETTLED` for one purchase, one merchant, one agent:

```ts
legs: [
  { MERCHANT, 27, PENDING,   DEBIT,  98_000 },
  { MERCHANT, 27, AVAILABLE, CREDIT, 98_000 },
  { AGENT,     5, PENDING,   DEBIT,     200 },
  { AGENT,     5, AVAILABLE, CREDIT,    200 },
  { INTERNAL,  0, PENDING,   DEBIT,   1_000 },
  { INTERNAL,  0, AVAILABLE, CREDIT, 1_000 },
]
```

**Assert transfers net to zero per holder.** Every reason except
`PAYIN_CAPTURED`, `TOPUP_APPROVED`, `PAYOUT_COMPLETED` and `MANUAL_ADJUSTMENT`
is a pure transfer between buckets, so its legs must sum to zero for each
holder. That one assertion catches most arithmetic mistakes at the point they
are made rather than in a report a month later.

### 2.2 `post()`

```ts
async post(tx: PrismaTransactionClient, movement: BalanceMovement): Promise<void>
```

Takes an existing transaction client rather than opening its own — the caller
decides the transaction boundary, because the whole point is that a balance
write and the row that caused it commit together.

For each leg, **sorted by `(holderType, holderId, bucket)`**:

1. `createMany` the entries, `skipDuplicates: false` — a duplicate is a
   real signal and must throw.
2. `upsert` the snapshot with an **atomic increment**:

```ts
await tx.balanceSnapshot.upsert({
  where:  { holderType_holderId_bucket: { holderType, holderId, bucket } },
  create: { holderType, holderId, bucket, amount: signed, lastEntryId: entryId },
  update: { amount: { increment: signed }, lastEntryId: entryId },
});
```

`signed` is `+amount` for a credit and `-amount` for a debit. Prisma's
`increment` compiles to `SET amount = amount + $1`, which is atomic in
Postgres — never read the balance into JavaScript and write it back.

### 2.3 Why there are no advisory locks

Legacy wrapped every balance write in `pg_advisory_xact_lock(30, 0)` plus
per-merchant and per-agent locks, and the audit flagged lock 30 as a throughput
bottleneck.

**Those locks existed because of how legacy computed a balance**: read the last
log row, add to it, insert a new row carrying the result. That is a
read-then-write, and two concurrent writers reading the same baseline is a lost
update — so it had to be serialized.

A snapshot row updated with `amount = amount + delta` has no such window.
Postgres takes a row lock for the duration of the update and applies the
increments one after another; both land. There is nothing left for an advisory
lock to protect.

**What still matters is ordering.** Two transactions updating the same set of
snapshot rows in different orders can deadlock on the *row* locks. Sorting the
legs by `(holderType, holderId, bucket)` before applying gives every transaction
the same acquisition order, which is the same discipline legacy achieved by
`.sort()`ing agent ids — just cheaper and without a global lock.

This is a real simplification, and it is worth understanding rather than
copying: if you ever reintroduce a read-then-write on a balance, the locks come
back with it.

### 2.4 `reserve()` — the one place that must check before it writes

```ts
async reserve(tx, { holderType, holderId, amount, sourceType, sourceId }):
  Promise<{ ok: true } | { ok: false; reason: 'INSUFFICIENT_BALANCE' }>
```

A payout must not proceed unless the balance is there. That check cannot be
`if (balance >= amount)` in JavaScript — two requests can both pass it.

Do it as a conditional update, which is one atomic statement:

```sql
UPDATE transaction.balance_snapshot
SET amount = amount - $1, last_entry_id = GREATEST(last_entry_id, $2)
WHERE holder_type = $3 AND holder_id = $4
  AND bucket = 'AVAILABLE'
  AND amount >= $1
RETURNING amount;
```

Zero rows back means insufficient balance — and it means it *reliably*, because
the comparison and the decrement are the same statement. Only then write the
two entries and credit `RESERVED`.

`GREATEST` is there because `lastEntryId` must never go backwards when two
transactions interleave; Step 4 depends on it being monotonic.

> **Raw SQL bypasses `@updatedAt`.** That attribute is a Prisma *client*
> feature, not a database default or trigger, so this statement fires neither it
> nor the audit extension. `BalanceSnapshot.updatedBy` is NOT NULL, so an update
> to an existing row will succeed while quietly leaving both columns stale.
> **Set `updated_at` and `updated_by` explicitly in this statement.**

**Verify**: `npx jest libs/balance`. Cover — legs applied in sorted order; a
duplicate movement throws rather than double-posting; `reserve` returns
`INSUFFICIENT_BALANCE` at exactly one rupiah short and succeeds at exactly
equal; transfer movements assert to zero per holder; a snapshot row is created
on first touch and incremented on second.

---

## Step 3 — Opening balances

A one-off script reading the legacy log tables and writing the starting
position. Put it in `apps/transaction/prisma/` next to the seeds, not in
application code — it runs once.

For each distinct holder in `MerchantBalanceLog`, `AgentBalanceLog` and
`InternalBalanceLog`, take the newest row by `(createdAt desc, id desc)` — the
same ordering `LATEST_FIRST` uses in
[apps/dashboard/src/modules/balance/balance.service.ts](../../apps/dashboard/src/modules/balance/balance.service.ts:34)
— and post one movement:

```ts
{
  reason: OPENING_BALANCE,
  sourceType: OPENING,
  sourceId: <holderId>,   // unique per holder within OPENING
  legs: [
    { holder, AVAILABLE, CREDIT, row.balanceActive  },
    { holder, PENDING,   CREDIT, row.balancePending },
  ],
}
```

Skip zero-amount legs — a holder with no pending balance should not get a zero
row.

**Make it idempotent and re-runnable.** The unique constraint already does most
of that; run it twice on purpose in testing and confirm the second run changes
nothing.

**Print a reconciliation summary at the end**: total available, total pending,
holder count, per holder type. Keep that output. It is the number every later
question about "was the migration right?" gets compared against.

**Verify**: run on a copy of production data, then for ten random merchants
confirm `BalanceSnapshot.amount` equals what the current dashboard endpoint
returns for them.

---

## Step 4 — The verification job

Small, and the reason the rest is trustworthy. `apps/transaction`, a nightly
`@Cron`.

For each snapshot row:

```sql
SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0)
FROM transaction.balance_entry
WHERE holder_type = $1 AND holder_id = $2 AND bucket = $3
  AND id <= $4;                            -- the snapshot's lastEntryId
```

**`id <= lastEntryId` is what makes this exact.** Without it the sum races
against concurrent writes and produces false mismatches at 2am, which is the
fastest way to get an alert ignored.

On a mismatch: log at error with holder, bucket, both figures and the
difference. **Never auto-correct.** A snapshot that disagrees with its entries
means either a bug or a manual database edit, and both need a human.

> **`@nestjs/schedule` v12 is ESM-only.** Runtime is fine on Node 24; Jest is
> not. `transformIgnorePatterns: ["/node_modules/(?!@nestjs/schedule)"]` is
> already in the jest config from the merchant-signature work — any new spec that
> transitively imports a scheduled service needs it, or you get a misleading
> "unexpected token".

**Verify**: seed a deliberate mismatch by updating a snapshot row directly;
confirm the job reports it and changes nothing.

---

## Step 5 — `PAYIN_CAPTURED`

[apps/transaction/src/api-v1/purchase/purchase.webhook.service.ts:209](../../apps/transaction/src/api-v1/purchase/purchase.webhook.service.ts) —
replace the `TODO(balance-ledger)` comment.

The movement, built from the purchase's `PurchaseFeeDetail` rows:

```
MERCHANT 27 | PENDING | CREDIT | netNominal
AGENT     5 | PENDING | CREDIT | <AGENT fee detail>      (one leg per agent)
INTERNAL  0 | PENDING | CREDIT | <INTERNAL fee detail>
```

The `PROVIDER` fee detail gets **no leg** — that money never reaches us, the
upstream keeps it. It stays recorded on the fee detail row for the export.

Three things to get right:

**Post inside the existing `$transaction`** that already updates the purchase
status, so the status change and the credit commit together.

**Handle the no-fee case.** The service already logs `Paid QRIS settled with no
fee detail` when the fee service was down. Post the merchant leg with
`netNominal` and no agent/internal legs, and let the existing settlement-sweep
note stand — a missing fee split must not block recording money that moved.

**Do not throw out of the webhook on a duplicate.** A replayed provider callback
hits the unique constraint. Catch Prisma `P2002` specifically, log it at debug,
and return success — the provider is retrying something already done, and a 500
makes them retry harder.

**Verify**: `npx jest apps/transaction`. A webhook that settles a purchase
writes one entry per non-provider fee holder; replaying the identical webhook
writes nothing more and does not error; a purchase with no fee details still
credits the merchant.

---

## Step 6 — Payout reserve, complete, fail

This is the step that closes D17.

**On create** — in the same `$transaction` as the disbursement row, **before**
the upstream is called:

```
MERCHANT 27 | AVAILABLE | DEBIT  | amount    (via reserve(), Step 2.4)
MERCHANT 27 | RESERVED  | CREDIT | amount
```

If `reserve()` returns `INSUFFICIENT_BALANCE`, throw before the provider call.
That ordering is the whole point: reserve-before-call, the same rule already
governing the transaction row itself.

**On callback SUCCESS**: `RESERVED | DEBIT | amount`.

**On callback FAILED**: `RESERVED | DEBIT` + `AVAILABLE | CREDIT` — the money
comes back.

Applies to `apps/transaction/src/api-v1/disbursement/` today. Withdraw and topup
live in `apps/dashboard` and are still stubs — they consume the same
`libs/balance` when they are built, which is why the lib is a lib.

**Verify**: two concurrent disbursements for more than the balance — exactly one
succeeds. Write this as a real concurrent test, not a sequential one; a
sequential test passes against the broken implementation too.

---

## Step 7 — `apps/settlement`

Only now is there something to run. Scaffold it like the existing apps:

- `apps/settlement/{src,prisma,tsconfig.app.json}`
- a `projects` entry in [nest-cli.json](../../nest-cli.json)
- `build:settlement` / `start:settlement` and the `prisma:*:settlement` scripts
  in `package.json`, mirroring the transaction ones
- `PrismaModule`, `ConfigModule`, `LoggerModule`, `HealthModule`,
  `RedisModule`, `ScheduleModule.forRoot()`

Its Prisma client spans **`transaction` + `config` + `settlement`**, so it needs
a merge step like the dashboard's. Copy
[apps/dashboard/prisma/merge-schema.js](../../apps/dashboard/prisma/merge-schema.js)
and point it at those three.

> There are now two generated schemas over the `transaction` tables. A change to
> `apps/transaction/prisma/schema.prisma` must re-run **both** merges. Add them
> to one `npm run prisma:merge:all` so neither is forgotten.

### 7.1 Machine identity — who is `createdBy` on a cron's writes?

[audit.extension.ts](../../apps/transaction/src/database/audit.extension.ts:37)
stamps `createdBy` / `updatedBy` from `nestjs-cls` at `authInfo.userId`. A cron
has no request, so no CLS context, so `getAuditUserId()` returns `undefined` —
and the extension then **omits the field** rather than writing null:

```ts
return { updatedAt: now, ...(userId !== undefined ? { updatedBy: userId } : {}) };
```

That omission behaves differently on the two paths, and the difference matters:

- **On a create**, the column has no prior value and no `@default`, so it lands
  as `NULL`. **Every balance entry a background job writes gets
  `createdBy: null`** — Steps 4, 10 and 13.
- **On an update**, the column keeps whatever was already there while
  `updatedAt` moves. So a row ends up reading *"last updated 03:00 by user
  42"* when user 42 did nothing at 03:00. A stale id is worse than a null,
  because it looks authoritative.

The existing `MerchantSecretCleanupService` is the second kind. Wrapping jobs in
a CLS context fixes both at once.

[auth-engine.seed.ts](../../apps/auth/prisma/seed/auth-engine.seed.ts:11) already
seeds `scheduler01@pg.id` … `scheduler10@pg.id` with `ROLE.SCHEDULER`, plus five
`reserved*` spares. This is what they are for.

**Allocate one scheduler account per job, not per pod.** Which pod did the work
is already answered by `SettlementRun.claimedBy`, and pod names are ephemeral —
a `Deployment` gives you `settlement-7d9f8b-x4k2p`, which cannot be mapped to a
stable account without a `StatefulSet`. *Which job* did the work is the question
`createdBy` is actually good at, and it is the one worth answering: a balance
entry attributed to the export job is a bug you would otherwise never find.

| Account | Job |
|---|---|
| `scheduler01` | Settlement batch runner (Step 10) |
| `scheduler02` | Settlement enqueuer (Step 11) |
| `scheduler03` | Stuck-run sweeper (Step 11) |
| `scheduler04` | Balance verification (Step 4) |
| `scheduler05` | Export runner (Step 13) |
| `scheduler06` | Export / MinIO cleanup (Step 13) |
| `scheduler07` | Merchant secret cleanup (exists; currently leaves a stale `updatedBy` beside a fresh `updatedAt`) |
| `scheduler08`–`10` | Unallocated — transaction expiry, webhook retry, import processing |

**Resolve the ids at boot, never hardcode them.** `User.id` is autoincrement, so
the numeric ids differ between a fresh database and production. The settlement
app's Prisma client does not span the `auth` schema — deliberately, since that
would also hand it merchant secrets — so resolve over TCP with a new
`AUTH_CMD.FIND_SCHEDULER_USER`, once at startup, cached for the process
lifetime. **Fail startup if an account is missing**, rather than silently
falling back to null and discovering it in an audit six months later.

**Then wrap each job run in a CLS context** and the existing audit extension does
the rest — no identity parameter has to be threaded through `libs/balance`:

```ts
await this.cls.run(async () => {
  this.cls.set('authInfo.userId', this.schedulerIds.settlementRunner);
  await this.runOnce();
});
```

**Verify**: run the batch job and confirm `BalanceEntry.createdBy` is
`scheduler01`'s id, not null.

**Verify**: `npx nest build settlement`; the app boots and `/health` answers.

---

## Step 8 — `SettlementRun` and `SettlementBatch`

`apps/settlement/prisma/schema.prisma`, schema `settlement`.

```prisma
model SettlementRun {
  id                Int      @id @default(autoincrement())
  merchantId        Int
  paymentMethodName String?  /// null = the merchant's default policy
  dueAt             DateTime @db.Timestamptz(6)

  status SettlementRunStatusEnum /// PENDING | RUNNING | DONE | FAILED

  claimedBy     String?   @db.VarChar(100) /// pod identity
  claimedAt     DateTime? @db.Timestamptz(6)
  finishedAt    DateTime? @db.Timestamptz(6)
  failureReason String?   @db.VarChar(1000)
  attempts      Int       @default(0)

  batches SettlementBatch[]

  /// Makes the enqueuer safe to run on both pods - the second insert loses.
  @@unique([merchantId, paymentMethodName, dueAt])
  @@index([status, dueAt])
  @@schema("settlement")
}

model SettlementBatch {
  id    Int @id @default(autoincrement())
  runId Int

  /// Descriptive, derived from what was claimed - never used to select.
  sweptFrom DateTime? @db.Timestamptz(6)
  sweptTo   DateTime? @db.Timestamptz(6)

  transactionCount Int     @default(0)
  grossAmount      Decimal @default(0) @db.Decimal(18, 2)
  feeAmount        Decimal @default(0) @db.Decimal(18, 2)
  netAmount        Decimal @default(0) @db.Decimal(18, 2)

  postedAt DateTime @default(now()) @db.Timestamptz(6)

  run SettlementRun @relation(fields: [runId], references: [id])

  @@index([runId])
  @@schema("settlement")
}
```

One run can produce several batches because of the 500-transaction cap.

### The claim index

The claim query in Step 10 filters on `settlementBatchId IS NULL`. A partial
index stays small forever, because rows leave it as they are settled:

```sql
CREATE INDEX purchase_unsettled_idx
  ON transaction.purchase_transaction (merchant_id, payment_method_name)
  WHERE settlement_batch_id IS NULL
    AND status = 'SUCCESS'
    AND deleted_at IS NULL;
```

Write this as raw SQL in the migration — Prisma cannot express a partial index.

---

## Step 9 — Policy and eligibility

`MerchantSettlementPolicy` goes in `apps/config/prisma/schema.prisma` alongside
`Merchant`, since it is merchant configuration. Shape is in
[settlement-batching.md §4](settlement-batching.md).

**Resolution is most-specific-first**: a row matching
`(merchantId, paymentMethodName)` wins over `(merchantId, null)`. If neither
exists, fall back to a system default of `FOLLOW_UPSTREAM` rather than settling
nothing — a merchant with no policy row should still get paid.

Also filter on `effectiveFrom <= now < effectiveTo`.

### `isEligible(payment, policy, now)`

Pure function, no I/O, in `apps/settlement/src/policy/`. This is the piece worth
unit-testing hardest — it decides when merchants get their money.

| Mode | Eligible when |
|---|---|
| `INSTANT` | always |
| `FIXED_DELAY` | `paidAt + delayDays` has passed, at `releaseTimes[0]` |
| `SCHEDULED` | the most recent `releaseTimes` entry after `paidAt` has passed |
| `FOLLOW_UPSTREAM` | the upstream's expected settlement for that provider and method has passed |

`FOLLOW_UPSTREAM` needs a small `UpstreamSettlementWindow` table — shape and the
three partners' known rules are in
[docs/accounting/upstream-settlement-schedules.md](../accounting/upstream-settlement-schedules.md).
Seed MotionPay QRIS (T+1 15:00) and E-Wallet (H+3) and stop there; add partners
as they go live.

**Everything is `Asia/Jakarta`.** Do the day arithmetic in an explicit timezone,
not in the container's local time, or the answer changes when the container
moves. The `businessDaysOnly` flag and the holiday calendar are only needed once
Pakailink is live — leave the column, skip the calendar.

**Verify**: a table-driven spec per mode, including the boundary minute in both
directions and a payment made at 23:59.

---

## Step 10 — The claim and the batch

`apps/settlement/src/settlement/settlement.service.ts`. The core.

Inside one `$transaction`:

**1. Claim, capped.**

```sql
UPDATE transaction.purchase_transaction
SET settlement_batch_id = $batchId, merchant_settled_at = now()
WHERE id IN (
  SELECT id FROM transaction.purchase_transaction
  WHERE merchant_id = $merchantId
    AND status = 'SUCCESS'
    AND settlement_batch_id IS NULL
    AND deleted_at IS NULL
    AND ($paymentMethod::text IS NULL OR payment_method_name = $paymentMethod)
    AND <eligibility predicate from Step 9>
  ORDER BY paid_at
  LIMIT 500
  FOR UPDATE SKIP LOCKED
)
RETURNING id, paid_at, nominal, net_nominal;
```

Claiming zero rows is normal and not an error — most runs for most merchants
will find nothing. Finish the run as `DONE` with no batch.

**2. Read the fee details** for the claimed ids, and build one movement per
purchase — merchant, each agent, internal, each moving `PENDING → AVAILABLE`.

**3. Post them** through `libs/balance`, still in the same transaction.

**4. Write the `SettlementBatch` row** with the totals and the min/max `paidAt`
as `sweptFrom` / `sweptTo`.

**5. If 500 rows came back, there may be more** — loop and create another batch
until a claim returns fewer than the cap.

Two things worth being deliberate about:

**Why the eligibility predicate is in SQL.** Fetching candidates and filtering
in JavaScript means reading every unsettled row of a busy merchant into memory
to discard most of them. For `FIXED_DELAY` and `SCHEDULED` the predicate is
plain date arithmetic on `paid_at`. For `FOLLOW_UPSTREAM` it is a lookup per
(provider, method) — resolve those to concrete cutoff timestamps in JavaScript
*before* the query, then pass them in as parameters.

**`FOR UPDATE SKIP LOCKED` on the inner select** means two pods that somehow run
the same merchant do not block each other; the second simply finds nothing. It
is a second line of defence behind the run claim, not a replacement for it.

**Verify**: settle a merchant with 1,200 eligible purchases → three batches,
every purchase claimed exactly once, snapshot moves match the sum of
`netNominal`. Re-run immediately → no new batches. And confirm an ineligible
purchase is still unclaimed afterwards.

---

## Step 11 — The enqueuer and the sweeper

**The enqueuer** is a `@Cron` (every 5 minutes is plenty) that inserts
`SettlementRun` rows for merchants whose next release time has passed. It does
no work itself. Both pods firing it is harmless because of
`@@unique([merchantId, paymentMethodName, dueAt])` — catch `P2002` and move on.

**The runner** claims one run at a time:

```sql
UPDATE settlement.settlement_run
SET status = 'RUNNING', claimed_by = $1, claimed_at = now(), attempts = attempts + 1
WHERE id = (
  SELECT id FROM settlement.settlement_run
  WHERE status = 'PENDING' AND due_at <= now()
  ORDER BY due_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

Loop until it returns nothing.

**The sweeper** resets runs stuck in `RUNNING` for more than 15 minutes back to
`PENDING`. This is what makes a pod crash recoverable — and it is safe *only*
because the claim in Step 10 is idempotent: whatever the dead pod already
settled is no longer `NULL`, so a re-run picks up only what is left.

Give up after `attempts >= 3` and mark it `FAILED` with the reason, so a
genuinely broken merchant does not spin forever.

**Verify**: kill the pod mid-run (or throw deliberately after the first batch),
confirm the sweeper resets it and the retry settles only the remainder.

---

## Step 12 — Dashboard

Three changes in `apps/dashboard`:

**Balance reads switch to the snapshot.** In
[balance.service.ts](../../apps/dashboard/src/modules/balance/balance.service.ts),
replace the `findFirst` on the log tables with a `findUnique` on
`BalanceSnapshot`. Simpler and faster — a primary-key lookup instead of an
ordered scan.

This also quietly fixes D18's aggregate inconsistency: the old aggregate
excluded `PURCHASE` while the single-holder endpoints did not, so the two never
had to agree. Summing snapshot rows removes the question.

**Admin profit view**: `INTERNAL` holder `0`, both buckets — pending profit and
settled profit shown separately. Gate on `ROLE.ADMIN` / `ROLE.SUPER_ADMIN` from
[libs/microservice/src/microservice.enum.ts](../../libs/microservice/src/microservice.enum.ts:56).

**Manual adjustment**: a form writing `BalanceAdjustment` plus its movement, in
one transaction, gated on the same two roles. Mandatory reason. `createdBy` from
the CLS auth context. Show the adjustment history on the same screen — an
adjustment tool without a visible log is how a balance quietly becomes fiction.

> **`BalanceEntry.id` is a `BigInt`, and `JSON.stringify` throws on those.**
> Convert to string in the DTO. This will not fail at compile time and it will
> not fail in a unit test that never serializes — it fails as a 500 the first
> time the endpoint is called.

---

## Step 13 — Excel export

What the other department actually asked for.

A `MinioModule` in `libs/` (new — nothing in the monorepo speaks S3 today), then
an export job in `apps/settlement` reusing the run-table pattern: a request row,
claimed and processed in the background, because a large export will outlive an
HTTP request.

- Filters: date range, merchant, provider, payment method, status.
- One row per transaction with the full fee breakdown — gross, provider fee,
  internal fee, agent fee, net. Amounts as text, not floats.
- Upload to MinIO, store the object key and an `expiresAt`, return a presigned
  URL.
- A daily cleanup deleting objects past `expiresAt` (1–2 days).

`exceljs` is what legacy used and is a reasonable choice. **Stream rather than
building the workbook in memory** — a month of transactions for a busy merchant
will not fit comfortably otherwise.

---

## Step 14 — Comparison tool (placeholder)

Deliberately unfinished, because no upstream's export format is decided.

Build: the upload endpoint, a `ReconciliationImport` row (filename, upstream,
uploaded by, status, object key), storage in MinIO, and a parser **interface**:

```ts
interface UpstreamStatementParser {
  readonly providerName: ProviderNameEnum;
  parse(file: Buffer): Promise<UpstreamStatementRow[]>;
}

interface UpstreamStatementRow {
  providerReference: string;
  amount: Decimal;
  paidAt: Date | null;
  raw: Record<string, unknown>;
}
```

No concrete parsers yet. When a format is known it is one class, registered by
provider name — not a redesign.

The matcher can be written now against that interface, since matching is
format-independent: join on `providerReference`, classify as matched / only in
theirs / only in ours / amount differs, render a table, offer it as Excel.
**It writes nothing to any balance.**

**Before writing any parser, email each upstream and ask what reference appears
on their export.** If their file carries nothing we can join on, the tool cannot
work — worth learning in a reply rather than after the code exists.

---

## Step 15 — Delete the legacy tables

Last, once the snapshot has been the read path for a full settlement cycle and
the Step 4 check has been quiet.

1. Drop `MerchantBalanceLog`, `AgentBalanceLog`, `InternalBalanceLog` — and
   remove them from `AUDITED_MODELS`.
2. Remove `TransactionTypeEnum.SETTLEMENT_PURCHASE` from the Prisma enums **and**
   from [libs/microservice/src/microservice.enum.ts](../../libs/microservice/src/microservice.enum.ts:112).
3. Drop `Merchant.settlementInterval` and `lastSettlementAt`; drop
   `Provider.reconciliationTime` and `lastReconciliationAt`; drop
   `batchReconciliationId` and `reconciliationAt` from both transaction models.
4. Re-run both schema merges.

**Take a backup of the three log tables first** — as a dump, not a rename.
They are the only record of pre-migration history, and the opening-balance
entries reference figures that came from them.

---

## Suggested commit boundaries

| Commit | Steps | Independently shippable? |
|---|---|---|
| `feat(transaction): balance entry + snapshot schema` | 1 | yes, dormant |
| `feat(balance): posting library` | 2 | yes, dormant |
| `feat(transaction): opening balances from legacy logs` | 3 | yes — data only, nothing reads it |
| `feat(transaction): nightly balance verification` | 4 | yes |
| `feat(transaction): credit merchant balance on payin` | 5 | **behavior change** |
| `feat(transaction): reserve balance before payout` | 6 | **behavior change** — closes D17 |
| `feat(settlement): app skeleton` | 7 | yes, empty |
| `feat(settlement): run and batch schema` | 8 | yes, dormant |
| `feat(config): merchant settlement policy` | 9 | yes, dormant |
| `feat(settlement): claim and post batches` | 10 | yes — nothing schedules it yet |
| `feat(settlement): enqueuer and stuck-run sweeper` | 11 | **behavior change** — the cutover |
| `feat(dashboard): read balances from snapshot` | 12 | **behavior change** |
| `feat(settlement): transaction export to minio` | 13 | yes |
| `feat(settlement): statement comparison placeholder` | 14 | yes |
| `chore: drop legacy balance logs` | 15 | yes, after a full cycle |

Steps 1–4 are dormant — nothing changes behaviour until Step 5. Step 11 is the
real cutover: it is the first moment settlement happens on the new schedule, and
it is worth telling merchants about beforehand, because `FOLLOW_UPSTREAM` means
waiting until T+1 15:00 instead of the 120 minutes they get today.

---

*Design rationale: [settlement-batching.md](settlement-batching.md). Partner
timings: [docs/accounting/upstream-settlement-schedules.md](../accounting/upstream-settlement-schedules.md).
Reference on ledger theory, kept for a possible future accounting app:
[docs/accounting/](../accounting/).*
