export const MOTIONPAY_QRIS_ENDPOINT = {
  TOKEN: '/priv/v1/pg/token',
  CREATE_QRIS_PAYMENT: '/payment/api/v1/qris/payment',
  /** Append the provider's `transaction_id` (the `FM-…` value), not our code. */
  QRIS_PAYMENT_STATUS: '/payment/api/v1/qris/payment-status',
} as const;

/**
 * Transfer (payout) endpoints.
 *
 * Separate from the QRIS block above because Transfer is a different product
 * on a different host with a different token endpoint — see
 * MotionPayConfig.TRANSFER_BASE_URL.
 */
export const MOTIONPAY_TRANSFER_ENDPOINT = {
  TOKEN: '/auth/v2/access-token',
  ACCOUNT_INQUIRY: '/transfer/api/v1/inquiry',
  FUND_TRANSFER: '/transfer/api/v1/payment',
  /** Append OUR `external_id` — unlike QRIS, status is keyed by our own id. */
  TRANSFER_STATUS: '/transfer/api/v1/status',
  BALANCE: '/transfer/api/v1/balance',
} as const;

/**
 * Transfer envelope `status.code` values. Note these are **strings**, not the
 * numbers QRIS uses — do not compare them against MOTIONPAY_STATUS_CODE.
 */
export const MOTIONPAY_TRANSFER_STATUS_CODE = {
  SUCCESS: '0001',
  PENDING: '0002',
  FAILED: '0003',
} as const;

/** `data.status` values on the Check Transfer Status response. */
export const MOTIONPAY_TRANSFER_STATUS = {
  SUCCESS: 'SUCCESS',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
} as const;

/** Documented bounds for transfer `amount`, in whole rupiah. */
export const MOTIONPAY_TRANSFER_AMOUNT = {
  MIN: 10_000,
  MAX: 50_000_000,
} as const;

/** Documented max length of the transfer `external_id`. */
export const MOTIONPAY_TRANSFER_EXTERNAL_ID_MAX_LENGTH = 50;

/**
 * Envelope `status.code` values.
 *
 * Note the asymmetry, which is in the provider's spec and not a mistake here:
 * the token endpoint signals success with 200, the payment endpoints with 0.
 * A single shared "is OK" check across all three would be wrong.
 */
export const MOTIONPAY_STATUS_CODE = {
  TOKEN_OK: 200,
  PAYMENT_OK: 0,
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  UNPROCESSABLE: 422,
} as const;

/** Wire values of `data.status`. The provider has no EXPIRED state. */
export const MOTIONPAY_TRANSACTION_STATUS = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

export const MOTIONPAY_QR_TYPE = {
  DYNAMIC: 'QRIS_DYNAMIC',
  STATIC: 'QRIS_STATIC',
} as const;

/** Documented bounds for `amount`, in whole rupiah. */
export const MOTIONPAY_AMOUNT = {
  MIN: 1_000,
  MAX: 10_000_000,
} as const;

/** Documented minimum for `session_time`, in minutes. */
export const MOTIONPAY_MIN_SESSION_TIME_MINUTES = 1;

/**
 * Documented max length of `external_id` / `terminal_id`.
 *
 * Flagged as an open question in docs/upstream/motionpay.md: the provider's own
 * samples exceed this (`"20c67336-dcea-42d8-a"` is 20 chars), and our
 * transaction code format does not fit in 16. We validate rather than truncate
 * — silently cutting a correlation key would break callback matching.
 */
export const MOTIONPAY_EXTERNAL_ID_MAX_LENGTH = 21;

/**
 * Bank / e-wallet codes accepted by MotionPay's Transfer service.
 *
 * Transcribed from their published list. Two things worth knowing before
 * validating against it:
 *
 * 1. **Codes are not all 3 characters**, despite the field being documented as
 *    `String, 3`. Syariah variants carry an `S` suffix (`013S`, `114S`) and
 *    e-wallets are words (`SHOPEEPAY`, `LINKAJA`). A `maxLength: 3` rule on
 *    `bank_code` would reject perfectly valid destinations — this list is the
 *    real contract, not the stated length.
 * 2. E-wallets sit in the same namespace as banks, so a "bank transfer" here
 *    can actually be a wallet top-up. Relevant when mapping to our own
 *    payment-method concepts.
 */
