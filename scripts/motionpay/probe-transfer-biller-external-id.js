/**
 * Probe MotionPay Transfer and Biller `external_id` length handling.
 *
 * Companion to probe-external-id.js, which found QRIS's field is 255 against a
 * documented 16. Transfer's 50 and Biller's 64 have never been tested, and the
 * one number that was tested was wrong by a factor of sixteen.
 *
 * **Inquiry legs only.** `/transfer/api/v1/payment` and `/biller/v1/payment`
 * move money; nothing here touches them. A transfer inquiry is a read-only bank
 * account lookup. A biller inquiry does open provider-side state and price a
 * product, which is the unavoidable cost of probing that field at all - it
 * debits nothing.
 *
 * Both products live on the same host and token endpoint but authenticate with
 * different key pairs, and their response envelopes disagree:
 *   Transfer: status: { success, code: "0001", message }
 *   Biller:   status: <number>, message, description
 */
const path = require('path');
const fs = require('fs');
const axios = require('axios');

require('dotenv').config({
  path: process.env.PROBE_ENV || path.join(__dirname, '..', '..', 'apps', 'transaction', '.env.local'),
});

const BASE_URL = process.env.MOTIONPAY_TRANSFER_BASE_URL;
const BILLER_BASE_URL = process.env.MOTIONPAY_BILLER_BASE_URL;
const TIMEOUT_MS = Number(process.env.MOTIONPAY_TIMEOUT_MS || 15000);

// Transfer has its own pair, falling back to the QRIS one - see the auth service.
const TRANSFER_CLIENT_KEY =
  process.env.MOTIONPAY_TRANSFER_CLIENT_KEY || process.env.MOTIONPAY_CLIENT_KEY;
const TRANSFER_SERVER_KEY =
  process.env.MOTIONPAY_TRANSFER_SERVER_KEY || process.env.MOTIONPAY_SERVER_KEY;
// Biller authenticates with the QRIS pair.
const BILLER_CLIENT_KEY = process.env.MOTIONPAY_CLIENT_KEY;
const BILLER_SERVER_KEY = process.env.MOTIONPAY_SERVER_KEY;

const TOKEN_URL = '/auth/v2/access-token';
const TRANSFER_INQUIRY_URL = '/transfer/api/v1/inquiry';
const BILLER_INQUIRY_URL = '/biller/v1/inquiry';

const LENGTHS = (process.env.PROBE_LENGTHS || '16,32,50,51,64,65,100,200,255,256')
  .split(',')
  .map(Number);

/** A real bank code and a plausible account. The lookup failing is fine. */
const BANK_CODE = '014'; // BCA
const BANK_ACCOUNT = '1234567890';
/** OVO, the first of the four open-amount wallet products we map. */
const PRODUCT_CODE = 'ESBO01';
const CUSTOMER_ID = '081234567890';
const NOMINAL = '10000';

function makeExternalId(n, idx) {
  const head = `Q${idx.toString(36)}${Date.now().toString(36)}`; // 10 chars
  const tail = 'TAIL';
  const fill = n - head.length - tail.length;
  if (fill < 0) throw new Error(`length ${n} too short for the probe shape`);
  return `${head}${'x'.repeat(fill)}${tail}`;
}

async function getToken(baseURL, clientKey, serverKey, label) {
  const response = await axios.post(
    TOKEN_URL,
    { client_key: clientKey, server_key: serverKey },
    { baseURL, timeout: TIMEOUT_MS, validateStatus: () => true },
  );
  const token = response.data?.data?.token;
  if (!token) {
    throw new Error(
      `${label} token rejected: http ${response.status} ${JSON.stringify(response.data)}`,
    );
  }
  return token;
}

async function call(config) {
  try {
    const response = await axios({
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
      ...config,
    });
    return { httpStatus: response.status, body: response.data };
  } catch (error) {
    return {
      httpStatus: null,
      body: null,
      transportError: error.code || error.message,
    };
  }
}

