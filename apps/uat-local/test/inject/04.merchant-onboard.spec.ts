/**
 * Step 04 - merchants.
 *
 * After agents, because a merchant is registered by one. Before 05, which gives
 * these merchants the fee rows they need to transact at all.
 *
 * ## What to inject
 *
 * **`merchantRegister(agentInternal, merchant)`** for each of `MERCHANTS` in
 * `src/helper/constant.ts`.
 *
 * Registered through the **real admin path** rather than reusing the seeded
 * `merchant1@example.com` fixtures, which is possible because the named
 * principals landed: `agentinternal` is `config.Agent` 22 and can sign in.
 * `registerMerchant` writes the `auth.User`, the detail row, the
 * `config.Merchant` row and a default `MerchantSettlementPolicy` in one
 * transaction.
 *
 * ## Ids
 *
 * Same as step 03: the response carries a null body, and `config.Merchant`
 * reuses the `auth.User` id, so `login(email, MERCHANT_PASSWORD)` then
 * `authInfo.userId` is how a later step learns one.
 *
 * Worth asserting `authInfo.profileId === authInfo.userId` once, because
 * `MerchantFee.merchantId` is matched against the **auth user id** by
 * `ProfileProviderService` at transaction time. If those two ever stop being
 * equal, step 05 would write fee rows against an id nothing routes by, and
 * nothing would complain.
 *
 * ## What a merchant still cannot do after this step
 *
 * Transact. Registration gives it no fees, and routing *is* the fee row, so
 * `resolveProvider` answers 403 until step 05 runs. That is deliberate rather
 * than a gap: it is the state every real merchant passes through, and the one
 * merchant left without fees in step 05 is what keeps that path exercised.
 *
 * It also has no signing secret yet - `MerchantSignature` is created with a
 * `clientId` but a null `secretKey`, `payinUrl` and `payoutUrl`. Rotating the
 * secret and registering the webhook URLs is merchant-signature work, not
 * onboarding, and belongs in its own step once the behaviour run needs it.
 *
 * ## Not idempotent
 *
 * As with agents, a second run fails on the duplicate email.
 */

describe('inject merchant onboard', () => {
  it.todo('register');
});
