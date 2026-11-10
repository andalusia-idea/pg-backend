/**
 * Step 01 - upstream providers and their settlement schedules.
 *
 * First because almost everything else references a provider:
 * `BaseFee.providerName` is a real foreign key to `config.Provider`, and the
 * settlement-window upsert refuses a provider that is not configured.
 *
 * ## What to inject
 *
 * 1. **Providers**, via `providerUpsert(superAdmin, [...])`.
 *
 *    `INTERNAL`, `MOTIONPAY` and `JATELINDO`. The migrations insert `INTERNAL`
 *    alone - every other provider exists because a contract was signed - so
 *    re-posting it is a harmless no-op that keeps the list in one place.
 *
 *    **Leave `TELEANJAR` out.** It is the fixture the E2E specs use for the
 *    "provider is not configured" refusal, and registering it here would make
 *    that case unreachable after an injection run. It has no upstream client
 *    either, so nothing can route to it.
 *
 * 2. **Settlement windows**, via `settlementWindowUpsert(superAdmin, [...])`.
 *
 *    When each partner closes a transaction window and releases our money.
 *    `FOLLOW_UPSTREAM` eligibility cannot answer anything without these, so a
 *    settlement run has nothing to compute until they exist.
 *
 *    `docs/accounting/upstream-settlement-schedules.md` is the source. What is
 *    published today:
 *
 *    | Provider | Method | Label | Window | Releases |
 *    |---|---|---|---|---|
 *    | MOTIONPAY | QRIS | DAILY | full day | H+1 15:00 |
 *    | MOTIONPAY | DIRECTEWALLET | DAILY | full day | H+3, no published time |
 *    | JATELINDO | ? | ? | **not published** | **not published** |
 *
 *    Two conventions the column comments spell out and the API enforces:
 *    a **full day is `windowEnd` equal to `windowStart`** (`"24:00"` is
 *    refused, so there is only one spelling), and
 *    **`windowStartDayOffset: -1`** when the window opens the previous day.
 *    `settlementTime: null` means no published time, which eligibility reads as
 *    end of day rather than start.
 *
 *    **Jatelindo has no schedule anywhere** - not here, not in the reference
 *    doc - and it is a live upstream, so settlement cannot answer
 *    `FOLLOW_UPSTREAM` for that rail until someone transcribes one from a
 *    partner notice. That is the gap worth filling first.
 *
 * Fixtures belong in `src/helper/constant.ts` beside `BASE_FEES`, not here.
 */

describe('inject upstream', () => {
  it.todo('register');
  it.todo('settlement window');
});
