# Settlement Batching — Implementation Guide

Companion to [settlement-batching.md](settlement-batching.md), which covers
*why*. This one is the build order.

Written 22 Sep 2026, **and kept current as each step lands** — where a step was
built differently from how it was planned, the section says so rather than
quietly reading as though it was always that way.

Steps are ordered so each is independently verifiable and nothing is left
half-wired between them. **Steps 1–6 needed no new app** — they landed in
`apps/transaction` and `libs/`, and they are the ones that fix money bugs.
`apps/settlement` does not appear until Step 7, when there is finally something
for it to run.

## Status

| Step | What | State |
|---|---|---|
| 1 | `BalanceEntry` + `BalanceSnapshot` + `BalanceAdjustment` | ✅ `f7af945` |
| 2 | `libs/balance` — `post()` and `reserve()` | ✅ `1f334d7` |
| 3 | Dev fixtures through the posting service | ✅ `3150b7d` |
| 4 | Nightly snapshot-versus-entries verification | ✅ `d5d7613` |
| 5 | `PAYIN_CAPTURED` from the purchase webhook | ✅ `e7aadc5` |
| 6 | Payout reserve / complete / fail — **closes D17** | ✅ `ddb6778` |
| 7 | `apps/settlement` skeleton | ✅ `61d20a9` |
| 8 | `SettlementRun` + `SettlementBatch` + the claim index | ✅ `4215a4f`, `d4ade10` |
| 9 | Policy and eligibility | ✅ `0896962` |
| 10 | The claim and the batch | next |
| 11–15 | Enqueuer, dashboard, export, comparison, cleanup | planned |

Step 8 took two commits because `SettlementRun.createdBy` went in nullable and
had to be corrected — the reasoning is under *Audit columns* in that step.

Both `TODO(balance-ledger)` markers are gone, and the overdraw race
([D17](../engine/dashboard-migration.md)) is closed structurally rather than by
locking — see Step 6.

Also pinned along the way, because `BalanceEntry.createdBy` is NOT NULL and a
webhook has no person behind it: the 6 roles and 20 machine principals now have
fixed ids from the `machine_principals` migration, exposed as `ROLE_ID`,
`MACHINE_USER_ID` and `SYSTEM_USER_ID` (Step 7.2).

> **Corrections this document has absorbed**, each explained where it comes up:
> there are **no advisory locks** (Step 2), there is **no `CHECK (amount >= 0)`**
> (Step 2), `sourceType` is **its own enum** rather than `TransactionTypeEnum`
> (Step 1), `PAYOUT_COMPLETED` **credits the internal and agent fees** rather
> than being a bare reservation debit (Step 6.3), and the settlement app has a
> **client per schema** rather than one borrowed client (Step 7.0).

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
[audit.extension.ts](../../apps/transaction/src/database/audit.extension.ts:28),
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

**Assert every amount is positive, and no finer than the column.**
`assertPositiveMoney` rejects two things on every leg, and on `reserve()`'s
amount:

- **Zero, negative, or non-finite.** `direction` carries the sign; the amount
  never does. A negative CREDIT and a positive DEBIT would mean the same thing,
  and once both spellings exist in the table every query has to handle both.
- **More than two decimal places.** The columns are `Decimal(18,2)`, so a third
  decimal would be rounded by Postgres on the way in — silently, and in a
  direction nobody chose. The error says to round at the fee split instead,
  which is the one place a residual can be assigned to a specific party
  deliberately rather than scattered across legs by the database.

Both throw rather than coerce. A movement that cannot be expressed exactly is a
bug upstream, and rounding it here would hide which party absorbed the
difference.

### 2.2 `post()`

```ts
async post(tx: BalanceTx, movement: BalanceMovement): Promise<void>
```

Takes an existing transaction client rather than opening its own — the caller
decides the transaction boundary, because the whole point is that a balance
write and the row that caused it commit together.

`BalanceTx` is a one-line alias for `Prisma.TransactionClient` from
`@transaction/prisma` — `Omit<PrismaClient, ITXClientDenyList>`, exactly what
`prisma.$transaction(async (tx) => …)` hands the callback. That points a lib at
an app, which is backwards, and `apps/dashboard` uses a different generated
client over these same tables (Step 12). Deliberate for now: real Prisma types
give the compile error when `createdBy` is missing, which is the enforcement
these tables are absent from `AUDITED_MODELS` for. **Widening that single alias
is the whole change** when a second client needs to call in.

A root client still type-checks here, because TypeScript permits extra
properties when assigning a variable — and passing one would let the entries and
the snapshot commit separately, silently. So there is a runtime guard, and it
checks **`$connect`, not `$transaction`**. Measured on Prisma 7.8:

```
         $transaction  $connect  $disconnect  $extends
  root   present       present   present      present
  tx     present       absent    absent       absent
```

The one property the type removes is the one that does not discriminate — the
interactive-transaction client is a Proxy that still exposes `$transaction`.
`$connect` is the honest test: only a client that owns a connection can open
one. Worth knowing because the obvious guard is the broken one, and the spec
written against the wrong assumption passed.

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
UPDATE "transaction"."BalanceSnapshot"
SET "amount"      = "amount" - $1,
    "lastEntryId" = GREATEST("lastEntryId", $2),
    "updatedAt"   = now(),
    "updatedBy"   = $3
WHERE "holderType" = $4 AND "holderId" = $5
  AND "bucket" = 'AVAILABLE'
  AND "amount" >= $1
