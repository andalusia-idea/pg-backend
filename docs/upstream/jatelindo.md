# Jatelindo (PT Jatelindo Perkasa Abadi) — Transfer Upstream

Payout rail: bank transfers and e-wallet top-ups over one API. Sibling of
[motionpay.md](motionpay.md); unlike MotionPay there is **one** product and one
host, not three.

Sources, all cross-checked on 2026-10-05:

- `DT-Transfer Service (API)-Ver 1.7_05012026.pdf` — the spec. Text extracted by
  inflating its Flate streams; there is no PDF tooling in this repo, so page
  references below are the spec's own page numbers.
- `TRF NON-SNAP (Optima S) v2.postman_collection.json` — the working collection,
  including the pre-request scripts that define the signature.
- Credentials and sandbox data: `data devel JPA NON-SNAP.txt`.

UAT scenario documents are deliberately out of scope here.

---

## 1. Overview

**Non-SNAP.** Jatelindo also publishes a SNAP variant; we integrate the
NON-SNAP one, which is form-encoded and uses a bespoke hash rather than SNAP's
signature scheme.

Six endpoints, all `POST` unless noted:

| Endpoint | Path | Host | Signed |
|---|---|---|---|
| Login | `/Host/Transfer/Session/Login` | private | no (Basic auth) |
| Balance Inquiry | `/Host/Transfer/Account/BalanceInquiry` | public | yes |
| Transaction History | `/Host/Transfer/Account/TransactionHistory` | public | **no** |
| Account Inquiry | `/Host/Transfer/Transaction/Inquiry` | private | yes |
| Single Transfer | `/Host/Transfer/Transaction/SingleTransfer` | private | yes |
| Transaction Status | `/Host/Transfer/Transaction/Status` | public | yes |

**Every request is `application/x-www-form-urlencoded`.** The spec uses
`--data-urlencode` throughout and the collection sends urlencoded bodies; no
endpoint takes JSON.

### Two hosts — unresolved

The collection defines two base URLs and uses them differently:

```
url_private = https://10.254.254.12:14890          ← Login, Inquiry, SingleTransfer
url_public  = https://dev-transferonline.fello.id:14890   ← Balance, History, Status
```

`JATELINDO_TRANSFER_BASE_URL` is a single value, currently the **public** one, so
the three private-host calls go somewhere the collection says they do not. A
private RFC1918 address suggests a VPN or peering route rather than a second
public endpoint.

The spec adds a third data point and contradicts the collection: it documents
Transaction Status as **`GET` on port 14991**, where the collection has `POST` on
14890. The implementation uses `GET`.

**Ask Jatelindo:** is the public host authoritative for all six, or is
`10.254.254.12` a required route for the transaction endpoints? And which of
`GET`/`POST` and `14890`/`14991` is current for Status?

### Revision history, from the spec's own table

Useful because it dates each field we depend on:

| Version | Date | Change |
|---|---|---|
| 1.0 | 22/03/2022 | First release |
| 1.1 | 14/08/2023 | Channel Transfer list added; endpoint URLs revised |
| 1.2 | 29/04/2024 | `customerAdmin` added to inquiry and transfer responses |
| 1.3 | 16/12/2024 | Response Code list added |
| 1.4 | 07/02/2025 | RC `A90 UNAUTHORIZED_ACCESS` added |
| 1.5 | 10/07/2025 | RC `S84 NO_TRANSACTION` added |
| 1.6 | 31/07/2025 | **E-wallet channel IDs added** |
| 1.7 | 05/01/2026 | `jpaReferenceNo` added to Transfer and Status; channel 142 added |

---

## 2. Authentication

Two layers, and they are independent.

### Layer 1 — session token

`POST /Host/Transfer/Session/Login` with **HTTP Basic** (`username:password`),
an `APIKey` header, and an empty urlencoded body. Response:

```json
{ "LoginResponse": [ { "token": "eyJhbGciOiJIUzI1NiJ9..." } ], "status": { ... } }
```

The token is a JWT, so its lifetime is read from its own `exp` claim rather than
guessed — same approach as MotionPay, same reason.

