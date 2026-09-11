/**
 * Probe MotionPay QRIS `external_id` length handling.
 *
 * Open question #1 in docs/upstream/motionpay.md: their spec says String(16),
 * their own samples are 20, and we guessed 21. Never confirmed against the
 * server.
 *
 * The dangerous outcome is not rejection - it is silent acceptance followed by
 * truncation, because then the callback carries a value that matches nothing.
 * So every probe checks what comes BACK, in two independent places:
 *   1. the echo on the create response
 *   2. `external_id` on a status read, keyed by their transaction_id
 *
 * Deliberately standalone: signs and posts directly rather than going through
 * MotionPayQrisService, so `MOTIONPAY_EXTERNAL_ID_MAX_LENGTH` stays at 21 and
 * nothing touches our database.
 */
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const ENV_PATH = path.join(__dirname, '..', '..', 'apps', 'transaction', '.env.local');
require('dotenv').config({ path: process.env.PROBE_ENV || ENV_PATH });

const BASE_URL = process.env.MOTIONPAY_QRIS_BASE_URL;
const CLIENT_KEY = process.env.MOTIONPAY_CLIENT_KEY;
const SERVER_KEY = process.env.MOTIONPAY_SERVER_KEY;
const MERCHANT_ID = process.env.MOTIONPAY_MERCHANT_ID;
const TIMEOUT_MS = Number(process.env.MOTIONPAY_TIMEOUT_MS || 15000);

const TOKEN_URL = '/priv/v1/pg/token';
const CREATE_URL = '/payment/api/v1/qris/payment';
const STATUS_URL = '/payment/api/v1/qris/payment-status';

/** The ladder. 21 is our current constant; 16 is what their docs claim. */
const LENGTHS = (process.env.PROBE_LENGTHS || '16,21,22,32,50,64,65').split(',').map(Number);

const AMOUNT = 1000; // MOTIONPAY_AMOUNT.MIN
const SESSION_TIME = 1; // minutes, documented minimum

/**
 * Build an `external_id` of exactly `n` characters, ending in a sentinel.
 *
 * If the echoed value still ends in TAIL, nothing was cut off the end. Length
 * alone would not tell us that - a server could pad as easily as truncate.
 */
function makeExternalId(n, idx) {
  const head = `P${idx}${Date.now().toString(36)}`; // 10 chars
  const tail = 'TAIL';
  const fillLength = n - head.length - tail.length;
  if (fillLength < 0) throw new Error(`length ${n} too short for the probe shape`);
  return `${head}${'x'.repeat(fillLength)}${tail}`;
}

async function getToken() {
  const { data } = await axios.post(
    TOKEN_URL,
    { client_key: CLIENT_KEY, server_key: SERVER_KEY },
    { baseURL: BASE_URL, timeout: TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } },
  );
  if (!data?.data?.token) {
    throw new Error(`token request rejected: ${JSON.stringify(data)}`);
  }
  return data.data.token;
}

/** Never throws on an HTTP error - a 400 is a result here, not a failure. */
async function call(token, config) {
  try {
    const response = await axios({
      baseURL: BASE_URL,
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
      ...config,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    return { httpStatus: response.status, body: response.data };
  } catch (error) {
    return { httpStatus: null, body: null, transportError: error.code || error.message };
  }
}

async function probe(token, length, idx) {
  const externalId = makeExternalId(length, idx);

  const created = await call(token, {
    method: 'POST',
    url: CREATE_URL,
    data: {
      terminal_id: MERCHANT_ID,
      external_id: externalId,
      amount: AMOUNT,
      description: `external_id length probe ${length}`,
      session_time: SESSION_TIME,
      fullname: '',
      email: '',
      phone_number: '',
    },
  });

  const result = {
    length,
    sent: externalId,
    httpStatus: created.httpStatus,
    transportError: created.transportError,
    statusCode: created.body?.status?.code ?? null,
    statusMessage: created.body?.status?.message ?? null,
    echoed: created.body?.data?.external_id ?? null,
    transactionId: created.body?.data?.transaction_id ?? null,
    createRaw: created.body,
  };

  result.echoedLength = result.echoed === null ? null : result.echoed.length;
  result.echoMatches = result.echoed === externalId;
  result.tailSurvived = result.echoed === null ? null : result.echoed.endsWith('TAIL');

  // Does the value reach the QR payload the customer scans? terminal_id does.
  const qrString = created.body?.data?.qr_string;
  result.externalIdInQr = typeof qrString === 'string' ? qrString.includes(externalId) : null;

  // Second observation point: what did they actually STORE?
  if (result.transactionId) {
    const status = await call(token, {
      method: 'GET',
      url: `${STATUS_URL}/${encodeURIComponent(result.transactionId)}`,
    });
    result.statusRead = {
      httpStatus: status.httpStatus,
      externalId: status.body?.data?.external_id ?? null,
      statusCode: status.body?.status?.code ?? null,
    };
    result.statusRead.matches = result.statusRead.externalId === externalId;
    result.statusRead.length =
      result.statusRead.externalId === null ? null : result.statusRead.externalId.length;
    result.statusRaw = status.body;
  }

  return result;
}

function verdict(r) {
  if (r.transportError) return `TRANSPORT ${r.transportError}`;
  if (r.statusCode !== 0) return `REJECTED (${r.statusCode})`;
  if (!r.echoMatches) return 'ACCEPTED BUT ALTERED';
  if (r.statusRead && !r.statusRead.matches) return 'ECHO OK, STORED ALTERED';
  return 'ACCEPTED INTACT';
}

(async () => {
  for (const [name, value] of Object.entries({ BASE_URL, CLIENT_KEY, SERVER_KEY, MERCHANT_ID })) {
    if (!value) throw new Error(`missing env: MOTIONPAY_${name}`);
  }
  console.log(`host: ${BASE_URL}\n`);

  const token = await getToken();
  console.log('token acquired\n');

  const results = [];
  for (let i = 0; i < LENGTHS.length; i++) {
    const r = await probe(token, LENGTHS[i], i);
    results.push(r);
    console.log(
      [
        `len ${String(r.length).padStart(2)}`,
        `http ${String(r.httpStatus ?? '-').padEnd(3)}`,
        `code ${String(r.statusCode ?? '-').padEnd(4)}`,
        `echo ${String(r.echoedLength ?? '-').padStart(2)}`,
        `stored ${String(r.statusRead?.length ?? '-').padStart(2)}`,
        `tail ${r.tailSurvived === null ? '-' : r.tailSurvived ? 'y' : 'N'}`,
        `inQR ${r.externalIdInQr === null ? '-' : r.externalIdInQr ? 'y' : 'n'}`,
        `| ${verdict(r)}`,
        r.statusMessage ? `| ${r.statusMessage}` : '',
      ].join('  '),
    );
  }

  const out = path.join(__dirname, 'probe-external-id.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nraw responses: ${out}`);
})().catch((error) => {
  console.error('probe failed:', error.message);
  process.exit(1);
});