RETURNING "amount";
```

**Quote every identifier.** This repo uses no `@map`, so the table is
`"BalanceSnapshot"` with camelCase columns and Postgres folds anything unquoted
to lower case — unquoted `holderType` fails with `column "holdertype" does not
exist`. The same applies to any computed column, which needs an explicit
`AS "name"`: Step 4 spent a debugging round on an alert that read
`undefined:undefined:PENDING` for exactly this reason.

Zero rows back means insufficient balance — and it means it *reliably*, because
the comparison and the decrement are the same statement. Only then write the
two entries and credit `RESERVED`.

`GREATEST` is there because `lastEntryId` must never go backwards when two
transactions interleave; Step 4 depends on it being monotonic.

> **Raw SQL bypasses `@updatedAt`.** That attribute is a Prisma *client*
> feature, not a database default or trigger, so this statement fires neither it
> nor the audit extension. `BalanceSnapshot.updatedBy` is NOT NULL, so an update
> to an existing row will succeed while quietly leaving both columns stale —
> which is why `"updatedAt"` and `"updatedBy"` are set explicitly above.

**Verify**: `npx jest libs/balance`. Cover — legs applied in sorted order; a
duplicate movement throws rather than double-posting; `reserve` returns
`INSUFFICIENT_BALANCE` at exactly one rupiah short and succeeds at exactly
equal; transfer movements assert to zero per holder; a snapshot row is created
on first touch and incremented on second.

---

## Step 3 — Dev fixtures

> **Changed 7 Oct 2026.** This step was "opening balances" — a one-off script
> reading the legacy log tables and posting each holder's starting position.
> **Dropped: this build does not carry legacy production data**, so there is
> nothing to migrate. `OPENING_BALANCE` and `BalanceSourceTypeEnum.OPENING` stay
> in the enums; they cost nothing and are the right reason code if a balance ever
> has to be established by hand.
>
> Balances therefore start at zero for everyone, and the first real entry any
> holder gets is a `PAYIN_CAPTURED` from Step 5.

### Do balance rows need creating when a merchant registers? No.

The natural instinct is to create three empty snapshot rows in
[`registerMerchant`](../../apps/dashboard/src/modules/user/user.service.ts:32).
It is not needed, and it is worth understanding why rather than just skipping it:

`applyToSnapshot` is an `INSERT ... ON CONFLICT DO UPDATE`, so the row is created
on first touch. That lazy path **cannot be removed**, because not every holder
has a registration event to hang initialisation off — `INTERNAL:0` has none at
all, and a holder's `RESERVED` row only ever appears when they first attempt a
payout. So pre-creating rows adds a *second* way for them to come into existence
without removing the first: two code paths writing one row, two places to be
wrong.

Three smaller reasons it is the wrong trade:

- `BalanceSnapshot.lastEntryId` is NOT NULL, so a pre-created row needs a
  sentinel (`0`) meaning "no entry yet" — a magic value in a money table.
- Anyone registered *before* such code shipped would still have no rows, so you
  would need a backfill. Which is the migration this step just dropped.
- The dashboard already handles an absent row:
  [balance.service.ts](../../apps/dashboard/src/modules/balance/balance.service.ts:55)
  does `?? ZERO`, with a comment saying no rows means no movement rather than a
  missing merchant.

And `reserve()` returning `INSUFFICIENT_BALANCE` for a holder with no snapshot
row is already the right answer — they have no money.

> **`registerMerchant` does need changing, but at Step 9, not here.** It
> currently writes `settlementInterval: dto.settlementInterval ?? 120`, and that
> column is deleted in Step 15. The replacement is a default
> `MerchantSettlementPolicy` row. `DEFAULT_SETTLEMENT_INTERVAL_MINUTES` and
> `CreateMerchantDto.settlementInterval` go with it.

### What to build instead

Fixtures, so Step 4 has something to verify and Step 12 has something to render.
`apps/transaction/prisma/seed/transaction-dev.seed.ts` exists and is empty by
decision — this is what goes in it.

Seed through `BalanceService.post()`, not with raw inserts. Writing rows directly
would let a fixture express a state the real code cannot produce, and then the
first bug you chase will be in the fixture.

Worth covering:

- a merchant with money in `PENDING` only — captured, not yet settled
- a merchant with money in `AVAILABLE` — settled, spendable
- a merchant mid-payout, with a non-zero `RESERVED`
- an agent with a share, and `INTERNAL:0` with the house cut
- a holder with **zero** balance, so the `?? ZERO` path gets exercised

Note the existing doc comment in that file describes constraints on the *old*
`*BalanceLog` tables (item 2, about running totals). That becomes stale here and
should be rewritten for the entry/snapshot model.

**Verify**: run the seed twice. The second run must change nothing — the unique
constraint on `(holder, bucket, reason, sourceType, sourceId)` makes that free as
long as fixture `sourceId`s are fixed rather than generated.

---

## Step 4 — The verification job

Small, and the reason the rest is trustworthy. `apps/transaction`, a nightly
`@Cron`.

### Why this does not wait for `apps/settlement`

The settlement app is meant to own the scheduled work, so a cron landing here
first looks like something that will need moving. It is worth being explicit
about why it does not justify creating that app yet: **this job writes nothing.**

| | This job (Step 4) | The batch runner (Steps 10–11) |
|---|---|---|
| Writes? | No — reads, compares, alerts | Yes, moves merchant money |
| Needs a scheduler account? | **No.** `createdBy` is never set, so none of Step 7.1 applies | Yes — `BalanceEntry.createdBy` is NOT NULL |
| Two pods both running it? | Harmless — two identical reads, duplicate log lines | Double-settles without the claim table |
| Runtime | Seconds | Minutes, in 500-row batches |
| Independent scaling? | No | Yes |

Everything in the right-hand column is the settlement app's reason to exist.
None of it is in the left.

So this needs exactly one thing `apps/transaction` does not have today:
`ScheduleModule.forRoot()` in its `app.module.ts` — `apps/auth` is currently the
only app with it. And when `apps/settlement` does exist, moving this is a
one-file move *because* it is read-only: no identity plumbing, no CLS wrapper and
no claim row travel with it.

> Creating the app now is cheaper than it looks — the `Dockerfile` is already
> parameterised by `SERVICE_NAME`, so it is a word in the CI matrix
> ([ci-cd.yml:17](../../.github/workflows/ci-cd.yml:17)), a
> `k8s/settlement-deployment.yaml`, a `kubectl set image` line, and an env file.
> Defensible if you would rather have it tidy. But it means a fifth deployed
> container whose only job is a nightly `SELECT`, and note `apps/dashboard` has
> no k8s manifest and is not in the CI matrix either — so there is already
> precedent for an app existing before it is deployed.

One statement, joining each snapshot to its own entries, rather than a query per
row:

```sql
SELECT
  s."holderType" AS "holderType",
  s."holderId"   AS "holderId",
  s."bucket"     AS "bucket",
  s."amount"     AS "stored",
  COALESCE(SUM(CASE WHEN e."direction" = 'CREDIT' THEN e."amount" ELSE -e."amount" END), 0) AS "computed"
FROM transaction."BalanceSnapshot" s
  LEFT JOIN transaction."BalanceEntry" e
  ON  e."holderType" = s."holderType"
  AND e."holderId"   = s."holderId"
  AND e."bucket"     = s."bucket"
  AND e."id"        <= s."lastEntryId"
