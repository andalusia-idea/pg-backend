# Settlement Batching — Payment Gateway Scope

What this system actually needs to build, after the C-level scope conversation.

The fuller accounting design in [docs/accounting/](../accounting/) stays on disk
as reference for a possible future accounting app. **It is not what we are
building.** This document is the scoped-down version, and where the two
disagree, this one wins.

---

## 0. Scope

**This system is a payment gateway.** It is not an accounting system, not a
back office, and not treasury.

| In scope | Out of scope |
|---|---|
| Transaction log with its fee breakdown, correct and stable | Balance sheet, financial statements, chart of accounts |
| Merchant/agent balance: pending → available → paid out | Tracking our money at each upstream |
| Settlement batching on a per-merchant policy | Dana Talangan, funding-gap measurement |
| Excel export of transactions | Double-entry journals, trial balance, period close |
| A tool to help compare our Excel against an upstream's | Deciding or posting what an upstream settled |

Two consequences worth stating plainly, because they remove a lot of work:

**We never post upstream settlement.** Another department tells us whether the
upstream balance is ready. If it is not, a payout fails and the merchant calls
customer service. That is an accepted outcome, not a bug for this system to
prevent.

**Reconciliation writes nothing.** It produces a comparison report for humans.
No balance changes, no journals, no corrections applied automatically. That
makes it a read-only feature, which is dramatically simpler than what a real
reconciliation engine would be.

---

## 1. What we keep, and what we drop

Kept from the ledger design — these are the parts that fix real bugs:

- **Immutable entries.** Balance rows are append-only. No `UPDATE`, no `DELETE`.
  A correction is a new, opposite entry.
- **Balance snapshot** as a fast read, written in the same database transaction
  as the entries, and provable against them.
- **Amount always positive; a direction column carries the sign.**
- **Three buckets — pending, available, reserved** — as separate rows rather
  than separate columns.
- **Idempotency by unique constraint**, so a replayed webhook or a re-run batch
  cannot double-credit.

Dropped:

- Chart of accounts (`UPSTREAM_SETTLED`, `BANK_OPERATIONAL`, `FEE_REVENUE`,
  `COMPANY_CAPITAL`, …)
- Double-entry journals and per-journal balancing
- Treasury movements between upstreams
- Funding-gap / Dana Talangan measurement
- Accounting periods, close, trial balance

The four-way fee split stays exactly where it already is, in the `*FeeDetail`
tables. That is what the other department needs in their Excel, and it is
already correct.

---

## 2. The balance model

### Three buckets, not three columns

This is the one structural change that matters. Today `MerchantBalanceLog` has
`balanceActive` and `balancePending` as two **columns on one row**, plus a single
`changeAmount`. Settlement moves money from one column to the other, and one
scalar cannot describe that — so the row has to either write zero or lie.

Make each bucket its own row and the problem disappears:

| Bucket | Meaning |
|---|---|
| `PENDING` | Payment succeeded; not settled to the merchant yet |
| `AVAILABLE` | Merchant can spend it now |
| `RESERVED` | Committed to a payout that is in flight |

Settlement becomes two ordinary rows:

```
merchant 27 | PENDING   | DEBIT  | 98,000 | MERCHANT_SETTLED | purchase:123
merchant 27 | AVAILABLE | CREDIT | 98,000 | MERCHANT_SETTLED | purchase:123
```

Nothing is edited. Both rows carry the same reason and the same source, so they
are obviously one movement, and they sum to zero — a cheap check that a transfer
did not lose money on the way across.

### Schema

