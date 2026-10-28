# Upstream Settlement Schedules — Reference

When each upstream releases *our* money to *us*. This is a factual reference,
not a design: it records what each partner has told us, and the questions each
one leaves open.

**This table never moves money.** It generates an *expectation* — "we should
have received X from MotionPay by 15:00 today" — which treasury forecasts
against and reconciliation checks against. Money moves only when the settlement
is observed. See [ledger-foundation-design.md](ledger-foundation-design.md) §6.

---

## 1. Known schedules

### MotionPay / Flash

| Product | Transaction window | Settles |
|---|---|---|
| QRIS | 00:00 – 23:59 | Next day, 15:00 |
| E-Wallet | (assumed same day window) | H+3 |

Open questions:
- Is "next day" a **calendar** day or a **business** day? QRIS volume is
  weekend-heavy; the answer changes the weekend float materially.
- H+3 from what — transaction date, or the day the window closes? And business
  or calendar days?
- Is there a settlement time for E-Wallet, or does it land whenever?
- Is there a holiday policy, and how is it communicated?

### Teleanjar

| Batch | Transaction window | Settles |
|---|---|---|
| 1 | 18:00 (previous day) – 12:00 | Same day, 13:00 |
| 2 | 12:01 – 18:00 | Same day, 19:00 |

Open questions — both are boundary gaps that will produce a one-transaction
mismatch and cost an afternoon in a chat group:
- **18:00 appears in both batches.** Batch 1 starts at 18:00 and batch 2 ends at
  18:00. Which batch owns a transaction at exactly 18:00:00?
- **12:00:01 – 12:00:59 belongs to neither.** Batch 1 ends at 12:00, batch 2
  starts at 12:01. Ask them to restate the windows as half-open intervals
  (`[18:00, 12:00)` and `[12:00, 18:00)`), which removes both problems.
- Weekends and holidays?

### Pakailink

Source: `C:\le\andalusia\pakaidonk\QRIS Settlement schedule.txt`

| Transaction time | Settles |
|---|---|
| ≤ 23:30 WIB | H+1 **business day** |
| 23:31 – 23:59 WIB | H+2 **business day** |

Their worked examples:

| Transaction | Settles |
|---|---|
| Friday ≤ 23:30 | Monday |
| Friday 23:31–23:59 | Tuesday |
| Saturday ≤ 23:30 | Monday |
| Saturday 23:31–23:59 | Tuesday |
| Sunday ≤ 23:30 | Monday |
| Sunday 23:31–23:59 | Tuesday |

**The rule that fits all six: the Nth business day strictly after the
transaction date.** Not "add N days then roll forward" — that gives Tuesday for
a Saturday H+1, which contradicts their own example. Implement it as: walk
forward from the transaction date, counting only business days, stop at the Nth.

**And it is not computable from a rule alone.** The directory also holds
`[PAKAILINK INFO] Settlement schedule International Labor Day 2026.pdf` — an
ad-hoc notice shifting the schedule around a public holiday. So the calendar
depends on:

1. Indonesian national public holidays, which move each year, and
2. Partner-specific notices delivered as PDFs in a chat group.

This is the strongest argument in the whole design for **evidence-driven
settlement posting**. Any system that computes a settlement date and posts money
on it will be wrong several times a year, silently, in the merchant's favour or
ours.

---

## 2. What the schedule model has to express

Every rule above fits one shape:

```prisma
model UpstreamSettlementWindow {
  id                Int     @id @default(autoincrement())
  providerName      String
  paymentMethodName String
  label             String  // "DAILY", "BATCH_1", "BATCH_2"

  // Transaction window, as a half-open interval [start, end) in `timezone`.
  windowStart          String // "18:00"
  windowStartDayOffset Int    @default(0)  // -1 when the window opens the previous day
  windowEnd            String // "12:00"

  // When the upstream releases it.
  settlementOffset  Int     // 0 same day, 1 = H+1, 3 = H+3
  settlementTime    String? // "13:00"; null when the partner gives no time
  businessDaysOnly  Boolean @default(false)

  timezone String @default("Asia/Jakarta")

  effectiveFrom DateTime
  effectiveTo   DateTime?   // schedules change; keep the history
}
```

Mapping the three partners onto it:

| Partner / product | start | offset | end | settle offset | time | business days |
|---|---|---|---|---|---|---|
| MotionPay QRIS | 00:00 | 0 | 24:00 | +1 | 15:00 | **unknown** |
| MotionPay E-Wallet | 00:00 | 0 | 24:00 | +3 | — | **unknown** |
| Teleanjar batch 1 | 18:00 | −1 | 12:00 | 0 | 13:00 | unknown |
| Teleanjar batch 2 | 12:00 | 0 | 18:00 | 0 | 19:00 | unknown |
| Pakailink QRIS early | 00:00 | 0 | 23:30 | +1 | — | **yes** |
| Pakailink QRIS late | 23:30 | 0 | 24:00 | +2 | — | **yes** |

Two things the table forces into the open:

**`effectiveFrom` / `effectiveTo` are not optional.** Partners change these
schedules and announce it by message. Without dated versions, re-running a
reconciliation for last month uses this month's rules and produces mismatches
that are not real.

**A `BusinessDayCalendar` is a separate, first-class table.** Indonesian public
holidays, plus partner-specific overrides, maintained by hand. It is small,
boring, and load-bearing — a missing entry silently moves every Pakailink
expectation by a day.

```prisma
model BusinessDayCalendar {
  date         DateTime @db.Date
  isBusinessDay Boolean
  providerName String?  // null = national calendar; set = partner override
  note         String?  // "International Labor Day 2026, per Pakailink notice"

  @@unique([date, providerName])
}
```

---

## 3. Why this is expectation only

> The upstream settlement schedule is to treasury what a provider callback is to
> a transaction: a **trigger** that says *go look*, never a **fact** you can post
> on.

The same verify-by-pull discipline the codebase already applies to unauthenticated
callbacks applies here, for the same reason — the difference being that no
partner currently offers anything to pull. MotionPay publishes no settlement
statement or report endpoint; the only source is a manual export from their
merchant portal.

So the expectation produced by this table is used for exactly three things:

1. **Treasury forecasting** — "how much should land at each upstream, and when",
   which is what tells the admin team when to move money (§ *Dana Talangan* in
   the ledger doc).
2. **Reconciliation targets** — the figure the admin's manual export is compared
   against.
3. **Alerting** — an expected settlement that has not been confirmed N hours
   after its due time is a thing someone should chase, not a thing to assume.

It is never used to post a journal.

---

## 4. Questions to send each partner

Worth asking once, in writing, and recording the answers here:

**All partners**
1. Calendar days or business days?
2. Which holiday calendar, and how are exceptions announced?
3. Is the settlement *time* a commitment or a target?
4. Is there any API, report endpoint, SFTP drop, or scheduled email for
   settlement statements? (Currently: portal export by hand for all of them.)
5. What is the reference we can match a settlement line back to individual
   transactions by?

**Teleanjar specifically**
6. Restate the batch windows as half-open intervals — who owns 18:00:00, and
   who owns 12:00:30?

**MotionPay specifically**
7. Confirm whether QRIS "next day 15:00" skips weekends.
8. H+3 for E-Wallet — from the transaction date or the window close, and
   business or calendar days?
