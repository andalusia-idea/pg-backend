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

### Banks

74 of our 91 banks are mapped in `JATELINDO_CHANNEL`. The mapping direction
matters: ours is `config.Bank.code` (Indonesian clearing codes, `014` = BCA),
theirs is their own sequence. Unrelated schemes, no formula between them, so
every bank needs a row.

**Every row is a name-based inference, not a verified route.** The two lists use
different naming conventions and sometimes different eras of the same bank, and
nothing here has been exercised against Jatelindo. A missing row fails loudly -
an empty `channelId=` that the provider refuses - while a *wrong* row succeeds
and pays a stranger. So anything ambiguous is left out rather than guessed, and
the whole map wants one verification pass before production.

> **How to verify safely:** the account-inquiry leg is read-only and returns the
> account holder name. An inquiry per channel against a known account confirms
> the route without moving money. Never use `/SingleTransfer` for this.

#### Not mapped, and why

| Our `bankCode` | Our name | Why not |
|---|---|---|
| `129` | BPD Bali | duplicate on THEIR side: 47 and 95 are both "BANK PEMBANGUNAN DAERAH BALI" |
| `212` | WOORI SAUDARA | absent from their list (no WOORI and no SAUDARA entry) |
| `484` | Line Bank | absent from their list (no LINE entry) |
| `485` | MNC INTERNASIONAL | rename: ours is MNC INTERNASIONAL, their only candidate is 62 PT. BANK BUMIPUTERA (Bumiputera -> ICB Bumiputera -> MNC) |
| `490` | Bank Neo Commerce | absent from their list (no NEO COMMERCE entry) |
| `501` | blu by BCA Digital | absent from their list (no blu / BCA Digital entry) |
| `503` | NOBU (NATIONAL NOBU) | absent from their list (no NOBU entry) |
| `523` | SAHABAT SAMPOERNA | absent from their list (no SAMPOERNA entry) |
| `542` | Bank Jago | absent as a conventional bank: their only Jago entry is 30 "BANK JAGO UNIT USAHA SYARIAH" |
| `547` | BTPN Syariah | absent from their list (no BTPN SYARIAH entry) |
| `562` | Superbank | absent from their list (no SUPERBANK entry) |
| `567` | HARDA INTERNASIONAL | rename: ours is HARDA INTERNASIONAL, their only candidate is 74 PT. ALLO BANK INDONESIA (Harda renamed Allo 2021) |
| `949` | CTBC Indonesia | rename: ours is CTBC Indonesia, their only candidate is 67 PT. BANK CHINATRUST INDONESIA (renamed CTBC 2012) |
| `095` | JTRUST | rename: ours is JTRUST, their only candidate is 65 PT. BANK MUTIARA Tbk. (renamed JTrust 2014) |
| `059` | Korea Exchane Bank | rename/merger: ours is Korea Exchane Bank, nearest is 73 BANK HANA (KEB merged into KEB Hana) |
| `022` | CIMB Niaga Syariah | ambiguous on OUR side: our seed labels 022 "CIMB Niaga Syariah", but 022 is the clearing code for CIMB Niaga itself. Their 9 is conventional, 40 is "PT. BANK NIAGA Tbk. SYARIAH" |
| `039` | Credit Agricole Indosuez | absent from their list (no CREDIT AGRICOLE / INDOSUEZ entry) |

The renames are the interesting group: in each case our catalogue carries one
era's name and the spec the other, so the match is probably right - but
"probably" is not good enough for a payout destination.

`022` is the one that is wrong on *our* side. The seed labels it "CIMB Niaga
Syariah", but `022` is the clearing code for CIMB Niaga itself, and the spec
offers both `9` (conventional) and `40` (syariah). Our catalogue has no plain
CIMB Niaga entry at all, which is the real gap.

> Two misspellings in `bank-engine.seed.ts` were found while matching — `451`
> "Bank **Suariah** Indonesia (BSI)" and `116` "BPD Aceh **Suariah**" — and are
> fixed in the seed. Display names only, shown in the dashboard's `BANK`
> dropdown; nothing routes on them.
>
> **An existing database still holds the old spelling.** That seed upserts with
> `update: {}`, on purpose, so re-running it never overwrites a name someone
> corrected by hand — which also means it never corrects one. Any environment
> already seeded needs a one-off statement:
>
> ```sql
> UPDATE "Bank" SET name = 'Bank Syariah Indonesia (BSI)' WHERE code = '451';
> UPDATE "Bank" SET name = 'BPD Aceh Syariah'             WHERE code = '116';
> ```

#### The full channel list, spec v1.7

Transcribed from the PDF, so that this does not have to be done again. **`81` is
absent from the spec** - the table goes 80, then 82. `76` was recovered from a
page break. `1` is Jatelindo's own account, not a destination.

