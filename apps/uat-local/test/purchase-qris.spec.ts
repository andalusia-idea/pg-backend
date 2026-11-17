/**
 * **Sighting 4** - a QR string that came out of our own fake, and a `PENDING`
 * row.
 *
 * Kept as a spec rather than performed once by hand, because the thing it
 * proves is exactly the thing that quietly stops being true: that
 * `MOTIONPAY_QRIS_BASE_URL` points at the fake. The first run of this against
 * a stack started before that env edit went straight to MotionPay's real
 * sandbox and *passed everything a looser assertion would have checked* - HTTP
 * 201, a QR string, a PENDING row. Only the shape of `providerReference` gave
 * it away. So this asserts the reference format and the `FAKEUAT` marker, and
 * those two assertions are the point of the file.
 *
 * ## What one response covers
 *
 * The merchant HMAC guard, the nonce store, the auth TCP hop, fee resolution,
 * provider routing through `MerchantFee`, the real MotionPay QRIS client with
 * its TypeBox schema validation and envelope checks, the token mint and its
 * JWT `exp` caching - and the fake answering with `code: 0` where the token
 * endpoint answers `200`. None of that is stubbed.
 *
 * ## It needs an injection run, deliberately
 *
 * Unlike the other specs here it does not set up its own state in
 * `beforeAll`. Routing *is* the merchant's `MerchantFee` row, so a
 * self-sufficient version would have to reproduce the whole of inject step 05
 * - 28 rows across seven rails - and then the fixture would exist twice.
 * Run `node scripts/test-inject-all.js` first; `merchant1` needs fees from
 * step 05 and a signing secret from step 07.
 *
 * ## The amount is not arbitrary
 *
 * `scenarioFor` keys the fake's behaviour off `amount % 100`, and only
 * `00`-`69` is the success band. 50,000 sits in it. An amount ending `77`
 * would be refused at create and `97` would answer 500 - both correct, both
 * Step 9's business rather than this file's.
 */

import { HttpStatus } from '@nestjs/common';
import { MERCHANT_1, sendOpenApi } from 'apps/uat-local/src/helper';
import { signRequest } from 'apps/uat-local/src/merchant/merchant-signer';
import { Client } from 'pg';

const ENDPOINT = '/v1/qr/qr-mpm-generate';

/** In the SUCCESS band: `50000 % 100 = 0`, which is `<= 69`. */
const AMOUNT = 50_000;

/** 900s, floored to 15 whole minutes downstream - the unit the provider takes. */
const EXPIRE_SECONDS = 900;

const DSN =
  process.env.POSTGRESQL_URL_MASTER_AUTH ??
  'postgresql://postgres:12345678@localhost:5432/pgtest';

interface PurchaseEnvelope {
  responseCode: string;
  responseMessage: string;
  data: {
    transactionId: string;
    merchantReference: string;
    status: string;
    qr: { qrString: string; expiresAt: string };
  };
}

describe('purchase QRIS against the fake MotionPay', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DSN });
    await client.connect();
  });

  afterAll(async () => {
    // Unconditional: a failed assertion with an open pg client hangs jest on
    // the handle rather than reporting the failure, which is how the first
    // run of this spec appeared to be a slow upstream instead of a typo.
    await client.end();
  });

  it('mints a QR through the real client and records it PENDING', async () => {
    const { rows: credentials } = await client.query<{
      userId: number;
      clientId: string;
      secretKey: string;
    }>(
      `SELECT s."userId", s."clientId", s."secretKey"
       FROM auth."MerchantSignature" s JOIN auth."User" u ON u.id = s."userId"
       WHERE u.email = $1 AND s."deletedAt" IS NULL`,
      [MERCHANT_1],
    );

    // Said plainly: without a secret this is inject step 07 not having run,
    // which is a different problem from the purchase being refused.
    expect(credentials).toHaveLength(1);
    expect(credentials[0].secretKey).toBeTruthy();

    const merchantReference = `UAT-S4-${Date.now()}`;
    const signed = signRequest({
      clientId: credentials[0].clientId,
      secretKey: credentials[0].secretKey,
      method: 'POST',
      endpoint: ENDPOINT,
      payload: {
        amount: { value: String(AMOUNT), currency: 'IDR' },
        merchantReference,
        expireSeconds: EXPIRE_SECONDS,
      },
    });

    const { status, text } = await sendOpenApi('POST', ENDPOINT, signed);

    /// A human runs this to see what it achieved, not just a green tick.
    console.log(`Sighting 4: HTTP ${status} ${text}`);

    expect(status).toEqual(HttpStatus.CREATED);
    const envelope = JSON.parse(text) as PurchaseEnvelope;
    expect(envelope.responseCode).toMatch(/^200/);
    expect(envelope.data.merchantReference).toEqual(merchantReference);
    expect(envelope.data.status).toEqual('PENDING');

    const { rows } = await client.query<{
      providerName: string;
      providerReference: string;
      systemReference: string;
      status: string;
      nominal: string;
    }>(
      `SELECT "providerName", "providerReference", "systemReference", status, nominal
       FROM transaction."PurchaseTransaction"
       WHERE "merchantReference" = $1`,
      [merchantReference],
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.providerName).toEqual('MOTIONPAY');
    expect(row.status).toEqual('PENDING');
    expect(Number(row.nominal)).toEqual(AMOUNT);
    expect(row.systemReference).toEqual(envelope.data.transactionId);

    // The two assertions this file exists for: both halves of the QR came from
    // the fake, not from a sandbox that happens to answer the same shape.
    expect(row.providerReference).toMatch(/^FM-\d+-\d{4}$/);
    expect(envelope.data.qr.qrString).toEqual(
      `00020101021226FAKEUAT${row.providerReference}`,
    );
  });
});
