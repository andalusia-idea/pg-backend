# Merchant Settlement Batching — Design

How a merchant's pending balance becomes spendable, on our schedule.

Sits on top of [ledger-foundation-design.md](ledger-foundation-design.md), which
is being built first. Partner timings:
[upstream-settlement-schedules.md](upstream-settlement-schedules.md). Theory:
[ledger-and-balance-reference.md](ledger-and-balance-reference.md).

> **Scope note.** This document covers *merchant* settlement only — journal 3.3
> in the ledger doc, a liability-side move. *Upstream* settlement (the upstream
> releasing funds to us) is a different event on the other side of the balance
> sheet, is evidence-driven rather than scheduled, and lives in the ledger doc
> §6. Conflating the two is what the current schema does, and why it cannot
> express either.

---

## 0. Why the ledger comes first

A settlement run's entire output is a set of accounting entries. If the shape
they are written into is wrong, the batch writes wrong rows reliably, on a
schedule, and reconciliation has nothing to check against.

The current balance model cannot express settlement at all. `MerchantBalanceLog`
carries one scalar `changeAmount` alongside `balanceActive` / `balancePending`,
and promoting pending → available moves value *between two columns of the same
row*. A single scalar cannot say that. A settlement row has to either write zero
or misrepresent itself.

Once pending and available are separate accounts, settlement is an ordinary
journal entry and this document becomes mostly orchestration.

---

## 1. What is being thrown away

Confirmed as legacy artifacts, created before the current plan, with no forward
value:

| Dropped | Why |
|---|---|
| `Merchant.settlementInterval` (minutes), `lastSettlementAt` | A rolling interval has no period boundary, so no batch can ever be *closed*. Replaced by `MerchantSettlementPolicy` — ledger doc §1 |
| `batchSettlementId`, `batchReconciliationId` | Nullable integers pointing at no table. Replaced by `LedgerJournal.batchId` and the reconciliation import record |
| `TransactionTypeEnum.SETTLEMENT_PURCHASE` | Replaced by `LedgerJournalTypeEnum.MERCHANT_SETTLED` |
| `Provider.reconciliationTime`, `lastReconciliationAt` | Replaced by `UpstreamSettlementWindow` + the import record |
| The three `*BalanceLog` tables | Replaced by the ledger |

Kept as an explicit projection, not a source of truth: a single
`merchantSettledAt` on the transaction row, stamped by the sweep. A paginated
dashboard list should not have to query the ledger to filter settled from
unsettled.

---

## 2. The rule that shapes the app

> **Credits can be swept. Debits cannot.**
>
> A payin credit arriving a minute late costs nothing — the merchant's pending
> balance updates a beat later. A payout debit arriving late is an overdraw: you
> have already sent money you had not yet deducted.

| Flow | Where it posts | Why |
|---|---|---|
| Payin captured → pending credit | **Swept** | Latency-tolerant; keeps the webhook path — the one under provider retry pressure — doing one job |
| Merchant settlement, pending → available | **Swept** | It is the batch |
| Payout created | **Synchronous**, same DB transaction as the payout row, before the provider is called | Gates on available balance; an overdraw is unrecoverable |
| Payout callback SUCCESS / FAILED | Synchronous | Converts or releases the reservation |

This is the **reserve-before-call** discipline already governing upstream calls
in this codebase, applied to money instead of rows.

### It is also what closes D17

[D17](../engine/dashboard-migration.md) identified an overdraw race: the
insufficient-balance guard is a check-then-act, so two concurrent withdrawals can
both pass it. The recommendation there was advisory locks.

Locks make the race *rarer*. A `MERCHANT_RESERVED` account makes it
*impossible*, because the debit happens at create time rather than at callback
time. With `CHECK (balance >= 0)` on the `MERCHANT_AVAILABLE` projection, the
second concurrent withdrawal fails at the database rather than at an application
`if`. Keep the advisory locks too — they serialize the balance chain — but the
reservation is what makes the invariant structural.

**Consequence for current code:** the two `TODO(balance-ledger)` comments in
`purchase.webhook.service.ts` and `disbursement.webhook.service.ts` are
*deleted, not implemented*. The purchase webhook posts nothing — the sweep does.
The disbursement webhook posts only the reservation conversion.

---

## 3. Select by claim, not by time window

**The single most important decision in the batching logic.**

Legacy already did this right: a conditional `updateMany` claiming rows
`WHERE status = 'SUCCESS' AND <unclaimed>`. Keep the mechanism exactly; only the
column it stamps changes.

```
The claim IS the batch definition.
Period fields are descriptive - "what this batch happened to contain" -
never selective - "what to go looking for".
```

This dissolves the late-arrival problem entirely: a callback landing after a
batch posts is simply swept by the next one. Nothing is lost, nothing reopens.

