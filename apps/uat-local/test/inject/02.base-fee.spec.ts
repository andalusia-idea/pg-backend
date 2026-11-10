/**
 * Step 02 - provider-level base fees.
 *
 * After 01 because `BaseFee.providerName` is a real foreign key to
 * `config.Provider`, and before 05 because a merchant's own fee override
 * carries a `baseFeeId` that has to exist first.
 *
 * ## What to inject
 *
 * **`baseFeeUpsert(superAdmin, BASE_FEES)`**, with the fixtures already in
 * `src/helper/constant.ts` - one MotionPay QRIS purchase rail and six Jatelindo
 * payout rails.
 *
 * Then read the ids back with `baseFeeFindAll`, because step 05 needs them:
 * the upsert answers 201 with no body, and `UpsertMerchantFeeDto.baseFeeId` is
 * the only way a merchant fee points at a rail. `baseFeeCode()` builds the
 * `PROVIDER_METHOD_TYPE` string the response carries, which is what joins what
 * was sent to the ids that came back.
 *
 * ## What the server will refuse, so the fixtures have to respect it
 *
 * - **`isActive` must be a real JSON boolean.** A string, or omitting it, is a
 *   422 - and before `@IsBoolean()` was added it was stripped silently, so a
 *   fee could not be deactivated at all.
 * - **The transaction type has to be one the payment method supports.**
 *   `PaymentMethod.transactionTypes` is an array column with no constraint
 *   relating the two, so a QRIS withdrawal would insert happily and then never
 *   match a transaction again. The API checks instead, naming the supported
 *   types.
 * - **Money is 2 decimal places, percentage is 4.** Both cross as strings.
 *   `ZERO` in the helper is built at the money scale, so a zero percentage is
 *   written `'0.00'` and comes back `'0.0000'` - accepted, just worth knowing
 *   it is not string-identical.
 *
 * ## Rates are invented, and that matters
 *
 * Real provider rates are commercial terms from a signed agreement. A database
 * carrying plausible-but-fictional ones is worse than one carrying none,
 * because nothing fails loudly - the fees are simply wrong and every settlement
 * quietly mis-splits. These are harness numbers; the production path is an
 * operator entering them through this same endpoint by hand.
 */

describe('inject base fee', () => {
  it.todo('register');
});
