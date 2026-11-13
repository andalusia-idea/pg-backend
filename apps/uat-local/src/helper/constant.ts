import { CreateMerchantDto } from 'apps/dashboard/src/modules/user/dto/create-merchant.dto';
import { CreateAgentDto } from 'apps/dashboard/src/modules/user/dto/create-agent.dto';
import { UpsertBaseFeeDto } from 'apps/dashboard/src/super-admin/dto/base-fee.dto';
import {
  ProviderNameEnum,
  PaymentMethodNameEnum,
  TransactionTypeEnum,
} from '@app/microservice/microservice.enum';
import Decimal from 'decimal.js';
import {
  SettlementWindowBody,
  UpsertMerchantAgentShareholderBody,
  UpsertMerchantFeeBody,
} from './api';
import { ActionEnum } from 'apps/dashboard/src/modules/config-merchant/config-merchant.constant';
import { CreateAdminDto } from 'apps/dashboard/src/super-admin/dto/create-admin.dto';

export const DASHBOARD_BASE_URL =
  process.env.DASHBOARD_BASE_URL ?? 'http://localhost:3000';
export const TRANSACTION_BASE_URL =
  process.env.TRANSACTION_BASE_URL ?? 'http://localhost:3003';
export const PORT = process.env.PORT ?? '3010';

export const ADMIN_1 = 'admin1@example.com';
export const ADMIN_PASSWORD = 'password123456789';

export const MERCHANT_1 = 'merchant1@example.com';
export const MERCHANT_2 = 'merchant2@example.com';
export const MERCHANT_3 = 'merchant3@example.com';
export const MERCHANT_4 = 'merchant4@example.com';
export const MERCHANT_PASSWORD = 'password123456789';

export const AGENT_1 = 'agent1@example.com';
export const AGENT_2 = 'agent2@example.com';
export const AGENT_3 = 'agent3@example.com';
export const AGENT_4 = 'agent4@example.com';
export const AGENT_PASSWORD = 'password123456789';

export const AGENT_INTERNAL_EMAIL = 'agentinternal@pg.id';
export const AGENT_INTERNAL_PASSWORD = 'password123456789';

export const SUPER_ADMIN_EMAIL = 'superadmin@pg.id';
export const SUPER_ADMIN_PASSWORD = 'password123456789';

export const ADMINS: CreateAdminDto[] = [
  {
    email: ADMIN_1,
    password: ADMIN_PASSWORD,
    fullname: 'Admin one',
    address: 'Jalan Admin one',
    phone: '0894236579812111',
  },
];

export const PROVIDERS = [
  ProviderNameEnum.INTERNAL,
  ProviderNameEnum.JATELINDO,
  ProviderNameEnum.MOTIONPAY,
];

const now = '2026-01-01T00:00:00+07:00';
const SETTLEMENT_WINDOWS_MOTIONPAY: SettlementWindowBody[] = [
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.QRIS,
    label: 'DAILY',
    settlementOffset: 1,
    settlementTime: '15:00',
    businessDaysOnly: false,
    // A full day is windowEnd equal to windowStart - "24:00" is refused, so
    // there is one spelling. The offset is 0 because the window opens on the
    // day it closes; -1 is for a window opening the evening before it closes,
    // as a partner's batch 1 does.
    windowStart: '00:00',
    windowStartDayOffset: 0,
    windowEnd: '00:00',
    effectiveFrom: now,
  },
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.DIRECTEWALLET,
    label: 'DAILY',
    settlementOffset: 3,
    // No settlementTime on purpose: MotionPay publishes no hour for H+3. The
    // service maps the missing field to null, which eligibility reads as end
    // of day rather than start, so we never release before they plausibly have.
    businessDaysOnly: false,
    windowStart: '00:00',
    windowStartDayOffset: 0,
    windowEnd: '00:00',
    effectiveFrom: now,
  },
];

/*
 * MotionPay only, and Jatelindo's absence is the deliberate part.
 *
 * A window affects *payin* settlement and nothing else: the claim reads
 * `transaction.PurchaseTransaction`, so a schedule for a payout rail can never
 * match a row. Jatelindo is payout-only today - its base fees are WITHDRAW and
 * DISBURSEMENT, and it is wired under `upstream/jatelindo/transfer`, never under
 * `api-v1/purchase` - so windows for TRANSFERBANK or the TRANSFEREWALLET_*
 * methods would be inert at best. At worst they are noise: the enqueuer fans a
 * `'*'` FOLLOW_UPSTREAM policy into one run per method that has a window, and
 * every one of those runs would claim nothing.
 *
 * Give a provider windows the day it serves a purchase rail. Several payin
 * methods on one schedule means one row each - `paymentMethodName` has no `'*'`
 * sentinel, because a partner publishes per product and a default here would
 * silence the "nobody entered this schedule" check - so build them with a
 * flatMap rather than by hand if that day brings more than a couple.
 *
 * Two batches on one rail still has coverage in test/upstream.spec.ts, which
 * exercises the endpoint rather than modelling a rail that settles.
 */
