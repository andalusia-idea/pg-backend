# Ledger Foundation — Design

The double-entry core the settlement app is built on. Approved to build first;
[settlement-batching-design.md](settlement-batching-design.md) sits on top of it.

Theory background: [ledger-and-balance-reference.md](ledger-and-balance-reference.md).
Partner schedules: [upstream-settlement-schedules.md](upstream-settlement-schedules.md).

---

## 0. The premise that determines everything else

> **We are not a licensed PJP. We hold no money. Every rupiah — ours, our
> merchants', their end-users' — sits at an upstream.**

Almost every payment-ledger design you can read assumes the operator holds cash
and owes some of it out. That is not this business. Here:

- The asset side of the balance sheet is **claims on upstreams**, not cash.
- Those claims are not fungible. 50 million at MotionPay cannot pay a
  disbursement routed through Teleanjar until somebody physically moves it.
- The claims are not all spendable. A claim that the upstream has not settled
  yet is real but frozen.

So the question the ledger must answer is not *"how much money do we have"*. It
is:

> **For each upstream, how much of our claim is spendable right now, and does
> that cover what our merchants can spend right now?**

When the answer is no, the gap is bridged with company capital — what the admin
team calls **Dana Talangan**. §4 makes it a number instead of a feeling.

---

## 1. "Settlement" is two different events

The single biggest source of confusion in the current model is that one word,
one column (`settlementAt`) and one config (`settlementInterval`) cover two
unrelated things:

| | Upstream settlement | Merchant settlement |
|---|---|---|
| **What** | The upstream releases funds to us | We make a merchant's balance spendable |
| **Whose rules** | Theirs — and all four disagree | Ours |
| **Calendar** | Their cutoffs, their holidays, announced by PDF | Whatever we promise |
| **How we know** | We **observe** it (manual portal export) | We **decide** it |
| **Ledger side** | Asset (`UPSTREAM_UNSETTLED → UPSTREAM_SETTLED`) | Liability (`MERCHANT_PENDING → MERCHANT_AVAILABLE`) |
| **Can it be scheduled?** | No — computing it is a guess | Yes — it is a cron |

They touch different sides of the balance sheet and never appear in the same
journal. Modelling them as one thing is why the current schema cannot express
either.

### Should we run our own settlement schedule? Yes.

Three reasons, in order of force:

1. **There is no single upstream schedule to inherit.** MotionPay QRIS settles
   T+1 15:00 while MotionPay *E-Wallet* settles H+3 — one provider, two answers.
   Teleanjar runs two batches a day. Pakailink counts business days and shifts
   for public holidays. A merchant taking QRIS on MotionPay and paying out via
   Teleanjar has no upstream schedule that could possibly be "theirs."

2. **The upstream's schedule is not knowable in advance.** Pakailink's calendar
   depends on holiday notices delivered as PDFs. Any system that computes a
   settlement date and posts money on it will be wrong several times a year,
   silently.

3. **The merchant-facing promise is a product decision.** It belongs in config,
   expressed in the language of a commercial offer, not as a cron interval.

### But the schedule must be priced against the upstream's

> Settling a merchant faster than the upstream settles to you is a loan. It is a
> perfectly good product — aggregators sell it — but it has to be deliberate,
> capped, and priced.

Right now it is none of those. `Merchant.settlementInterval` defaults to **120
minutes**, while MotionPay QRIS settles **T+1 at 15:00**. A payment captured at
09:00 Monday becomes merchant-spendable at 11:00 Monday and is only actually
available to us at MotionPay around 15:00 Tuesday. **Every merchant on the
default is being funded from company capital for roughly 28 hours, unmetered.**

That is the exposure Dana Talangan covers today, and nobody can currently say
how big it is.

### Settlement policy, replacing `settlementInterval`

