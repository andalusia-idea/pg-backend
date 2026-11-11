import { ResponseDto } from 'apps/dashboard/src/shared/response.dto';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import {
  AGENT_INTERNAL_EMAIL,
  AGENT_INTERNAL_PASSWORD,
  DASHBOARD_BASE_URL,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASSWORD,
} from './constant';
import axios, { AxiosRequestConfig } from 'axios';
import { UpsertBaseFeeDto } from 'apps/dashboard/src/super-admin/dto/base-fee.dto';
import {
  ProviderDto,
  RetireProviderDto,
  UpsertProviderDto,
} from 'apps/dashboard/src/super-admin/dto/provider.dto';
import {
  SettlementWindowDto,
  UpsertSettlementWindowDto,
} from 'apps/dashboard/src/super-admin/dto/settlement-window.dto';
import { BaseFeeDto } from 'apps/dashboard/src/modules/config-fee/dto/base-fee.dto';
import { MerchantConfigDto } from 'apps/dashboard/src/modules/config-merchant/dto/merchant-config.dto';
import {
  UpsertMerchantAgentShareholderDto,
  UpsertMerchantFeeDto,
} from 'apps/dashboard/src/modules/config-merchant/dto/upsert-merchant-fee.dto';
import { CreateAgentDto } from 'apps/dashboard/src/modules/user/dto/create-agent.dto';
import { CreateMerchantDto } from 'apps/dashboard/src/modules/user/dto/create-merchant.dto';
import { MerchantSignatureStatusDto } from 'apps/dashboard/src/modules/merchant-signature/dto/merchant-signature-status.dto';
import { RegisterWebhookUrlDto } from 'apps/dashboard/src/modules/merchant-signature/dto/register-webhook-url.dto';
import { SignedRequest } from '../merchant/merchant-signer';
import { TRANSACTION_BASE_URL } from './constant';

export const callDashboard = async <T>(
  config: AxiosRequestConfig,
): Promise<ResponseDto<T>> => {
  try {
    const configRequest: AxiosRequestConfig = {
      baseURL: DASHBOARD_BASE_URL,
      ...config,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
    };
    const ress = await axios.request<ResponseDto<T>>(configRequest);
    return ress.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const { status, data } = error.response ?? {};
      throw new Error(
        `${config.method} ${config.url} -> ${status ?? error.code} ${JSON.stringify(data)}`,
      );
    }
    throw error;
  }
};

/**
 * Any principal, by email. `/api/v1/login` gates on nothing but the password -
 * `validateUser` does not look at the role - so a merchant signs in here the
 * same way an admin does, which is how a spec learns a merchant's own id.
 */
export const login = async (email: string, password: string) => {
  const res = await callDashboard<AuthDto>({
    method: 'POST',
    url: '/api/v1/login',
    data: { email, password },
  });
  return res.data!;
};