export const SETTLEMENT_WINDOWS: SettlementWindowBody[] = [
  ...SETTLEMENT_WINDOWS_MOTIONPAY,
];

const address = {
  province: 'Jakarta',
  regency: 'Jakarta Barat',
  district: 'Tanah Abang',
  village: 'Bendungan Hilir',
  postalCode: '10210',
  coordinate: null,
  ktpImage: null,
  siupFile: null,
};

export const MERCHANTS: Array<CreateMerchantDto> = [
  {
    email: MERCHANT_1,
    password: MERCHANT_PASSWORD,
    ownerName: 'Merchant Owner One',
    businessName: 'Merchant Business Name One',
    brandName: 'Brand One',
    phoneNumber: '08954631470',
    nik: '2132467912356985',
    npwp: '01.234.567.8-901.111',
    bankCode: '008',
    bankName: 'Mandiri',
    accountNumber: '111111111',
    accountHolderName: `Merchant ${MERCHANT_1}`,
    address: `Jl. Merchant ${MERCHANT_1}`,
    ...address,
  },
  {
    email: MERCHANT_2,
    password: MERCHANT_PASSWORD,
    ownerName: 'Merchant Owner Two',
    businessName: 'Merchant Business Name Two',
    brandName: 'Brand Two',
    phoneNumber: '08745369771',
    nik: '4120359785236541',
    npwp: '09.876.543.2-123.222',
    bankCode: '009',
    bankName: 'BNI',
    accountNumber: '222222222',
    accountHolderName: `Merchant ${MERCHANT_2}`,
    address: `Jl. Merchant ${MERCHANT_2}`,
    ...address,
  },
  {
    email: MERCHANT_3,
    password: MERCHANT_PASSWORD,
    ownerName: 'Merchant Owner Three',
    businessName: 'Merchant Business Name Three',
    brandName: 'Brand Three',
    phoneNumber: '08741234943',
    nik: '2450367891024686',
    npwp: '10.443.252.9-534.333',
    bankCode: '009',
    bankName: 'BNI',
    accountNumber: '333333333',
    accountHolderName: `Merchant ${MERCHANT_3}`,
    address: `Jl. Merchant ${MERCHANT_3}`,
    ...address,
  },
  {
    email: MERCHANT_4,
    password: MERCHANT_PASSWORD,
    ownerName: 'Merchant Owner Four',
    businessName: 'Merchant Business Name Four',
    brandName: 'Brand Four',
    phoneNumber: '082134759392',
    nik: '7510365987204613',
    npwp: '78.225.445.9-363.444',
    bankCode: '009',
    bankName: 'BNI',
    accountNumber: '444444444',
    accountHolderName: `Merchant ${MERCHANT_4}`,
    address: `Jl. Merchant ${MERCHANT_4}`,
    ...address,
  },
];

export const AGENTS: Array<CreateAgentDto> = [
  {
    email: AGENT_1,
    password: AGENT_PASSWORD,
    fullname: 'Agent One',
    phone: '0811111111',
    bankCode: '014',
    bankName: 'BCA',
    accountNumber: '1111111111',
    accountHolderName: `Agent ${AGENT_1}`,
    address: `Jl. Merchant ${AGENT_1}`,
  },
  {
    email: AGENT_2,
    password: AGENT_PASSWORD,
    fullname: 'Agent Two',
    phone: '0822222222',
    bankCode: '002',
    bankName: 'BRI',
    accountNumber: '2222222222',
    accountHolderName: `Agent ${AGENT_2}`,
    address: `Jl. Merchant ${AGENT_2}`,
  },
  {
    email: AGENT_3,
    password: AGENT_PASSWORD,
    fullname: 'Agent Three',
    phone: '0833333333',
    bankCode: '002',
    bankName: 'BRI',
    accountNumber: '3333333333',
    accountHolderName: `Agent ${AGENT_3}`,
    address: `Jl. Merchant ${AGENT_3}`,
  },
  {
    email: AGENT_4,
    password: AGENT_PASSWORD,
    fullname: 'Agent Four',
    phone: '0844444444',
    bankCode: '014',
    bankName: 'BCA',
    accountNumber: '4444444444',
    accountHolderName: `Agent ${AGENT_4}`,
    address: `Jl. Merchant ${AGENT_4}`,
  },
];

const ZERO = new Decimal(0).toFixed(2);

