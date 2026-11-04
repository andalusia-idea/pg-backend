import { CreateAgentDto } from 'apps/dashboard/src/modules/user/dto/create-agent.dto';
import { AGENTS, callDashboard, loginSuperAdmin } from '../src/helper';
import { AuthDto } from 'apps/dashboard/src/auth';

const registerAgent = async (token: string, createAgentDto: CreateAgentDto) => {
  const res = await callDashboard<null>({
    method: 'POST',
    url: '/api/v1/user/admin/register-agent',
    data: createAgentDto,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
};

describe('agent onboard by SuperAdmin', () => {
  let superadmin: AuthDto;

  beforeAll(async () => {
    superadmin = await loginSuperAdmin();
    console.log({ superadmin });
    expect(superadmin.token).toBeTruthy();
    expect(superadmin.authInfo.userId).toBeGreaterThan(0);
  });

  it('register agent', async () => {
    const token = superadmin.token;
    for (const a of AGENTS) {
      const res = await registerAgent(token, a);
      expect(res.statusCode).toEqual(201);
      expect(res.status).toBe('CREATED');
    }
  });
});
