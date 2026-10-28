# MotionPay probes

Throwaway scripts for answering questions about MotionPay's API that their
documentation gets wrong. Not part of the build, not imported by anything.

They read credentials from `apps/transaction/.env.local` and talk to **sandbox**.
Each signs and posts directly rather than going through `MotionPayQrisService`
and friends, which is the point: a probe must not require loosening a production
constant to run, and must not touch our database.

| Script | Answers |
|---|---|
| `check-host-reachability.js` | Is a 403 an IP-allowlist block or our own problem? Prints the three-way comparison and this machine's egress IP. |
| `probe-qris-external-id.js` | How long may a QRIS `external_id` be, and do they truncate? **Answered: 255, and they reject rather than truncate.** |
| `probe-transfer-biller-external-id.js` | The same question for Transfer and Biller. **Blocked** on the IP allowlist. |

Run from the repo root:

```bash
node scripts/motionpay/check-host-reachability.js
node scripts/motionpay/probe-qris-external-id.js
PROBE_LENGTHS="16,32,64,128,255,256" node scripts/motionpay/probe-qris-external-id.js
```

## Two rules for anything added here

**Inquiry legs only.** `/transfer/api/v1/payment` and `/biller/v1/payment` move
money. A field width is never worth finding out that way.

**Observe what comes back, not just the status code.** The dangerous outcome is
never rejection — it is silent acceptance followed by truncation, because a
shortened correlation key does not error, it just stops matching at callback and
reconciliation time. Every value sent carries a `TAIL` sentinel so a quiet trim
cannot hide behind a matching length, and is checked in both places the provider
will report it back.

Findings belong in `docs/upstream/motionpay.md`, not in this directory. The JSON
each script writes is raw evidence, gitignored.