const BASE_FEES_MOTIONPAY: Array<UpsertBaseFeeDto> = [
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.QRIS,
    transactionType: TransactionTypeEnum.PURCHASE,
    isActive: true,
    feeProviderFixed: ZERO,
    feeProviderPercentage: new Decimal(0.9).toFixed(4),
  },
];

const BASE_FEES_JATELINDO: Array<UpsertBaseFeeDto> = [
  {
    providerName: ProviderNameEnum.JATELINDO,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    transactionType: TransactionTypeEnum.WITHDRAW,
    isActive: true,
    feeProviderFixed: new Decimal(500).toFixed(2),
    feeProviderPercentage: ZERO,
  },
  {
    providerName: ProviderNameEnum.JATELINDO,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    transactionType: TransactionTypeEnum.DISBURSEMENT,
    isActive: true,
    feeProviderFixed: new Decimal(1_500).toFixed(2),
    feeProviderPercentage: ZERO,
  },

  {
    providerName: ProviderNameEnum.JATELINDO,
    paymentMethodName: PaymentMethodNameEnum.TRANSFEREWALLET_DANA,
    transactionType: TransactionTypeEnum.DISBURSEMENT,
    isActive: true,
    feeProviderFixed: new Decimal(350).toFixed(2),
    feeProviderPercentage: ZERO,
  },
  {
    providerName: ProviderNameEnum.JATELINDO,
    paymentMethodName: PaymentMethodNameEnum.TRANSFEREWALLET_GOPAY,
    transactionType: TransactionTypeEnum.DISBURSEMENT,
    isActive: true,
    feeProviderFixed: new Decimal(500).toFixed(2),
    feeProviderPercentage: ZERO,
  },
  {
    providerName: ProviderNameEnum.JATELINDO,
    paymentMethodName: PaymentMethodNameEnum.TRANSFEREWALLET_OVO,
    transactionType: TransactionTypeEnum.DISBURSEMENT,
    isActive: true,
    feeProviderFixed: new Decimal(700).toFixed(2),
    feeProviderPercentage: ZERO,
  },
  {
    providerName: ProviderNameEnum.JATELINDO,
    paymentMethodName: PaymentMethodNameEnum.TRANSFEREWALLET_SHOPEEPAY,
    transactionType: TransactionTypeEnum.DISBURSEMENT,
    isActive: true,
    feeProviderFixed: new Decimal(650).toFixed(2),
    feeProviderPercentage: ZERO,
  },
];

export const BASE_FEES: Array<UpsertBaseFeeDto> = [
  ...BASE_FEES_MOTIONPAY,
  ...BASE_FEES_JATELINDO,
];

const buildCode = (
  providerName: ProviderNameEnum,
  paymentMethodName: PaymentMethodNameEnum,
  transactionType: TransactionTypeEnum,
) => {
  return `${providerName}_${paymentMethodName}_${transactionType}`;
};

export const baseFeeCode = (
  dtos: Array<{
    providerName: ProviderNameEnum;
    paymentMethodName: PaymentMethodNameEnum;
    transactionType: TransactionTypeEnum;
  }>,
) => {
  return dtos.map((dto) => {
    return buildCode(
      dto.providerName,
      dto.paymentMethodName,
      dto.transactionType,
    );
  });
};

export const BASE_FEE_CODES = baseFeeCode(BASE_FEES);