```prisma
model BalanceEntry {
  id BigInt @id @default(autoincrement())

  holderType BalanceHolderTypeEnum // MERCHANT | AGENT | INTERNAL
  holderId   Int
  bucket     BalanceBucketEnum     // PENDING | AVAILABLE | RESERVED

  direction BalanceDirectionEnum   // CREDIT | DEBIT
  amount    Decimal @db.Decimal(18, 2) // ALWAYS positive

  reason     BalanceReasonEnum     // §3 below
  sourceType TransactionTypeEnum   // PURCHASE | DISBURSEMENT | WITHDRAW | TOPUP
  sourceId   Int
  batchId    Int?

  createdAt DateTime @default(now()) @db.Timestamptz(6)
  createdBy Int?

  // Idempotency. A replayed webhook or a re-run batch fails the insert
  // instead of double-crediting.
  @@unique([holderType, holderId, bucket, reason, sourceType, sourceId])
  @@index([holderType, holderId, bucket, id])
  @@schema("transaction")
}

model BalanceSnapshot {
  // The fast read. Written in the same DB transaction as its entries.
  holderType  BalanceHolderTypeEnum
  holderId    Int
  bucket      BalanceBucketEnum
  amount      Decimal  @db.Decimal(18, 2)
  lastEntryId BigInt
  version     Int      @default(0)
  updatedAt   DateTime @updatedAt @db.Timestamptz(6)

  @@id([holderType, holderId, bucket])
  @@schema("transaction")
}
```

`Decimal`, never `BIGINT` minor units — confirmed decision, reasoning in
[docs/accounting/settlement-batching-design.md](../accounting/settlement-batching-design.md) §4.
Widened to `(18,2)` because snapshots accumulate where transaction amounts do
not.

### Why the snapshot is safe here but was not before

Today's "balance" is the newest log row, and that row's number was computed from
the row before it. One wrong row is inherited forever and nothing notices.

With entries and a snapshot, the snapshot is a **cache of something provable**:

```sql
SELECT SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END)
FROM balance_entry
WHERE holder_type = 'MERCHANT' AND holder_id = 27 AND bucket = 'AVAILABLE';
```

Run that nightly, compare to the snapshot, alert on any difference. That single
job is the whole reason this design is trustworthy rather than merely tidy.
Never auto-correct on a mismatch — investigate it.

### Non-negative available balance

```sql
ALTER TABLE transaction.balance_snapshot
  ADD CONSTRAINT available_non_negative
  CHECK (bucket <> 'AVAILABLE' OR amount >= 0);
```

Last line of defence against an overdraw that slips past application code.

---

## 3. Reasons

The complete list of why a balance row exists. Small on purpose.

| Reason | Buckets touched |
|---|---|
| `PAYIN_CAPTURED` | `PENDING` credit |
| `MERCHANT_SETTLED` | `PENDING` debit + `AVAILABLE` credit |
| `PAYOUT_RESERVED` | `AVAILABLE` debit + `RESERVED` credit |
| `PAYOUT_COMPLETED` | `RESERVED` debit |
| `PAYOUT_FAILED` | `RESERVED` debit + `AVAILABLE` credit |
| `TOPUP_APPROVED` | `AVAILABLE` credit |
| `PAYIN_REVERSED` | reverses `PAYIN_CAPTURED` (and `AVAILABLE` if already settled) |
| `MANUAL_ADJUSTMENT` | anything — requires a reason and an approver |

`MANUAL_ADJUSTMENT` is not optional. The other department *will* find problems,
and the alternative to a logged adjustment is someone editing the database by
hand. Give it two-person approval, a mandatory note, and its own reason code so
adjustments can be counted separately. A month where they increase is a month
where something upstream is broken.

---

## 4. Settlement policy — the four modes

You had three of the four right. One correction:

| Mode | When a payment becomes available | Example |
|---|---|---|
| `INSTANT` | The moment the payment succeeds | Merchant needs immediate liquidity |
| `FOLLOW_UPSTREAM` | Once the upstream's own settlement time for that method has passed | MotionPay QRIS → next day after 15:00. **Default** |
| `FIXED_DELAY` | N days after the payment, at a set time | "T+2, released at 10:00" — **one release per day** |
| `SCHEDULED` | At set times of day | **"4 batches a day: 06:00, 12:00, 18:00, 23:00"** |

**Your "4 batches within the same day" is `SCHEDULED`, not `FIXED_DELAY`.** The
difference:

- `FIXED_DELAY` answers *"how long does the merchant wait?"* — it delays by days.
- `SCHEDULED` answers *"at what times do we release?"* — it batches within a day.

Your "our own regulated schedule" is also `SCHEDULED`. So `SCHEDULED` covers both
of the cases you described, and `FIXED_DELAY` is the separate "T+N" one.

