import { ROLE } from '@app/microservice';
import { PrismaClient } from '@auth/prisma';
import { randomUUID } from 'node:crypto';
import { RoleIds } from './role-engine.seed';
import { hashPassword, logSeeded, SEED_PASSWORD } from './seed.helper';

const MERCHANT_SIGNATURE_STATUS_ACTIVE = 'ACTIVE';

/** Ported verbatim from the legacy auth-service seed. */
const DEV_AGENTS = [
  {
    serial: 1,
    fullname: 'Agent One',
    phone: '0811111111',
    bankCode: '014',
    bankName: 'BCA',
    accountNumber: '1111111111',
  },
  {
    serial: 2,
    fullname: 'Agent Two',
    phone: '0822222222',
    bankCode: '002',
    bankName: 'BRI',
    accountNumber: '2222222222',
  },
  {
    serial: 3,
    fullname: 'Agent Three',
    phone: '0833333333',
    bankCode: '002',
    bankName: 'BRI',
    accountNumber: '3333333333',
  },
  {
    serial: 4,
    fullname: 'Agent Four',
    phone: '0844444444',
    bankCode: '014',
    bankName: 'BCA',
    accountNumber: '4444444444',
  },
];

const DEV_MERCHANTS = [
  {
    serial: 1,
    owner: 'Merchant Owner One',
    business: 'Merchant Business Name One',
    brand: 'Brand One',
    phone: '08954631470',
    nik: '2132467912356985',
    npwp: '01.234.567.8-901.111',
    bankCode: '008',
    bankName: 'Mandiri',
    accountNumber: '111111111',
  },
  {
    serial: 2,
    owner: 'Merchant Owner Two',
    business: 'Merchant Business Name Two',
    brand: 'Brand Two',
    phone: '08745369771',
    nik: '4120359785236541',
    npwp: '09.876.543.2-123.222',
    bankCode: '009',
    bankName: 'BNI',
    accountNumber: '222222222',
  },
  {
    serial: 3,
    owner: 'Merchant Owner Three',
    business: 'Merchant Business Name Three',
    brand: 'Brand Three',
    phone: '08741234943',
    nik: '2450367891024686',
    npwp: '10.443.252.9-534.333',
    bankCode: '009',
    bankName: 'BNI',
    accountNumber: '333333333',
  },
  {
    serial: 4,
    owner: 'Merchant Owner Four',
    business: 'Merchant Business Name Four',
    brand: 'Brand Four',
    phone: '082134759392',
    nik: '7510365987204613',
    npwp: '78.225.445.9-363.444',
    bankCode: '009',
    bankName: 'BNI',
    accountNumber: '444444444',
  },
];

/** Every dev merchant sits at the same address; only identity fields differ. */
const DEV_MERCHANT_ADDRESS = {
  province: 'Jakarta',
  regency: 'Jakarta Barat',
  district: 'Tanah Abang',
  village: 'Bendungan Hilir',
  postalCode: '10210',
};

/**
 * DEVELOPMENT ONLY - never run against production.
 *
 * Sample agents and merchants ported from the legacy auth-service seed, so a
 * fresh local database has something to log in as and something for the
 * dashboard's list, dropdown and config screens to show.
 *
 * Permissions are deliberately NOT seeded here.
 *
 * Idempotent: upserts on the unique `email`, and merchant signatures upsert on
 * the unique `userId` so their generated clientId stays stable across re-runs.
 */
export async function userDevSeed(
  prisma: PrismaClient,
  roleIds: RoleIds,
  system01Id: number,
): Promise<void> {
  const password = await hashPassword(SEED_PASSWORD);

  const agents = await prisma.$transaction(
    DEV_AGENTS.map((agent) => {
      const email = `agent${agent.serial}@example.com`;
      return prisma.user.upsert({
        where: { email },
        create: {
          email,
          password,
          roleId: roleIds[ROLE.AGENT],
          createdBy: system01Id,
          AgentDetail: {
            create: {
              fullname: agent.fullname,
              address: `Jl. Agent ${agent.serial}`,
              phone: agent.phone,
              bankCode: agent.bankCode,
              bankName: agent.bankName,
              accountNumber: agent.accountNumber,
              accountHolderName: `AGENT${agent.serial}`,
              createdBy: system01Id,
            },
          },
        },
        update: {},
        select: { id: true },
      });
    }),
  );

  const merchants = await prisma.$transaction(
    DEV_MERCHANTS.map((merchant) => {
      const email = `merchant${merchant.serial}@example.com`;
      return prisma.user.upsert({
        where: { email },
        create: {
          email,
          password,
          roleId: roleIds[ROLE.MERCHANT],
          createdBy: system01Id,
          MerchantDetail: {
            create: {
              ownerName: merchant.owner,
              businessName: merchant.business,
              brandName: merchant.brand,
              phoneNumber: merchant.phone,
              nik: merchant.nik,
              npwp: merchant.npwp,
              address: `Jl. Merchant ${merchant.serial}`,
              ...DEV_MERCHANT_ADDRESS,
              bankCode: merchant.bankCode,
              bankName: merchant.bankName,
              accountNumber: merchant.accountNumber,
              accountHolderName: `MERCHANT${merchant.serial}`,
              createdBy: system01Id,
            },
          },
        },
        update: {},
        select: { id: true },
      });
    }),
  );

  // A merchant cannot call the Open API without a signature record. Upserting on
  // userId keeps the clientId stable when the seed is re-run - regenerating it
  // would silently invalidate any credentials already handed out locally.
  await Promise.all(
    merchants.map((merchant) =>
      prisma.merchantSignature.upsert({
        where: { userId: merchant.id },
        create: {
          userId: merchant.id,
          clientId: `${merchant.id}-${randomUUID()}`,
          status: MERCHANT_SIGNATURE_STATUS_ACTIVE,
          createdBy: system01Id,
        },
        update: {},
      }),
    ),
  );

  logSeeded('dev agents', agents.length);
  logSeeded('dev merchants', merchants.length);
  logSeeded('dev merchant signatures', merchants.length);
}