GROUP BY 1, 2, 3, 4
HAVING s."amount" <> COALESCE(SUM(CASE WHEN e."direction" = 'CREDIT' THEN e."amount" ELSE -e."amount" END), 0);
```

**`e."id" <= s."lastEntryId"` is what makes this exact.** Without it the sum
races against concurrent writes and produces false mismatches at 2am, which is
the fastest way to get an alert ignored.

Three things this statement learned the hard way:

- **Quote every identifier, and alias every computed column.** Unquoted names
  fold to lower case, so the first version came back as `holdertype` and the
  alert read `undefined:undefined:PENDING`. The `AS "computed"` matters for the
  same reason — without it the column arrives as `coalesce`.
- **`LEFT JOIN`, not an inner one.** A snapshot whose entries have all been
  rolled past, or a snapshot written for a holder with no entries yet, is
  exactly the disagreement worth alerting on; an inner join hides it.
- **`COALESCE` needs the second argument.** `COALESCE(SUM(x))` with one
  argument returns NULL for an empty group rather than zero, so every
  entry-less snapshot would compare `amount <> NULL`, which is never true.

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

This is the step that closes D17. **Read 6.0 first** — the disbursement flow was
revamped on 30 Sep 2026 and this step needs more than it looks.

### 6.0 What the flow looks like now, and the one thing that blocks this

Audited 7 Oct 2026 against
`apps/transaction/src/api-v1/disbursement/`. The good news first: the
reserve-before-call ordering survived the revamp intact —
`DisbursementService.create` still does
`common.reserveTransaction()` → `send()` → `common.recordUpstreamResult()`, so the
row exists before any provider is asked to move anything.

**The blocker: fees are computed in the webhook, not at create time.**
`reserveTransaction` writes `nominal` and nothing else — no `netNominal`, no
`feeDetails`. Those are written later, by
`DisbursementWebhookService` calling `FeeCalculateConfigClient.disbursement()`.
So at the moment we need to reserve, we do not know the amount to reserve.

And that amount is *not* `nominal`. The existing `TODO(balance-ledger)` flags an
open question — whether `netNominal` is bigger or smaller than `nominal` for a
payout, warning that "backwards, it leaks the fee on every payout". **That
question is now answered.** From the two fee services in `apps/config/src/fee/`:

| Flow | Merchant net | Meaning |
|---|---|---|
| `purchase-fee.service.ts` | `nominal.minus(fees)` | merchant **receives** less than the customer paid |
| `disbursement-fee.service.ts` | `nominal.plus(fees)` | merchant **pays** more than the recipient receives |

So for a payout `netNominal > nominal`, and **the reserve must be `netNominal`.**
Reserving `nominal` would leak the fee on every single payout — precisely the
failure that TODO feared.

### 6.1 Fee calculation has to move to the create path

It already has every input it needs there — `merchantId`, `providerName`,
`paymentMethodName`, `nominal` are all in hand before `reserveTransaction` is
called. Moving it earns a second benefit beyond making the reserve correct: a
merchant with insufficient balance is rejected **before** the provider is called,
rather than discovering it after the money has gone.

> ⚠️ **This forces an availability decision, and it is yours to make.** Today a
> fee-service outage still lets payouts through: the webhook tolerates
> `fee === null`, logs *"Completed payout settled with no fee detail - needs the
> settlement sweep"*, and records the transaction without fees. With
> reserve-at-create that is no longer possible — **you cannot reserve an unknown
> amount**, so a fee-calculation failure has to reject the payout.
>
> Trading availability for correctness is the right call on a debit path, but it
> is a behaviour change on a live endpoint and should be a decision rather than a
> side effect.

### 6.2 Two structural fixes needed first

**`reserveTransaction` is not in a transaction.** It is a bare
`prismaMaster.disbursementTransaction.create(...)`. The row and the balance
reserve must commit together, so it needs wrapping in `$transaction` — and
`BalanceService.post()` will refuse the root client if it is not (Step 2.4).

**Two senses of "reserve" meet in one call path.**
`DisbursementCommonService.reserveTransaction` means *reserve the transaction
row*; `BalanceService.reserve` means *hold the merchant's funds*. Having both in
`DisbursementService.create` is a genuine readability trap. Rename the former —
`createPendingTransaction` says what it does — before adding the latter.

### 6.3 Then the movements

> **Corrected 12 Oct 2026.** Earlier drafts of this section showed
> `PAYOUT_COMPLETED` as a bare `RESERVED | DEBIT`, which **loses the fee**. The
> merchant pays `netNominal` and the recipient gets `nominal`; the difference is
> the provider's cut plus our cut plus the agent's. Debiting the reservation
> without crediting anyone made the internal and agent share vanish on every
> payout. Caught during implementation, not by this document.

**On create**, inside one `$transaction` with the row, before the upstream call:

```
MERCHANT 27 | AVAILABLE | DEBIT  | netNominal    (via reserve(), Step 2.4)
MERCHANT 27 | RESERVED  | CREDIT | netNominal
```

If `reserve()` returns `INSUFFICIENT_BALANCE`, throw before the provider call.
Note `reserve()` **returns** that rather than throwing, so the result has to be
checked — see 6.4.

**On callback SUCCESS** — the reservation is consumed *and* the fees it earned
are paid out:

```
MERCHANT 27 | RESERVED  | DEBIT  | netNominal
INTERNAL  0 | AVAILABLE | CREDIT | internalFee
AGENT     5 | AVAILABLE | CREDIT | agentFee      (one leg per agent)
```

Three things make that the right shape:

**`AVAILABLE`, not `PENDING`.** `PENDING` models "waiting for an upstream to
settle", and this money came out of the merchant's *already settled* balance -
there is nothing to wait for. It would also strand there: the settlement batch
claims purchases and never disbursements, so a payout fee in `PENDING` would
never be promoted.

**The provider fee gets no leg**, same as a pay-in - the upstream keeps it and
it never reaches a balance we track. Net across the holders is therefore
`-(nominal + providerFee)`, exactly the money that left the system.

**`PAYOUT_COMPLETED` is not a transfer reason**, so `post()` does not assert the
legs net to zero - correct, because money genuinely leaves.

**On callback FAILED** — the reservation comes back whole, and **no fee legs**:

```
MERCHANT 27 | RESERVED  | DEBIT  | netNominal
MERCHANT 27 | AVAILABLE | CREDIT | netNominal
```

That asymmetry is the reason to credit the fees at completion rather than at
reservation: the fee is earned by a payout that *works*, so the failure path has
nothing to reverse. `PAYOUT_FAILED` **is** a transfer reason, so `post()`
asserts these two net to zero for the merchant.

Verified against the seeded fixtures, all three paths, rolled back:

```
start      mAVAIL 245,000.00  mRESV       0.00  INTERNAL 7,500.00  AGENT   500.00
reserved   mAVAIL 141,000.00  mRESV 104,000.00  INTERNAL 7,500.00  AGENT   500.00
completed  mAVAIL 141,000.00  mRESV       0.00  INTERNAL 9,500.00  AGENT 1,000.00
```

`RESERVED` returning to exactly `0.00` is the invariant to watch: credit it with
`netNominal` and debit it with anything else and the difference is stranded in
that bucket forever - and the Step 4 check will *not* flag it, because entries
and snapshot stay consistent. The money is simply in the wrong bucket.

### 6.4 What implementing it turned up

- **`reserve()` returns rather than throws**, so ignoring the result lets a
  payout reach the provider with nothing reserved - silently. Check
  `reserved.ok` and raise `TransactionException.insufficientBalance()`.
- **`reserveFailure` must pass a `TransactionException` through untouched.** It
  exists to classify Prisma errors; without a passthrough, a deliberate
  rejection raised inside the reservation transaction falls through to
  `serviceUnavailable()` and the merchant is told to retry something that can
  never succeed.
- **The fee DTO has both `nominal` and `netNominal`** on `merchantFee`. Reading
  the wrong one is how `RESERVED` acquires a residue; `netNominal` lives on the
  disbursement row so the reserve and the debit are the same number by
  construction.
- **A fee-service outage answers `serviceUnavailable()`, not
  `internalError()`** - a dependency being down makes "retry later" correct
  advice, where an internal error implies a malformed request.

Withdraw and topup live in `apps/dashboard` and are still D17-blocked stubs. They
consume the same `libs/balance` when they are built, which is why it is a lib —
but note withdraw will need the same fee-direction answer, since
`WithdrawTransaction` has the same `nominal` / `netNominal` pair.

**Verify**: two concurrent disbursements for more than the balance — exactly one
succeeds. Write this as a real concurrent test, not a sequential one; a
sequential test passes against the broken implementation too. Then check the
reserved amount equals `netNominal` and not `nominal`, because that is the bug
this step exists to avoid.

---

## Step 7 — `apps/settlement`

Only now is there something to run. Scaffold it like the existing apps:

- `apps/settlement/{src,tsconfig.app.json}` — note: **no `prisma/` directory**
- a `projects` entry in [nest-cli.json](../../nest-cli.json)
- `build:settlement` / `start:settlement` in `package.json`. **No
  `prisma:*:settlement` scripts** — see below
- `ConfigurationModule.forRoot()`, `LoggerModule`, `RedisModule`,
  `TerminusModule`, `DatabaseModule`, `ScheduleModule.forRoot()`

Built in `61d20a9`. Two things the app deliberately does **not** import, both
commented in its `app.module.ts`: `MicroserviceModule`, because it reaches the
schemas directly rather than over TCP, and `ClsModule`, because nothing here
runs in a request context.

### 7.0 No Prisma schema of its own, but a client per schema

It still has **no `schema.prisma`, no `prisma.config.ts`, no `migrations/`, no
`src/generated/` and no merge step.** Every table it touches is declared in
`apps/transaction/prisma/schema.prisma` — the `transaction` schema's transaction
and balance tables, and the `settlement` schema's run, batch and policy tables
(Steps 8 and 9). One schema file, one migration history.

What that avoids is the point: the first plan gave this app its own merged
schema, which meant a copy of the transaction models, a merge script, a CI check
to catch it going stale, and a second generated client in the repo. All of it
existed only to keep a copy in sync with an original. No copy, none of it — and
the drift `apps/dashboard` accumulated over several migrations becomes
impossible here rather than merely guarded against.

> **Where the implementation diverged from this plan.** Earlier drafts said to
> pass `@transaction/prisma` to `createPrismaMasterProvider` from `@app/prisma`
> and be done. That does not fit: `PrismaModule.forRoot()` builds exactly **one**
> master/slave pair from **one** client class, and this app reaches more than one
> schema. So it wires its own `DatabaseModule` with a pair per schema.

```
apps/settlement/src/database/
  database.module.ts            PrismaConnectionRegistry + the active pairs
  prisma-transaction.provider.ts  master + slave   (active)
  prisma-auth.provider.ts         master + slave   (commented out)
  prisma-config.provider.ts       master + slave   (commented out)