```prisma
model MerchantSettlementPolicy {
  id                Int     @id @default(autoincrement())
  merchantId        Int
  paymentMethodName String? // null = the merchant's default for everything

  mode SettlementModeEnum

  delayDays        Int?     // FIXED_DELAY: 1 = T+1
  releaseTimes     String[] // SCHEDULED: ["06:00","12:00","18:00","23:00"]
                            // FIXED_DELAY: a single entry
  businessDaysOnly Boolean  @default(false)

  effectiveFrom DateTime  @db.Timestamptz(6)
  effectiveTo   DateTime? @db.Timestamptz(6)

  @@schema("config")
}
```

`effectiveFrom` / `effectiveTo` rather than editing in place, so changing a
merchant's terms does not rewrite how last month's batches should have behaved.

`FOLLOW_UPSTREAM` uses the *expected* upstream settlement time from
[docs/accounting/upstream-settlement-schedules.md](../accounting/upstream-settlement-schedules.md) —
a table of what each partner has told us. We never wait for confirmation,
because confirmation comes from another department's manual export and tying
merchant settlement to that would be a worse promise than we make today.

---

## 5. "Select by claim, not by time window" — plainly

### The time-window way, and why it breaks

```sql
-- settle everything paid between 08:00 and 10:00
WHERE paid_at >= '08:00' AND paid_at < '10:00'
```

A customer pays at **09:59**. The provider's webhook reaches us at **10:05** —
normal, webhooks are not instant.

The 10:00 batch already ran. That payment is inside a window that is finished.
Now you have to pick one of three bad options: re-open a closed batch, lose the
merchant's money, or write extra code just for stragglers.

### The claim way

```sql
UPDATE transaction.purchase_transaction
SET settlement_batch_id = $batchId,
    merchant_settled_at = now()
WHERE merchant_id = $merchantId
  AND status = 'SUCCESS'
  AND settlement_batch_id IS NULL        -- <<< this line is the whole trick
  AND <eligible under the merchant's policy>
RETURNING id, net_nominal;
```

`settlement_batch_id IS NULL` means **"has nobody settled this yet?"** A row can
only be claimed once, ever, because claiming it fills in the column. Run the same
statement twice and the second run claims nothing and returns no rows.

The 09:59 payment simply gets picked up by the 12:00 batch. No special case, no
extra code, nothing to reopen.

Afterwards the batch **records** what it happened to contain:

```
batch 88 | merchant 27 | 42 transactions | 08:03 → 10:01 | net 4,120,000
```

Those timestamps are a description of the result, not the question that was
asked. That is the whole idea in one sentence: **the batch reports its range; it
does not search by one.**

---

## 6. "Claim table" vs "cron + Redis lock" — plainly

You run 2 pods. Both have a clock. At 10:00 both wake up and think *"time to
settle merchant 27."* If both actually run it, the merchant could get paid twice.

### The Redis lock approach

Before working, each pod asks Redis: *"am I the one?"* Only one gets yes; the
other skips. This works, and it is what we already do for the MotionPay token.
But it has three problems **for this particular job**:

1. **The lock has a timer.** Say 30 seconds. If settlement takes 40, the lock
   expires while pod 1 is still working, and pod 2 starts. Two pods, same
   merchant, at once.
2. **A crash leaves no trail.** Pod 1 dies halfway. The lock expires. Pod 2
   starts — with no way to know what pod 1 already did.
3. **Nothing is written down.** Ask *"did settlement run at 10:00 on Tuesday,
   and what did it produce?"* and there is nothing to look at. Only
   `lastSettlementAt`, one column, overwritten every time.

### The claim table approach

Instead of asking *"who gets to run?"*, write the work down as rows first:

```
settlement_run
 id | merchant_id | due_at | status  | claimed_by | claimed_at | result
 41 | 27          | 10:00  | PENDING | null       | null       | null
```

A pod takes work by **changing the row**:

```sql
UPDATE settlement.settlement_run
SET status = 'RUNNING', claimed_by = $podName, claimed_at = now()
WHERE id = (
  SELECT id FROM settlement.settlement_run
  WHERE status = 'PENDING' AND due_at <= now()
  ORDER BY due_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is just SQL for *"give me a row nobody else is working
on right now, and don't sit there waiting if one is busy."* Postgres guarantees
only one pod wins. **That is the lock** — you still have one, it just lives in
the database instead of Redis.

Why that is better here:

- **Same database as the work.** The claim and the balance rows are in one
  transaction. If the transaction rolls back, the claim rolls back with it.
  Redis cannot know whether your Postgres transaction succeeded — it is a
  separate system holding an opinion about a thing it cannot see.
- **A crash is recoverable.** The row stays `RUNNING` with a timestamp. A small
  sweeper resets anything `RUNNING` for more than N minutes back to `PENDING`.
  And because the claim in §5 is idempotent, re-running is harmless — the
  already-settled rows are no longer `NULL`, so they are simply not picked up
  again.
- **History is free.** The table *is* the record. What ran, when, what it
  produced, what failed, which pod did it.
- **Re-running by hand is just inserting a row.** No separate admin code path to
  write and keep correct.

`@Cron` still exists — but it only **inserts due rows**, it does not do the work.
Both pods firing the cron at once is harmless if the run table has
`@@unique([merchantId, dueAt])`: the second insert just fails.

> **Rule of thumb.** A Redis lock is right when the thing you are protecting is
> *not* in the database — like "only one pod should call MotionPay's token
> endpoint." A claim row is right when the work *is* database writes, because
> then the claim and the work can succeed or fail together.

---

## 7. The reserved bucket is not optional

It looks like extra complexity. It is the one piece that prevents a real money
bug.

**Without it:** merchant has 100,000 available. Two withdrawal requests arrive at
the same instant. Both read the balance, both see 100,000, both pass the "do
they have enough?" check, both go out. The merchant withdrew 200,000 they did
not have. This is live in the legacy code today (D17).

**With it:** the balance is moved to `RESERVED` in the same database transaction
that creates the payout row, *before* the provider is called. The second request
finds 0 available and is rejected — by the database's `CHECK` constraint, not by
an application `if` that two requests can pass simultaneously.

The general rule this follows:

> **Credits can wait. Debits cannot.**
>
> A payment credit landing a minute late costs nothing. A payout debit landing a
> minute late means money already left that you had not deducted.

So: payin credits and settlement are done by the batch. Payout reservations are
done immediately, in the same transaction as the payout row. It is the same
reserve-before-call discipline already used for upstream calls, applied to money.

---

## 8. Export and the comparison tool

### Transaction export

What the other department actually asked for. Straightforward:

- Filter by date range, merchant, provider, payment method, status.
- One row per transaction with the full fee breakdown from `*FeeDetail` —
  gross, provider fee, internal fee, agent fee, net.
- Generated in the background, written to MinIO, downloadable from the
  dashboard, deleted after 1–2 days.
- The job itself is a `settlement_run`-style row, for the same reasons as §6.

### Upstream comparison

Assistive only. It **reads, compares, and reports. It writes nothing.**

1. Admin uploads the upstream's export (from their merchant portal).
2. We match line-by-line against our transactions on the provider reference.
3. We show the differences:

| Result | Meaning |
|---|---|
| Matched | Both sides agree on reference and amount |
| Only in theirs | They have a transaction we have no record of — a lost callback, or worth investigating |
| Only in ours | We recorded a payment they did not — our record is wrong, or the callback was not genuine |
| Amount differs | Both have it, figures disagree — usually fees or rounding |

Output is a screen and a downloadable Excel. What happens next is a human
decision made in another department, which is exactly why this feature is small.

**Before building the matcher, find out what reference appears on each
upstream's export.** If their file does not carry something we can match on, the
tool cannot work, and that is worth knowing in an email rather than after the
code is written.

---

## 9. What gets deleted

| Dropped | Replaced by |
|---|---|
| `MerchantBalanceLog`, `AgentBalanceLog`, `InternalBalanceLog` | `BalanceEntry` + `BalanceSnapshot` |
| `changeAmount`, `balanceActive`, `balancePending` | Buckets as separate rows |
| `batchReconciliationId`, `reconciliationAt` | Reconciliation writes nothing now |
| `TransactionTypeEnum.SETTLEMENT_PURCHASE` | `BalanceReasonEnum.MERCHANT_SETTLED` |
| `Merchant.settlementInterval`, `lastSettlementAt` | `MerchantSettlementPolicy` + `settlement_run` |
| `Provider.reconciliationTime`, `lastReconciliationAt` | Nothing — not our job any more |
| `TODO(balance-ledger)` in both webhook services | §3 reasons, written by the batch and the payout path |

`batchSettlementId` is **kept** but finally gets a real table behind it, and
`merchantSettledAt` stays as the fast flag for dashboard filtering.

### Migrating existing balances

Legacy is live and the log tables have real rows. Opening balance is one entry
per holder per bucket, with `reason = MANUAL_ADJUSTMENT` and a note saying it is
the migration:

```
merchant 27 | AVAILABLE | CREDIT | <their balanceActive>  | MANUAL_ADJUSTMENT
merchant 27 | PENDING   | CREDIT | <their balancePending> | MANUAL_ADJUSTMENT
```

Dated, visible, reversible. Then the snapshot is built from the entries, and from
that moment forward the nightly check in §2 is meaningful.

---

## 10. Build order

| Step | What | Why here |
|---|---|---|
| 1 | `BalanceEntry` + `BalanceSnapshot` + the posting service | Everything else needs it |
| 2 | Opening balances from the existing logs | Real numbers to test against |
| 3 | `PAYIN_CAPTURED` from the purchase webhook | Closes one of the two `TODO(balance-ledger)` gaps |
| 4 | `PAYOUT_RESERVED` / `COMPLETED` / `FAILED` | Closes D17 — the overdraw bug |
| 5 | Nightly entries-vs-snapshot check | Makes the rest trustworthy |
| 6 | `settlement_run` + the claim query (§5, §6) | The batch itself |
| 7 | `MerchantSettlementPolicy` + the four modes | Replaces `settlementInterval` |
| 8 | Excel export to MinIO | What the other department asked for |
| 9 | Upstream comparison tool | Assistive, lowest risk |

Steps 1–5 are the ones that fix money bugs. 6–7 are the batching feature. 8–9 are
the reporting features. If work stops after step 5, the system is already more
correct than it is today.

---

## 11. Answered questions

All five resolved 21 Sep 2026. Build details in
[settlement-batching-implementation.md](settlement-batching-implementation.md).

1. **Per-method batches: supported, but per-merchant is the normal case.**
   `MerchantSettlementPolicy.paymentMethodName` stays nullable; `null` is the
   merchant's default and most merchants will only ever have that row. A
   per-method override is resolved most-specific-first, and produces its own
   batch. Build the resolution properly, expect it to be rarely used.

2. **Agents settle on the merchant's schedule.** Agents have no transactions of
   their own — an agent's income is a profit share on *merchant* transactions,
   via `AgentShareholder`. So the agent's share of a purchase is settled by the
   same batch, in the same database transaction, pointing at the same
   `sourceId`. There is no agent batch and no agent policy.

3. **The comparison tool gets a file-upload placeholder only.** Each upstream's
   export format is different and none is decided yet. Build the upload, the
   stored file record, and a parser interface with no concrete parsers behind
   it. Adding a format later is then one class, not a redesign.

4. **`MANUAL_ADJUSTMENT` is gated to `ADMIN` and `SUPER_ADMIN`** — the roles in
   [libs/microservice/src/microservice.enum.ts](../../libs/microservice/src/microservice.enum.ts).
   Single approver, not two-person. A mandatory reason and `createdBy` are still
   required, because the point is that the adjustment is attributable.

5. **`INTERNAL` gets a running balance like everyone else.** The admin portal
   shows current house profit, so it needs a live figure rather than a sum over
   the export. It follows the same bucket lifecycle as merchants — profit lands
   in `PENDING` at capture and moves to `AVAILABLE` on settlement — which means
   the portal can show earned and settled profit separately, and costs nothing
   extra because the batch is already touching those rows.

Still genuinely open: **what reference appears on each upstream's export file.**
It does not block anything now that (3) is a placeholder, but it is worth asking
in an email before anyone writes a parser.
