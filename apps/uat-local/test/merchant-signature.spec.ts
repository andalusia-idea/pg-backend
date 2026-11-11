import { config as loadEnv } from 'dotenv';
import { Pool } from 'pg';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import {
  login,
  loginAgentInternal,
  MERCHANT_1,
  MERCHANT_PASSWORD,
  MERCHANTS,
  merchantRegister,
  merchantSecretKeyGenerate,
  merchantSignatureStatus,
  merchantWebhookRegister,
  PORT,
  sendOpenApi,
} from '../src/helper';
import { signRequest } from '../src/merchant/merchant-signer';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import { HttpStatus } from '@nestjs/common';

/**
 * **Sighting 3** of `docs/uat/local-uat-build-order.md`, and the highest-value
 * checkpoint in it: the merchant signing path, end to end, with no provider, no
 * upstream and no callback anywhere in the picture.
 *
 * Extracted from `merchant.onboard.spec.ts`, which mixed it with the onboarding
 * steps that now live in `test/inject`. What is left here is behaviour, which is
 * why it reads as a sequence rather than as independent cases: sign in, rotate
 * the secret, register the webhooks, learn the clientId, send one signed
 * request, then replay it. Splitting that into cases says *which* call broke
 * rather than failing one long test.
 *
 * **Needs a live stack** - dashboard, auth, config, transaction, Redis and
 * `pgtest` - as do the other specs in this directory.
 */

/**
 * The one value with no sensible default, so it is loaded rather than guessed.
 *
 * `dotenv` does not overwrite what is already in `process.env`, so running this
 * through `dotenv -e ... -- jest` still wins. Read lazily in `beforeAll` rather
 * than at module scope, because the constants in `src/helper` are evaluated
 * when they are imported - which happens before any top-level statement here.
 */
const authDsn = (): string => {
  loadEnv({ path: 'apps/uat-local/.env.test', quiet: true });
  return process.env.POSTGRESQL_URL_MASTER_AUTH ?? '';
};

/**
 * `127.0.0.1`, never `localhost`. `RegisterWebhookUrlDto` puts `@IsUrl()` on
 * both fields and validator defaults to `require_tld: true`, so a TLD-less host
 * is a 400 that reads like an auth problem - and the harness binds the IPv4
 * loopback to match, which is the other half of the same trap.
 */
const PAYIN_URL = `http://127.0.0.1:${PORT}/merchant/webhook/payin`;
const PAYOUT_URL = `http://127.0.0.1:${PORT}/merchant/webhook/payout`;

const ENDPOINT = '/open/v1/test';

/** The Open API answers with its own envelope, not the dashboard's. */
interface MerchantEnvelope<T> {
  responseCode: string;
  responseMessage: string;
  serverTime: string;
  data: T;
}