```

Each provider builds its own `Pool`, hands it to `PrismaPg`, and registers it:

```ts
const pool = new Pool({ connectionString: dsn });
const client = new PrismaClient({ adapter: new PrismaPg(pool), log: [...] });
registry.register('transaction-master', client, pool);
```

Four things that are load-bearing rather than stylistic:

**`PrismaConnectionRegistry` must be in this module's `providers`,** not merely
imported. Nest only runs `onApplicationShutdown` on providers it instantiates,
and that hook is the only thing that closes these pools — `$disconnect()` leaves
an externally-created pool open, which is why the registry exists at all.
Without it the process ignores SIGTERM and gets SIGKILLed on every deploy.

**A `Pool` instance, not a connection string.** The registry's own doc explains
the adapter only closes pools it created itself, so handing it an instance is
what puts closing under our control.

**Auth and config stay commented out until something consumes them.** Each pair
is two more connection pools, and the registry documents the budget as roughly
80 of a default `max_connections` of 100 across the other four apps. Their DSNs
are commented out of `.env.example` to match, so `getOrThrow` cannot fire for a
key nothing reads.

**Give every pool a distinct registry label** — `transaction-master`,
`transaction-slave`. Both halves of a pair under one name means a shutdown
failure cannot be attributed to either.

> **The trade is unchanged.** `apps/settlement` build-depends on
> `apps/transaction`'s generated client, and its deploy depends on transaction's
> migrations having run. Both are desirable: the apps are *meant* to agree on
> these tables, and settlement's carry foreign keys into transaction's, so the
> ordering requirement exists in the database whether or not the build expresses
> it. `apps/dashboard` already works this way.
>
> And the split does **not** cost atomicity for the batch. Once Step 8 declares
> `schemas = ["transaction", "settlement"]`, the transaction client covers the
> claim, the balance entries *and* `SettlementBatch` — so one provider does the
> whole thing in one transaction. The split would only bite if something needed
> to *write* across two of them.

### 7.0.1 Health is local, not `@app/health`

`@app/health`'s controller injects `PRISMA_MASTER_PROVIDER_KEY` /
`PRISMA_SLAVE_PROVIDER_KEY`, tokens only `PrismaModule.forRoot()` provides. With
a client per schema there is nothing to bind them to, so the app has its own
`HealthController` pinging the transaction pools by their own tokens — a smaller
change than teaching a lib four apps share about a second naming scheme.

`TerminusModule` has to be imported directly as a result; it previously arrived
via `@app/health`.

While doing this, the `https://docs.nestjs.com` ping was dropped from
`@app/health` too, so **no app's liveness probe depends on a third-party site**
any more. A DNS hiccup or blocked egress was enough to get a healthy process
restarted — worse here than for an API, since a restart can kill a settlement
batch mid-transaction and manufacture exactly the stuck run the Step 11 sweeper
exists to clean up. `HttpModule` went with it, unused in both places.