```prisma
model MerchantSettlementPolicy {
  id                Int     @id @default(autoincrement())
  merchantId        Int
  paymentMethodName String? // null = the merchant's default for everything

  mode SettlementModeEnum
  // FOLLOW_UPSTREAM - release once the upstream's expected settlement passes.
  //                   Zero funding cost. This should be the default.
  // FIXED_DELAY     - T+N at releaseTime. Simple to explain, easy to price.
  // SCHEDULED       - specific times of day (the closest thing to today).
  // INSTANT         - release on capture. Fully funded by us; needs a cap.

  delayDays        Int?
  releaseTime      String?  // "16:00"
  businessDaysOnly Boolean  @default(false)

  // Maximum funded exposure for this merchant under INSTANT / fast modes.
  // Once outstanding unsettled-but-released volume hits this, releases queue.
  fundedLimit Decimal? @db.Decimal(18, 2)

  effectiveFrom DateTime
  effectiveTo   DateTime?
}
```

`FOLLOW_UPSTREAM` deserves to be the default because it is the only mode that
costs nothing, and because it makes the funding decision explicit rather than
accidental: if a merchant wants faster, someone has to choose a different mode
and set a limit.

---

## 2. Chart of accounts

| Type | Account | Scope | Meaning |
|---|---|---|---|
| Asset | `UPSTREAM_UNSETTLED` | provider × payment method | Captured, upstream holds it, not released to us yet |
| Asset | `UPSTREAM_SETTLED` | provider | Released by the upstream; spendable at that upstream now |
| Asset | `UPSTREAM_IN_TRANSIT` | provider | We sent a top-up; they have not credited it yet |
| Asset | `BANK_OPERATIONAL` | bank account | Our own account — the hub every inter-upstream move passes through |
| Liability | `MERCHANT_PENDING` | merchant | Credited to them, not yet settled |
| Liability | `MERCHANT_AVAILABLE` | merchant | Spendable by them |
| Liability | `MERCHANT_RESERVED` | merchant | Committed to an in-flight payout |
| Liability | `AGENT_PAYABLE` | agent | The agent's earned share |
| Revenue | `FEE_REVENUE` | house | Our cut |
| Expense | `PROVIDER_FEE` | provider | What the upstream keeps |
| Equity | `COMPANY_CAPITAL` | house | Capital in — the source of Dana Talangan |
| Equity | `RETAINED_EARNINGS` | house | Closed-out profit |
| Equity | `OPENING_BALANCE` | house | Migration only (§10) |
| Equity | `ROUNDING_RESIDUAL` | house | Where sub-rupiah remainders go |

Four decisions worth stating:

**`UPSTREAM_UNSETTLED` is split by payment method; `UPSTREAM_SETTLED` is not.**
Unsettled money is *money waiting on a schedule*, and MotionPay's QRIS and
E-Wallet schedules differ. Once it settles it is one pool at that upstream and
fully fungible there.

**`UPSTREAM_IN_TRANSIT` is not optional.** A top-up from our bank to Teleanjar
is not instant. Without this account the money vanishes from the books for
however long the transfer takes, and every liquidity check run during that
window is wrong.

**`BANK_OPERATIONAL` exists even though we "hold no money."** Every
upstream-to-upstream move is two legs through our own account — withdraw from
MotionPay, top up Teleanjar. The account is mostly a transit hub, and it is also
where capital lands.

**Agents get real liability accounts, not a log.** `WithdrawTransaction` already
carries `userRole`, so agents withdraw their own earnings. That is a payable, and
it should look like one.

---

## 3. Journal catalogue

Every event that moves money, with its entries. Implementation is mechanical
once this list is agreed. Running example: **QRIS 100,000**, provider fee 800,
internal fee 1,000, agent fee 200, merchant net 98,000.

### 3.1 `PAYIN_CAPTURED` — payment confirmed

```
Dr UPSTREAM_UNSETTLED:MOTIONPAY:QRIS   99,200
Dr PROVIDER_FEE:MOTIONPAY                 800
   Cr MERCHANT_PENDING:27                        98,000
   Cr FEE_REVENUE                                 1,000
   Cr AGENT_PAYABLE:5                               200
```