export const loginSuperAdmin = async () =>
  login(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

export const loginAgentInternal = async () =>
  login(AGENT_INTERNAL_EMAIL, AGENT_INTERNAL_PASSWORD);

/* -------------------------------------------------------------------------- */
/* Dashboard admin API                                                        */
/*                                                                            */
/* One caller per endpoint, here rather than in a spec because both halves of  */
/* test/ need them - the injection steps under test/inject and the E2E specs   */
/* beside it - and because the schedulers and mock-provider code that will     */
/* drive merchant behaviour live in src/ and will want the same ones.          */
/*                                                                            */
/* Everything imported from apps/dashboard above is a *type*, which TypeScript */
/* erases. Nothing here pulls a dashboard runtime module, and in particular    */
/* nothing reaches @dashboard/prisma, which cannot load under ts-jest. Keep it */
/* that way: import DTOs for their shape, never a service, module or enum from */
/* the dashboard.                                                             */
/*                                                                            */
/* Deliberately absent: anything needing jest's expect(). A rejection helper   */
/* belongs in the spec that asserts with it.                                   */
/* -------------------------------------------------------------------------- */

/**
 * The JSON shape of `UpsertSettlementWindowDto`.
 *
 * The DTO types `effectiveFrom` as a `Date` because `@ToJsDate()` has already
 * run by the time a handler sees it. On the wire it is an ISO 8601 string with
 * an explicit offset, so a request body is this shape rather than the DTO's.
 */
export type SettlementWindowBody = Omit<
  UpsertSettlementWindowDto,
  'effectiveFrom' | 'effectiveTo'
> & { effectiveFrom: string; effectiveTo?: string | null };

const bearer = (authDto: AuthDto) => ({
  Authorization: `Bearer ${authDto.token}`,
});

/** Activates upstream providers, and reactivates a retired one. */
export const providerUpsert = async (
  authDto: AuthDto,
  providers: UpsertProviderDto[],
) =>
  callDashboard<null>({
    method: 'POST',
    url: '/api/v1/super-admin/provider',
    data: providers,
    headers: bearer(authDto),
  });

/**
 * Retires providers. Refused while any of them still has an active base fee:
 * nothing in the routing path reads `config.Provider`, so retiring one with
 * live fees would hide it from the dropdowns and keep sending transactions to
 * it.
 */
export const providerRetire = async (
  authDto: AuthDto,
  providers: RetireProviderDto[],
) =>
  callDashboard<null>({
    method: 'POST',
    url: '/api/v1/super-admin/provider/retire',
    data: providers,
    headers: bearer(authDto),
  });

/** Every provider, retired ones included. */
export const providerFindAll = async (authDto: AuthDto) =>
  callDashboard<ProviderDto[]>({
    method: 'GET',
    url: '/api/v1/super-admin/provider',
    headers: bearer(authDto),
  });

/** Upserts provider-level base fees on (provider, method, transaction type). */
export const baseFeeUpsert = async (
  authDto: AuthDto,
  baseFees: UpsertBaseFeeDto[],
) =>
  callDashboard<null>({
    method: 'POST',
    url: '/api/v1/super-admin/base-fee',
    data: baseFees,
    headers: bearer(authDto),
  });

/** The configuration view: inactive and soft-deleted rows included. */
export const baseFeeFindAll = async (authDto: AuthDto) =>
  callDashboard<BaseFeeDto[]>({
    method: 'GET',
    url: '/api/v1/super-admin/base-fee',
    headers: bearer(authDto),
  });

/**
 * The operational fee read, and deliberately a different endpoint: it filters
 * `deletedAt` and carries only `@CheckPolicies()`, so any signed-in principal
 * may call it, while the configuration view above is `SUPER_ADMIN`-only.
 */
export const feeConfigFindAll = async (authDto: AuthDto) =>
  callDashboard<BaseFeeDto[]>({
    method: 'GET',
    url: '/api/v1/fee/config',
    headers: bearer(authDto),
  });

/** Upserts upstream settlement windows on their natural key. */
export const settlementWindowUpsert = async (
  authDto: AuthDto,
  windows: SettlementWindowBody[],
) =>
  callDashboard<null>({
    method: 'POST',
    url: '/api/v1/super-admin/settlement-window',
    data: windows,
    headers: bearer(authDto),
  });

/** Every window, retired ones included, newest schedule first per rail. */
export const settlementWindowFindAll = async (authDto: AuthDto) =>
  callDashboard<SettlementWindowDto[]>({
    method: 'GET',
    url: '/api/v1/super-admin/settlement-window',
    headers: bearer(authDto),
  });

/** Registers an agent. SUPER_ADMIN only; agentinternal cannot do this one. */
export const agentRegister = async (
  authDto: AuthDto,
  createAgentDto: CreateAgentDto,
) =>
  callDashboard<null>({
    method: 'POST',
    url: '/api/v1/user/admin/register-agent',
    data: createAgentDto,
    headers: bearer(authDto),
  });

/** Registers a merchant: user, detail and config row in one transaction. */
export const merchantRegister = async (
  authDto: AuthDto,
  createMerchantDto: CreateMerchantDto,
) =>
  callDashboard<null>({
    method: 'POST',
    url: '/api/v1/user/admin/register-merchant',
    data: createMerchantDto,
    headers: bearer(authDto),
  });

/**
 * Upserts a merchant's own fee overrides. Routing *is* these rows:
 * `ProfileProviderService` resolves the provider from the merchant's
 * `MerchantFee`, so a merchant with none gets a 403 from `resolveProvider`.
 */
export const merchantFeeUpsert = async (
  authDto: AuthDto,
  merchantId: number,
  fees: UpsertMerchantFeeDto[],
) =>
  callDashboard<null>({
    method: 'POST',
    url: `/api/v1/merchant/${merchantId}/provider`,
    data: fees,
    headers: bearer(authDto),
  });

/** Upserts who shares a merchant's agent fee. The batch must total 100%. */
export const merchantAgentShareholderUpsert = async (
  authDto: AuthDto,
  merchantId: number,
  shareholders: UpsertMerchantAgentShareholderDto[],
) =>
  callDashboard<null>({
    method: 'POST',
    url: `/api/v1/merchant/${merchantId}/agent-shareholder`,
    data: shareholders,
    headers: bearer(authDto),
  });

/** A merchant's fees and shareholders, as the config screen reads them. */
export const merchantConfigFindAll = async (
  authDto: AuthDto,
  merchantId: number,
) =>
  callDashboard<MerchantConfigDto>({
    method: 'GET',
    url: `/api/v1/merchant/${merchantId}/config`,
    headers: bearer(authDto),
  });

/* -------------------------------------------------------------------------- */
/* The merchant's own side                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rotates the merchant's shared secret and returns it.
 *
 * Safe to repeat: the old value moves to `secretKeyPrevious` and keeps working
 * for the grace period. The secret is shown here and nowhere else, so a caller
 * that loses it rotates again rather than looking it up.
 */
export const merchantSecretKeyGenerate = async (authDto: AuthDto) =>
  callDashboard<string>({
    method: 'GET',
    url: '/api/v1/merchant-signature/generate-secret-key',
    headers: bearer(authDto),
  });

/**
 * Registers where this merchant wants its webhooks delivered.
 *
 * Both fields carry `@IsUrl()`, and validator defaults to
 * `require_tld: true` - so `localhost` is a 400 and the loopback has to be
 * written `127.0.0.1`.
 */
export const merchantWebhookRegister = async (
  authDto: AuthDto,
  urls: RegisterWebhookUrlDto,
) =>
  callDashboard<null>({
    method: 'POST',
    url: '/api/v1/merchant-signature/register-webhook-url',
    data: urls,
    headers: bearer(authDto),
  });

/** The caller's own signature status. Carries no `clientId`. */
export const merchantSignatureStatus = async (authDto: AuthDto) =>
  callDashboard<MerchantSignatureStatusDto>({
    method: 'GET',
    url: '/api/v1/merchant-signature/status',
    headers: bearer(authDto),
  });

/**
 * Sends an already-signed request to the transaction app's Open API, the way a
 * merchant's own server would.
 *
 * Takes the signed request rather than signing here, because that is what lets
 * a caller send the *same* signed bytes twice - which is the only way to prove
 * the nonce store is consulted rather than decorative.
 *
 * Returns the status and the raw text rather than a parsed envelope, and never
 * throws on a non-2xx: the Open API answers with its own `responseCode` shape
 * rather than the dashboard's `ResponseDto`, and the rejections are the
 * interesting part.
 */
export const sendOpenApi = async (
  method: 'GET' | 'POST',
  endpoint: string,
  signed: SignedRequest,
): Promise<{ status: number; text: string }> => {
  const res = await fetch(`${TRANSACTION_BASE_URL}${endpoint}`, {
    method,
    headers: signed.headers,
    // The exact bytes the signature was computed over. Re-serialising a parsed
    // object here is the usual cause of a signature that will not verify.
    body: method === 'POST' ? signed.body : undefined,
  });

  return { status: res.status, text: await res.text() };
};
