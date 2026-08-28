import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MerchantSecretCleanupService } from './merchant-secret-cleanup.service';

const GRACE_SECONDS = 86_400;

describe('MerchantSecretCleanupService', () => {
  let updateMany: jest.Mock;
  let service: MerchantSecretCleanupService;

  beforeEach(() => {
    updateMany = jest.fn(async () => ({ count: 0 }));

    service = new MerchantSecretCleanupService(
      { merchantSignature: { updateMany } } as never,
      { SECRET_KEY_GRACE_SECONDS: GRACE_SECONDS } as never,
    );
  });

  it('clears only rows whose grace window has closed', async () => {
    const before = Date.now();
    await service.clearExpiredPreviousSecrets();
    const after = Date.now();

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [args] = updateMany.mock.calls[0] as [
      {
        where: {
          secretKeyPrevious: { not: null };
          secretKeyRotatedAt: { lt: Date };
        };
        data: Record<string, unknown>;
      },
    ];

    expect(args.where.secretKeyPrevious).toEqual({ not: null });

    const cutoff = args.where.secretKeyRotatedAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - GRACE_SECONDS * 1000);
    expect(cutoff).toBeLessThanOrEqual(after - GRACE_SECONDS * 1000);
  });

  it('nulls the retired secret and nothing else', async () => {
    await service.clearExpiredPreviousSecrets();

    const [args] = updateMany.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];

    // `secretKeyRotatedAt` must survive: it records when the merchant last
    // rotated, which stays useful for support long after the key it bounded.
    expect(args.data).toEqual({ secretKeyPrevious: null });
  });

  /**
   * The job runs on both replicas without a lock, which is only safe because
   * the statement is idempotent. If this ever becomes a read-then-write, it
   * needs leader election.
   */
  it('is safe to run twice', async () => {
    await service.clearExpiredPreviousSecrets();
    await service.clearExpiredPreviousSecrets();

    expect(updateMany).toHaveBeenCalledTimes(2);
    const [first] = updateMany.mock.calls[0] as [{ data: unknown }];
    const [second] = updateMany.mock.calls[1] as [{ data: unknown }];
    expect(first.data).toEqual(second.data);
  });

  /**
   * An unhandled rejection inside a cron takes the process down. This job
   * failing is not urgent - the rows it clears are already inert - so it must
   * never be the reason auth restarts.
   */
  it('does not throw when the update fails', async () => {
    updateMany.mockRejectedValue(new Error('connection lost') as never);

    await expect(
      service.clearExpiredPreviousSecrets(),
    ).resolves.toBeUndefined();
  });
});