`UPSTREAM_UNSETTLED` is 99,200, not 100,000, because MotionPay keeps their 800.
That figure is exactly what their settlement report should show.

### 3.2 `UPSTREAM_SETTLED` — the upstream released funds (§6, evidence-driven)

```
Dr UPSTREAM_SETTLED:MOTIONPAY          99,200
   Cr UPSTREAM_UNSETTLED:MOTIONPAY:QRIS          99,200
```

Asset side only. The merchant is not involved and must not be.

### 3.3 `MERCHANT_SETTLED` — our sweep, our promise

```
Dr MERCHANT_PENDING:27                 98,000
   Cr MERCHANT_AVAILABLE:27                      98,000
```

Liability side only. The upstream is not involved and must not be.

**3.2 and 3.3 are independent.** Their ordering is not guaranteed and does not
need to be. The gap between them, summed across all merchants, is the funding
exposure in §4.

### 3.4 `PAYOUT_RESERVED` — merchant initiates a disbursement or withdrawal

Written **synchronously, in the same DB transaction as the payout row, before
the provider is called.**

```
Dr MERCHANT_AVAILABLE:27               30,000
   Cr MERCHANT_RESERVED:27                       30,000
```

### 3.5 `PAYOUT_COMPLETED` — provider confirms

```
Dr MERCHANT_RESERVED:27                30,000
Dr PROVIDER_FEE:TELEANJAR                 500
   Cr UPSTREAM_SETTLED:TELEANJAR                 30,000
   Cr FEE_REVENUE                                   500
```

(Exact split depends on who absorbs the payout fee — a `MerchantFee` question,
not a ledger one. The shape holds either way.)

### 3.6 `PAYOUT_FAILED` — reverse the reservation

```
Dr MERCHANT_RESERVED:27                30,000
   Cr MERCHANT_AVAILABLE:27                      30,000
```

### 3.7 `TREASURY_WITHDRAWAL` — pull funds out of an upstream

```
Dr BANK_OPERATIONAL:BCA                50,000
   Cr UPSTREAM_SETTLED:MOTIONPAY                 50,000
```

### 3.8 `TREASURY_TOPUP_SENT` — push funds toward an upstream

```
Dr UPSTREAM_IN_TRANSIT:TELEANJAR       50,000
   Cr BANK_OPERATIONAL:BCA                       50,000
```

### 3.9 `TREASURY_TOPUP_CONFIRMED` — the upstream credited it

```
Dr UPSTREAM_SETTLED:TELEANJAR          50,000
   Cr UPSTREAM_IN_TRANSIT:TELEANJAR              50,000
```

3.7 → 3.8 → 3.9 is the **Dana Talangan movement** in the user's own example:
MotionPay settles, admin withdraws, admin tops up Teleanjar so merchants can
disburse. Three journals, each individually verifiable, with the money visible
at every step rather than disappearing for a day.

### 3.10 `CAPITAL_INJECTION` — company money in

```
Dr BANK_OPERATIONAL:BCA               100,000
   Cr COMPANY_CAPITAL                           100,000
```

This is the *source* of Dana Talangan, and keeping it separate is what lets you
say "of the 500M sitting at upstreams, 80M is ours and 420M is merchants'."

### 3.11 `MERCHANT_TOPUP` — merchant deposits with us

```
Dr BANK_OPERATIONAL:BCA                10,000
   Cr MERCHANT_AVAILABLE:27                      10,000
```

> ⚠️ **Compliance question, not an engineering one.** This journal means merchant
> funds land in our own bank account. For an entity that is deliberately *not* a
> licensed PJP, holding client funds directly is the exact activity the licence
> governs. Worth a definitive answer from whoever advises on the PJP partnership
> before this flow carries real volume — the alternative shape is the merchant
> topping up the *upstream* directly, which never touches our account.