export const MOTIONPAY_BANK_CODE = {
  '002': 'Bank Rakyat Indonesia',
  '008': 'Bank Mandiri',
  '009': 'BNI (Bank Negara Indonesia)',
  '011': 'Bank Danamon & Danamon Syariah',
  '013': 'Permata',
  '013S': 'Permata Syariah',
  '014': 'Bank Central Asia',
  '016': 'Maybank Indonesia',
  '016S': 'Maybank Syariah',
  '019': 'Panin Bank',
  '022': 'CIMB Niaga & CIMB Niaga Syariah',
  '023': 'TMRW/UOB',
  '028': 'Bank OCBC NISP',
  '028S': 'Bank OCBC NISP Syariah',
  '031': 'Citibank',
  '033': 'Bank of America NA',
  '036': 'China Construction Bank Indonesia',
  '037': 'Bank Artha Graha Internasional',
  '042': 'Bank of Tokyo Mitsubishi UFJ',
  '046': 'DBS Indonesia',
  '047': 'Bank Resona Perdania',
  '048': 'Bank Mizuho Indonesia',
  '050': 'Standard Chartered Bank',
  '054': 'Bank Capital Indonesia',
  '057': 'BNP Paribas Indonesia',
  '061': 'ANZ Indonesia',
  '069': 'Bank of China (Hong Kong) Limited',
  '076': 'Bank Bumi Arta',
  '087': 'HSBC Indonesia',
  '088': 'Bank Antardaerah',
  '089': 'Rabobank International Indonesia',
  '095': 'Bank Jtrust Indonesia',
  '097': 'Bank Mayapada',
  '110': 'BJB',
  '111': 'Bank DKI',
  '112': 'Bank BPD DIY',
  '112S': 'Bank BPD DIY Syariah',
  '113': 'Bank Jateng',
  '114': 'Bank Jatim',
  '114S': 'Bank Jatim Syariah',
  '115': 'Bank Jambi',
  '115S': 'Bank Jambi Syariah',
  '116': 'Bank Aceh Syariah',
  '117': 'Bank Sumut',
  '117S': 'Bank Sumut Syariah',
  '118': 'Bank Nagari',
  '118S': 'Bank Nagari Syariah',
  '119': 'Bank Riau Kepri',
  '120': 'Bank Sumsel Babel',
  '120S': 'Bank Sumsel Babel Syariah',
  '121': 'Bank Lampung',
  '122': 'Bank Kalsel',
  '122S': 'Bank Kalsel Syariah',
  '123': 'Bank Kalbar',
  '123S': 'Bank Kalbar Syariah',
  '124': 'Bank Kaltimtara',
  '124S': 'Bank Kaltim Syariah',
  '125': 'Bank Kalteng',
  '126': 'Bank Sulselbar',
  '126S': 'Bank Sulselbar Syariah',
  '127': 'Bank SulutGo',
  '128': 'Bank NTB Syariah',
  '129': 'BPD Bali',
  '130': 'Bank NTT',
  '131': 'Bank Maluku',
  '132': 'Bank Papua',
  '133': 'Bank Bengkulu',
  '134': 'Bank Sulteng',
  '135': 'Bank Sultra',
  '137': 'BPD Banten',
  '145': 'Bank Nusantara Parahyangan',
  '146': 'Bank of India Indonesia',
  '147': 'Muamalat',
  '151': 'Bank Mestika Dharma',
  '152': 'Bank Shinhan Indonesia',
  '153': 'Bank Sinarmas',
  '153S': 'Bank Sinarmas Syariah',
  '157': 'Bank Maspion Indonesia',
  '161': 'Bank Ganesha',
  '164': 'ICBC Indonesia',
  '167': 'QNB Indonesia',
  '200': 'BTN',
  '200S': 'BTN Syariah',
  '203': 'Nobu (Nationalnobu) Bank',
  '212': 'Bank Woori Saudara',
  '213': 'BTPN',
  '405': 'Bank Victoria Syariah',
  '425': 'BJB Syariah',
  '426': 'Bank Mega',
  '441': 'Wokee/Bukopin',
  '451': 'BSI (Bank Syariah Indonesia)',
  '472': 'Bank Jasa Jakarta',
  '484': 'LINE Bank/KEB Hana',
  '485': 'Motion/MNC Bank',
  '490': 'Neo Commerce/Yudha Bhakti',
  '494': 'BRI Agroniaga',
  '498': 'SBI Indonesia',
  '501': 'Blu/BCA Digital',
  '506': 'Bank Mega Syariah',
  '513': 'Bank Ina Perdana',
  '517': 'Panin Dubai Syariah',
  '520': 'Bank Prima Master',
  '521': 'Bank Bukopin Syariah',
  '523': 'Bank Sahabat Sampoerna',
  '526': 'Bank Dinar Indonesia',
  '531': 'Bank Amar Indonesia',
  '535': 'Seabank/Bank BKE',
  '536': 'BCA (Bank Central Asia) Syariah',
  '542': 'Jago/Artos',
  '542S': 'Bank Jago Syariah',
  '547': 'Bank BTPN Syariah',
  '548': 'Bank Multi Arta Sentosa (Bank MAS)',
  '553': 'Bank Mayora Indonesia',
  '555': 'Bank Index Selindo',
  '559': 'Bank CNB (Centratama Nasional Bank)',
  '562': 'Superbank',
  '564': 'Bank MANTAP (Mandiri Taspen)',
  '566': 'Bank Victoria International',
  '567': 'Allo Bank/Bank Harda Internasional',
  '724': 'Bank DKI Syariah',
  '725': 'Bank Jateng Syariah',
  '867': 'BPR EKA (Bank Eka)',
  '945': 'Bank IBK Indonesia',
  '947': 'Bank Aladin Syariah',
  '949': 'CTBC (Chinatrust) Indonesia',
  '950': 'Commonwealth Bank',
  LINKAJA: 'LinkAja',
  SHOPEEPAY: 'ShopeePay',
  GOPAY: 'GoPay',
  OVO: 'OVO',
  DANA: 'Dana',
} as const;

export type MotionPayBankCode =
  (typeof MOTIONPAY_BANK_CODE)[keyof typeof MOTIONPAY_BANK_CODE];

/** Longest code in the list — used to bound `bank_code` without under-sizing it. */
export const MOTIONPAY_BANK_CODE_MAX_LENGTH = Math.max(
  ...Object.keys(MOTIONPAY_BANK_CODE).map((code) => code.length),
);

export function isKnownMotionPayBankCode(
  code: string,
): code is MotionPayBankCode {
  return Object.prototype.hasOwnProperty.call(MOTIONPAY_BANK_CODE, code);
}