### 7.1 Machine identity — who is `createdBy` on a cron's writes?

[audit.extension.ts](../../apps/transaction/src/database/audit.extension.ts:173)
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

The `machine_principals` migration pins 6 roles and 20 machine users at fixed
ids, exposed as `ROLE_ID`, `MACHINE_USER_ID` and `SYSTEM_USER_ID` in
[microservice.constant.ts](../../libs/microservice/src/microservice.constant.ts).
This is what those accounts are for.

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
| `scheduler04` | *Unallocated.* Step 4's balance verification writes nothing, so it needs no identity at all — see Step 4 |
| `scheduler05` | Export runner (Step 13) |
| `scheduler06` | Export / MinIO cleanup (Step 13) |
| `scheduler07` | Merchant secret cleanup (exists; currently leaves a stale `updatedBy` beside a fresh `updatedAt`) |
| `scheduler08`–`10` | Unallocated — transaction expiry, webhook retry, import processing |

### 7.2 The ids are constants, not a lookup

> **Resolved 9 Oct 2026.** Earlier drafts of this section said to resolve the
> ids at boot over a new `AUTH_CMD.FIND_SCHEDULER_USER`, because `User.id` is
> autoincrement and a hardcoded number is wrong in any environment where the
> insert order differed. That reasoning was sound; the premise is now gone.

The `machine_principals` migration inserts the 6 roles and 20 machine users with
**explicit ids**, so they are the same in every database that has ever run the
migration:

```ts
import { MACHINE_USER_ID, SYSTEM_USER_ID } from '@app/microservice';

createdBy: MACHINE_USER_ID.SCHEDULER_01   // the batch runner
createdBy: SYSTEM_USER_ID                 // a webhook, no person behind it
```

No TCP command, no boot-time resolution, no caching, and nothing has to reach
across a schema boundary at runtime.

Three things made that safe to do, and all three matter:

**Roles moved too, and had to.** Migrations run before seeds, so a user row
inserted by a migration cannot reference a role the seed has not created yet.
`Role.name` also gained a unique constraint — the seed previously used
lookup-then-create specifically because it lacked one.

**The sequence is advanced in the same migration.** Explicit ids do not move it,
so without `setval('"User_id_seq"', 20, true)` the next real signup would be
handed id 1 and collide on the primary key. This is the step to not forget if
the block is ever extended.

**The migration refuses to complete if the ids disagree.** Both inserts are
`ON CONFLICT DO NOTHING`, which is what makes it safe against a database the
seed already populated — but skipping is only correct if the existing rows are
already where the constants claim. A `DO` block compares every pinned role and
user and raises with the exact mismatch, so a database built in some other order
fails the migration instead of shipping wrong attribution.

**`superadmin` and `agentinternal` stay in the seed**, at ids 21 and 22. They are
real login credentials, and a hardcoded argon2 hash in a migration would put the
production admin password in version control — identical everywhere and
unchangeable without a new migration.

A side effect worth having: the 20 machine accounts now carry a password value
that is not a valid argon2 hash, so `AuthHelper.verifyPassword` rejects every
attempt and they are structurally unable to sign in. Previously they held
working hashes of a shared `ENGINE_PASSWORD` literal, despite the seed
documenting them as unable to log in.

**Then wrap each job run in a CLS context** and the existing audit extension does
the rest — no identity parameter has to be threaded through `libs/balance`:

```ts
await this.cls.run(async () => {
  this.cls.set('authInfo.userId', MACHINE_USER_ID.SCHEDULER_01);
  await this.runOnce();
});
```

Note `libs/balance` does **not** rely on that — `BalanceMovement.createdBy` is
passed explicitly, precisely so a money write cannot depend on an ambient value
somebody forgot to set. The CLS wrapper is for everything *else* a job writes:
`PurchaseTransaction.updatedBy` and friends, which the audit extension stamps.

**Verify**: run the batch job and confirm `BalanceEntry.createdBy` is
`MACHINE_USER_ID.SCHEDULER_01` (11), not null.

**Verify**: `npx nest build settlement`; the app boots and `/health` answers.

---

## Step 8 — `SettlementRun` and `SettlementBatch`

These go in **`apps/transaction/prisma/schema.prisma`**, in a new `settlement`
Postgres schema. First widen the datasource:

```prisma
datasource db {
  provider = "postgresql"
  schemas  = ["transaction", "settlement"]
}
```

Then add the models with `@@schema("settlement")`. Lead the block with a comment
explaining the split, because it is the one place in this repo where a schema's
migrations live outside the app that owns the tables:

```prisma
/// Tables owned by apps/settlement, in their own Postgres schema so it is
/// obvious at a glance which app writes them.
///
/// Their MIGRATIONS live here rather than in apps/settlement, deliberately:
/// the DSN's default schema is `transaction`, so `transaction._prisma_migrations`
/// is the one history covering both. That also lets apps/settlement import
/// `@transaction/prisma` instead of maintaining a merged copy of these models -
/// see Step 7.0. Do not look for apps/settlement/prisma/; there isn't one.
```