### 3.12 `PAYIN_REVERSED` — refund or chargeback

A new journal that reverses 3.1, never an edit. If the merchant has already
spent the money, `MERCHANT_AVAILABLE` goes negative — which is why §5 I6's
non-negative check applies to the *payout* path, not to reversals. A negative
available balance is a receivable from the merchant and should raise an alert.

### 3.13 `MANUAL_ADJUSTMENT` — the escape hatch

Required, because reconciliation will find things. Always: two-person approval,
a mandatory reason, a link to the evidence, and its own journal type so
adjustments can be summed separately. **A month where adjustments grow is a
month where something upstream is broken.**

---

## 4. Dana Talangan, as a number

The exposure everyone currently feels but nobody can quote:

```
Spendable now   = Σ UPSTREAM_SETTLED + Σ BANK_OPERATIONAL
Claimable now   = Σ MERCHANT_AVAILABLE + Σ MERCHANT_RESERVED + Σ AGENT_PAYABLE

Funding gap     = max(0, Claimable now − Spendable now)
```

**The funding gap is Dana Talangan.** It is what company capital is covering at
this instant. Put it on a dashboard; it is the single most important number in
the business.

Two refinements that matter operationally:

**Per-upstream liquidity** is what actually tells the admin team to move money:

```
For each upstream U:
  Headroom(U) = UPSTREAM_SETTLED(U) − (payouts currently routed through U)
```

A negative headroom at Teleanjar with a positive balance at MotionPay is
precisely the "withdraw from MotionPay, top up Teleanjar" trigger — and it can be
alerted on hours before a merchant's disbursement fails, rather than after.

**Forecast headroom** uses
[upstream-settlement-schedules.md](upstream-settlement-schedules.md) to project
what lands when:

```
Headroom(U, t) = UPSTREAM_SETTLED(U)
               + expected settlements into U before t
               − expected payouts through U before t
```

This is the only reason the schedule table exists. It never posts anything.

---

## 5. Invariants

These are what make the ledger *credible* rather than merely *tidy*. They run as
a scheduled job and alert; they never auto-correct.

**I1 — every journal balances, per currency.**
`Σ debits = Σ credits` within each currency of each journal. Asserted at write
time and re-checked nightly. See §8 on why "per currency" is not hypothetical.

**I2 — the projection matches the entries.**
`LedgerBalance[a]` equals the signed sum of `LedgerEntry` for `a` from the last
snapshot forward. This is the reference doc's §5.7 job, and it is the one that
makes a cached balance trustworthy instead of optimistic.

**I3 — solvency.**
```
Σ all asset accounts  ≥  Σ all liability accounts
```
If this fails we owe more than exists anywhere. The difference is equity:
positive is accumulated margin, negative is a hole with a date on it.

**I4 — liquidity.**
```
Σ MERCHANT_AVAILABLE + Σ MERCHANT_RESERVED  ≤  Σ UPSTREAM_SETTLED + Σ BANK_OPERATIONAL
```
Merchants can spend available balance *now*. Breaching this does not mean
insolvency — the unsettled money is real — it means a payout will fail for
liquidity reasons. The breach amount is the funding gap from §4.

**I5 — no unbacked payout.** Enforced structurally by the reserve in 3.4 plus
`CHECK (balance >= 0)` on `MERCHANT_AVAILABLE` projections. A concurrent second
withdrawal fails at the database, not at an application `if`.

**I6 — no `UPDATE` or `DELETE` on `LedgerEntry` or `LedgerJournal`, ever.**
Corrections are reversing journals. Worth enforcing with a database role, not
convention.

---

## 6. Upstream settlement must be evidence-driven

MotionPay publishes **no settlement statement, no report endpoint, nothing to
pull.** The only source is a manual export from their merchant portal, done by
the admin team. Teleanjar and Pakailink are the same.