describe('merchant signature', () => {
  let pool: Pool;
  let merchant: AuthDto;
  let clientId = '';
  let secretKey = '';

  beforeAll(async () => {
    const dsn = authDsn();
    // Said plainly, because a bad DSN surfaces as an opaque pg error several
    // assertions later.
    expect(dsn).toBeTruthy();
    pool = new Pool({ connectionString: dsn });

    // Make sure the merchant exists. Registration creates rather than upserts,
    // so a second run would fail on the duplicate email - signing in first and
    // only registering when that fails is what keeps this spec runnable on its
    // own, whether or not an injection run has been through.
    merchant = await login(MERCHANT_1, MERCHANT_PASSWORD).catch(async () => {
      const agentInternal = await loginAgentInternal();
      await merchantRegister(
        agentInternal,
        MERCHANTS.find((m) => m.email === MERCHANT_1)!,
      );
      return login(MERCHANT_1, MERCHANT_PASSWORD);
    });

    expect(merchant.token).toBeTruthy();
    expect(merchant.authInfo.userId).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rotates the shared secret and is shown it once', async () => {
    const res = await merchantSecretKeyGenerate(merchant);
    expect(res.statusCode).toEqual(HttpStatus.OK);
    expect(res.status).toBe(ResponseStatus.SUCCESS);

    secretKey = res.data!;
    expect(secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('registers both webhook URLs on the IPv4 loopback', async () => {
    const res = await merchantWebhookRegister(merchant, {
      payinUrl: PAYIN_URL,
      payoutUrl: PAYOUT_URL,
    });
    expect(res.statusCode).toEqual(HttpStatus.CREATED);

    const status = await merchantSignatureStatus(merchant);
    expect(status.data!.payinUrl).toBe(PAYIN_URL);
    expect(status.data!.payoutUrl).toBe(PAYOUT_URL);
    expect(status.data!.secretKeyGeneratedAt).not.toBeNull();
    expect(Array.isArray(status.data!.allowedIps)).toBe(true);
  });

  /**
   * Read rather than copied into `.env`: the secret is stored in plaintext on
   * `auth.MerchantSignature`, so anything with a database connection can have
   * it - which is an open production risk, not a harness detail. Reading it
   * also means a database reset plus a re-onboard needs no edit anywhere.
   *
   * Plain `pg` rather than the generated Prisma client, because that client is
   * generated for ESM with `.ts` import specifiers and nothing in this repo
   * loads it under ts-jest. Inside Nest the injected client is the right way,
   * and is already proven there.
   *
   * `clientId` is the one thing no endpoint returns - `status` carries the
   * webhook URLs, the generated-at timestamp and the allowed IPs, but not this
   * - so the database is the only source.
   */
  it('reads the clientId back from auth.MerchantSignature', async () => {
    const { rows } = await pool.query<{ clientId: string }>(
      'select "clientId" from auth."MerchantSignature" where "userId" = $1',
      [merchant.authInfo.userId],
    );

    clientId = rows[0]?.clientId ?? '';

    /// A human runs this and wants to see what it achieved, not just a green
    /// tick. The secret is deliberately never printed.
    console.log(
      `clientId ${clientId} belongs to userId ${merchant.authInfo.userId}`,
    );

    expect(rows).toHaveLength(1);
    expect(clientId).toBeTruthy();
  });

  /**
   * **Sighting 3.** One response proves the signature guard, the nonce store,
   * the auth TCP hop, the CLS principal and the response interceptor at once.
   *
   * `{}` rather than no body at all: the guard requires a JSON content-type on
   * any POST, and Fastify rejects an empty body under that content-type - so
   * "no body" fails before the guard even runs. The signer hashes the one
   * string it returns, which is the string sent.
   */
  it('accepts a signed POST and names the merchant', async () => {
    const signed = signRequest({
      clientId,
      secretKey,
      method: 'POST',
      endpoint: ENDPOINT,
      payload: {},
    });

    const { status, text } = await sendOpenApi('POST', ENDPOINT, signed);
    console.log(`Sighting 3: HTTP ${status} ${text}`);

    expect(status).toBeLessThan(300);

    const envelope = JSON.parse(text) as MerchantEnvelope<{
      merchantUserId: number;
    }>;
    expect(envelope.data.merchantUserId).toBe(merchant.authInfo.userId);
    expect(envelope.responseCode).toMatch(/^200/);
  });

  /**
   * The one claim Sighting 3 cannot make on its own.
   *
   * A valid signature proves the HMAC path. Only a *rejected replay* proves the
   * nonce store is actually consulted - without it `x-nonce` is decoration and
   * a captured request stays reusable for the whole timestamp window.
   *
   * Signed once and sent twice, deliberately: re-signing would mint a new nonce
   * and prove nothing.
   */
  it('rejects a replay of that exact signed request', async () => {
    const signed = signRequest({
      clientId,
      secretKey,
      method: 'POST',
      endpoint: ENDPOINT,
      payload: {},
    });

    const first = await sendOpenApi('POST', ENDPOINT, signed);
    const second = await sendOpenApi('POST', ENDPOINT, signed);
    console.log(`Replay: HTTP ${second.status} ${second.text}`);

    expect(first.status).toBeLessThan(300);
    expect(second.status).toEqual(HttpStatus.CONFLICT);
    expect(second.text).toMatch(/nonce/i);
  });

  /**
   * A tampered signature has to fail for the same reason a replay does: the
   * guard verifying rather than merely parsing.
   *
   * **One hex digit flipped, not a character appended.** The signature is
   * checked for shape first - 128 hex characters, HMAC-SHA512 - so lengthening
   * it is refused on format and proves nothing about the comparison. This stays
   * exactly 128 characters and still valid hex, so the only thing left to
   * reject it is the HMAC itself, which is the case that would quietly pass if
   * that comparison were ever skipped.
   */
  it('rejects a signed request whose signature does not match', async () => {
    const signed = signRequest({
      clientId,
      secretKey,
      method: 'POST',
      endpoint: ENDPOINT,
      payload: {},
    });

    const header = Object.keys(signed.headers).find(
      (key) => key.toLowerCase() === 'x-signature',
    )!;
    const signature = signed.headers[header];
    const flipped =
      signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0');

    expect(flipped).toHaveLength(signature.length);
    expect(flipped).not.toBe(signature);
    expect(flipped).toMatch(/^[0-9a-f]{128}$/);

    const { status, text } = await sendOpenApi('POST', ENDPOINT, {
      ...signed,
      headers: { ...signed.headers, [header]: flipped },
    });
    console.log(`Tampered: HTTP ${status} ${text}`);

    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    // Not the format complaint - that would mean the shape check fired and the
    // comparison never ran.
    expect(text).not.toMatch(/expected 128 hex/i);
  });
});