```prisma
model SettlementRun {
  id                Int      @id @default(autoincrement())
  merchantId        Int
  /// `*` = the merchant's default policy, i.e. every payment method at once.
  paymentMethodName String   @default("*")
  dueAt             DateTime @db.Timestamptz(6)

  status SettlementRunStatusEnum @default(PENDING) /// PENDING | RUNNING | DONE | FAILED

  claimedBy     String?   @db.VarChar(100) /// pod identity
  claimedAt     DateTime? @db.Timestamptz(6)
  finishedAt    DateTime? @db.Timestamptz(6)
  failureReason String?   @db.VarChar(1000)
  attempts      Int       @default(0)

  batches SettlementBatch[]

  /// Makes the enqueuer safe to run on both pods - the second insert loses.
  /// Load-bearing only because `paymentMethodName` is NOT NULL; see below.
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

`SettlementRunStatusEnum` needs `@@schema("settlement")` too — Prisma requires
every enum in a multi-schema datasource to declare one.

### Why `paymentMethodName` is `'*'` and not `NULL`

`null = the merchant's default policy` reads better, and it was written that way
first. It makes the `@@unique` above a lie.

Postgres counts NULLs as **distinct** in a unique index, so two rows that agree
on `merchantId` and `dueAt` and are both NULL on the method do not collide —
they both insert. And the default policy is the common case, so the constraint
was inert for precisely the rows it existed to protect. Measured on 17.4 before
the fix:

```
pg=17.4  indnullsnotdistinct=f
rowsWithNullMethod=2        <- both inserts succeeded
nonNullDup=REJECTED         <- the same pair with 'QRIS' collided correctly
```

The damage would have been mild rather than financial — a second run claims
`batchSettlementId IS NULL` rows the first already holds, finds none under
`SKIP LOCKED`, and finishes `DONE` with no batch — but duplicate runs for one
merchant-day are exactly the kind of thing the constraint was supposed to make
impossible.

Postgres 15+ can express this as `NULLS NOT DISTINCT`. Prisma cannot, so taking
that route means a hand-written unique index and a constraint the generator no
longer owns. A non-nullable sentinel keeps it all in `schema.prisma`, at the
cost of one magic string. After the change, the duplicate is rejected and both
defaults land:

```
paymentMethodName=*  status=PENDING
duplicate default-policy run: REJECTED
```

Anything reading `paymentMethodName` must now compare against `'*'` rather than
test for NULL — see the claim query in Step 10.

### Audit columns

`SettlementRun` gets `createdAt` and `createdBy`. `SettlementBatch` gets
neither, and **neither model goes into `AUDITED_MODELS`**.

`createdAt` is when the run was *enqueued*, which is not `dueAt` — the gap
between them is how you notice an enqueuer that stopped firing. `createdBy` is
the principal that caused the run to exist: the enqueuer's machine id normally,
a real `auth.User.id` once the dashboard can trigger one by hand. That second
case is what makes the column worth having, because it separates "the cron did
this" from "someone clicked the button at 2am" on an operation that moves money.

`createdBy` is **NOT NULL**, like `BalanceEntry` and `BalanceAdjustment` and
unlike the older `*BalanceLog` tables. Those are nullable because the audit
extension fills them opportunistically and may find no userId in CLS; this one
is written explicitly, and only two things ever write it, both of which always
know their principal. It went in nullable first by matching
`PurchaseTransaction`'s audit quartet — the wrong neighbour — and was corrected
in a second migration while the table was still empty. Nullable would have cost
the compile error that catches a forgotten `createdBy`, which is the stated
reason `libs/balance` types against `@transaction/prisma` at all.

`SettlementBatch` needs none of it: rows are written once inside the claim
transaction and never edited, and a batch's creator is reachable through
`runId`.

Staying out of `AUDITED_MODELS` is deliberate twice over. The claim and the
sweeper are raw SQL, which the extension cannot see — it hooks
`query.$allModels` — so generic `updatedAt`/`updatedBy` would go stale on every
status transition, and `claimedAt` / `finishedAt` / `attempts` /
`failureReason` already record the lifecycle far better. And auto-injection
needs `authInfo.userId` in CLS, which a `@Cron` has no request to supply.
Adding either model to the set without the columns throws outright:
`creationAuditFields` injects `createdAt` unconditionally.

### Housekeeping — two strings that are easy to miss

**The dashboard merge script hardcodes its schema list.**
[merge-schema.js:58](../../apps/dashboard/prisma/merge-schema.js:58) writes:

```js
'  schemas  = ["auth", "config", "transaction"]',
```

Add `"settlement"`. Miss it and the merge produces a schema whose models
reference a Postgres schema the datasource does not declare — the dashboard
client will not generate, so at least this one fails loudly.

**The admin UI needs these tables.** The dashboard edits
`MerchantSettlementPolicy` (Step 9) and shows batch history (Step 12), so run
the merge and regenerate after this step:

```bash
npm run prisma:merge:dashboard && npm run prisma:generate:dashboard
```

### The claim index

The claim query in Step 10 filters on `batchSettlementId IS NULL`. A partial
index stays small forever, because rows leave it as they are settled:

```sql
CREATE INDEX "PurchaseTransaction_unsettled_idx"
  ON "transaction"."PurchaseTransaction" ("merchantId", "paymentMethodName")
  WHERE
    "batchSettlementId" IS NULL
    AND "status" = 'SUCCESS'
    AND "deletedAt" IS NULL;
```

Write this as raw SQL in the migration — Prisma cannot express a partial index.
There is no schema change to diff, so `migrate dev` generates nothing; get an
empty migration and fill it in:

```bash
npx dotenv -e apps/transaction/.env.local -- prisma migrate dev \
  --create-only --name claim_index --config ./apps/transaction/prisma.config.ts
```

**Quote every identifier.** This repo uses no `@map`, so the table really is
`"PurchaseTransaction"` with camelCase columns, and Postgres folds anything
unquoted to lower case — an unquoted `merchantId` fails with `column
"merchantid" does not exist`. The first draft of this section had both the
snake_case names and the column spelled `settlement_batch_id`; the real column
is **`batchSettlementId`**, and the settled-at timestamp is **`settlementAt`**.

**Prisma will not drop it.** Raw DDL in a migration often gets reverted by the
next `migrate dev`, since the diff runs from the migration history towards
`schema.prisma` and the index appears only in the former. Checked by replaying
every migration into a throwaway shadow database and diffing that state against
the schema: `-- This is an empty migration.`, with the index confirmed present
in the shadow. Safe to leave out of `schema.prisma`.

`ORDER BY "paidAt"` in Step 10 is *not* covered by this index, so expect a sort
node. Whether that is worth a third index column depends on how many unsettled
rows a real merchant accumulates — settle it with an `EXPLAIN` at Step 10 rather
than guessing the column order now.

---

## Step 9 — Policy and eligibility

