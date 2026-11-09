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