That is not a temporary inconvenience to automate away later — it is the
permanent shape of the asset side of the ledger, and the design has to take it
seriously:

> `UPSTREAM_UNSETTLED → UPSTREAM_SETTLED` (journal 3.2) is posted **only** from
> confirmed evidence. Never from a computed date, never from a cron.

### Two levels, ship the first one

**Level 1 — aggregate confirmation.** An admin records: *upstream, date, amount
settled*, attaches the export file, and a second admin approves. That posts 3.2
against the pool. Because the ledger accounts are pools, this is completely sound
accounting — it just doesn't say *which* transactions were covered.

Cheap to build, and it unblocks treasury and every liquidity number in §4
immediately.

**Level 2 — per-transaction matching.** The export is parsed, each line matched
to our transaction by provider reference, and the outcomes classified:

| Outcome | Meaning | Action |
|---|---|---|
| `MATCHED` | Amounts agree | Post |
| `MISSING_IN_OURS` | They settled something we have no record of | **Investigate — a lost callback, or fraud** |
| `MISSING_IN_THEIRS` | We recorded a payment they did not settle | Our record is wrong, or the callback was fake |
| `AMOUNT_MISMATCH` | Both have it, figures differ | Fee disagreement, or rounding |
| `DUPLICATE` | Two of ours match one of theirs | Idempotency failure on our side |

Level 2 proves the Level 1 aggregate rather than replacing it. Both post the
same journal.

Note that legacy's `processCSV()` parsed uploads and **returned the rows without
writing anything** — the matching code was commented out. So this is genuinely
new work, and it is load-bearing from day one rather than a future nicety:
without it `UPSTREAM_SETTLED` never increases and treasury has no inputs.

### Import lifecycle

```
UPLOADED → PARSED → MATCHED → REVIEWED → POSTED
                        ↓
                    EXCEPTIONS (worked by hand, then re-reviewed)
```

Only `POSTED` writes journals, and a posted import is immutable — a correction
is a new import or a `MANUAL_ADJUSTMENT`. The mismatch cases that end up in a
chat group today become rows in an exceptions table with an owner and an
outcome, which is the difference between an audit trail and a chat history.

---

## 7. Schema

New Postgres schema `ledger`. Money stays `Decimal` — never `BIGINT` minor
units; see [settlement-batching-design.md](settlement-batching-design.md) §4 for
the reasoning. Widened to `(18,2)` because balances accumulate where transaction
amounts do not.

```prisma
model LedgerAccount {
  id          Int                   @id @default(autoincrement())
  ownerType   LedgerOwnerTypeEnum   // MERCHANT | AGENT | PROVIDER | BANK | HOUSE
  ownerId     Int?                  // null for HOUSE
  ownerKey    String?               // provider name / bank code / method, where the id is a string
  accountType LedgerAccountTypeEnum
  currency    String                @default("IDR") @db.Char(3)
  normalSide  LedgerSideEnum        // fixed by accountType, denormalised for query speed
  isActive    Boolean               @default(true)

  @@unique([ownerType, ownerId, ownerKey, accountType, currency])
  @@schema("ledger")
}

model LedgerJournal {
  id          BigInt                @id @default(autoincrement())
  journalType LedgerJournalTypeEnum // the §3 catalogue

  // What caused it. The unique below is the idempotency guarantee: a replayed
  // webhook, a re-run sweep or a double-clicked button fails the insert
  // instead of double-posting.
  sourceType LedgerSourceTypeEnum
  sourceId   String                 // string, so imports and treasury ops fit too

  // postedAt is when we wrote it; effectiveAt is the date it belongs to for
  // reporting. A settlement confirmed on the 17th for the 15th has two
  // different dates, and finance needs both.
  postedAt    DateTime @default(now()) @db.Timestamptz(6)
  effectiveAt DateTime @db.Date

  reversesJournalId BigInt?  // set on a reversing journal
  batchId           Int?
  description       String?
  createdBy         Int?

  entries LedgerEntry[]

  @@unique([sourceType, sourceId, journalType])
  @@index([effectiveAt])
  @@index([batchId])
  @@schema("ledger")
}

model LedgerEntry {
  id        BigInt         @id @default(autoincrement())
  journalId BigInt
  accountId Int
  side      LedgerSideEnum // DEBIT | CREDIT
  amount    Decimal        @db.Decimal(18, 2) // ALWAYS positive
  currency  String         @db.Char(3)

  journal LedgerJournal @relation(fields: [journalId], references: [id])
  account LedgerAccount @relation(fields: [accountId], references: [id])

  @@index([accountId, id])
  @@schema("ledger")
}

model LedgerBalance {
  // Projection. Written in the same DB transaction as its entries.
  accountId   Int      @id
  balance     Decimal  @db.Decimal(18, 2)
  lastEntryId BigInt
  version     Int      @default(0)
  updatedAt   DateTime @updatedAt @db.Timestamptz(6)

  @@schema("ledger")
}

model LedgerSnapshot {
  // Bounds verification cost as history grows - reference doc §5.6.
  id          BigInt   @id @default(autoincrement())
  accountId   Int
  balance     Decimal  @db.Decimal(18, 2)
  lastEntryId BigInt
  takenAt     DateTime @default(now()) @db.Timestamptz(6)

  @@index([accountId, takenAt])
  @@schema("ledger")
}
```