Selecting by `paidAt BETWEEN x AND y` instead forces a choice between three bad
answers for a late payment — reopen a closed batch (destroys immutability), drop
it (loses merchant money), or build a straggler mechanism (complexity buying
nothing the claim model gives free).

The eligibility predicate comes from the merchant's settlement policy rather than
from a clock:

| Policy mode | A captured payin is eligible when |
|---|---|
| `FOLLOW_UPSTREAM` | the upstream's expected settlement time for that method has passed |
| `FIXED_DELAY` | `capturedAt + delayDays` has passed, at `releaseTime` |
| `SCHEDULED` | the next configured release time has passed |
| `INSTANT` | immediately, subject to `fundedLimit` |

Note that `FOLLOW_UPSTREAM` uses the *expected* upstream settlement, not the
confirmed one. Waiting for confirmation would couple merchant settlement to the
admin team's manual export cadence, which would be a worse promise than the one
we make today. The expectation is the right trigger; the confirmation is what
reconciliation checks.

```prisma
model SettlementBatch {
  id         Int                       @id @default(autoincrement())
  merchantId Int
  runId      Int
  status     SettlementBatchStatusEnum // CLAIMING | POSTED | FAILED

  // Descriptive only. Derived from what was actually claimed.
  sweptFrom DateTime? @db.Timestamptz(6)
  sweptTo   DateTime? @db.Timestamptz(6)

  transactionCount Int     @default(0)
  grossAmount      Decimal @default(0) @db.Decimal(18, 2)
  feeAmount        Decimal @default(0) @db.Decimal(18, 2)
  netAmount        Decimal @default(0) @db.Decimal(18, 2)

  journalId     BigInt?   // the MERCHANT_SETTLED journal this batch posted
  claimedBy     String?   // pod identity, for forensics
  claimedAt     DateTime? @db.Timestamptz(6)
  postedAt      DateTime? @db.Timestamptz(6)
  failureReason String?

  @@unique([merchantId, runId])
  @@schema("settlement")
}
```

Preserve from legacy, unchanged: per-merchant `pg_advisory_xact_lock`,
`Serializable` isolation, retry on Prisma `P2034` up to 3×, and sorted lock
acquisition order across agents. That is the most correct code in either legacy
codebase.

---

## 4. Money type: `Decimal`, not `BIGINT`

Confirmed decision. [ledger-and-balance-reference.md](ledger-and-balance-reference.md)
§5.3 recommends integers in minor units; that advice does not fit here:

- IDR's minor unit (sen) is not used in practice; amounts are whole rupiah.
- The existing schema is `Decimal(15,2)` across roughly 25 columns in four
  schemas.
- Postgres `NUMERIC` is exact — the floating-point argument does not apply to it.
- Prisma maps `BIGINT` to JS `BigInt`, which `JSON.stringify` throws on. The
  reference doc flags this itself, and this codebase has both a Redis/JSON cache
  layer and DTO serialization that would hit it.
- Fees are percentage-derived (`Decimal(8,4)`), so fractional intermediate
  results and a rounding policy are needed either way.

Ledger tables use `Decimal(18,2)` rather than `(15,2)` — transaction amounts stay
small but account balances accumulate forever, and 15,2 caps around 9.99 trillion
IDR.

**Rounding policy:** round half-up to 2dp per fee component, then make the
merchant leg the residual (`merchantNet = gross − Σ other legs`) so every journal
balances by construction. Never round the residual.

---

## 5. Scheduling: a claim table, not cron plus a Redis lock

The app is also meant to host the schedulers other apps need. The recommendation
is a durable run table, claimed with `SKIP LOCKED`:

```sql
UPDATE settlement.settlement_run
SET status = 'RUNNING', claimed_by = $1, claimed_at = now()
WHERE id = (
  SELECT id FROM settlement.settlement_run
  WHERE status = 'PENDING' AND due_at <= now()
  ORDER BY due_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

Why this rather than `@Cron` plus a Redis lock:

- **Two pods is not the only concurrency.** A restart mid-run is too. A Redis
  lock held by a pod that OOMs releases on TTL, and a second pod starts a
  duplicate run against half-written state.
- **The claim is in the same transaction as the work.** No second system to be
  wrong about.
- **It produces history** — what ran, when, what it produced, what failed.
  `lastSettlementAt` as a single column gives none of that, and finance will ask.
- **Manual re-run and backfill become the same code path** as the scheduler
  rather than a second implementation that drifts.

Keep `@Cron` as an **enqueuer** only, inserting due `SettlementRun` rows.
Double-enqueueing is harmless with `@@unique([merchantId, dueAt])`.

The legacy cron `'0 */90 * * * *'` is broken — the minutes field cannot step by
90. Do not carry it forward.

---

## 6. App and library boundaries

Legacy had `transaction-service` and `settlerecon-service` both writing
`transaction.*BalanceLog` through two independently generated Prisma clients that
disagreed on ID type (`Int` vs `BigInt`) —
[legacy-microservices.md](../engine/legacy-microservices.md) §6 calls unifying
that the "highest-leverage decision point." Standing up a new app is exactly when
that risk returns.

| Component | Owns | Notes |
|---|---|---|
| **`libs/ledger`** (new) | Accounts, journals, the balanced-entry assertion, advisory locks, the projection update | **One posting engine, one implementation.** Both apps use it; neither reimplements it |
| **`apps/settlement`** (new) | `settlement` + `ledger` schemas and migrations; run scheduler, sweep, treasury, reconciliation import, exports | The only writer for everything except the payout reservation |
| **`apps/transaction`** | Transaction rows | Uses `libs/ledger` for exactly one thing: the synchronous payout reservation (§2) |
| **`apps/dashboard`** | Nothing new | Balance reads move from `*BalanceLog` to `LedgerBalance` |

The existing `prisma:merge:dashboard` tooling already handles the multi-schema
case; the settlement app needs the same treatment for `transaction` + `config` +
`ledger`.

The app name `settlement` is fine, but note it owns more than settlement —
ledger, treasury, and reconciliation all live there. `treasury` would be more
accurate; not worth renaming over.

---

## 7. Migration

Full revamp, so the phasing is about *safety*, not about preserving the old
shape. Legacy is live and `*BalanceLog` has production rows.

| Phase | Change | Risk |
|---|---|---|
| **0** | `libs/ledger` + `ledger` schema, nothing writing to it yet | None |
| **1** | Chart of accounts and opening balances — ledger doc §10. Includes the first real look at what the asset side actually holds | Low — one dated, reversible journal per holder |
| **2** | Payin capture and payout reservation journals. Ledger is now live and correct going forward | Medium — this is the cutover for new money |
| **3** | Shadow: keep writing `*BalanceLog` alongside, assert nightly that the two agree, for one full settlement cycle | Low |
| **4** | Flip dashboard reads to `LedgerBalance` | Medium — reversible by flipping back |
| **5** | Stop writing `*BalanceLog`; tables become read-only history | Low |
| **6** | Settlement policy + sweep replaces `settlementInterval` | Medium — changes when merchants get their money, so it needs announcing |

The nightly assertion in phase 3 is not throwaway — it becomes the permanent
invariant job from ledger doc §5.

**Phase 6 is a commercial change, not just a technical one.** Moving a merchant
from a 120-minute interval to `FOLLOW_UPSTREAM` means they wait until T+1 15:00
instead of two hours. That is the correct default and it removes an unmetered
funding cost, but it is a change to what they have been getting and should be
communicated rather than deployed quietly. Merchants who need the old speed are
the ones to put on `INSTANT` with a priced `fundedLimit`.

---

## 8. Out of scope here

- **Upstream settlement and reconciliation** — different side of the balance
  sheet, evidence-driven. Ledger doc §6.
- **Treasury movement between upstreams (Dana Talangan)** — ledger doc §3.7–3.10
  and §4. It comes *before* this document's work in the build order, because the
  sweep is what creates funding exposure and it is better to see the exposure
  before automating the thing that grows it.
- **CSV export to MinIO with TTL cleanup** — the lowest-risk item on the app's
  list and unrelated to correctness. It should go last: it is the piece that
  feels most like progress and teaches the least about whether the design works.
- **`*FeeDetail` tables** — they record the fee *calculation*; the ledger records
  the money *movement*. Different questions, both worth keeping.

---

## 9. Decisions

Resolved:

| Question | Answer |
|---|---|
| `Decimal` or `BIGINT` minor units? | **`Decimal`**, widened to `(18,2)` in the ledger |
| Does MotionPay publish a settlement report? | **No.** Manual portal export by the admin team. Upstream settlement is therefore evidence-driven — ledger doc §6 |
| Is `settlementInterval` a real product promise? | **No** — legacy artifact. Replaced by `MerchantSettlementPolicy` |
| Keep `batchSettlementId` / `SETTLEMENT_PURCHASE`? | **No** — dropped, §1 |
| Build ledger first or batching first? | **Ledger first** |
| Our own settlement schedule, or follow the upstream's? | **Ours** — there is no single upstream schedule to inherit, and theirs is not computable in advance. But `FOLLOW_UPSTREAM` should be the *default* mode, because anything faster is company-funded |

Still open — all in ledger doc §12, plus:

1. **Are agents settled on the merchant's schedule or their own?**
   `AgentShareholder` has no schedule of its own today, so the answer is
   implicitly "the merchant's." Worth making explicit now that agents have real
   `AGENT_PAYABLE` accounts.

2. **Does a merchant settlement batch cover all payment methods at once, or one
   batch per method?** Per-method matters as soon as a merchant takes QRIS (T+1)
   and E-Wallet (H+3) from the same provider under `FOLLOW_UPSTREAM` — the two
   become eligible on different days and cannot share a batch.