`MerchantSettlementPolicy` goes in the **`settlement` schema**, beside the run
and batch models from Step 8 — not in `apps/config`. Shape is in
[settlement-batching.md §4](settlement-batching.md).

It is settlement configuration, not general merchant configuration: nothing
outside this app reads it, and the eligibility check in this step is its only
consumer. Putting it here also means `apps/settlement` borrows nothing from the
`config` schema at all, so its client stays exactly the transaction app's — the
whole basis of Step 7.0.

`UpstreamSettlementWindow` (below) belongs there for the same reason.

The dashboard still edits both through its merged schema; that is a read/write
of settlement's tables by the admin UI, not a reason to move them.

### `registerMerchant` changes here

[user.service.ts](../../apps/dashboard/src/modules/user/user.service.ts:91)
currently creates the config row with
`settlementInterval: dto.settlementInterval ?? DEFAULT_SETTLEMENT_INTERVAL_MINUTES`.
That column is deleted in Step 15, so a registration path still writing it would
break the moment it goes.

In the same transaction, create a default `MerchantSettlementPolicy` instead:
`paymentMethodName: '*'`, `mode: FOLLOW_UPSTREAM`, `effectiveFrom: now()`. Then
remove `DEFAULT_SETTLEMENT_INTERVAL_MINUTES` and
`CreateMerchantDto.settlementInterval`, and give the frontend the mode enum in
their place.

The `isEligible` fallback still treats a merchant with no policy row as
`FOLLOW_UPSTREAM`, so a merchant registered before this lands is not stranded —
but an explicit row is what makes their terms visible and editable in the admin
UI rather than implied by a default buried in code.

**Resolution is most-specific-first**: a row matching
`(merchantId, paymentMethodName)` wins over `(merchantId, '*')`. If neither
exists, fall back to a system default of `FOLLOW_UPSTREAM` rather than settling
nothing — a merchant with no policy row should still get paid.

Give this table the same `'*'` sentinel as `SettlementRun`, for the same reason:
nullable means two default policies can coexist for one merchant, and
most-specific-first then has no single answer. See *Why `paymentMethodName` is
`'*'` and not `NULL`* in Step 8.

**The unique key must include `effectiveFrom`.** An earlier draft of this
section said to copy `SettlementRun`'s `@@unique([merchantId,
paymentMethodName])` exactly, and that is wrong — it contradicts the
effective-dating two lines above it. Versioning a policy means **two rows** for
the same merchant and method, the old one with `effectiveTo` set and the new one
starting later. A unique on just those two columns permits one row, so the only
way to change a policy becomes an `UPDATE` in place, which destroys the history
those columns exist to keep:

```prisma
@@unique([merchantId, paymentMethodName, effectiveFrom])
```

"Only one *currently active* row per merchant and method" is then an
application invariant. It could be a hand-written partial index
(`WHERE "effectiveTo" IS NULL`, in the style of the claim index), but leave that
until the dashboard can actually create a second version.

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

**`label` belongs in its unique key**, not just `(providerName,
paymentMethodName, effectiveFrom)`. A partner can run several windows on one
method from the same date — Teleanjar settles batch 1 at 13:00 and batch 2 at
19:00, both effective from the same day — so leaving `label` out means the
second insert loses and that schedule cannot be expressed at all:

```prisma
@@unique([providerName, paymentMethodName, label, effectiveFrom])
@@index([providerName, paymentMethodName])
```

**Everything is `Asia/Jakarta`.** Do the day arithmetic in an explicit timezone,
not in the container's local time, or the answer changes when the container
moves. Give `effectiveFrom`/`effectiveTo` `@db.Timestamptz(6)` like every other
timestamp in this schema — a bare `DateTime` becomes `TIMESTAMP(3)` with no
timezone, which is a strange thing for the one table whose whole job is
timezone-sensitive scheduling, and the `timestamptz_consistency` migration
exists because that drift happened before.

The `businessDaysOnly` flag and the holiday calendar are only needed once
Pakailink is live — leave the column, skip the calendar.

### Audit columns on all three

Unlike Step 8's run and batch, these **do** belong in `AUDITED_MODELS` — the
dashboard edits them through Prisma on an authenticated request, so the
extension actually fires. No raw SQL, no missing CLS context.

They are hand-typed configuration that decides when merchants get paid, and
`effectiveFrom`/`effectiveTo` record *when a term applied*, never *who set it*.
An hour entered wrong in `UpstreamSettlementWindow` moves the payout time for
every merchant on that rail, quietly; that table wants the trail at least as
much as the policy does.

Add the columns **before** adding a model to the set. The other order throws on
the first write, because `creationAuditFields` injects `createdAt`
unconditionally — the same way `BalanceSnapshot` would have in Step 1.

One exception: **`BusinessDayCalendar` takes no `deletedAt`/`deletedBy`.** Its
primary key is a natural one with no surrogate id, so a soft-deleted row would
hold its own key forever — enter a date by mistake, retire it, and entering it
correctly collides on the primary key with no way out but un-deleting. Hard
delete there. `MerchantSettlementPolicy` has the same shape in milder form,
since a soft-deleted row keeps its `(merchantId, paymentMethodName,
effectiveFrom)` slot, but `effectiveFrom` is a timestamp that will not usually
repeat exactly.

**Verify**: a table-driven spec per mode, including the boundary minute in both
directions and a payment made at 23:59.

---

## Step 10 — The claim and the batch

`apps/settlement/src/settlement/settlement.service.ts`. The core.

> **Build the mental picture first.**
> [settlement-explained.md](settlement-explained.md) walks the whole thing
> end to end - why claiming replaces time windows, the two senses of the
> word "claim", a worked example with real rows, and the transaction
> ordering this step glosses over (the batch row has to exist before the
> claim can reference its id). This step is the specification; that one is
> the explanation.

Inside one `$transaction`:

**1. Claim, capped.**

```sql
UPDATE "transaction"."PurchaseTransaction"
SET "batchSettlementId" = $batchId, "settlementAt" = now()
WHERE "id" IN (
  SELECT "id" FROM "transaction"."PurchaseTransaction"
  WHERE "merchantId" = $merchantId
    AND "status" = 'SUCCESS'
    AND "batchSettlementId" IS NULL
    AND "deletedAt" IS NULL
    AND ($paymentMethod = '*' OR "paymentMethodName" = $paymentMethod)
    AND <eligibility predicate from Step 9>
  ORDER BY "paidAt"
  LIMIT 500
  FOR UPDATE SKIP LOCKED
)
RETURNING "id", "paidAt", "nominal", "netNominal";
```

Three things in there are easy to get wrong:

- **Quote every identifier.** No `@map` in this repo means PascalCase tables and
  camelCase columns, and Postgres folds unquoted names to lower case. Alias any
  computed column explicitly too (`AS "amount"`) — the same trap that produced
  `holdertype` and `coalesce` in Step 4.
- **The claim column is `batchSettlementId`**, and the timestamp beside it is
  `settlementAt`. Earlier drafts of this document called them
  `settlement_batch_id` and `merchant_settled_at`; neither exists.
- **`$paymentMethod` is compared to `'*'`, not tested for NULL.** The run's
  method is NOT NULL since Step 8 — see *Why `paymentMethodName` is `'*'` and
  not `NULL`* there.

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
plain date arithmetic on `paidAt`. For `FOLLOW_UPSTREAM` it is a lookup per
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

`SettlementRun.createdBy` is NOT NULL, so this insert will not compile without a
principal. Use the one Step 7.2 already pins for this job —
`MACHINE_USER_ID.SCHEDULER_01`, id 11 — not `SYSTEM_USER_ID`, which is for
webhooks. Worth giving it a name rather than repeating the trailing comment at
every call site:

```ts
/** apps/settlement's enqueuer and runner - the id Step 7.2 calls the batch runner. */
export const SETTLEMENT_RUNNER_USER_ID = MACHINE_USER_ID.SCHEDULER_01;
```

Pass it explicitly on the insert. This model is out of `AUDITED_MODELS` (see
Step 8), so nothing fills the column for you — and a `@Cron` has no CLS context
to fill it from anyway, which is the same reason Step 7.2 wraps each job run in
`cls.run()` for everything *else* it writes.

A human-triggered run from the dashboard (Step 12) passes that person's real
`auth.User.id` instead. That distinction is the whole point of the column.

**The runner** claims one run at a time:

```sql
UPDATE "settlement"."SettlementRun"
SET "status"    = 'RUNNING',
    "claimedBy" = $1,
    "claimedAt" = now(),
    "attempts"  = "attempts" + 1
