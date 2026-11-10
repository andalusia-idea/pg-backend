/**
 * Step 05 - per-merchant fee config, and who shares the agent's cut.
 *
 * Last, because it needs base-fee ids from 02, merchant ids from 04 and agent
 * ids from 03. **This is the step that makes a merchant able to transact.**
 *
 * ## What to inject
 *
 * 1. **`merchantFeeUpsert(agentInternal, merchantId, fees)`** per merchant,
 *    each entry `{ action: 'U', baseFeeId, feeInternalFixed,
 *    feeInternalPercentage, feeAgentFixed, feeAgentPercentage }`.
 *
 *    **Routing is this row, not a provider setting.** `ProfileProviderService`
 *    resolves a merchant's provider through `merchantFee.baseFee`, filtering on
 *    the base fee's `paymentMethodName`, `transactionType` and `isActive` - and
 *    deliberately *not* on provider, with **no `orderBy`**. So two rows for one
 *    (method, type) pairing make the chosen provider depend on Postgres row
 *    order. Give each merchant at most one row per pairing, and put a second
 *    provider on a *different merchant* rather than as a second row on the same
 *    one.
 *
 *    That is also how to make a merchant route to a particular upstream: there
 *    is no switch for it, only which base fee its own row points at.
 *
 * 2. **`merchantAgentShareholderUpsert(agentInternal, merchantId, holders)`**
 *    for any merchant given a non-zero agent fee.
 *
 *    An agent fee with no shareholder row is money owed to nobody - the fee
 *    says an agent is due a cut and no row says which one.
 *    `assertShareholderPercentagesTotal` sums the **request**, not the stored
 *    set, so a batch has to total exactly 100 even when it is a partial update.
 *
 * ## Leave one merchant unconfigured
 *
 * A merchant with no fee rows is a real state - every merchant starts there -
 * and it is the only way to exercise the 403 that `resolveProvider` documents
 * as an onboarding gap on our side rather than a bad request on the merchant's.
 * The dashboard also has to render that merchant as zero rather than as
 * missing, which is the same reason the transaction dev seed leaves one
 * merchant out of its balance fixtures.
 *
 * ## A suggested shape, given the rails 01 and 02 install
 *
 * | Merchant | Payin | Payout | Agent cut |
 * |---|---|---|---|
 * | merchant1 | MotionPay QRIS | — | no |
 * | merchant2 | MotionPay QRIS | Jatelindo bank transfer | yes, one agent at 100% |
 * | merchant3 | — | Jatelindo e-wallet | no |
 * | merchant4 | — | — | — (the 403 fixture) |
 *
 * Read it back with `merchantConfigFindAll` to confirm each merchant has one
 * row per pairing: that listing is the only place the row-order hazard above is
 * visible before a transaction trips over it.
 */

describe('inject merchant fee', () => {
  it.todo('register');
  it.todo('agent shareholder');
});