// feeInternalFixed;
// feeInternalPercentage;
// feeAgentFixed;
// feeAgentPercentage;
const MATRIX_MERCHANT_FEE = new Map<string, Map<string, Array<number>>>([
  [
    buildCode('MOTIONPAY', 'QRIS', 'PURCHASE'),
    new Map([
      [MERCHANT_1, [0, 0.1, 0, 0.05]],
      [MERCHANT_2, [0, 0.05, 0, 0.05]],
      [MERCHANT_3, [0, 0.15, 0, 0.075]],
      [MERCHANT_4, [0, 0.2, 0, 0]],
    ]),
  ],
  [
    buildCode('JATELINDO', 'TRANSFERBANK', 'WITHDRAW'),
    new Map([
      [MERCHANT_1, [150, 0, 50, 0]],
      [MERCHANT_2, [100, 0, 50, 0]],
      [MERCHANT_3, [200, 0, 30, 0]],
      [MERCHANT_4, [200, 0, 0, 0]],
    ]),
  ],
  [
    buildCode('JATELINDO', 'TRANSFERBANK', 'DISBURSEMENT'),
    new Map([
      [MERCHANT_1, [150, 0, 50, 0]],
      [MERCHANT_2, [100, 0, 50, 0]],
      [MERCHANT_3, [200, 0, 30, 0]],
      [MERCHANT_4, [200, 0, 0, 0]],
    ]),
  ],
  [
    buildCode('JATELINDO', 'TRANSFEREWALLET_DANA', 'DISBURSEMENT'),
    new Map([
      [MERCHANT_1, [175, 0, 50, 0]],
      [MERCHANT_2, [125, 0, 100, 0]],
      [MERCHANT_3, [100, 0, 60, 0]],
      [MERCHANT_4, [225, 0, 0, 0]],
    ]),
  ],
  [
    buildCode('JATELINDO', 'TRANSFEREWALLET_GOPAY', 'DISBURSEMENT'),
    new Map([
      [MERCHANT_1, [75, 0, 50, 0]],
      [MERCHANT_2, [50, 0, 50, 0]],
      [MERCHANT_3, [25, 0, 60, 0]],
      [MERCHANT_4, [125, 0, 0, 0]],
    ]),
  ],
  [
    buildCode('JATELINDO', 'TRANSFEREWALLET_OVO', 'DISBURSEMENT'),
    new Map([
      [MERCHANT_1, [75, 0, 50, 0]],
      [MERCHANT_2, [50, 0, 50, 0]],
      [MERCHANT_3, [25, 0, 60, 0]],
      [MERCHANT_4, [125, 0, 0, 0]],
    ]),
  ],
  [
    buildCode('JATELINDO', 'TRANSFEREWALLET_SHOPEEPAY', 'DISBURSEMENT'),
    new Map([
      [MERCHANT_1, [175, 0, 50, 0]],
      [MERCHANT_2, [125, 0, 100, 0]],
      [MERCHANT_3, [100, 0, 60, 0]],
      [MERCHANT_4, [225, 0, 0, 0]],
    ]),
  ],
]);

/**
 * MERCHANT_1 = Punya 1 agent
 * MERCHANT_2 = Punya 2 agent
 * MERCHANT_3 = Punya 3 agent
 * MERCHANT_4 = Punya 0 agent
 */

export const MERCHANT_FEES = (): Map<string, UpsertMerchantFeeBody[]> => {
  const map = new Map<string, UpsertMerchantFeeBody[]>();
  for (const [code, value] of MATRIX_MERCHANT_FEE) {
    for (const [email, fees] of value) {
      const body: UpsertMerchantFeeBody = {
        action: ActionEnum.I,
        // `baseFeeId` is absent by type, not left at a placeholder: the id is
        // only knowable at run time, and a 0 sitting in the fixture is one
        // forgotten resolution away from writing a fee against the wrong rail.
        code: code,
        feeInternalFixed: new Decimal(fees[0]).toFixed(2),
        feeInternalPercentage: new Decimal(fees[1]).toFixed(4),
        feeAgentFixed: new Decimal(fees[2]).toFixed(2),
        feeAgentPercentage: new Decimal(fees[3]).toFixed(4),
      };
      const old = map.get(email) ?? [];
      map.set(email, [...old, body]);
    }
  }
  return map;
};

const MATRIX_AGENT_SHAREHOLDER = new Map<
  string,
  Array<{ email: string; percent: number }>
>([
  [MERCHANT_1, [{ email: AGENT_1, percent: 100 }]],
  [
    MERCHANT_2,
    [
      { email: AGENT_1, percent: 30 },
      { email: AGENT_2, percent: 70 },
    ],
  ],
  [
    MERCHANT_3,
    [
      { email: AGENT_1, percent: 30 },
      { email: AGENT_3, percent: 30 },
      { email: AGENT_4, percent: 40 },
    ],
  ],
  [MERCHANT_4, []],
]);

export const AGENT_SHAREHOLDERS = (): Map<
  string,
  UpsertMerchantAgentShareholderBody[]
> => {
  const map = new Map<string, UpsertMerchantAgentShareholderBody[]>();

  for (const [emailMerchant, value] of MATRIX_AGENT_SHAREHOLDER) {
    // Seeded before the inner loop so a merchant with no agents gets an empty
    // array rather than no key at all. MERCHANT_4 is that merchant, and
    // `map.get(email)!` on a missing key is a TypeError rather than a skip.
    map.set(emailMerchant, []);

    for (const share of value) {
      // As with `baseFeeId`: `agentId` is absent by type and resolved from
      // `email` at run time, so it cannot be posted as a placeholder.
      const body: UpsertMerchantAgentShareholderBody = {
        action: ActionEnum.I,
        email: share.email,
        percentagePerAgent: new Decimal(share.percent).toFixed(4),
      };
      map.set(emailMerchant, [...map.get(emailMerchant)!, body]);
    }
  }

  return map;
};

// export const AGENT_SHAREHOLDER = new Map<
//   string,
//   UpsertMerchantAgentShareholderBody[]
// >([[MERCHANT_1, [{
//   action: ActionEnum.I
// }]]]);
