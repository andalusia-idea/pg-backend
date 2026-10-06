import { EWalletEnum, TransactionStatusEnum } from '@app/microservice';

export const JATELINDO_ENDPOINT = {
  /// Transfer
  LOGIN: '/Host/Transfer/Session/Login',
  BALANCE_INQUIRY: '/Host/Transfer/Account/BalanceInquiry',
  INQUIRY: '/Host/Transfer/Transaction/Inquiry',
  SINGLE_TRANSFER: '/Host/Transfer/Transaction/SingleTransfer',
  TRANSACTION_STATUS: '/Host/Transfer/Transaction/Status',
};

export const JATELINDO_RESPONSE_CODE = {
  PROCESSED: 'A00',
  REQUESTED: 'A01',
  DUPLICATE_TRANSACTION: 'P16',
  TRANSACTION_FAILED: 'T40',
  TRANSACTION_BLOCKED: 'T40',
  INACTIVE_ACCOUNT: 'S14',
  TRANSACTION_AMOUNT_ABOVE_LIMIT: 'T18',
  TRANSACTION_REJECTED: 'T40',
  TRANSACTION_AMOUNT_BELOW_LIMIT: 'T16',
  INVALID_ACCOUNT: 'S14',
  UNKNOWN_ERROR: 'E99',
  TIMEOUT: 'E18',
  UNAUTHORIZED_ACCESS: 'A90',
  NO_TRANSACTION: 'S84',
  /// TODO complete the rest
} as const;
export type JATELINDO_RESPONSE_CODE =
  (typeof JATELINDO_RESPONSE_CODE)[keyof typeof JATELINDO_RESPONSE_CODE];

/**
 * Response code to our transaction status, per the spec's own table.
 *
 * **The column that matters is "Need Check Status".** Three codes carry `Y`, and
 * the spec calls their status `SUSPECT` - Jatelindo is saying it cannot confirm
 * the outcome and a status call is required. Those must become `PENDING`:
 *
 * - `A01 REQUESTED` - the normal response to an accepted transfer
 * - `E99 UNKNOWN_ERROR`
 * - `E18 TIMEOUT`
 *
 * **Never a terminal state for those.** Marking a SUSPECT payout FAILED,
 * CANCELLED or EXPIRED asserts something the provider has explicitly said it
 * does not know - and a merchant told their payout failed will retry, paying the
 * recipient twice. `PENDING` is the state that means "unresolved, poll it", which
 * is exactly what `Need Check = Y` asks for.
 *
 * Nothing maps to CANCELLED or EXPIRED: Jatelindo has neither concept for a
 * payout. Every `Need Check = N` code is a verified FAILED.
 *
 * Typed as an exhaustive record so a new response code is a compile error here
 * rather than silently taking a default. Table: docs/upstream/jatelindo.md §4.
 */
const JATELINDO_STATUS_BY_RESPONSE_CODE = {
  A00: TransactionStatusEnum.SUCCESS,

  // Need Check = Y / SUSPECT. Outcome unknown, not failed.
  A01: TransactionStatusEnum.PENDING,
  E99: TransactionStatusEnum.PENDING,
  E18: TransactionStatusEnum.PENDING,

  // Need Check = N. The provider answered, and the answer was no.
  P16: TransactionStatusEnum.FAILED,
  T40: TransactionStatusEnum.FAILED,
  T16: TransactionStatusEnum.FAILED,
  T18: TransactionStatusEnum.FAILED,
  S14: TransactionStatusEnum.FAILED,
  A90: TransactionStatusEnum.FAILED,
  S84: TransactionStatusEnum.FAILED,
} as const satisfies Record<JATELINDO_RESPONSE_CODE, TransactionStatusEnum>;

/**
 * An unrecognised code is treated as unresolved, not as failed.
 *
 * The opposite default would turn any code Jatelindo adds - they have added four
 * since 2024 - into a payout we declare dead without checking. Leaving it PENDING
 * costs a status call; getting it wrong costs a double payment.
 */
export const jatelindoMapperResponseCode = (
  responseCode: JATELINDO_RESPONSE_CODE,
): TransactionStatusEnum =>
  JATELINDO_STATUS_BY_RESPONSE_CODE[responseCode] ??
  TransactionStatusEnum.PENDING;

