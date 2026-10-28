import { UpstreamException } from '@app/upstream';
import { JatelindoTransferOtherService } from './jatelindo-transfer.other.service';

/**
 * `transactionStatus` was validating a status response against the *balance*
 * schema. The two shapes share no field, so the method could never return - and
 * nothing noticed, because `confirmWithProvider` does not reach Jatelindo yet.
 *
 * The fixtures below are the spec's own response examples (v1.7, Transaction
 * Status and Balance Inquiry), so these tests fail if our schema drifts from
 * what Jatelindo actually sends rather than from what we assumed.
 */

/** Spec v1.7, "Response Example" under /Host/Transfer/Transaction/Status. */
const STATUS_RESPONSE = {
  traceNumber: '081225164201',
  jpaReferenceNo: '124abcd3467b1971751541d51f6122ba',
  TransactionStatusResponse: [
    {
      traceNumber: '081225164201',
      transactionNumber: '20251014BMRIIDJA010O9943681863',
      description: 'Tes Dev Bug Fix 1',
      transactionDate: '2025-12-08T16:44:09+07:00',
      transactionState: 'PROCESSED',
      destinationAccount: {
        accountName: 'Lionel Messi',
        accountNo: '1250010399080',
        bankName: 'PT. BANK MANDIRI Tbk.',
      },
    },
  ],
  status: {
    description: 'Transaction completed',
    message: 'PROCESSED',
    responseCode: 'A00',
  },
};

const BALANCE_RESPONSE = {
  BalanceInquiryResponse: [
    {
      accountBalance: '1000000.00',
      reservedAmount: '0.00',
      member: { name: 'MANAPAY', username: '1112143' },
      account: { name: 'MANAPAY', id: '1250010399080' },
    },
  ],
  status: {
    description: 'Transaction completed',
    message: 'PROCESSED',
    responseCode: 'A00',
  },
};

describe('JatelindoTransferOtherService', () => {
  let request: jest.Mock;
  let service: JatelindoTransferOtherService;

  beforeEach(() => {
    request = jest.fn();

    const authService = { request };
    const requestAuth = {
      balanceInquiry: jest.fn().mockResolvedValue('balance-sig'),
      transactionStatus: jest.fn().mockResolvedValue('status-sig'),
    };

    service = new JatelindoTransferOtherService(
      authService as never,
      requestAuth as never,
    );
  });

  describe('transactionStatus', () => {
    it('accepts the response the spec documents', async () => {
      request.mockResolvedValue(STATUS_RESPONSE);

      const result = await service.transactionStatus({
        systemReference: '081225164201',
      } as never);

      expect(result).toEqual(STATUS_RESPONSE);
    });

    it('POSTs the traceNumber to the status endpoint', async () => {
      request.mockResolvedValue(STATUS_RESPONSE);

      await service.transactionStatus({
        systemReference: '081225164201',
      } as never);

      const [context, requestAuth, config] = request.mock.calls[0] as [
        string,
        string,
        { method: string; url: string; data: unknown },
      ];

      expect(context).toBe('transactionStatus');
      expect(requestAuth).toBe('status-sig');
      expect(config.method).toBe('POST');
      expect(config.url).toBe('/Host/Transfer/Transaction/Status');
      expect(config.data).toEqual({ traceNumber: '081225164201' });
    });

    it('names itself, not balanceInquiry, when the shape is wrong', async () => {
      request.mockResolvedValue(BALANCE_RESPONSE);

      const error = await service
        .transactionStatus({ systemReference: '081225164201' } as never)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UpstreamException);
      expect((error as UpstreamException).message).toContain(
        'transactionStatus',
      );
      expect((error as UpstreamException).message).not.toContain(
        'balanceInquiry',
      );
    });

    it('rejects a balance response, which it used to require', async () => {
      request.mockResolvedValue(BALANCE_RESPONSE);

      await expect(
        service.transactionStatus({ systemReference: 'x' } as never),
      ).rejects.toThrow(/did not match the expected schema/);
    });
  });

  describe('balanceInquiry', () => {
    it('still validates and labels its own response', async () => {
      request.mockResolvedValue(BALANCE_RESPONSE);

      const result = await service.balanceInquiry();

      expect(result).toEqual(BALANCE_RESPONSE.BalanceInquiryResponse);
      expect(request.mock.calls[0][0]).toBe('balanceInquiry');
    });

    it('rejects a status response', async () => {
      request.mockResolvedValue(STATUS_RESPONSE);

      await expect(service.balanceInquiry()).rejects.toThrow(
        /balanceInquiry: response did not match/,
      );
    });
  });
});