### Layer 2 — `RequestAuth` per-request hash

Every signed endpoint carries three headers:

```
APIKey:        <api key>
Authorization: Bearer <session token>
RequestAuth:   <hash, below>
```

The hash is:

```
RequestAuth = SHA256( "secret=" + MD5(secret)
                    + "/" + field=value   (all signed fields, see below)
                    ... )                  → lowercase hex
```

**The ordering rule**, derived from the collection's four pre-request scripts:
`secret=MD5(secret)` first, then every other signed field in
**case-insensitive alphabetical order**, joined with `/`, each as `key=value`.
The signed fields are the request body's fields plus `APIKey` and `token`.

That yields, per endpoint:

| Endpoint | String to sign |
|---|---|
| Balance Inquiry | `secret/APIKey/token` |
| Account Inquiry | `secret/accountNo/amount/APIKey/channelId/description/email/name/phoneNo/token` |
| Single Transfer | `secret/accountNo/amount/APIKey/channelId/description/email/name/phoneNo/token/traceNumber` |
| Transaction Status | `secret/APIKey/token/traceNumber` |

Note `token` sorts before `traceNumber` (`toke` < `trac`), which is why it sits
second-to-last on the two that carry a trace number.

Empty values are signed as empty: `description=` with nothing after it. The
implementation relies on `Array.join('')` rendering `null` as `''`, which happens
to match what Postman produces for an empty urlencoded field — correct, but by
coincidence rather than intent.

**Transaction History is the one signed-looking endpoint that is not signed.** It
carries `Authorization` and `APIKey` but no `RequestAuth`, and has no
pre-request script.

---

## 3. Channel IDs

`channelId` is **numeric**, for banks *and* e-wallets. The spec's "List Channel
Transfer" table runs to 142 entries.

### E-wallets

```
901  DANA
902  SHOPEEPAY
903  GOPAY
904  OVO
```

Added in spec v1.6. **LinkAja is not in Jatelindo's list** — worth knowing
because MotionPay's bank-code list does include it, so a merchant routed to
Jatelindo cannot reach LinkAja.

### Banks — the ones mapped so far

| Our `bankCode` | Jatelindo `channelId` | Name |
|---|---|---|
| `013` | `2` | PT. BANK PERMATA Tbk. |
| `008` | `3` | PT. BANK MANDIRI Tbk. |