/**
 * Our `bankCode` to Jatelindo's `channelId`.
 *
 * **`channelId` is numeric, for e-wallets as much as for banks.** The e-wallet
 * codes sit in a 90x block and were added in spec v1.6; sending the wallet's
 * *name* is rejected. See docs/upstream/jatelindo.md §3.
 *
 * The two numbering schemes are unrelated: ours is the Indonesian clearing code
 * (`014` = BCA), Jatelindo's is its own sequence running to 142. There is no
 * formula between them - every destination needs a row here, and a missing row
 * means `JATELINDO_CHANNEL[bankCode]` is `undefined`, which the signature then
 * renders as an empty `channelId=` and the provider refuses.
 *
 * Note LinkAja is absent from Jatelindo's list entirely, so a merchant routed
 * here cannot reach it even though MotionPay can.
 */
export const JATELINDO_CHANNEL = {
  // E-wallets. Spec v1.6, "List Channel Transfer".
  [EWalletEnum.DANA]: '901',
  [EWalletEnum.SHOPEEPAY]: '902',
  [EWalletEnum.GOPAY]: '903',
  [EWalletEnum.OVO]: '904',

  // Banks: 74 of our 91 mapped, from the spec v1.7 channel list.
  //
  // 17 are deliberately absent rather than guessed - renames where our name and
  // theirs are different eras of the same bank, our 022 label, their duplicate
  // Bali entry, and banks they do not carry at all. docs/upstream/jatelindo.md §3
  // lists each with the reason. A missing row fails loudly; a wrong row pays a
  // stranger, so absent is the safer default until someone confirms.

  // Bank Umum Nasional (24)
  '014': '4', // BCA = PT. BANK CENTRAL ASIA Tbk.
  '008': '3', // MANDIRI = PT. BANK MANDIRI Tbk.
  '009': '5', // BNI = PT. BNI 1946 (Persero) Tbk.
  '002': '6', // BRI = PT.BRI (Persero) Tbk.
  '200': '8', // BTN = PT. BANK TABUNGAN NEGARA (Persero)
  '013': '2', // PERMATA = PT. BANK PERMATA Tbk.
  '011': '10', // DANAMON = PT BANK DANAMON INDONESIA Tbk
  '016': '142', // MAYBANK INDONESIA = PT. Bank Maybank Indonesia
  '426': '11', // MEGA = PT. BANK MEGA Tbk.
  '153': '123', // SINARMAS = PT. BANK SINARMAS
  '028': '15', // OCBC NISP = PT. BANK OCBC NISP Tbk.
  '441': '19', // BUKOPIN (KB BUKOPIN) = PT. BUKOPIN
  '019': '119', // PANIN = PT. BANK PAN INDONESIA Tbk. (PAN
  '213': '17', // BTPN / Jenius = PT. BANK TABUNGAN PENSIUNAN NASIONAL
  '950': '136', // COMMONWEALTH = PT. BANK COMMONWEALTH
  '023': '16', // UOB INDONESIA = PT. BANK UOB INDONESIA
  '054': '141', // CAPITAL INDONESIA = PT. BANK CAPITAL INDONESIA
  '097': '87', // MAYAPADA = PT. BANK MAYAPADA
  '157': '86', // MASPION = PT. BANK MASPION INDONESIA
  '161': '72', // GANESHA = PT. BANK GANESHA
  '566': '132', // VICTORIA INTERNATIONAL = PT. BANK VICTORIA INTERNATIONAL
  '555': '137', // INDEX SELINDO = PT. BANK INDEX SELINDO
  '513': '79', // INA PERDANA = PT. BANK INA PERDANA
  '553': '88', // MAYORA INDONESIA = PT. BANK MAYORA INDONESIA

  // Digital (1)
  '535': '125', // Seabank = PT BANK SEABANK INDONESIA

  // Syariah (9)
  '451': '7', // Bank Syariah Indonesia (BSI) = PT BANK SYARIAH INDONESIA TBK
  '147': '18', // Bank Muamalat = PT. BANK MUAMALAT INDONESIA
  '536': '21', // BCA Syariah = PT. BANK BCA SYARIAH
  '506': '23', // Bank Mega Syariah = PT. BANK SYARIAH MEGA INDONESIA
  '517': '22', // Bank Panin Dubai Syariah = PT. Bank Panin Syariah
  '425': '35', // Bank BJB Syariah = PT. BANK JABAR BANTEN SYARIAH
  '116': '29', // BPD Aceh Syariah = PT. Bank Aceh Syariah
  '521': '27', // KB Bukopin Syariah = PT BANK SYARIAH BUKOPIN
  '947': '25', // Bank Aladin Syariah = PT BANK ALADIN SYARIAH Tbk

  // Bank Pembangunan Daerah (25)
  '110': '99', // Bank BJB = PT. BANK JABAR DAN BANTEN
  '111': '135', // Bank DKI = PT. BPD DKI JAKARTA
  '112': '118', // BPD DIY = PT. BANK PEMBANGUNAN DAERAH DIY
  '113': '100', // Bank Jateng = PT. BPD JAWA TENGAH
  '114': '102', // Bank Jatim = BPD JATIM
  '115': '101', // BPD Jambi = PT.BANK PEMBANGUNAN DAERAH JAMBI
  '117': '113', // Bank Sumut = BPD SUMATERA UTARA
  '118': '112', // Bank Nagari (Sumbar) = BPD SUMATERA BARAT
  '119': '111', // Bank Riau Kepri = PT.BANK PEMBANGUNAN DAERAH RIAU
  '120': '61', // Bank Sumsel Babel = BPD SUMSEL DAN BABEL
  '121': '107', // Bank Lampung = BPD LAMPUNG
  '122': '105', // Bank Kalsel = BPD KALIMANTAN SELATAN
  '123': '103', // Bank Kalbar = PT.BPD KALIMANTAN BARAT
  '124': '106', // Bank Kaltimtara = PT.BPD KALTIM DAN KALTARA
  '125': '104', // Bank Kalteng = PT. BPD KALTENG
  '126': '116', // Bank Sulselbar = PT BPD SULAWESI SELATAN
  '127': '109', // Bank NTB = PT. BANK PEMBANGUNAN DAERAH NTB
  '128': '117', // Bank SulutGo = BPD SULAWESI UTARA
  '130': '110', // Bank NTT = BPD NUSA TENGGARA TIMUR
  '131': '108', // Bank Muluku Malut = PT. BPD MALUKU DAN MALUKU UTARA
  '132': '98', // Bank Papua = PT.BANK PEMBANGUNAN DAERAH PAPUA
  '133': '97', // Bank Bengkulu = PT. BPD BENGKULU
  '134': '114', // Bank Sulteng = PT.BPD SULAWESI TENGAH
  '135': '115', // Bank Sultra = PT.BPD SULAWESI TENGGARA
  '137': '96', // Bank Banten = PT. BPD BANTEN, Tbk

  // Bank Asing (15)
  '041': '14', // HSBC = PT BANK HSBC INDONESIA
  '050': '124', // Standart Chartered = STANDARD CHARTERED BANK
  '032': '64', // JP Morgan Chase = JPMORGAN CHASE BANK, NA
  '033': '55', // Bank of America = BANK OF AMERICA , NA
  '046': '68', // DBS Indonesia = PT. BANK DBS INDONESIA
  '069': '138', // Bank of China = Bank of China (Hongkong) Limited
  '048': '93', // Mizuho Bank = PT. BANK MIZUHO INDONESIA
  '042': '57', // MUFG Bank = MUFG BANK LTD
  '061': '12', // ANZ Indonesia = PT. ANZ PANIN BANK
  '067': '69', // Deutsche Bank = DEUTSCHE BANK AG
  '057': '54', // BNP Paribas = PT. BANK BNP PARIBAS INDONESIA
  '040': '139', // Bangkok Bank = THE BANGKOK BANK PCL
  '036': '89', // China Construction Bank (CCB) = BANK CHINA CONSTRUCTION BANK IND
  '164': '77', // ICBC Indonesia = PT. BANK ICBC INDONESIA
  '047': '59', // Resona Perdania = PT. BANK RESONA PERDANIA
} as const;
