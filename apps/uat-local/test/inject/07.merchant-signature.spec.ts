/**
 * Step 07 - each merchant's signing credentials.
 *
 * Last, and the first step whose subject is not configuration. Everything
 * before it makes a merchant *exist* and makes it *routable*; this is what
 * lets it call us. After this step `POST /open/v1/*` is reachable as each of
 * the four merchants, which is the precondition for every behaviour run.
 *
 * ## Why it is a step of its own rather than part of 04
 *
 * Step 04's header already says so, and the reason is the secret's lifetime:
 * `generate-secret-key` hands it back once and never again. A step that
 * rotated during onboarding would hold the only copy inside a jest process
 * that then exits, so the value would be lost between steps 04 and 05. The
 * separation is not tidiness - it is the only ordering that makes rotation
 * survivable.
 *
 * ## Where the behaviour run gets the secret, since this step does not keep it
 *
 * Out of the database. `merchant-signature.service.ts` writes `secretKey`
 * **in plaintext**, so after this step `auth.MerchantSignature` holds the
 * `clientId` and the `secretKey` for every merchant, and anything with a
 * connection can sign as one. `test/merchant-signature.spec.ts` already reads
 * them that way.
 *
 * That is an **open production risk**, not a harness convenience - the same
 * one recorded against the Redis cache - and it is what this step relies on.
 * It is also why nothing here captures or logs the value it is handed: the
 * terminal and the jest output are not places a shared secret belongs, even a
 * local one.
 *
 * ## What to inject
 *
 * Per merchant in `MERCHANTS`, as the merchant itself - both routes act on the
 * caller's own signature row, taking `userId` from the token rather than the
 * request, so there is no admin path to do this with:
 *
 * 1. **`merchantSecretKeyGenerate`** - rotates and returns the shared secret.
 * 2. **`merchantWebhookRegister`** - both URLs from `MERCHANT_WEBHOOK_URLS`.
 * 3. **`merchantSignatureStatus`** - read back what the two writes left.
 *
 * ## `allowedIps` is deliberately left empty
 *
 * Empty means unrestricted, and `PUT /merchant-signature/allowed-ips` is not
 * called here. Pinning it to the loopback would be more realistic and is a
 * trap for this harness: `isIpAllowed` matches by exact address family, so an
 * allowlist of `127.0.0.1` refuses the same request arriving over `::1` - and
 * which one you get depends on Node's happy-eyeballs rather than on anything
 * written down. An empty allowlist is asserted rather than ignored, so a
 * future step that starts restricting it has to come through here.
 *
 * ## Idempotent, and it invalidates step 04's third assertion
 *
 * Rotation is safe to repeat: the outgoing value moves to `secretKeyPrevious`
 * and keeps working for the grace period, so re-running this step costs
 * nothing but a new secret. Webhook registration is an update of one row.
 *
 * What it does break is step 04's `it('3. merchant signature')`, which asserts
 * the secret is *unissued*. That ordering is one-way by design and costs
 * nothing: step 04 cannot be re-run against the same database anyway, since
 * registration fails on the duplicate email.
 */

import { HttpStatus } from '@nestjs/common';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import {
  login,
  MERCHANT_PASSWORD,
  MERCHANT_WEBHOOK_URLS,
  MERCHANTS,
  merchantSecretKeyGenerate,
  merchantSignatureStatus,
  merchantWebhookRegister,
} from 'apps/uat-local/src/helper';

/** What `generateSecretKey` produces: 32 bytes, hex. */
const SECRET_SHAPE = /^[0-9a-f]{64}$/;

describe('inject merchant signature', () => {
  it('1. rotate the shared secret and register the webhooks', async () => {
    // Collected to prove the secrets differ, never to print them. A rotation
    // that handed every merchant the same value would satisfy every
    // per-merchant assertion below and let any merchant sign as any other.
    const secrets = new Set<string>();

    for (const m of MERCHANTS) {
      const auth = await login(m.email, MERCHANT_PASSWORD);
      expect(auth.token).toBeTruthy();

      const resSecret = await merchantSecretKeyGenerate(auth);
      expect(resSecret.statusCode).toEqual(HttpStatus.OK);
      expect(resSecret.status).toBe(ResponseStatus.SUCCESS);
      expect(resSecret.data).toMatch(SECRET_SHAPE);
      secrets.add(resSecret.data!);

      const resWebhook = await merchantWebhookRegister(
        auth,
        MERCHANT_WEBHOOK_URLS,
      );
      expect(resWebhook.statusCode).toEqual(HttpStatus.CREATED);
      expect(resWebhook.status).toBe(ResponseStatus.CREATED);

      const resStatus = await merchantSignatureStatus(auth);
      expect(resStatus.statusCode).toEqual(HttpStatus.OK);
      expect(resStatus.status).toBe(ResponseStatus.SUCCESS);
      expect(resStatus.data).toBeTruthy();

      const status = resStatus.data!;
      expect(status.payinUrl).toEqual(MERCHANT_WEBHOOK_URLS.payinUrl);
      expect(status.payoutUrl).toEqual(MERCHANT_WEBHOOK_URLS.payoutUrl);

      // Non-null is the point - this is the one field that says a secret
      // exists at all, since no endpoint will show it again. The offset is
      // asserted too because every date in this API carries one, and a bare
      // UTC string here would mean the serializer had been bypassed.
      expect(status.secretKeyGeneratedAt).not.toBeNull();
      expect(status.secretKeyGeneratedAt).toMatch(/\+07:00$/);

      // See the header: unrestricted on purpose.
      expect(status.allowedIps).toEqual([]);
    }

    expect(secrets.size).toEqual(MERCHANTS.length);
  });
});