Duplicates to be aware of: `47` and `95` are both BPD Bali, and `75`/`128`
both repeat HSBC's foreign branch alongside `14` for the Indonesian subsidiary.
`76` (BII) and `142` (Maybank Indonesia) are the same bank under two names.

| ID | Name | Our code |
|---|---|---|
| 1 | Fello | — |
| 2 | PT. BANK PERMATA Tbk. | `013` |
| 3 | PT. BANK MANDIRI Tbk. | `008` |
| 4 | PT. BANK CENTRAL ASIA Tbk. | `014` |
| 5 | PT. BNI 1946 (Persero) Tbk. | `009` |
| 6 | PT.BRI (Persero) Tbk. | `002` |
| 7 | PT BANK SYARIAH INDONESIA TBK | `451` |
| 8 | PT. BANK TABUNGAN NEGARA (Persero) | `200` |
| 9 | PT. BANK CIMB NIAGA Tbk. | — |
| 10 | PT BANK DANAMON INDONESIA Tbk | `011` |
| 11 | PT. BANK MEGA Tbk. | `426` |
| 12 | PT. ANZ PANIN BANK | `061` |
| 13 | PT. BANK ARTHA GRAHA INTERNASION | — |
| 14 | PT BANK HSBC INDONESIA | `041` |
| 15 | PT. BANK OCBC NISP Tbk. | `028` |
| 16 | PT. BANK UOB INDONESIA | `023` |
| 17 | PT. BANK TABUNGAN PENSIUNAN NASIONAL | `213` |
| 18 | PT. BANK MUAMALAT INDONESIA | `147` |
| 19 | PT. BUKOPIN | `441` |
| 20 | PT. BANK MANDIRI TASPEN | — |
| 21 | PT. BANK BCA SYARIAH | `536` |
| 22 | PT. Bank Panin Syariah | `517` |
| 23 | PT. BANK SYARIAH MEGA INDONESIA | `506` |
| 24 | PT BANK MAYBANK SYARIAH INDONESI | — |
| 25 | PT BANK ALADIN SYARIAH Tbk | `947` |
| 26 | PT. BPD NTB SYARIAH | — |
| 27 | PT BANK SYARIAH BUKOPIN | `521` |
| 28 | PT. BANK VICTORIA SYARIAH | — |
| 29 | PT. Bank Aceh Syariah | `116` |
| 30 | PT. BANK JAGO UNIT USAHA SYARIAH | — |
| 31 | PT. BANK PERMATA Tbk. SYARIAH | — |
| 32 | PT BANK DANAMON Tbk SYARIAH | — |
| 33 | PT. BTN (Persero) SYARIAH | — |
| 34 | PT. BPD DKI JAKARTA SYARIAH | — |
| 35 | PT. BANK JABAR BANTEN SYARIAH | `425` |
| 36 | BPD JATENG SYARIAH | — |
| 37 | BPD JATIM SYARIAH | — |
| 38 | PT BPD KALIMANTAN BARAT SYARIAH | — |
| 39 | BPD KALIMANTAN SELATAN SYARIAH | — |
| 40 | PT. BANK NIAGA Tbk. SYARIAH | — |
| 41 | PT BANK OCBC NISP TBK. SYARIAH | — |
| 42 | PT BPD SUMSEL DAN BABEL SYARIAH | — |
| 43 | PT BPD SUMUT SYARIAH | — |
| 44 | PT. BANK SINARMAS SYARIAH | — |
| 45 | PT BANK SULSELBAR SYARIAH | — |
| 46 | PT. BPD DIY SYARIAH | — |
| 47 | PT. BANK PEMBANGUNAN DAERAH BALI | — |
| 48 | THE ROYAL BANK OF SCOTLAND N.V. | — |
| 49 | PT. AGRONIAGA BANK | — |
| 50 | PT. BANK AKITA | — |
| 51 | PT. BANK ARTOS INDONESIA | — |
| 52 | PT. BANK KESAWAN | — |
| 53 | PT. BANK BUMI ARTA | — |
| 54 | PT. BANK BNP PARIBAS INDONESIA | `057` |
| 55 | BANK OF AMERICA , NA | `033` |
| 56 | BANK OF SCOTLAND PLC | — |
| 57 | MUFG BANK LTD | `042` |
| 58 | THE BoT MITSUBISHI UFJ LTD. | — |
| 59 | PT. BANK RESONA PERDANIA | `047` |
| 60 | PT. BANK HS 1906 | — |
| 61 | BPD SUMSEL DAN BABEL | `120` |
| 62 | PT. BANK BUMIPUTERA | — |
| 63 | PT. BANK BISNIS INTERNATIONAL | — |
| 64 | JPMORGAN CHASE BANK, NA | `032` |
| 65 | PT. BANK MUTIARA Tbk. | — |
| 66 | CITIBANK NA | — |
| 67 | PT. BANK CHINATRUST INDONESIA | — |
| 68 | PT. BANK DBS INDONESIA | `046` |
| 69 | DEUTSCHE BANK AG | `067` |
| 70 | PT. BANK FAMA INTERNATIONAL | — |
| 71 | PT. BANK AGRIS | — |
| 72 | PT. BANK GANESHA | `161` |
| 73 | BANK HANA | — |
| 74 | PT. ALLO BANK INDONESIA, TBK | — |
| 75 | THE HONGKONG AND SHANGHAI BC (HSBC) | — |
| 76 | PT. BII Tbk. | — |
| 77 | PT. BANK ICBC INDONESIA | `164` |
| 78 | PT. BANK SBI INDONESIA | — |
| 79 | PT. BANK INA PERDANA | `513` |
| 80 | PT. BANK JASA JAKARTA | — |
| 82 | PT Bank Dinar Indonesia Tbk | — |
| 83 | PT.ANGLOMAS INTERNATIONAL BANK | — |
| 84 | LLOYDS BANK PLC | — |
| 85 | INDONESIA EXIMBANK | — |
| 86 | PT. BANK MASPION INDONESIA | `157` |
| 87 | PT. BANK MAYAPADA | `097` |
| 88 | PT. BANK MAYORA INDONESIA | `553` |
| 89 | BANK CHINA CONSTRUCTION BANK IND | `036` |
| 90 | PT. BANK MESTIKA DHARMA | — |
| 91 | PT BANK SHINHAN INDONESIA | — |
| 92 | PT. BANK MITRANIAGA | — |
| 93 | PT. BANK MIZUHO INDONESIA | `048` |
| 94 | PT. BANK NUSANTARA PARAHYANGAN | — |
| 95 | PT. BANK PEMBANGUNAN DAERAH BALI | — |
| 96 | PT. BPD BANTEN, Tbk | `137` |
| 97 | PT. BPD BENGKULU | `133` |
| 98 | PT.BANK PEMBANGUNAN DAERAH PAPUA | `132` |
| 99 | PT. BANK JABAR DAN BANTEN | `110` |
| 100 | PT. BPD JAWA TENGAH | `113` |
| 101 | PT.BANK PEMBANGUNAN DAERAH JAMBI | `115` |
| 102 | BPD JATIM | `114` |
| 103 | PT.BPD KALIMANTAN BARAT | `123` |
| 104 | PT. BPD KALTENG | `125` |
| 105 | BPD KALIMANTAN SELATAN | `122` |
| 106 | PT.BPD KALTIM DAN KALTARA | `124` |
| 107 | BPD LAMPUNG | `121` |
| 108 | PT. BPD MALUKU DAN MALUKU UTARA | `131` |
| 109 | PT. BANK PEMBANGUNAN DAERAH NTB | `127` |
| 110 | BPD NUSA TENGGARA TIMUR | `130` |
| 111 | PT.BANK PEMBANGUNAN DAERAH RIAU | `119` |
| 112 | BPD SUMATERA BARAT | `118` |
| 113 | BPD SUMATERA UTARA | `117` |
| 114 | PT.BPD SULAWESI TENGAH | `134` |
| 115 | PT.BPD SULAWESI TENGGARA | `135` |
| 116 | PT BPD SULAWESI SELATAN | `126` |
| 117 | BPD SULAWESI UTARA | `128` |
| 118 | PT. BANK PEMBANGUNAN DAERAH DIY | `112` |
| 119 | PT. BANK PAN INDONESIA Tbk. (PAN | `019` |
| 120 | PT. BANK PURBA DANARTA | — |
| 121 | PT BANK RABOBANK INTERNATIONAL | — |
| 122 | PT. BANK ROYAL INDONESIA | — |
| 123 | PT. BANK SINARMAS | `153` |
| 124 | STANDARD CHARTERED BANK | `050` |
| 125 | PT BANK SEABANK INDONESIA | `535` |
| 126 | PT. BANK SWADESI Tbk. | — |
| 127 | PT. BII Tbk. SYARIAH | — |
| 128 | THE HONGKONG AND SHANGHAI BC (HS | — |
| 129 | PT.BPD KALTIM DAN KALTARA UUS | — |
| 130 | BPD SUMATERA BARAT UUS | — |
| 131 | WISE EUROPE S A | — |
| 132 | PT. BANK VICTORIA INTERNATIONAL | `566` |
| 133 | PT. BANK YUDHA BHAKTI | — |
| 134 | PT. BANK DIPO INTERNATIONAL | — |
| 135 | PT. BPD DKI JAKARTA | `111` |
| 136 | PT. BANK COMMONWEALTH | `950` |
| 137 | PT. BANK INDEX SELINDO | `555` |
| 138 | Bank of China (Hongkong) Limited | `069` |
| 139 | THE BANGKOK BANK PCL | `040` |
| 140 | PT. BANK MULTI ARTA SENTOSA TBK | — |
| 141 | PT. BANK CAPITAL INDONESIA | `054` |
| 142 | PT. Bank Maybank Indonesia | `016` |

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
| **No status resolution path.** `callback.service.ts` is empty and the webhook's `confirmWithProvider` switches on MotionPay only | §7 |
| `TRANSACTION_HISTORY` absent from `JATELINDO_ENDPOINT` | `jatelindo.constant.ts` |
| Bank channel map: 74 of our 91 mapped, and **none of them verified against Jatelindo** — 17 unmapped with reasons in §3 | same file |

### Closed

| Was | Fixed by |
|---|---|
| Credentials in the logs: the raw `username:password`, its base64, the whole axios response, the bearer token, and `MD5(secret)` twice | removed; the "token acquired" line keeps `expiresAt` only |
| `E99` → CANCELLED and `E18` → EXPIRED, both terminal on a `SUSPECT` outcome | both → `PENDING`; `T18`/`T16`/`A90` → `FAILED`; unknown codes → `PENDING` |
| E-wallet `channelId` sent as the wallet's name | the 90x block from spec v1.6 |
| Bank channel map covered 2 of 142 | 74 of our 91 banks transcribed from spec v1.7, with the full 141-row list in §3 so it need not be done again |
| `isUnathorized` read `data['responseCode']` — one level too shallow, and it crashed on a body-less response | reads `status.responseCode`, guards the body, and also accepts a real HTTP 401 |
| The refresh path could not fire **at all**: it only ran in a `catch`, and A90 arrives in a 200 | `send()` now raises an internal signal when it sees A90 in a successful envelope, so both arrival shapes take the one retry path |
| `send()` spread `...config` before `headers`, dropping caller headers | headers merged; `Content-Type` overridable, `APIKey`/`Authorization`/`RequestAuth` and `baseURL` are not |
| `JatelindoTransferOtherService` not registered in `JatelindoModule` | registered and exported |
| `transactionStatus` validated against the *balance* schema, under the *balance* label, over **GET** | validates `JatelindoTransactionStatusResponseSchema`, labels itself, and POSTs — the two shapes share no field, so the method could not return at all |

Covered by `jatelindo-transfer.auth.service.spec.ts`, which asserts the call
*count* and which token each attempt carries — the original bug was a silent
no-op, and only those assertions catch its return.

> **Worth confirming with Jatelindo** (add to §9): whether a refused or expired
> session token comes back as a 200 envelope carrying `A90`, as an HTTP 401, or
> both. The spec lists A90 in the response-code table and never mentions a 401
> anywhere, so the implementation handles both shapes rather than guess. The
> answer decides whether the 401 branch is dead code or the main path.

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

**`transactionState` is not a response code.** The status response carries two
unrelated verdicts, and conflating them is the easy mistake:

| Field | Says | Vocabulary |
|---|---|---|
| `status.responseCode` | whether the *lookup* worked | `A00`, `S84`, … — §4's table |
| `TransactionStatusResponse[].transactionState` | what happened to the *payout* | `PROCESSED`, … — its own set |

So `A00` on a status call means "we found your transaction", not "the payout
succeeded". **Do not put `transactionState` through
`jatelindoMapperResponseCode`** — it needs its own map, and that map's values
have not been enumerated yet, which is one of §9's questions. `S84
NO_TRANSACTION` on a lookup is the useful terminal signal: Jatelindo has no
record of it, so a payout we left PENDING never reached them.

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

0. **What are the possible values of `transactionState`?** Only `PROCESSED`
   appears in the spec's example, and the status call cannot resolve a payout
   without the complete set — in particular which values are terminal failures
   and which mean "still in flight".

1. **Is there a callback/webhook**, or is `Transaction/Status` the only way to
   resolve `A01`? (§7 — the answer changes how soon the poller is needed, not
   whether.)
2. **Which host serves which endpoint?** Is `10.254.254.12` required for Login /
   Inquiry / SingleTransfer, or does the public host serve all six? (§1)
3. **Transaction Status: `GET` or `POST`, port 14890 or 14991?** The spec
   disagrees with *itself*: the Configuration block says `Method GET`, while the
   Request Example immediately below is `--data-urlencode` — a POST — and both
   collections POST it. **We implement POST**, following the two artifacts over
   the table. If they confirm GET, the `traceNumber` has to move to the query
   string; changing the method alone would send an empty request. (§1)
4. **Recommended poll interval**, given `T40 TRANSACTION_BLOCKED` is
   rate-limit-driven. (§4)
5. **Is `Transaction History` genuinely unsigned**, or is the collection missing
   its `RequestAuth`? (§2)
6. Production channel IDs — confirm the list is identical to development before
   the bank map is completed.