**`amount` is always positive and `side` carries direction.** A signed amount
lets a bug write a negative credit, which is meaningless and still sums
correctly. Positive amount plus a side enum cannot express that, and it makes
the trial balance two lines of SQL.

**Rounding.** Round half-up to 2dp on each fee component, then make the
*merchant leg the residual* — `merchantNet = gross − Σ(other legs)` — so every
journal balances by construction. Never round the residual. Rounding all four
legs independently produces a 0.01 imbalance roughly once in fifty transactions,
and each one costs a manual investigation.

---

## 8. Multi-currency is not hypothetical

`WithdrawTransaction.paymentMethodName` is already `TRANSFER_BANK or USDT`, and
the schema comment describes both a manual and an API USDT flow. **There is a
crypto leg in this system today.**

That means:

- `currency` belongs on accounts and entries **from day one**, even while
  everything is IDR. Retrofitting currency into a live ledger is brutal;
  carrying an unused column is free.
- I1 must balance **per currency**, not overall. A journal with IDR on one side
  and USDT on the other does not balance — it is an *exchange*, and it needs a
  rate and an `FX_GAIN_LOSS` account.
- A USDT withdrawal is really three events: debit the merchant in IDR, convert
  at the vendor's rate, deliver USDT. Modelling it as one journal will silently
  bury the FX spread in whichever account absorbs the remainder.

**Recommendation:** ship the currency column and the per-currency invariant now;
give the USDT flow its own design pass before it carries volume. Do not let it
in through the IDR path.

---

## 9. Accounting periods

Finance will ask for a monthly close. It is cheap now and expensive to retrofit:

- A `LedgerPeriod` row per month with `OPEN | CLOSING | CLOSED`.
- Posting with `effectiveAt` inside a `CLOSED` period is rejected; the correction
  goes into the open period with a reference to what it fixes.
- Close runs the §5 invariants, writes snapshots for every account, and records
  a trial balance for the period.

This is also what makes historical reconciliation reproducible: re-running last
month's numbers should give last month's answer, not today's.

---

## 10. What gets deleted

Confirmed as legacy artifacts with no forward value:

| Dropped | Replaced by |
|---|---|
| `MerchantBalanceLog`, `AgentBalanceLog`, `InternalBalanceLog` | `LedgerEntry` + `LedgerBalance` |
| `changeAmount` / `balanceActive` / `balancePending` columns | Account balances; pending and available are separate accounts |
| `batchSettlementId`, `batchReconciliationId` | `LedgerJournal.batchId`, and the reconciliation import record |
| `TransactionTypeEnum.SETTLEMENT_PURCHASE` | `LedgerJournalTypeEnum.MERCHANT_SETTLED` |
| `Merchant.settlementInterval`, `lastSettlementAt` | `MerchantSettlementPolicy` (§1) |
| `Provider.reconciliationTime`, `lastReconciliationAt` | `UpstreamSettlementWindow` + the import record |
| `TODO(balance-ledger)` in both webhook services | Journals 3.1 and 3.5/3.6 |

Kept as **projections**, explicitly not sources of truth: `netNominal` on the
transaction rows, and a single `merchantSettledAt` stamped by the sweep — a
paginated dashboard list should not have to hit the ledger.

### Opening the book

Legacy is live and `*BalanceLog` has production rows. Opening balances are one
dated journal per holder, exactly as an accountant would do it:

```
Dr OPENING_BALANCE                            (total)
   Cr MERCHANT_AVAILABLE:27                          (their balanceActive)
   Cr MERCHANT_PENDING:27                            (their balancePending)
   Cr AGENT_PAYABLE:5                                ...
```

Then the asset side, from a portal export taken the same day:

```
Dr UPSTREAM_SETTLED:MOTIONPAY                 (what the portal shows)
Dr UPSTREAM_UNSETTLED:MOTIONPAY:QRIS          (what we believe is pending)
   Cr OPENING_BALANCE                                (total)
```

**The difference between the two sides on day one is the real starting position**
— and quite possibly the first genuinely new fact this project produces. It will
not be zero. Whatever it is, it goes to `COMPANY_CAPITAL` with a note, once,
deliberately.

---

## 11. Build order

| Step | What | Unblocks |
|---|---|---|
| 1 | `libs/ledger` — accounts, journals, balanced-entry assertion, projection, advisory locks | everything |
| 2 | Chart of accounts + opening balances (§10) | real numbers |
| 3 | Journals 3.1 / 3.4 / 3.5 / 3.6 — payin capture and the payout reserve | correct balances, D17 closed |
| 4 | Treasury journals 3.7–3.10 + the §4 dashboard | Dana Talangan becomes visible |
| 5 | Reconciliation import, Level 1 aggregate (§6) | `UPSTREAM_SETTLED` starts moving |
| 6 | Merchant settlement policy + sweep | [settlement-batching-design.md](settlement-batching-design.md) |
| 7 | Reconciliation Level 2, per-transaction matching | fraud detection |
| 8 | Period close, exports, MinIO | reporting |

Steps 4 and 5 before 6 is deliberate and is a change from the earlier draft.
Treasury visibility and upstream confirmation are worth more than an automated
merchant sweep, because the sweep is the thing that *creates* funding exposure —
better to be able to see the exposure before automating the thing that grows it.

---

## 12. Open questions

1. **Does a merchant top-up (3.11) land in our bank account?** If so, that is
   holding client funds, which is what a PJP licence governs. Needs a
   definitive answer from whoever advises on the partnership.

2. **Who absorbs the payout fee** — merchant, or us out of `FEE_REVENUE`?
   Determines the exact split in 3.5.

3. **What is the policy when a settled transaction is reversed after the
   merchant has withdrawn?** Negative `MERCHANT_AVAILABLE`, or a receivable
   tracked separately? A policy question; answer it before the first reversal.

4. **Is there one operational bank account or several?** Per-upstream accounts
   would change `BANK_OPERATIONAL` from one account to several and make transit
   easier to trace.

5. **What reference appears on an upstream's settlement export?** Determines
   whether Level 2 matching (§6) is possible at all, per upstream. Worth asking
   before building the matcher.

6. **Should `FEE_REVENUE` be split by provider and payment method?** One account
   is simpler; split gives per-rail margin without a join. Cheap to decide now,
   annoying later.
