import { Pool } from 'pg';
import { signRequest } from '../src/merchant/merchant-signer';

/**
 * Step 3 of `docs/uat/local-uat-build-order.md`: onboard merchant1 by hand and
 * get the first signed request accepted. No provider is involved.
 *
 * **Needs a live stack** - dashboard, auth, config, transaction, Redis and
 * `pgtest` - which a unit run does not have. Hence the `.onboard-spec.ts`
 * name: the root jest config matches `.*\.spec\.ts$`, which this does not, so
 * `npm test` leaves it alone and `npm run test:onboard` runs it.
 *
 * The cases are ordered and share state on purpose. This is a scripted
 * one-off, and splitting it up says *which* call broke rather than failing one
 * long test.
 */

const DASHBOARD_BASE_URL =
  process.env.DASHBOARD_BASE_URL ?? 'http://localhost:3000';
const TRANSACTION_BASE_URL =
  process.env.TRANSACTION_BASE_URL ?? 'http://localhost:3003';
const HARNESS_PORT = process.env.PORT ?? '3010';
const AUTH_DSN = process.env.POSTGRESQL_URL_MASTER_AUTH ?? '';

/**
 * merchant1 of the four the dev seed creates. Its agent share is zero and its
 * whole internal cut goes to Agent Internal, so the first fee breakdown read
 * in Step 6 has the fewest moving parts.
 */
const MERCHANT_EMAIL = 'merchant1@example.com';
const MERCHANT_PASSWORD = 'password123456789';

/**
 * `127.0.0.1`, never `localhost`. `RegisterWebhookUrlDto` puts `@IsUrl()` on
 * both fields and validator defaults to `require_tld: true`, so a TLD-less
 * host is a 400 that reads like an auth problem (Step 2a) - and the harness
 * binds the IPv4 loopback to match (Step 2b).
 */
const PAYIN_URL = `http://127.0.0.1:${HARNESS_PORT}/merchant/webhook/payin`;
const PAYOUT_URL = `http://127.0.0.1:${HARNESS_PORT}/merchant/webhook/payout`;

interface Envelope<T> {
  statusCode: number;
  status: string;
  message: string;
  data: T;
}

interface MerchantEnvelope<T> {
  responseCode: string;
  responseMessage: string;
  serverTime: string;
  data: T;
}

/**
 * The body, not only the status: a 400 from `register-webhook-url` reads like
 * an auth failure until you see `payinUrl must be a URL address` in it.
 */
const callDashboard = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<Envelope<T>> => {
  const res = await fetch(`${DASHBOARD_BASE_URL}/api/v1${path}`, init);
  const text = await res.text();

  if (res.status >= 300) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${text}`);
  }

  return JSON.parse(text) as Envelope<T>;
};

describe('Step 3 - onboard merchant1 by hand', () => {
  let pool: Pool;
  let token = '';
  let userId = 0;
  let clientId = '';
  let secretKey = '';

  beforeAll(() => {
    pool = new Pool({ connectionString: AUTH_DSN });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('signs in and gets a bearer token', async () => {
    const envelope = await callDashboard<{
      token: string;
      authInfo: { userId: number; profileId: number; role: string };
    }>('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: MERCHANT_EMAIL,
        password: MERCHANT_PASSWORD,
      }),
    });

    token = envelope.data.token;
    userId = envelope.data.authInfo.userId;

    expect(token).toBeTruthy();
    expect(userId).toBeGreaterThan(0);
  });

  /**
   * Rotating is safe to repeat: the old value moves to `secretKeyPrevious` and
   * keeps working for the grace period, and nothing caches the secret outside
   * the database.
   */
  it('rotates the shared secret and is shown it once', async () => {
    const envelope = await callDashboard<string>(
      '/merchant-signature/generate-secret-key',
      { headers: { authorization: `Bearer ${token}` } },
    );

    secretKey = envelope.data;

    expect(secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('registers both webhook URLs on the IPv4 loopback', async () => {
    await callDashboard<null>('/merchant-signature/register-webhook-url', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ payinUrl: PAYIN_URL, payoutUrl: PAYOUT_URL }),
    });

    const status = await callDashboard<{
      payinUrl: string | null;
      payoutUrl: string | null;
      secretKeyGeneratedAt: string | null;
    }>('/merchant-signature/status', {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(status.data.payinUrl).toBe(PAYIN_URL);
    expect(status.data.payoutUrl).toBe(PAYOUT_URL);
    expect(status.data.secretKeyGeneratedAt).not.toBeNull();
  });

  /**
   * Read rather than copied into `.env`: the secret is stored in plaintext on
   * `auth.MerchantSignature`, so anything with a database connection can have
   * it - which is the open production risk, not a harness detail. Reading it
   * also means a database reset plus re-onboard needs no edit anywhere.
   *
   * Plain `pg` rather than the generated Prisma client, because that client is
   * generated for ESM with `.ts` import specifiers and nothing in this repo
   * loads it under ts-jest yet. The harness itself reads this through its
   * injected Prisma client, inside Nest, where that is already proven.
   */
  it('reads the clientId back from auth.MerchantSignature', async () => {
    const { rows } = await pool.query<{ clientId: string }>(
      'select "clientId" from auth."MerchantSignature" where "userId" = $1',
      [userId],
    );

    clientId = rows[0]?.clientId ?? '';

    /// A human runs this and wants to see what it achieved, not just a green
    /// tick. The secret is deliberately never printed.
    console.log(`clientId ${clientId} belongs to userId ${userId}`);

    expect(rows).toHaveLength(1);
    expect(clientId).toBeTruthy();
  });

  /**
   * **Sighting 3.** One response proves the signature guard, the nonce store,
   * the auth TCP hop, the CLS principal and the response interceptor - with no
   * provider, no upstream and no callback in the picture.
   *
   * `{}` rather than no body at all: Fastify rejects an empty body under a
   * JSON content-type, and the guard requires that content-type on any POST.
   * The signer hashes the one string it returns, which is the string sent.
   */
  it('accepts a signed POST /open/v1/test and names merchant1', async () => {
    const endpoint = '/open/v1/test';
    const { body, headers } = signRequest({
      clientId,
      secretKey,
      method: 'POST',
      endpoint,
      payload: {},
    });

    const res = await fetch(`${TRANSACTION_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body,
    });
    const text = await res.text();

    if (res.status >= 300) {
      throw new Error(`POST ${endpoint} -> ${res.status} ${text}`);
    }

    const envelope = JSON.parse(text) as MerchantEnvelope<{
      merchantUserId: number;
    }>;

    console.log(`Sighting 3: HTTP ${res.status} ${text}`);

    expect(envelope.data.merchantUserId).toBe(userId);
    expect(envelope.responseCode).toMatch(/^200/);
  });

  /**
   * The one claim Sighting 3 cannot make on its own. A valid signature proves
   * the HMAC path, but only a rejected replay proves the nonce store is
   * actually consulted - otherwise `x-nonce` is decoration and a captured
   * request is reusable for the whole timestamp window.
   */
  it('rejects a replay of that exact signed request', async () => {
    const endpoint = '/open/v1/test';
    const { body, headers } = signRequest({
      clientId,
      secretKey,
      method: 'POST',
      endpoint,
      payload: {},
    });

    const send = () =>
      fetch(`${TRANSACTION_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body,
      });

    const first = await send();
    await first.text();
    const second = await send();
    const secondText = await second.text();

    console.log(`Replay: HTTP ${second.status} ${secondText}`);

    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeGreaterThanOrEqual(400);
  });
});
