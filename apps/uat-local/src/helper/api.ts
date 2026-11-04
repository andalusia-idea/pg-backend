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

export const loginSuperAdmin = async () => {
  const res = await callDashboard<AuthDto>({
    method: 'POST',
    url: '/api/v1/login',
    data: { email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD },
  });
  return res.data!;
};

export const loginAgentInternal = async () => {
  const res = await callDashboard<AuthDto>({
    method: 'POST',
    url: '/api/v1/login',
    data: { email: AGENT_INTERNAL_EMAIL, password: AGENT_INTERNAL_PASSWORD },
  });
  return res.data!;
};
