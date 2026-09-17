# Ledger & Balance: Reference Notes

Context document for designing transactional/wallet systems. Covers the
finance concepts, their engineering equivalents, and the schema/consistency
decisions that follow.

Stack assumptions in the examples: NestJS + Prisma + PostgreSQL.

---

## 1. The core idea

A **ledger** is the record of what happened. A **balance** is the answer to
"how much is there right now." The balance is *derived* from the ledger — it is
not an independent fact.

> **Ledger = the facts. Balance = a conclusion drawn from the facts.**

If the two ever disagree, the ledger is right and the balance is wrong. Never
the other way around. Every design decision below follows from this.

---

## 2. Finance point of view

### Immutability

In accounting, the ledger is **append-only**. You do not edit a transaction. If
you made a mistake, you write a *new* entry that reverses it (a reversal or
contra entry). This is deliberate, not a technical limitation — the history *is*
the audit trail. An editable ledger is worthless for audit.

### Double-entry bookkeeping

Every transaction touches **at least two accounts**, and the amounts must sum to
zero. Money never appears or vanishes; it moves.

Example — a customer tops up 100,000 IDR via a payment gateway:

| Account | Debit | Credit |
|---|---|---|
| Gateway Settlement (asset) | 100,000 | |
| Customer Wallet (liability) | | 100,000 |

Two entries, one transaction, net zero.

The customer's wallet is a **liability** to you, not an asset — you now *owe*
them that money. This trips up almost everyone at first.

**Why bother** instead of just `UPDATE balance = balance + 100000`? Because
double-entry makes errors *structurally detectable*. If the books don't sum to
zero, something is wrong and you know it immediately. Single-entry can be wrong
silently forever.

### Debits and credits

Whether a debit increases or decreases depends on the account type. Debit/credit
are **not** synonyms for in/out.

| Account type | Debit | Credit | Example |
|---|---|---|---|
| Asset | ↑ | ↓ | Cash, gateway settlement account |
| Liability | ↓ | ↑ | Customer wallet balance |
| Equity | ↓ | ↑ | Retained earnings |
| Revenue | ↓ | ↑ | Transaction fees earned |
| Expense | ↑ | ↓ | Gateway fees paid |

Underlying identity: **Assets = Liabilities + Equity**

### Glossary

| Term | Meaning |
|---|---|
| **Journal** | Chronological list of transactions as they occur |
| **General Ledger** | The same entries, organized by account |
| **Posting** | Writing a journal entry into the ledger |
| **Journal entry** | One transaction — the whole balanced set of lines |
| **Ledger line / posting line** | One side of it (one account, one amount) |
| **Chart of Accounts** | The catalog of all accounts in use |
| **Debit / Credit** | Left/right; meaning flips by account type |
| **T-account** | Visual layout of one account's debits and credits |
| **Trial balance** | Check that all debits equal all credits |
| **Opening / closing balance** | Balance at start/end of a period |
| **Running balance** | Balance after each individual transaction |
| **Reconciliation** | Comparing your ledger against an external one |
| **Settlement** | When money actually moves between institutions |
| **Clearing** | The process between authorization and settlement |
| **Pending vs available** | Authorized but not settled, vs. spendable now |
| **Reversal / contra entry** | A new entry that undoes a previous one |
| **Idempotency** | Processing the same instruction twice = same effect as once |

---

## 3. IT point of view

The finance concepts map onto patterns already familiar from software:

| Finance | Engineering equivalent |
|---|---|
| Ledger (immutable, append-only) | **Event log / event sourcing** |
| Balance | **Projection / read model / materialized view** |
| Posting | Appending an event |
| Reversal entry | Compensating transaction |
| Trial balance | Invariant check / consistency assertion |
| Reconciliation | Scheduled verification job |
| Opening balance | **Snapshot** |
| Idempotency | Deduplication by idempotency key |

A ledger is **event sourcing applied to money** — and accountants arrived at it
roughly 500 years before software did. The balance is a CQRS read model over
that event stream.

---

## 4. The central engineering decision

**Question:** compute the balance by summing the whole ledger every time, or
keep a separate balance table?

### Option A — Always `SUM()` from the beginning

```sql
SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE account_id = $1;
```

- ✅ Always correct by construction. Single source of truth. No drift possible.
- ❌ Cost grows forever. At 10M rows for one account this is seconds, not
  milliseconds. Indexes help but don't change the growth curve.

Fine for a prototype. Fails as a production wallet.

### Option B — A `balances` table updated on every write

```sql
UPDATE balances SET amount = amount + $1 WHERE account_id = $2;
```

- ✅ O(1) reads.
- ❌ **It can drift.** A failed transaction, a race condition, a bug, a manual DB
  fix — and the balance now disagrees with the ledger, with nothing detecting it.

This is the dangerous option, because it fails *silently*. You find out from an
angry customer.

### Option C — Balance table **plus** periodic reconciliation ✅

