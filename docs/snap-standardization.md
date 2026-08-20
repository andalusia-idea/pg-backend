# SNAP Standardization — Technical Guidance

Status: **research/guidance only — no SNAP-related code has been written.** Last reviewed 20 Aug 2026 — §3's licensing/scope questions are now resolved and cross-checked against the live MotionPay integration. This document synthesizes everything in [`docs/aspi-snap/`](aspi-snap) into one reference for standardizing manapay's transactional APIs toward SNAP compliance. It's meant to be read now for orientation and re-read later as the actual implementation phases start.

Every claim below traces back to one of the 9 source PDFs. Where the sources are ambiguous, contradict each other, or seem to contain a documentation error, that's called out explicitly rather than papered over — verify those specific points empirically (with a partner bank/PSP, or against the live ASPI portal) before building on them.

---

## 1. TL;DR

- **SNAP** (Standar Nasional Open API Pembayaran) is Bank Indonesia's mandatory Open API standard for payment-system interoperability, established 16 Aug 2021, now administered day-to-day by **ASPI** (handover from BI, 1 Sept 2023). It standardizes *how PJSPs call each other's APIs* — auth, signing, headers, data shapes, error codes — for account/balance/transfer/QR/direct-debit style services.
- **The 3 "buletin" PDFs are not SNAP documents.** They're ASPI's QRIS MPM bulletins (2020–2021), a separate, earlier BI/ASPI QR-payment standard. Still relevant to manapay (it already supports QRIS), but track it as a second, independent compliance surface, not folded into SNAP.
- **§3's licensing question is resolved: manapay is a Merchant Aggregator (MA), not a licensed PJP** — it operates downstream under partner PJP licenses (a **Non-PJP Pengguna Layanan**, in the governance doc's vocabulary), aggregating small merchants (toko kelontong, toko elektrik, warung) onto a partner's already-licensed rails rather than holding its own.
- **The SNAP-relevant relationship is manapay ↔ its upstream PJP partner, in both directions** (manapay's outbound calls *and* the upstream's inbound notify/webhook calls back) — not manapay's own merchant-facing API, which is very likely outside SNAP's scope entirely (a merchant isn't a PJSP). See §3.2 for the reasoning.
- **The current (and only) upstream, MotionPay/Flash Mobile, is not SNAP-compliant today** — confirmed against its live integration ([docs/upstream/motionpay.md](upstream/motionpay.md)): proprietary body-based auth, three inconsistent response envelopes across its own products, no request signing, and a payout callback with **no authentication at all**. SNAP prep doesn't reduce any current MotionPay work — it only pays off once a SNAP-compliant upstream actually exists. See §3.3–§4.1.
- **When that becomes relevant, SNAP compliance is mostly a new provider-integration module**, not a rewrite of manapay's core business logic — it would sit alongside the existing per-provider upstream pattern (`apps/transaction/src/upstream/*`) as one more provider implementation, just one that happens to follow a standardized shape instead of a bespoke one like MotionPay's.
- **Real DB/schema impact exists but is additive**, not a rewrite: a merchant/sub-merchant/store/terminal hierarchy SNAP expects that manapay's current `Merchant`/`Agent` model doesn't have; a per-day-unique external-reference-ID concept alongside the existing transaction code-format key; storing RSA keypairs + HMAC client secrets per counterparty; and a response envelope shape (`responseCode`/`responseMessage`) to normalize into or wrap around.
- **No SNAP "Settlement API" exists.** Bank Statement + Transaction History are the closest thing (reconciliation feeds), confirmed by full-text search of the 585-page data spec doc. Manapay's own settlement/balance-ledger logic stays manapay's own problem — SNAP doesn't replace it, it just standardizes the wire format for the transfer/QR/VA calls that feed it.
- **This is a future workstream, sequenced behind the current monorepo migration** — nothing here blocks the phased migration plan already in progress ([plan-claude.md](plan-claude.md)). Treat this doc as the reference to come back to when that's far enough along to start on SNAP.

---

## 2. What SNAP actually is, and what's in `docs/aspi-snap/`

| File | Actual title | Version / date | Covers |
|---|---|---|---|
| `SNAP_StandarTeknisKeamanan.pdf` | Standar Teknis dan Keamanan (Technical & Security Standard) | **v1.0.2, Sept 2024** | Auth model, signature schemes, headers, TLS, token lifecycle, key management, WAF/FDS/BCP requirements |
| `SNAP_StandarDataSpesifikasiTeknis.pdf` | Standar Data dan Spesifikasi Teknis (Data Spec Standard) | **v1.0.2, Sept 2024** | The actual API catalog — 5 categories / 22 APIs / ~81 sub-APIs, full request/response field tables, response code table |
| `SNAP_Pedoman_Tata_Kelola.pdf` | Pedoman Tata Kelola (Governance Guideline) | **v1.0, 16-08-2021** | Consumer protection, data protection, due-diligence/onboarding, contract clauses between parties |
| `Guideline Uji Penggunaan Developer Site.pdf` | Pedoman Penggunaan Developer Site | v1.1, Jan 2026 | How to register/use ASPI's sandbox portal |
| `Guideline Uji Verifikasi.pdf` | *(actual title differs)* Pedoman Pengajuan Permohonan Surat Rekomendasi SNAP | v1.0.1, June 2026 | The certification/verification submission process |
| `Skenario Pengujian.pdf` | Skenario Pengujian | — | 1-page stub; links out to an external `.xlsx` (not retrieved — see §9) |
| `buletin_september2020.pdf` | Buletin No.1 — merchant/amount validation | Sep 2020 | **QRIS MPM, not SNAP** |
| `buletin_november2020.pdf` | Buletin No.2 — transaction notification | Nov 2020 | **QRIS MPM, not SNAP** |
| `buletin_QRIS_MPM_00321_rev.pdf` | Buletin 3/III/2021 — QRIS MPM display standard | 1 Mar 2021 | **QRIS MPM, not SNAP** |

**Note the governance doc is 3 years older than the two technical standards**, and predates ASPI's Sept 2023 takeover from BI. It still refers to "Bank Indonesia" throughout as the report/notification recipient — that routing may now practically run through ASPI instead. Confirm current routing directly with ASPI rather than assuming the 2021 text is still procedurally accurate; the substantive obligations (consent, breach notification, contract clauses) are unlikely to have changed even if the addressee has.

**QRIS MPM is a separate, still-live compliance track.** None of the 3 bulletins mention SNAP; SNAP launched 5–12 months after the latest of them. If manapay's QRIS support needs to stay current, that means periodically checking ASPI's QRIS MPM bulletin series independently of SNAP — they're administered by the same body (ASPI) but are different standards with different document sets. Useful facts already extracted from the bulletins (§8 below) are worth keeping even though they're off the SNAP track.

---

## 3. Business/legal position (confirmed 20 Aug 2026)

The three open questions from the original research pass are now answered directly by the business.

### 3.1 Licensing status: manapay is a Merchant Aggregator (MA), not a licensed PJP

Manapay does not hold, and isn't pursuing, its own Bank Indonesia PJP license. It operates as a **downstream party under one or more partner PJP licenses** — in the governance doc's vocabulary, manapay is a **Non-PJP Pengguna Layanan**, and its upstream partner (currently MotionPay/Flash Mobile) is the **Penyedia Layanan**.

The business model: manapay aggregates many small, typically bank-underserved merchants (toko kelontong, toko elektrik, warung) that a PJP wouldn't cost-effectively onboard and manage one-by-one, and routes their transactions through the partner PJP's already-licensed rails. Mutually beneficial: the partner PJP gets indirect reach into a merchant segment it doesn't want to manage directly, and manapay gets access to licensed payment rails without carrying the licensing burden itself.

**Implication for §10 (certification path)**: per how that process is actually described in the guideline docs, it's the **Penyedia Layanan** who applies for the Surat Rekomendasi via SILA, naming its Pengguna Layanan — bulk/mixed submissions explicitly support naming multiple service users in one package. Manapay likely doesn't pursue certification independently; it's named inside its upstream partner's submission. Worth confirming directly with the partner rather than assuming, but nothing in the docs suggests a Non-PJP Pengguna Layanan certifies on its own.

### 3.2 Which relationship actually needs to speak SNAP

Manapay has three distinct API relationships, and they don't all carry the same SNAP obligation:

1. **Manapay calling the upstream PJP** (e.g. Create QRIS Payment, Fund Transfer) — outbound requests, signed per §5.2 if/when the upstream is SNAP-compliant.
2. **The upstream PJP calling manapay back** (SNAP's `*-notify` endpoints — QR MPM Payment Notify, VA Payment Notify, etc.) — this is *part of the same Pengguna-Layanan relationship as (1)*, not a separate question. If an upstream is SNAP-compliant, manapay needs a receiver for these too, verifying whatever signature the upstream sends and acknowledging with `responseCode`/`responseMessage` (§7). "Outbound client" doesn't mean manapay never runs a server endpoint for this integration — it does, just scoped to the specific notify contract SNAP defines, not a general-purpose API.
3. **Manapay's own Public API to its merchants** — a genuinely separate question. SNAP's documents define roles for *Penyedia Layanan*, *PJP Pengguna Layanan*, *Non-PJP Pengguna Layanan*, and *Konsumen*; a merchant using manapay's platform doesn't fit cleanly into any of those. SNAP governs interoperability between PJSPs/payment-system participants — a toko kelontong accepting QRIS through manapay reads as manapay's own commercial customer, not a party to a regulated Open-API relationship. **This is my own inference from the roles as defined, not something the SNAP documents state outright** — worth a direct confirmation from the upstream partner or legal counsel, but on current evidence, manapay's merchant-facing Public API is manapay's own design choice, not something SNAP's technical standard mandates the shape of.

Net: **§5 and §7's SNAP-shaped work applies to (1) and (2) together** — both sides of the manapay↔upstream-PJP relationship. (3), the merchant-facing API, can stay whatever shape best serves manapay's own product.

### 3.3 Scope is bounded by the upstream, not by manapay's roadmap

Per the business: today's only upstream is **MotionPay (Flash Mobile)**, and its offering is **QRIS, TransferBank, EMoney, and Biller**. That's the real ceiling on which SNAP sub-APIs would ever matter for this integration specifically — no amount of manapay-side engineering effort makes Virtual Account or Interbank Bulk relevant if the upstream never exposes them.

And separately: MotionPay's *live* API for what it does expose is a proprietary Flash Mobile format, not SNAP-shaped at all (§4.1). So "scope bounded by the upstream" cuts two ways — it bounds what SNAP work would ever be *worth* doing, and it means none of that work applies to today's MotionPay integration. It's only relevant once a SNAP-compliant upstream (a different partner, or a future SNAP-compliant version of MotionPay) enters the picture.

### 3.4 What's already in the codebase (grounding, not new information)

Per the business, and consistent with what's in the schema: manapay stores `Merchant` and `Agent` records, connects them to upstream providers (`ProviderNameEnum`, now including `MOTIONPAY`), and calculates a profit split across four parties on every transaction — merchant, agent, manapay itself, and the upstream provider — via `BaseFee`/`MerchantFee` in `apps/config`. Any SNAP-routed transaction would need to feed the same fee-split logic; SNAP doesn't change that calculation, only the wire format of the calls that produce the transaction data feeding into it (consistent with §6/§7's "additive, not a rewrite" framing).

None of this blocks the technical prep work in §5–§6, but it determines how far that work eventually needs to go — and, per §3.3, that it isn't worth starting until a SNAP-compliant upstream is actually on the table.

---

## 4. Mapping manapay's current product onto SNAP's API catalog

SNAP organizes ~81 sub-APIs into 5 categories (Registrasi, Informasi Saldo, Riwayat Transaksi, Transfer Kredit, Transfer Debit). Cross-referencing against manapay's existing `PaymentMethodNameEnum` / `TransactionTypeEnum` (in `libs/microservice/src/microservice.enum.ts`):

> **Read this as SNAP's generic taxonomy, not as what MotionPay actually offers today.** MotionPay's live API (§4.1, and [docs/upstream/motionpay.md](upstream/motionpay.md)) is a proprietary Flash Mobile format with no SNAP shape at all — none of the sub-APIs below are actually callable in SNAP's form against MotionPay right now. This mapping is for whenever a SNAP-compliant upstream is in scope.

| Manapay concept | Closest SNAP sub-API(s) | Category | Notes |
|---|---|---|---|
| `PaymentMethodNameEnum.QRIS` — purchase | **API QR MPM** (Generate, Decode, Payment Host-to-Host, Query, Notify, Cancel, Refund — 8 sub-APIs) | Transfer Kredit §4.3.5 | This is SNAP's actual "payment gateway" bundle — closest match to a merchant-facing QRIS checkout flow. |
| `PaymentMethodNameEnum.VIRTUALACCOUNT` — purchase | **API Virtual Account** (Create/Update/Delete VA, Inquiry, Payment, Status, Notify, Get Report — 12 sub-APIs) | Transfer Kredit §4.2.2.7 | Largest single sub-API group in the whole spec (p.191–319). `Get Report` doubles as your VA-collections reconciliation feed. |
| `PaymentMethodNameEnum.TRANSFERBANK` — purchase/disbursement | **Intrabank Transfer** / **Interbank Transfer** (+ **Bulk** variant) | Transfer Kredit §4.2.2.2/.4 | Bulk variant (`bulkObject[]` array + its own `-notify` webhook) is the batch-payout path if disbursement ever needs many recipients per call. |
| `PaymentMethodNameEnum.DIRECTEWALLET` / `TRANSFEREWALLET` | **Customer Top Up** + **Account Inquiry**, or **Transfer to Bank** if paying an e-wallet's linked bank account | Transfer Kredit §4.3.1/.3 | Directionality (push-in vs pull/payout) needs a case-by-case check per e-wallet partner — SNAP's Customer Top Up is written from the *issuer's* perspective. |
| `TransactionTypeEnum.WITHDRAW` / `DISBURSEMENT` | **Transfer to Bank** (Account Inquiry + Payment), **Interbank Transfer(+Bulk)**, **Transfer to OTC** (cash pickup) | Transfer Kredit §4.3.3/.4, §4.2.2.4 | `Transfer to Bank` (svc 42/43) is the cleanest match for "pay out from an e-money balance to a bank account." |
| `TransactionTypeEnum.TOPUP` | **Customer Top Up**, **Bulk Cash In** | Transfer Kredit §4.3.1/.2 | |
| `TransactionTypeEnum.SETTLEMENT_PURCHASE` | **No dedicated SNAP API.** Closest: **Bank Statement** + **Transaction History** (reconciliation feeds only) | Riwayat Transaksi §3 | Confirmed gap, not a research miss — full-text search of the 585-page spec found no settlement/netting API. Real inter-PJP settlement happens over BI-RTGS/SKNBI/BI-FAST outside Open API scope. **manapay's own settlement/balance-ledger logic is not replaced by SNAP** — SNAP only standardizes the transfer/QR/VA call shapes that feed into it. |
| Balance check (any flow) | **Balance Inquiry** | Informasi Saldo §2 | Explicitly wallet-agnostic — response `balanceType` supports named sub-balances (the spec's own examples: `"Balance"`, `"Ovo Cash"`, `"Shopee Coins"`). |
| Registration/card-on-file (not currently a manapay feature) | **API Card Registration**, **API Account Registration** (11 sub-APIs total) | Registrasi §1 | Lower priority unless tokenized/repeat-payment support is planned. |
| Recurring/subscription debits (not currently a manapay feature) | **API Direct Debit BI-FAST** (e-Mandate) | Transfer Debit §5.2.4 | Newer BI-FAST rail; worth a dedicated look only if recurring billing becomes a product requirement. |

**Full endpoint reference for the sub-APIs above** (paths are relative; real requests are `{base}/{version}/...`, e.g. `/api/v1.0/balance-inquiry` per the sandbox worked example):

| Sub-API | Method | Path |
|---|---|---|
| Balance Inquiry | POST | `/balance-inquiry` |
| VA – Inquiry / Payment / Status | POST | `/transfer-va/inquiry`, `/payment`, `/status` |
| VA – Create / Update / Delete | POST/PUT/DELETE | `/transfer-va/create-va`, `/update-va`, `/delete-va` |
| VA – Payment Notification (webhook) | POST | `/transfer-va/notify-payment-intrabank` |
| VA – Get Report | GET | `/transfer-va/report` |
| QR MPM – Generate / Decode | POST | `/qr/qr-mpm-generate`, `/qr-mpm-decode` |
| QR MPM – Payment (Host-to-Host) | POST | `/qr/qr-mpm-payment` |
| QR MPM – Query / Cancel / Refund | POST | `/qr/qr-mpm-query`, `/qr-mpm-cancel`, `/qr-mpm-refund` |
| QR MPM – Payment Notification (webhook) | POST | `/qr/qr-mpm-notify` |
| Interbank Transfer (single / bulk) | POST | `/transfer-interbank`, `/transfer-interbank-bulk` |
| Transfer to Bank – Account Inquiry / Payment | POST | `/emoney/bank-account-inquiry`, `/emoney/transfer-bank` |
| Customer Top Up – Inquiry / Top Up / Status | POST | `/emoney/account-inquiry`, `/emoney/topup`, `/emoney/topup-status` |
| Bulk Cash In – Submit / Notify | POST | `/emoney/bulk-cashin-payment`, `/bulk-cashin-notify` |
| Bank Statement | POST | `/bank-statement` |
| Transaction Status Inquiry (credit / QR-emoney) | POST | `/transfer/status`, `/qr/qr-mpm-status` |

(The remaining ~50 sub-APIs — RTGS/SKNBI transfer, QR CPM, Direct Debit, Auth Payment, most of Registration — are cataloged in the source PDF but weren't deep-dived since they don't currently map to manapay's product surface. Pull them from `SNAP_StandarDataSpesifikasiTeknis.pdf` directly if that changes.)

### 4.1 Against today's actual upstream (MotionPay)

Per the business, MotionPay currently offers **QRIS, TransferBank, EMoney, and Biller** — narrower than, and not fully aligned with, manapay's own `PaymentMethodNameEnum` (which also has `VIRTUALACCOUNT`, not currently offered by MotionPay at all):

| MotionPay service | Coded in `apps/transaction/src/upstream/motionpay/`? | Notes |
|---|---|---|
| QRIS (pay-in) | **Yes** — auth, create payment, status. | Sandbox blocked on a merchant PTEN-registration issue as of the last integration note ([docs/upstream/motionpay.md](upstream/motionpay.md) §7) — not a code problem. |
| TransferBank (payout) | **Yes** — auth, account inquiry, fund transfer, status, balance. | Sandbox blocked on IP whitelisting as of the last integration note (§11.1). Already silently covers e-wallet payouts too — GOPAY/OVO/DANA/SHOPEEPAY/LINKAJA share the same `bank_code` namespace as banks (`motionpay-bank-code.constant.ts`). |
| EMoney | **Not yet coded.** No `motionpay-emoney.*` module exists. | Closest conceptual overlap with manapay's `DIRECTEWALLET`/`TRANSFEREWALLET` — but the Transfer e-wallet payout support above may already cover part of this without a separate module. |
| Biller | **Not yet coded**, and not currently in manapay's own `PaymentMethodNameEnum` either. | No single clear SNAP sub-API surfaced for bill-payment/PPOB-style products in the sections deep-dived so far — worth a dedicated look at `SNAP_StandarDataSpesifikasiTeknis.pdf` if this becomes a near-term priority. |
| VirtualAccount (in manapay's own enum) | N/A | Not among MotionPay's stated services — either a future upstream would need to supply this, or it's not currently reachable through any live provider. |

This doesn't change anything already built — it's the current boundary of what's real vs. aspirational, kept next to the SNAP mapping so the two don't get conflated. It's also worth registering as a standalone fact regardless of SNAP: MotionPay's own Transfer callback has no authentication mechanism at all (§7 below), and its documentation carries several self-contradictions (token TTL, field-length limits, host URLs) worked around empirically in [docs/upstream/motionpay.md](upstream/motionpay.md) — a preview of the kind of per-provider documentation risk SNAP's standardization is meant to reduce, once a partner actually implements it.

---

## 5. Security & auth architecture

This is the part of SNAP that's a genuinely new architectural layer, not a data-shape tweak — and it applies specifically to the manapay↔upstream-PJP relationship (both manapay's outbound calls and the upstream's inbound notify calls back, §3.2), not to manapay's own merchant-facing API. Two independent signature schemes are involved, used in different places:

### 5.1 Token acquisition (once per session, not per-transaction)

- **OAuth 2.0, `client_credentials` grant** (RFC 6749/6750). `POST {base}/{version}/access-token/b2b`.
- Signed with **`SHA256withRSA`** over `stringToSign = client_ID + "|" + X-TIMESTAMP`, using manapay's **RSA private key**.
- Headers: `X-TIMESTAMP` (ISO-8601 + offset, e.g. `2020-12-17T10:55:00+07:00`), `X-CLIENT-KEY` (= client ID), `X-SIGNATURE`.
- Response: opaque `accessToken` (String ≤2048), `tokenType: "Bearer"`, `expiresIn: 900` (**15 minutes** — confirmed by two independent sources: the security standard doc and a live worked sandbox example). No refresh mechanism for the B2B flow — just re-request on expiry.
- There's a separate B2B2C flow (`AUTHORIZATION_CODE`/`REFRESH_TOKEN` grants, `/access-token/b2b2c`) for consumer-consented access — likely not needed unless manapay ever acts on an individual end-customer's behalf rather than a merchant's.

### 5.2 Per-transaction signing (every API call after token issuance)

Default scheme ("Type 1 — Symmetric, with token"), signed with **`HMAC_SHA512`** using the **shared `clientSecret`** established during onboarding:

```
stringToSign = HTTPMethod + ":" + EndpointUrl + ":" + AccessToken + ":"
             + lowercase(hex(SHA256(minify(RequestBody)))) + ":" + TimeStamp

X-SIGNATURE = HMAC_SHA512(clientSecret, stringToSign)
```

`EndpointUrl` is the full relative path incl. query params; `minify(RequestBody)` is `""` if there's no body. An alternate asymmetric variant ("Type 2") exists that skips the token call entirely and signs with the RSA private key instead — same formula minus the `AccessToken` segment.

### 5.3 Required headers (transaction calls)

| Header | Required | Notes |
|---|---|---|
| `Content-Type` | Mandatory | `application/json` |
| `Authorization` | Conditional/Mandatory* | `Bearer <accessToken>` |
| `X-TIMESTAMP` | Mandatory | ISO-8601 + offset |
| `X-SIGNATURE` | Mandatory | Per §5.2 |
| `X-PARTNER-ID` | Mandatory | String ≤36 |
| `X-EXTERNAL-ID` | Mandatory | String ≤36; **must be unique per calendar day** — this is SNAP's idempotency/replay defense (see §6) |
| `CHANNEL-ID` | Mandatory | String ≤5 |
| `ORIGIN` | Optional | Some examples in the data-spec doc use `X-ORIGIN` instead — inconsistent in the source, verify with your counterparty which one they expect |

\* Listed as Conditional in the B2B header table, Mandatory in the B2B2C table — treat as mandatory.

For B2B2C flows, also: `Authorization-Customer`, `X-DEVICE-ID` (mandatory), `X-IP-ADDRESS`/`X-LATITUDE`/`X-LONGITUDE` (optional).

### 5.4 Transport & key management

- **TLS 1.3 required.** TLS 1.2 permitted only as a fallback with 4 specific AES-GCM cipher suites, and **only until 30 June 2026 per the document — a deadline that had already passed when this doc was written (12 Aug 2026).** Worth confirming with ASPI/a partner bank whether that sunset was extended, since if not, TLS 1.2 fallback for SNAP traffic may no longer be spec-compliant at all.
- **No mTLS requirement.** SNAP's mutual-trust model is the application-layer signature scheme above, not client TLS certificates. This is a **separate concern from [docs/tls.md](tls.md)**, which covers manapay's *internal* inter-service TCP traffic — don't conflate the two; SNAP's TLS 1.3 requirement applies specifically to the external channel to SNAP counterparties.
- **Key generation**: RSA keypair, PKCS#1 PEM format is the de facto convention used by real SNAP integrators (BRI, Espay) even though the ASPI PDF itself never states a format explicitly. The PDF states key size as "256 bits," which is almost certainly a documentation error for **2048-bit** — every real-world implementer reference found says RSA-2048.
- **Only the public key is ever transmitted** (private keys stay local, generated and held by each party) — sent to the counterparty via encrypted email (password-protected ZIP w/ split-channel password, PGP, or OpenSSL-encrypted) or through their portal, during bilateral onboarding. Not a self-service API call.
- Required key-management capabilities per the standard: access-controlled storage, documented create/renew/delete procedures, standards-recommended algorithms, clear key versioning, and support for usage monitoring/audit. No mandated rotation interval is specified.
- **Architectural implication**: manapay will need per-counterparty storage for an RSA keypair + a shared `clientSecret`, analogous to (but distinct from) whatever credential storage exists today for Inacash/PDN/Pakaidonk API keys — this is a natural fit for `libs/configuration`-managed, env/secret-store-backed config, not hardcoded values (the existing legacy-code audit already flagged hardcoded provider credentials as a security gap to fix regardless of SNAP).

### 5.5 Operational security requirements (beyond the wire protocol)

Stated as requirements on both parties in the security standard, not the governance doc:

- **Mandatory Web Application Firewall** (cloud/network/host-based) covering XSS/CSRF/SQLi/DDoS/malware, plus IP whitelisting on all SNAP-integration assets.
- **Mandatory Fraud Detection System** with real-time alerting; recommended rule dimensions include velocity, incorrect-PIN/OTP attempts, nominal thresholds, dormant-account/negative-balance checks, device ID, and blacklists.
- **Hot DR site** for API management infra: **RTO < 1 hour, RPO < 1 hour**; daily/weekly/monthly DB backups + transaction-log backups; **10-year data/log retention**.
- **Periodic independent audit** of the SNAP implementation (frequency unspecified). Security certifications (ISO-27001-style) are "recommended," not mandated.
- Written policies required covering: user management, cyber management, data security/storage, secure SDLC, change management, IT governance.

---

## 6. Data model / schema impact

This is the concrete answer to "will this change the database" — here's what's genuinely new vs. what's just a mapping/adapter concern:

**Genuinely new concepts (likely new tables/columns):**

- **Merchant hierarchy**: SNAP's QR/VA/Direct-Debit APIs consistently use a 4-level structure — `merchantId` → `subMerchantId` → `storeId`/`externalStoreId` → `terminalId`. Manapay's current `Merchant`/`Agent` Prisma models don't have sub-merchant/store/terminal concepts. Whether this needs to become real schema (new tables) or can be satisfied with a couple of nullable columns depends on whether any target partner actually requires sub-merchant-level granularity — worth confirming per-partner before building it out speculatively.
- **Per-counterparty credential storage**: RSA keypair + `clientSecret` per SNAP partner (see §5.4) — new table or `libs/configuration` secret entries, one row/entry per integrated bank/PSP.
- **SNAP reference-ID tracking**: `X-EXTERNAL-ID` must be unique *per calendar day* per the spec — this is a different uniqueness rule than manapay's existing transaction code-format key (`{timestampMs}{type}{method}{provider}-{userId}[-random]`, which is unique by construction, not by a daily-reset window). These will likely coexist rather than merge: manapay's internal correlation key stays the source of truth internally, and a SNAP-specific `partnerReferenceNo`/`X-EXTERNAL-ID` gets generated and stored per outbound SNAP call.
- **AML/KYC originator fields**: transfer-type calls (Interbank Transfer, Interbank Bulk, VA Payment) carry `hashedSourceAccountNo`/`sourceBankCode`/`originatorInfos[]` fields, conditionally required "if requested by the sender or consent has been granted" (citing Indonesia's Fund Transfer Law, Art. 8(5)). If manapay's disbursement/transfer flows don't currently capture originator identity data, that's a gap to close for any flow that routes through these SNAP sub-APIs.

**Adapter/mapping concerns (less likely to need new tables, more likely a translation layer):**

- **Universal response envelope**: every SNAP response starts with `responseCode` (7-char: 3-digit HTTP status + 2-digit service code + 2-digit case code, e.g. `2001100` = HTTP 200, service 11/Balance Inquiry, case 00/success) + `responseMessage`. This is a clean, parseable convention worth normalizing into internal DTOs at the SNAP-client boundary rather than propagating the raw SNAP shape through the rest of the system.
- **Amount type**: SNAP represents money as `{ value: "12345678.00", currency: "IDR" }` — string-encoded, always 2 decimals, ISO 4217 currency code. Needs a serialization adapter wherever manapay's internal representation differs (worth checking against the existing `MoneyType`/`PercentageType` TypeBox schemas in `microservice.enum.ts`, which are already string-pattern-based — likely a close fit).
- **Universal status enum**: `00=Success, 01=Initiated, 02=Paying, 03=Pending, 04=Refunded, 05=Canceled, 06=Failed, 07=Not found` — map onto (not replace) manapay's own transaction-status model at the SNAP-client boundary.
- **Fee-allocation convention**: `feeType`: `OUR` (sender pays, default) / `BEN` (recipient pays) / `SHA|<amount>` (split) — relevant wherever manapay's fee-calculation logic (`apps/config`'s fee calculators) intersects with a SNAP-routed disbursement.
- **A subtle but important reconciliation rule**: for ambiguous/timeout responses (error case `404/18`, "Inconsistent Request"), the spec says treat it as **success** for *credit transfer* flows (Intrabank/Interbank/RTGS/SKNBI/VA payment/refund) but as **failure** for *debit* flows (Transfer to OTC, Direct Debit, QR CPM, Auth Payment/Capture). This directly affects retry/reconciliation logic for any SNAP-routed flow and is easy to get backwards if not encoded deliberately.

---

## 7. Business process impact

- **Webhook/callback contract changes.** SNAP's `*-notify` endpoints (VA payment notify, QR MPM payment notify, bulk-transfer notify, bulk-cashin notify) define a specific inbound payload shape manapay would need to receive and acknowledge with a bare `responseCode`/`responseMessage`. This is architecturally the same *kind* of gap already confirmed live today: MotionPay's own Transfer callback (§14 of [docs/upstream/motionpay.md](upstream/motionpay.md)) has **no authentication mechanism at all** — no signature, no shared secret, anything that can reach the endpoint can post a fake success for an arbitrary `external_id`. Building real inbound-webhook signature verification once, generically, would close the MotionPay gap now and be ready for SNAP's notify contract later, rather than solving it twice.
- **Reconciliation shifts toward Bank Statement / Transaction History.** Both have hard limits worth designing around: **max 1-month date range per query, 1-year retrievable history, DESC-only sort, page size ≤50.** These become a real data source for settlement/reconciliation once SNAP-routed transactions exist, but they're report-pull APIs with retention limits — not a substitute for manapay keeping its own permanent transaction/ledger records.
- **No change forced onto manapay's own settlement computation.** Reiterating from §4: SNAP has no settlement/netting API. The balance-ledger + advisory-lock design already planned for `apps/transaction` stays as-is; SNAP only standardizes the *inputs* (transfer/QR/VA call results) to that logic when a counterparty is SNAP-compliant.
- **Compliance-operations obligations, not just code**: a designated **Data Protection Officer** function, a documented **BCP/BRP**, **72-hour breach/incident notification** (to consumers, counterparties, and authorities), **20-working-day complaint resolution SLA** (extendable by 20 more days under conditions), and **consent revocation taking effect within 72 hours**. These are process/staffing commitments the solo-dev team should know about even though they're not code changes per se.
- **Contract-level requirements with each counterparty**: the governance doc specifies minimum clauses every bilateral SNAP cooperation contract must include — termination grounds, suspension grounds, confidentiality, fee/tax handling, complaint-handling SLA. Not engineering work, but worth knowing it's a per-partner legal step, not just a technical integration step.

---

## 8. QRIS MPM specifics (separate track, still relevant)

Since manapay already supports QRIS as a payment method, these facts from the 3 bulletins are worth keeping even though they're not SNAP:

- **Acquirer-side validation is mandatory** before processing: check MID → MPAN → Merchant Name in sequence; mismatch on any of them returns response code **03 (Invalid Merchant)**. Separately, a fixed-amount QR's embedded nominal must be re-verified at processing time; mismatch → response code **13 (Invalid Amount)**.
- **Transaction notifications must carry specific minimum fields**, and the **RRN (Retrieval Reference Number) is carried in a field called `Reff ID`** — this is the field both merchant and end-user are expected to reconcile transactions on, so it's the natural key for any QRIS notification/webhook payload or status UI manapay builds.
- The underlying QR payload uses an **EMVCo-style tag-length-value structure**; **Tag 62** carries the Terminal ID as a subfield (confirmed structurally, though the full Tag 62 subfield table lives in the base QRIS MPM technical spec, which isn't among the 3 bulletins reviewed — pull it separately if payload-level QR generation/parsing is ever built in-house instead of delegated to a provider).
- If manapay ever prints or displays physical QRIS codes (stickers, terminal screens), there's a detailed branding/layout standard (colors, typography, minimum sizes, 3 sanctioned display variants) — low engineering relevance, flagged only so it doesn't get missed if a physical-merchant product ever comes up.

---

## 9. Known gaps and inconsistencies in the source documents

Worth keeping this list close at hand rather than rediscovering these the hard way during implementation — every item below was cross-checked (grep'd for absence, or checked against external implementer docs) rather than assumed:

- **RSA key size stated as "256 bits"** in the security standard — almost certainly a typo/error for **2048-bit**, based on consistent external implementer documentation (BRI, Espay). Confirm with your first integration partner rather than trusting the PDF literally.
- **TLS 1.2 fallback sunset date (30 June 2026) had already passed** when this doc was written (12 Aug 2026). Either SNAP traffic needs to already be TLS-1.3-only, or ASPI has issued an extension not reflected in this PDF — check before assuming either way.
- **`X-EXTERNAL-ID` format is contradictory**: "Alphanumeric" in the B2B transaction header table, "Numeric String" in the B2B2C one. Implement to the more permissive Alphanumeric spec, but confirm with counterparties since a receiver expecting strictly-numeric IDs could reject alphanumeric ones.
- **`ORIGIN` vs `X-ORIGIN`** — both spellings appear in different worked examples across the 585-page data spec doc. Likely a documentation inconsistency, not two real headers, but confirm with whichever partner you integrate first.
- **B2B2C access token lifetime says "15 days"** in one place, which directly conflicts with the adjacent statement that "refresh token should be less than access token validity" and with the B2B flow's 900-second lifetime. Treat as a probable documentation defect, not a real 1,440x-longer TTL, and confirm empirically.
- **The actual functional-test scenario list is not in this folder.** `Skenario Pengujian.pdf` is a 1-page stub linking to an external `09_Lampiran - Skenario Functional Test_V.3.2.xlsx` on ASPI's portal, which couldn't be fetched (see next point). Only the top-level rule is known: 1 positive + 1 negative Developer Site scenario per sub-API, plus separate end-to-end functional testing with your counterparty.
- **ASPI's Developer Site portal (`apidevportal.aspi-indonesia.or.id`) returned an expired-TLS-certificate error** when checked programmatically during this research. Could be a transient/network-specific issue — worth trying from a normal browser before concluding the portal itself is down, since you'll need an account there regardless.
- **No PJP/participant-category taxonomy (Prinsipal/Penyelenggara/Peserta/etc.) exists anywhere in the SNAP documents** — confirmed by full-text search of both the governance doc and Bank Indonesia's own SNAP overview page. That vocabulary belongs to a different regulation (likely PBI 22/23/PBI/2020 or GPN/QRIS-specific rules) — don't use SNAP-document terms to describe manapay's licensing category.
- **No numeric data-retention period or data-localization requirement appears in the governance doc** — both are deferred to unnamed "prevailing law and BI provisions." If either matters architecturally (e.g., "must storage be in-Indonesia"), it needs a separate regulatory check (Indonesia's PDP Law / UU 27/2022 is the likely source).

---

## 10. Certification path (once implementation actually starts)

The concrete end-to-end process, per the two guideline documents:

1. **Register on ASPI's Developer Site** (`apidevportal.aspi-indonesia.or.id`) with an institutional email. Default role is "Guest."
2. **Submit "Request Aplikasi Pengujian"** naming the app and a category (Provider-side dev / User-side dev / third-party systems dev) → promotes account to "Developer" role, pending ASPI activation. Once active: issued a **Client ID, Client Secret, Public Key, Private Key** for the sandbox, valid 3 months (renewable).
3. **Self-test in the sandbox** for every sub-API in scope: the fixed call chain is **Signature Auth → Access Token (B2B) → Signature Service → the actual Sub-API call**, each keyed to a consistent `X-TIMESTAMP`. Requires ≥1 positive + ≥1 negative scenario per sub-API. Some sub-APIs require fixed sandbox test values (e.g. Balance Inquiry requires `accountNo = "2000100101"`).
4. **Run end-to-end functional testing with your actual cooperating counterparty** (the bank/PSP), using ASPI's functional test scenarios (the external spreadsheet from §9).
5. **Assemble the certification document package**: Surat Permohonan (application letter), Surat Pernyataan (statement letter), SOP documentation (+ explanatory matrix), Developer Site test results (both sides), Berita Acara (functional test report), and — only if a third-party developer was involved — the development contract. Bulk submission across multiple sub-APIs/counterparties is allowed in one package.
6. **Submit via SILA** (`sila.aspi-indonesia.or.id`), naming the cooperating Pengguna Layanan.
7. **ASPI reviews** — primarily document review; may (at ASPI's discretion) also do an interview, product trial, or live demo. No stated turnaround time, no stated appeal process if ASPI isn't satisfied.
8. **ASPI issues a Surat Rekomendasi** (Recommendation Letter) — this is the actual "certified" artifact.
9. **Optional: list in the public Direktori Publikasi** — a separate, post-certification step requiring the issued Surat Rekomendasi as proof.

No Bank Indonesia involvement in individual applications is described anywhere in these two documents — ASPI appears to be the sole reviewing/approving body under the current process.

---

## 11. Suggested sequencing

Not urgent, and explicitly not blocking the current monorepo migration — for when the team is ready to pick this up:

1. ~~Resolve the licensing/role question~~ — **done, see §3.** Manapay is confirmed non-PJP/MA; the SNAP-relevant work is scoped to the manapay↔upstream-PJP relationship only.
2. **Watch for the actual trigger: a SNAP-compliant upstream.** Nothing below is actionable until either MotionPay adopts SNAP or a new upstream partner requires/offers it — check that before investing engineering time here. When it happens, QR MPM is the most plausible first target (MotionPay's current QRIS product is the closest live analog); Virtual Account has no current upstream offering it at all, so it's lower priority than the original ranking suggested.
3. **Build the SNAP signing/client layer as a shared lib** — RSA/HMAC signing (§5.2), header construction (§5.3), response-envelope normalization (§6) — designed once, reusable across every future SNAP-compliant counterparty, replacing what would otherwise be bespoke per-provider integration code.
4. **Add the additive schema pieces (§6)** only as specific partners require them (sub-merchant/store/terminal hierarchy, per-counterparty key storage, AML originator fields) rather than speculatively building the full hierarchy up front.
5. **Register on the Developer Site and sandbox-test** against the chosen sub-APIs.
6. **Pursue certification (§10)** once a real counterparty is ready for end-to-end functional testing.

---

## Sources

All facts above were extracted directly from the 9 files in [`docs/aspi-snap/`](aspi-snap), cross-checked against each other where they overlap, and spot-verified against public sources where the PDFs referenced external material or seemed potentially outdated (Bank Indonesia's SNAP pages, ASPI's own site, and public SNAP integration docs from BRI, Espay, and Faspay — used only to identify inconsistencies in the primary source, never treated as more authoritative than it). §3's business/legal position and §4.1's upstream-scope details were added 20 Aug 2026 based on direct input from the business owner, cross-checked against the live codebase (`apps/transaction/src/upstream/motionpay/`, `libs/microservice/src/microservice.enum.ts`) and [docs/upstream/motionpay.md](upstream/motionpay.md).
