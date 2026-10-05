import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { isUpstreamTransportFailure, UpstreamException } from '@app/upstream';
import { HttpMethodEnum } from '@app/microservice';
import { JatelindoTransferAuthService } from './jatelindo-transfer.auth.service';

/**
 * These cover the refresh-and-retry path, which until this was fixed could not
 * fire at all: the guard tested `data['responseCode']` while the envelope nests
 * it under `status`, and it only ran in a `catch` while `A90` arrives in a 200.
 *
 * A silent no-op is exactly the kind of regression nothing notices, so the
 * assertions here are about *how many* calls happen and *which* token each one
 * carries, not just the return value.
 */

const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const A90_ENVELOPE = {
  status: {
    responseCode: 'A90',
    message: 'We cannot authorize you, please check your authorization',
  },
};

const OK_ENVELOPE = {
  status: { responseCode: 'A00', message: 'PROCESSED' },
  inquiryInfo: { accountName: 'SITI AMINAH' },
};

function okResponse(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as AxiosResponse['config'],
  };
}

function axiosFailure(status: number, data: unknown): AxiosError {
  return new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      data,
      status,
      statusText: '',
      headers: {},
      config: {} as AxiosResponse['config'],
    },
  );
}

describe('JatelindoTransferAuthService', () => {
  let httpRequest: jest.Mock;
  let refreshIfUnchanged: jest.Mock;
  let service: JatelindoTransferAuthService;

  const CALL = {
    method: HttpMethodEnum.POST,
    url: '/Host/Transfer/Transaction/Inquiry',
  };

  beforeEach(() => {
    httpRequest = jest.fn();
    refreshIfUnchanged = jest
      .fn()
      .mockResolvedValue({ token: 'token-2', expiresAtSeconds: FUTURE });

    const httpService = { request: httpRequest, post: jest.fn() };
    const config = {
      TRANSFER_BASE_URL: 'https://jatelindo.example',
      TRANSFER_API_KEY: 'api-key',
      TIMEOUT_MS: 5000,
      TOKEN_SKEW_SECONDS: 30,
    };
    const tokenRedis = {
      getOrRefresh: jest
        .fn()
        .mockResolvedValue({ token: 'token-1', expiresAtSeconds: FUTURE }),
      refreshIfUnchanged,
    };

    service = new JatelindoTransferAuthService(
      httpService as never,
      config as never,
      tokenRedis as never,
    );
  });

  describe('A90 in a 200 envelope', () => {
    it('refreshes the token once and retries with the new one', async () => {
      httpRequest
        .mockReturnValueOnce(of(okResponse(A90_ENVELOPE)))
        .mockReturnValueOnce(of(okResponse(OK_ENVELOPE)));

      const result = await service.request('inquiry', 'sig', CALL);

      expect(result).toEqual(OK_ENVELOPE);
      expect(httpRequest).toHaveBeenCalledTimes(2);
      expect(refreshIfUnchanged).toHaveBeenCalledTimes(1);
      expect(refreshIfUnchanged.mock.calls[0][0]).toMatchObject({
        staleToken: 'token-1',
      });

      const [first, second] = httpRequest.mock.calls.map(
        (call) => call[0] as { headers: Record<string, string> },
      );
      expect(first.headers.Authorization).toBe('Bearer token-1');
      expect(second.headers.Authorization).toBe('Bearer token-2');
    });

    it('does not retry for ever when the fresh token is refused too', async () => {
      httpRequest.mockReturnValue(of(okResponse(A90_ENVELOPE)));

      await expect(service.request('inquiry', 'sig', CALL)).rejects.toThrow(
        /A90 UNAUTHORIZED_ACCESS/,
      );
      expect(httpRequest).toHaveBeenCalledTimes(2);
      expect(refreshIfUnchanged).toHaveBeenCalledTimes(1);
    });

    it('reports a surviving A90 as a refusal, not an unknown outcome', async () => {
      httpRequest.mockReturnValue(of(okResponse(A90_ENVELOPE)));

      const error = await service
        .request('single transfer', 'sig', CALL)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UpstreamException);

      // The one that matters on a payout: without a `status` in the context this
      // reads as "the call never got an answer", and the disbursement layer
      // leaves the transaction PENDING instead of failing it.
      expect(isUpstreamTransportFailure(error)).toBe(false);
      expect((error as UpstreamException).context).toMatchObject({
        status: 200,
        responseCode: 'A90',
      });
    });
  });

  describe('transport-level rejection', () => {
    it('also refreshes on a real HTTP 401', async () => {
      httpRequest
        .mockReturnValueOnce(throwError(() => axiosFailure(401, '')))
        .mockReturnValueOnce(of(okResponse(OK_ENVELOPE)));

      await expect(service.request('inquiry', 'sig', CALL)).resolves.toEqual(
        OK_ENVELOPE,
      );
      expect(refreshIfUnchanged).toHaveBeenCalledTimes(1);
    });

    it('survives an error response that carries no body', async () => {
      // The old guard indexed `data` without checking it, so this raised a
      // TypeError from inside the guard rather than the provider's own failure.
      httpRequest.mockReturnValue(
        throwError(() => axiosFailure(500, undefined)),
      );

      await expect(service.request('inquiry', 'sig', CALL)).rejects.toThrow(
        UpstreamException,
      );
      expect(refreshIfUnchanged).not.toHaveBeenCalled();
    });

    it('does not refresh for a failure that is not about authorization', async () => {
      httpRequest.mockReturnValue(
        throwError(() =>
          axiosFailure(500, { status: { responseCode: 'T40' } }),
        ),
      );

      await expect(service.request('inquiry', 'sig', CALL)).rejects.toThrow(
        UpstreamException,
      );
      expect(httpRequest).toHaveBeenCalledTimes(1);
      expect(refreshIfUnchanged).not.toHaveBeenCalled();
    });
  });

  describe('request configuration', () => {
    it('keeps the caller headers and keeps the managed ones', async () => {
      httpRequest.mockReturnValue(of(okResponse(OK_ENVELOPE)));

      await (
        service as unknown as {
          send: (
            config: Record<string, unknown>,
            token: string,
            requestAuth: string,
          ) => Promise<unknown>;
        }
      ).send(
        {
          ...CALL,
          baseURL: 'https://somewhere-else.example',
          headers: {
            'Content-Type': 'application/json',
            'X-Trace': 'abc123',
            Authorization: 'Bearer stolen',
          },
        },
        'token-1',
        'sig',
      );

      const sent = httpRequest.mock.calls[0][0];

      // The caller's own header survives - spreading `config` over the whole
      // object used to replace the headers block and drop it.
      expect(sent.headers['X-Trace']).toBe('abc123');
      expect(sent.headers['Content-Type']).toBe('application/json');

      // The credential and the signature belong to this class.
      expect(sent.headers.Authorization).toBe('Bearer token-1');
      expect(sent.headers.APIKey).toBe('api-key');
      expect(sent.headers.RequestAuth).toBe('sig');

      // And the token does not get sent to a host the caller chose.
      expect(sent.baseURL).toBe('https://jatelindo.example');
    });
  });
});
