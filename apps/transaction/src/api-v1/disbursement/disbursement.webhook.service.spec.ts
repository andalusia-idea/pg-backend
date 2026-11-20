import { ProviderNameEnum, TransactionStatusEnum } from '@app/microservice';
import Decimal from 'decimal.js';
import { DisbursementWebhookService } from './disbursement.webhook.service';

/**
 * The generated Prisma client cannot be loaded from a spec - it is emitted as
 * ESM reading `import.meta.url`, and `@transaction/prisma` is a tsconfig path
 * alias the root jest config has no mapper for. Same virtual mock as
 * `disbursement-common.service.spec.ts`, and for the same reason: adding a
 * shared mapper would pull 1.5MB of generated ESM into every suite.
 *
 * Only `Prisma` is needed, for the `InputJsonValue` cast in `recordWebhook`.
 */
jest.mock('@transaction/prisma', () => ({ Prisma: {} }), { virtual: true });

/**
 * A provider callback that is **not terminal** must not touch the money.
 *
 * `settle` used to derive one boolean - `isPaid = status === SUCCESS` - and
 * hand it to `postPayoutOutcome`, so a `PENDING` callback took the failed
 * branch and gave the merchant's reservation back while the payout was still
 * in flight. It was safe while MotionPay was the only payout provider, because
 * every status its callback could carry was terminal; Jatelindo's `A01`, `E99`
 * and `E18` map to `PENDING` on purpose, because the provider is saying it
 * cannot confirm the outcome.
 *
 * These tests are the guard on that distinction, which is invisible in the
 * types: both branches are a `TransactionStatusEnum`, and only the terminal
 * list tells them apart.
 */
describe('DisbursementWebhookService.handle', () => {
  const DISBURSEMENT_ID = 42;
  const MERCHANT_ID = 27;
  const NET_NOMINAL = new Decimal('15678.00');

  let findUniqueOrThrow: jest.Mock;
  let update: jest.Mock;
  let webhookCreate: jest.Mock;
  let postPayoutOutcome: jest.Mock;
  let findMerchantWebhookUrl: jest.Mock;
  let service: DisbursementWebhookService;

  const row = (status: TransactionStatusEnum) => ({
    id: DISBURSEMENT_ID,
    systemReference: 'SYS-1',
    merchantReference: 'UAT-D-1',
    merchantId: MERCHANT_ID,
    providerName: ProviderNameEnum.JATELINDO,
    paymentMethodName: 'TRANSFERBANK',
    providerReference: 'JPA-1',
    status,
    nominal: new Decimal('13978.00'),
    netNominal: NET_NOMINAL,
    accountHolderName: 'UAT BENEFICIARY',
    accountNumber: '1234567890',
    bankCode: '014',
    metadata: {},
  });

  const callback = (status: TransactionStatusEnum) =>
    ({
      systemReference: 'SYS-1',
      providerReference: 'JPA-1',
      providerName: ProviderNameEnum.JATELINDO,
      status,
      rawPayload: {},
      metadata: {},
    }) as never;

  beforeEach(() => {
    findUniqueOrThrow = jest.fn().mockResolvedValue(row(TransactionStatusEnum.PENDING));
    update = jest.fn().mockResolvedValue(undefined);
    webhookCreate = jest.fn().mockResolvedValue(undefined);
    postPayoutOutcome = jest.fn().mockResolvedValue(undefined);
    // Returning no URL keeps `notifyMerchant` a no-op without an HTTP mock;
    // these tests are about the money, not the notification.
    findMerchantWebhookUrl = jest.fn().mockResolvedValue({ payoutUrl: null });

    const tx = { disbursementTransaction: { update } };
    const prismaMaster = {
      disbursementTransaction: { findUniqueOrThrow },
      webhookLog: { create: webhookCreate },
      $transaction: jest.fn(async (run: (client: unknown) => Promise<unknown>) =>
        run(tx),
      ),
    };

    service = new DisbursementWebhookService(
      prismaMaster as never,
      { postPayoutOutcome } as never,
      undefined as never,
      { findMerchantWebhookUrl } as never,
    );
  });

  /**
   * The defect, stated as a test. `E18 TIMEOUT` is one of the three codes
   * Jatelindo marks `Need Check = Y`, and it arrives as `PENDING`.
   */
  it('does not release the reservation on a non-terminal callback', async () => {
    const outcome = await service.handle(
      callback(TransactionStatusEnum.PENDING),
    );

    expect(postPayoutOutcome).not.toHaveBeenCalled();
    expect(outcome.retry).toBe(false);
    expect(outcome.reason).toContain('not terminal');
  });

  /**
   * It still has to be written down. The provider's reference and whatever it
   * said are the only record that it was asked and could not answer.
   */
  it('still records a non-terminal callback against the row', async () => {
    await service.handle(callback(TransactionStatusEnum.PENDING));

    expect(webhookCreate).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DISBURSEMENT_ID } }),
    );
  });

  it('releases the reservation when the payout verifiably failed', async () => {
    await service.handle(callback(TransactionStatusEnum.FAILED));

    expect(postPayoutOutcome).toHaveBeenCalledTimes(1);
    expect(postPayoutOutcome.mock.calls[0][1]).toMatchObject({
      disbursementId: DISBURSEMENT_ID,
      merchantId: MERCHANT_ID,
      netNominal: NET_NOMINAL,
      isPaid: false,
    });
  });

  it('consumes the reservation when the payout succeeded', async () => {
    await service.handle(callback(TransactionStatusEnum.SUCCESS));

    expect(postPayoutOutcome).toHaveBeenCalledTimes(1);
    expect(postPayoutOutcome.mock.calls[0][1]).toMatchObject({ isPaid: true });
  });

  /**
   * `EXPIRED` and `CANCELLED` are terminal too. Jatelindo never sends them on
   * a payout - its own constants say so - but MotionPay's rail can, and a
   * terminal status that did not release would strand the reservation, which
   * is the defect `2427cc7` fixed from the other direction.
   */
  it.each([TransactionStatusEnum.EXPIRED, TransactionStatusEnum.CANCELLED])(
    'treats %s as terminal and releases',
    async (status) => {
      await service.handle(callback(status));

      expect(postPayoutOutcome).toHaveBeenCalledTimes(1);
      expect(postPayoutOutcome.mock.calls[0][1]).toMatchObject({
        isPaid: false,
      });
    },
  );

  /**
   * The pre-existing guard, kept honest: a row that is already terminal is
   * ignored outright, so a duplicate callback cannot post a second movement.
   */
  it('ignores a callback for an already-terminal row', async () => {
    findUniqueOrThrow.mockResolvedValue(row(TransactionStatusEnum.SUCCESS));

    const outcome = await service.handle(
      callback(TransactionStatusEnum.SUCCESS),
    );

    expect(postPayoutOutcome).not.toHaveBeenCalled();
    expect(outcome.reason).toBe('already terminal');
  });
});
