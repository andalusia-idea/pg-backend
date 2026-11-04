import { callDashboard, loginAgentInternal, MERCHANTS } from '../src/helper';
import { CreateMerchantDto } from 'apps/dashboard/src/modules/user';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';

const registerMerchant = async (
  token: string,
  createMerchantDto: CreateMerchantDto,
) => {
  const res = await callDashboard<null>({
    method: 'POST',
    url: '/api/v1/user/admin/register-merchant',
    data: createMerchantDto,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
};

describe('merchant onboard by AgentInternal', () => {
  let agentInternal: AuthDto;

  beforeAll(async () => {
    agentInternal = await loginAgentInternal();
    console.log({ agentInternal });
    expect(agentInternal.token).toBeTruthy();
    expect(agentInternal.authInfo.userId).toBeGreaterThan(0);
  });

  it('register merchant', async () => {
    const token = agentInternal.token;
    for (const m of MERCHANTS) {
      const res = await registerMerchant(token, m);
      expect(res.statusCode).toEqual(201);
      expect(res.status).toBe('CREATED');
    }
  });
});
