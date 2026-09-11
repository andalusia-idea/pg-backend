/**
 * Is a 403 from a MotionPay host an IP-allowlist block, or our own problem?
 *
 * The distinction is content type, not status code. A JSON body means their
 * application ran and refused us; an HTML body means the edge refused us first
 * and MotionPay never saw the request. Only the second is the allowlist.
 *
 * Prints all three cases side by side plus this machine's egress IP, which is
 * the value Flash needs in order to whitelist it.
 */
const path = require('path');
const axios = require('axios');

require('dotenv').config({
  path: path.join(__dirname, '..', '..', 'apps', 'transaction', '.env.local'),
});
const T = 15000;

const post = (baseURL, url, data) =>
  axios({ method: 'POST', baseURL, url, data, timeout: T, validateStatus: () => true })
    .then((r) => ({ status: r.status, ct: r.headers['content-type'], body: r.data }))
    .catch((e) => ({ status: null, err: e.code || e.message }));

(async () => {
  const qris = await post(process.env.MOTIONPAY_QRIS_BASE_URL, '/priv/v1/pg/token', {
    client_key: process.env.MOTIONPAY_CLIENT_KEY,
    server_key: process.env.MOTIONPAY_SERVER_KEY,
  });
  console.log('QRIS host     ', process.env.MOTIONPAY_QRIS_BASE_URL);
  console.log('  ->', qris.status, '|', String(qris.ct).split(';')[0], '| token:',
    qris.body?.data?.token ? 'issued' : JSON.stringify(qris.body).slice(0, 80));

  const tr = await post(process.env.MOTIONPAY_TRANSFER_BASE_URL, '/auth/v2/access-token', {
    client_key: process.env.MOTIONPAY_TRANSFER_CLIENT_KEY || process.env.MOTIONPAY_CLIENT_KEY,
    server_key: process.env.MOTIONPAY_TRANSFER_SERVER_KEY || process.env.MOTIONPAY_SERVER_KEY,
  });
  console.log('TRANSFER host ', process.env.MOTIONPAY_TRANSFER_BASE_URL);
  console.log('  ->', tr.status, '|', String(tr.ct).split(';')[0], '|', JSON.stringify(tr.body).slice(0, 80));

  // Deliberately wrong credentials on the QRIS host, to show what an auth
  // failure looks like versus what the transfer host is doing.
  const bad = await post(process.env.MOTIONPAY_QRIS_BASE_URL, '/priv/v1/pg/token', {
    client_key: 'nope', server_key: 'nope',
  });
  console.log('QRIS + bad creds -> ', bad.status, '|', String(bad.ct).split(';')[0], '|',
    JSON.stringify(bad.body).slice(0, 90));

  const ip = await axios.get('https://api.ipify.org?format=json', { timeout: T })
    .then((r) => r.data.ip).catch(() => 'unavailable');
  console.log('\nthis machine egress IP:', ip);
})();