WHERE "id" = (
  SELECT "id" FROM "settlement"."SettlementRun"
  WHERE "status" = 'PENDING' AND "dueAt" <= now()
  ORDER BY "dueAt"
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

`$1` is a **pod identity**, not a `MACHINE_USER_ID` — see the note below.

Note also that this statement is raw SQL, so the Prisma audit extension does
not see it. Nothing here populates `updatedAt` / `updatedBy`, which is why
`SettlementRun` is deliberately absent from `AUDITED_MODELS`.

Loop until it returns nothing.

**The sweeper** resets runs stuck in `RUNNING` for more than 15 minutes back to
`PENDING`. This is what makes a pod crash recoverable — and it is safe *only*
because the claim in Step 10 is idempotent: whatever the dead pod already
settled is no longer `NULL`, so a re-run picks up only what is left.

Give up after `attempts >= 3` and mark it `FAILED` with the reason, so a
genuinely broken merchant does not spin forever.

### `claimedBy` is a pod identity, not a `MACHINE_USER_ID`

Tempting to reach for `MACHINE_USER_ID` here, since that is what every other
"who did this" column in the repo holds. It cannot work: a machine principal
identifies a *role*, and every settlement pod authenticates as the same one. Run
three pods and all three would write the identical id, leaving the column unable
to answer the only question anyone asks of it — *which process was holding this
run when it died, and whose logs do I read?* A lease column has to distinguish
instances, so it holds something per-process: the Kubernetes pod name, or
`hostname:pid` outside Kubernetes.

Note what this means for the sweeper: it resets on `claimedAt` age alone and
never reads `claimedBy`, so `claimedBy` is diagnostic rather than load-bearing.
Nothing in the repo exposes a pod identity yet; this step has to add it to
configuration, defaulting to `os.hostname()`.

The audit question underneath this is answered elsewhere, not here:
`SettlementRun.createdAt` and `createdBy` record *who caused the run to exist* —
the enqueuer's machine id normally, a real `auth.User.id` when a human triggers
one from the dashboard. Both landed in Step 8 (see *Audit columns* there), which
is why the insert above cannot compile without a principal.

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
   from [libs/microservice/src/microservice.enum.ts](../../libs/microservice/src/microservice.enum.ts:168).
3. Drop `Merchant.settlementInterval` and `lastSettlementAt`; drop
   `Provider.reconciliationTime` and `lastReconciliationAt`; drop
   `batchReconciliationId` and `reconciliationAt` from both transaction models.
4. Re-run both schema merges.

**Take a backup of the three log tables first** — as a dump, not a rename.
They are the only record of pre-migration history, and the opening-balance
entries reference figures that came from them.

---

## Commit boundaries for what is left

Steps 1–8 have landed; their commits are in the Status table at the top, which
is the record. This covers only what remains, one commit per step:

| Commit | Step | Independently shippable? |
|---|---|---|
| `feat(transaction): settlement policy and upstream windows` | 9 | yes, dormant |
| `feat(settlement): claim and post batches` | 10 | yes — nothing schedules it yet |
| `feat(settlement): enqueuer and stuck-run sweeper` | 11 | **behavior change** — the cutover |
| `feat(dashboard): read balances from snapshot` | 12 | **behavior change** |
| `feat(settlement): transaction export to minio` | 13 | yes |
| `feat(settlement): statement comparison placeholder` | 14 | yes |
| `chore: drop legacy balance logs` | 15 | yes, after a full cycle |

**Step 11 is the real cutover.** It is the first moment settlement happens on
the new schedule, and it is worth telling merchants about beforehand, because
`FOLLOW_UPSTREAM` means waiting until T+1 15:00 instead of the 120 minutes they
get today.

**Step 15 waits for a full cycle.** Dropping the legacy balance logs is
irreversible, and the thing that proves the new tables are right is a complete
settlement cycle having run against them in production — not a passing test.

One note on the messages above: they are the shape, not the wording. The commits
for steps 1–8 did not use `feat(scope):` prefixes, because the recent history in
this repo does not — it uses a plain imperative subject with the reasoning in
the body. Match the history, not this table.

---

*Design rationale: [settlement-batching.md](settlement-batching.md). Partner
timings: [docs/accounting/upstream-settlement-schedules.md](../accounting/upstream-settlement-schedules.md).
Reference on ledger theory, kept for a possible future accounting app:
[docs/accounting/](../accounting/).*