/** Digs the echoed external_id out of either envelope shape. */
function echoedExternalId(body) {
  return body?.data?.external_id ?? null;
}

async function probeLadder({ label, baseURL, url, token, headers, makeBody }) {
  const results = [];
  console.log(`\n=== ${label} — ${url} ===`);

  for (let i = 0; i < LENGTHS.length; i++) {
    const length = LENGTHS[i];
    const externalId = makeExternalId(length, i);

    const { httpStatus, body, transportError } = await call({
      method: 'POST',
      url,
      baseURL,
      data: makeBody(externalId),
      headers: { 'Content-Type': 'application/json', ...headers(token) },
    });

    const echoed = echoedExternalId(body);
    const result = {
      length,
      sent: externalId,
      httpStatus,
      transportError,
      // Transfer nests its code; Biller puts a bare number at `status`.
      code: body?.status?.code ?? body?.status ?? null,
      message: body?.status?.message ?? body?.message ?? null,
      description: body?.description ?? null,
      echoed,
      echoedLength: echoed === null ? null : echoed.length,
      echoMatches: echoed === externalId,
      tailSurvived: echoed === null ? null : echoed.endsWith('TAIL'),
      raw: body,
    };
    results.push(result);

    console.log(
      [
        `len ${String(length).padStart(3)}`,
        `http ${String(httpStatus ?? '-').padEnd(4)}`,
        `code ${String(result.code ?? '-').padEnd(6)}`,
        `echo ${String(result.echoedLength ?? '-').padStart(3)}`,
        `tail ${result.tailSurvived === null ? '-' : result.tailSurvived ? 'y' : 'N'}`,
        `| ${transportError ?? result.message ?? result.description ?? ''}`,
      ].join('  '),
    );
  }

  return results;
}

(async () => {
  console.log(`transfer host: ${BASE_URL}`);
  console.log(`biller host:   ${BILLER_BASE_URL}`);

  const out = {};

  // --- Transfer -----------------------------------------------------------
  try {
    const token = await getToken(
      BASE_URL,
      TRANSFER_CLIENT_KEY,
      TRANSFER_SERVER_KEY,
      'transfer',
    );
    console.log('\ntransfer token acquired');
    out.transfer = await probeLadder({
      label: 'TRANSFER account inquiry (read-only)',
      baseURL: BASE_URL,
      url: TRANSFER_INQUIRY_URL,
      token,
      headers: (t) => ({
        Authorization: `Bearer ${t}`,
        'x-server-key': TRANSFER_SERVER_KEY,
      }),
      makeBody: (externalId) => ({
        bank_code: BANK_CODE,
        bank_account: BANK_ACCOUNT,
        external_id: externalId,
      }),
    });
  } catch (error) {
    console.log(`\nTRANSFER blocked: ${error.message}`);
    out.transferError = error.message;
  }

  // --- Biller -------------------------------------------------------------
  try {
    const token = await getToken(
      BILLER_BASE_URL,
      BILLER_CLIENT_KEY,
      BILLER_SERVER_KEY,
      'biller',
    );
    console.log('\nbiller token acquired');
    out.biller = await probeLadder({
      label: 'BILLER inquiry (opens provider-side state, debits nothing)',
      baseURL: BILLER_BASE_URL,
      url: BILLER_INQUIRY_URL,
      token,
      headers: (t) => ({ Authorization: `Bearer ${t}` }),
      makeBody: (externalId) => ({
        external_id: externalId,
        product_code: PRODUCT_CODE,
        customer_id: CUSTOMER_ID,
        nominal: NOMINAL,
      }),
    });
  } catch (error) {
    console.log(`\nBILLER blocked: ${error.message}`);
    out.billerError = error.message;
  }

  const file = path.join(__dirname, 'probe-transfer-biller.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nraw responses: ${file}`);
})().catch((error) => {
  console.error('probe failed:', error.message);
  process.exit(1);
});