Keep the fast balance, but treat it as a **cache that must be provable** against
the ledger. This is what real payment systems do.

```
ledger_entries     ← immutable truth, append-only
balances           ← fast read, updated in the same DB transaction
balance_snapshots  ← periodic checkpoints
reconciliation job ← scheduled, proves balances == SUM(ledger)
```

---

## 5. Implementation rules

### 5.1 Update balance in the same DB transaction as the ledger insert

If these can diverge, you've built Option B with extra steps.

```typescript
await this.prisma.$transaction(async (tx) => {
  await tx.ledgerEntry.create({
    data: { accountId, amount, externalRef, direction },
  });

  await tx.balance.update({
    where: { accountId },
    data: { amount: { increment: amount } }, // atomic, not read-then-write
  });
});
```

### 5.2 Never read-then-write

`balance = balance + x` computed in application code is a lost-update race. Use
the database's atomic increment (Prisma `increment`, or
`SET amount = amount + $1`), or lock the row with `SELECT ... FOR UPDATE`.

### 5.3 Store money as integers in minor units

`BIGINT` holding sen/cents. **Never** `FLOAT` or `DOUBLE` —
`0.1 + 0.2 !== 0.3` is not acceptable in a ledger. Use Postgres `NUMERIC` if you
need fractional minor units.

Note: Prisma maps `BIGINT` to JS `BigInt`, which `JSON.stringify` throws on —
relevant if balances pass through a Redis/JSON caching layer.

### 5.4 Enforce non-negative balance in the database

```sql
ALTER TABLE balances ADD CONSTRAINT non_negative CHECK (amount >= 0);
```

A race that slips past the service-layer check still gets stopped here.

### 5.5 Idempotency on the ledger insert

Payment gateways retry callbacks. A unique constraint on the gateway's reference
ID means a duplicate callback fails the insert instead of double-crediting:

```sql
CREATE UNIQUE INDEX ON ledger_entries (external_ref)
  WHERE external_ref IS NOT NULL;
```

This is also the defense against a replayed webhook that carries a valid
signature.

### 5.6 Snapshots bound the recompute cost

Store a checkpoint per account periodically, then verify from the checkpoint
forward instead of from the beginning of time:

```sql
SELECT s.amount + COALESCE(SUM(e.amount), 0)
FROM balance_snapshots s
LEFT JOIN ledger_entries e
  ON e.account_id = s.account_id AND e.id > s.last_entry_id
WHERE s.account_id = $1
GROUP BY s.amount;
```

Verification now reads a bounded number of rows regardless of account age.

### 5.7 The reconciliation job

Scheduled (e.g. nightly). For each account:

1. Recompute from the ledger, starting at the latest snapshot.
2. Compare against the `balances` row.
3. Alert on any mismatch — do not auto-correct silently.
4. Write a fresh snapshot.

This job is what makes Option C trustworthy rather than Option B with optimism.

---

## 6. Schema sketch (Prisma)

```prisma
model LedgerEntry {
  id          BigInt   @id @default(autoincrement())
  accountId   String
  amount      BigInt   // minor units; signed, or use separate debit/credit
  direction   String   // 'DEBIT' | 'CREDIT'
  journalId   String   // groups the balanced set of lines
  externalRef String?  @unique
  createdAt   DateTime @default(now())

  @@index([accountId, id])
}

model Balance {
  accountId String   @id
  amount    BigInt
  version   Int      @default(0)  // optimistic locking
  updatedAt DateTime @updatedAt
}

model BalanceSnapshot {
  id          BigInt   @id @default(autoincrement())
  accountId   String
  amount      BigInt
  lastEntryId BigInt
  createdAt   DateTime @default(now())

  @@index([accountId, createdAt])
}
```

**There should be no `UPDATE` or `DELETE` path for `LedgerEntry` anywhere in the
codebase.** Enforce it with a database role or trigger if possible — it is the
single most valuable guarantee in the whole design.

---

## 7. Quick reference

| Rule | Why |
|---|---|
| Ledger is append-only | It's the audit trail; corrections are new entries |
| Balance is derived, never authoritative | Ledger wins every disagreement |
| Write both in one DB transaction | Prevents divergence at the source |
| Atomic increment, never read-then-write | Prevents lost updates under concurrency |
| Integers in minor units | Float arithmetic is unacceptable for money |
| `CHECK (amount >= 0)` | Last line of defense against overdraw races |
| Unique external ref | Idempotency against retried/replayed callbacks |
| Snapshots | Keeps verification cost bounded as history grows |
| Scheduled reconciliation | The only thing that makes a cached balance trustworthy |

---

## 8. Further reading

- Martin Fowler's accounting patterns (Account, Transaction, Posting Rule)
- TigerBeetle — a database purpose-built for double-entry ledgers at high throughput
- Published ledger designs from Square, Stripe, and Uber engineering blogs

Topics these cover that this document does not: multi-currency handling,
hold/capture flows for pending authorizations, and what to actually do when a
reconciliation finds a mismatch.