Others confirmed from the spec, not yet mapped: `1` Fello (Jatelindo's own),
`5` BNI, `6` BRI, `10` Danamon, `123` Sinarmas, `125` Seabank, `142` Maybank
(added v1.7). The full table is in the spec; `JATELINDO_CHANNEL` carries a
`TODO complete the rest`.

> The mapping direction matters: ours is `config.Bank.code` (Indonesian clearing
> codes, `014` = BCA) and Jatelindo's is its own sequence. They are unrelated
> numbering schemes and there is no formula - every bank needs a table row.

---

## 4. Response codes

The spec's table, complete. The **Need Check** column is the one that matters:
`Y` means Jatelindo is telling us the outcome is *not yet known* and a status
call is required.

| RC | Message | Need Check | Their STATUS | We map to |
|---|---|---|---|---|
| `A00` | PROCESSED | N | SUCCESS | `SUCCESS` |
| `A01` | REQUESTED | **Y** | SUSPECT | `PENDING` |
| `E99` | UNKNOWN_ERROR | **Y** | SUSPECT | `PENDING` |
| `E18` | TIMEOUT | **Y** | SUSPECT | `PENDING` |
| `P16` | DUPLICATE_TRANSACTION | N | FAILED | `FAILED` |
| `T40` | TRANSACTION_FAILED | N | FAILED | `FAILED` |
| `T40` | TRANSACTION_BLOCKED | N | FAILED | `FAILED` |
| `T40` | TRANSACTION_REJECTED | N | FAILED | `FAILED` |
| `T16` | TRANSACTION_AMOUNT_BELOW_LIMIT | N | FAILED | `FAILED` |
| `T18` | TRANSACTION_AMOUNT_ABOVE_LIMIT | N | FAILED | `FAILED` |
| `S14` | INACTIVE_ACCOUNT | N | FAILED | `FAILED` |
| `S14` | INVALID_ACCOUNT | N | FAILED | `FAILED` |
| `A90` | UNAUTHORIZED_ACCESS | N | FAILED | `FAILED` |
| `S84` | NO_TRANSACTION | N | FAILED | `FAILED` |

**`SUSPECT` maps to `PENDING`, never to a terminal state.** Our
`TransactionStatusEnum` has no SUSPECT, and PENDING is the state that means
"unresolved, poll it". Mapping `E18`/`E99` to `EXPIRED` or `CANCELLED` asserts a
failure the provider has explicitly said it cannot confirm - and a merchant told
their payout failed will retry, paying the recipient twice.

**Three codes share `T40` and two share `S14`.** That is the spec's own doing,
not a transcription error, so `TRANSACTION_BLOCKED` and `TRANSACTION_REJECTED`
are indistinguishable from the code alone - the `message` field is the only
discriminator.

> `T40 TRANSACTION_BLOCKED` is *"Blocked by bank, too many request"*. Polling
> frequency is therefore a correctness concern and not just an efficiency one -
> an aggressive status poll can manufacture failures.

---

## 5. Request and response shapes

Confirmed field-by-field against the spec's examples.

### Account Inquiry

Request: `accountNo`, `amount`, `channelId`, `description`, `phoneNo`, `name`,
`email`. For an e-wallet, `accountNo` is empty and `phoneNo` carries the number;
for a bank, the reverse.

```json
{
  "inquiryInfo": {
    "accountName": "CATUR NUGROHO",
    "accountNo": "140397",
    "bankName": "BANK CENTRAL ASIA",
    "customerAdmin": "6500"
  },
  "referenceID": "122a8810-a939-11ec-89ec-024290aa468c",
  "status": { "responseCode": "A00", "message": "PROCESSED", "description": "..." }
}
```

### Single Transfer

Request: the inquiry's fields plus `traceNumber` (our `systemReference`).

```json
{
  "DisbursementResponse": [ {
    "transactionType": { "name": "Disbursement" },
    "traceNumber": "081225164201",
    "sourceAccount": { "fromName": "Member JPA", "fromUsername": "devids" },
    "transactionNumber": "20251014BMRIIDJA010O9943681863",
    "destinationAccount": { "accountName": "...", "accountNo": "...", "bankName": "..." }
  } ],
  "traceNumber": "081225164201",
  "jpaReferenceNo": "124abcd3467b1971751541d51f6122ba",
  "status": { "responseCode": "A00", ... }
}
```

Two references, and the spec says what each is for:

- **`transactionNumber`** — quote this to the *receiving bank* when funds have
  not arrived. Stored as `bankReference`.
- **`jpaReferenceNo`** — looks the transaction up in Jatelindo's own ODS portal.
  Top-level, added in v1.7. Stored as `providerReference`.

### Transaction Status

Request: `traceNumber`. Response mirrors Single Transfer but with
`TransactionStatusResponse[]`, each carrying `transactionState` and
`transactionDate` alongside the same `destinationAccount` block.

---

## 6. What is implemented, and what is not

### Correct

- All four `RequestAuth` variants, verified line-by-line against the collection's
  pre-request scripts
- Basic-auth login, JWT `exp` for token lifetime, token shared across replicas
  through `TokenRedis`
- `application/x-www-form-urlencoded` on every call
- Inquiry and Single Transfer response schemas, including `customerAdmin` and
  top-level `jpaReferenceNo`
- `createTransfer` orchestrating both legs, throwing `UpstreamTransferException`
  with the leg named — see [docs/batch](../batch/settlement-batching.md) for why
  the step and `outcomeUnknown` matter

### Open

| Gap | Where |
|---|---|
| **No status resolution path.** `callback.service.ts` is empty, `JatelindoTransferOtherService` is exported from its barrel but **not registered in `JatelindoModule`**, and the webhook's `confirmWithProvider` switches on MotionPay only | §7 |
| `transactionStatus` validates against `JatelindoBalanceInquiryResponseSchema` and labels its errors `balanceInquiry` | `jatelindo-transfer.other.service.ts` |
| `isUnathorized` reads `data['responseCode']`, but the envelope nests it as `status.responseCode` — so the 401-refresh path never fires | `jatelindo-transfer.auth.service.ts` |
| Credentials reach the logs: the raw `username:password`, its base64, the whole axios response, the bearer token, and `MD5(secret)` twice | same file |
| `send()` spreads `...config` before `headers`, silently dropping any caller-supplied header | same file |
| `TRANSACTION_HISTORY` absent from `JATELINDO_ENDPOINT` | `jatelindo.constant.ts` |
| Bank channel map covers 2 of 142 | same file |

---

## 7. Status resolution — needed regardless of the callback answer

Jatelindo publishes **no callback endpoint** in either collection or in the spec,
and `A01 REQUESTED` with `Need Check = Y` is the documented *normal* response to
an accepted transfer. So the happy path ends with an unresolved payout and an
instruction to poll.

Pending confirmation from Jatelindo on whether a webhook exists at all. But the
polling job is required either way, because **MotionPay needs it too**: its
callbacks are unauthenticated and therefore only triggers, and a callback that
never arrives — dropped, provider outage, our endpoint down during a deploy —
leaves a MotionPay payout PENDING with nothing to resolve it.

Design notes for whenever it is built:

**Not a timestamp-range scan.** A range query re-selects the same rows every run,
needs a separate "last polled" column to avoid hammering a three-day-old PENDING
row every minute, and with two replicas both pods poll the same transaction.
Use the claim pattern already described for settlement runs: a `nextPollAt`
column, claimed with `FOR UPDATE SKIP LOCKED`, pushed forward on each
unresolved attempt.

**Backoff is correctness, not tidiness.** `T40 TRANSACTION_BLOCKED` is "too many
request" — an impatient poller can turn an in-flight payout into a failed one.

**Reuse `confirmWithProvider`.** The webhook service already routes a status
lookup per provider; the poller wants the same routing, not a second copy.

**Give up eventually.** After a bounded number of attempts a payout that will not
resolve is a human problem, not a polling problem — which matches how
reconciliation exceptions are already handled.

This is **not** the settlement batcher, and cannot be folded into it: settlement
claims rows `WHERE status = 'SUCCESS'`, so a PENDING payout is invisible to it.
Status resolution is strictly upstream of settlement. They also sit on opposite
sides of the ledger — settlement promotes payin money to spendable, while a
payout debits.

---

## 8. Environment

```
JATELINDO_TIMEOUT_MS=15000
JATELINDO_TOKEN_SKEW_SECONDS=300
JATELINDO_TRANSFER_BASE_URL=
JATELINDO_TRANSFER_USERNAME=
JATELINDO_TRANSFER_PASSWORD=
JATELINDO_TRANSFER_API_KEY=
JATELINDO_TRANSFER_SECRET=
```

Sandbox values are in `C:\le\andalusia\jatelindo\data untuk mitra non-snap\data
devel JPA NON-SNAP.txt` and in the collection's variables. They are development
credentials against `dev-transferonline.fello.id`, and they are **not** in this
repository — keep it that way.

---

## 9. Questions for Jatelindo

1. **Is there a callback/webhook**, or is `Transaction/Status` the only way to
   resolve `A01`? (§7 — the answer changes how soon the poller is needed, not
   whether.)
2. **Which host serves which endpoint?** Is `10.254.254.12` required for Login /
   Inquiry / SingleTransfer, or does the public host serve all six? (§1)
3. **Transaction Status: `GET` or `POST`, port 14890 or 14991?** The spec and the
   collection disagree. (§1)
4. **Recommended poll interval**, given `T40 TRANSACTION_BLOCKED` is
   rate-limit-driven. (§4)
5. **Is `Transaction History` genuinely unsigned**, or is the collection missing
   its `RequestAuth`? (§2)
6. Production channel IDs — confirm the list is identical to development before
   the bank map is completed.
