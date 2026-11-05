import { CreateMerchantDto } from 'apps/dashboard/src/modules/user/dto/create-merchant.dto';
import { CreateAgentDto } from 'apps/dashboard/src/modules/user/dto/create-agent.dto';

export const DASHBOARD_BASE_URL =
  process.env.DASHBOARD_BASE_URL ?? 'http://localhost:3000';
export const TRANSACTION_BASE_URL =
  process.env.TRANSACTION_BASE_URL ?? 'http://localhost:3003';
export const PORT = process.env.PORT ?? '3010';

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
