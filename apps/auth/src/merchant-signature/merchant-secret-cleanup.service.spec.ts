import { MERCHANT_SECRET_CLEANUP_USER_ID } from '@app/microservice';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AUDIT_USER_ID_PATH } from '../database/audit.constant';
import { MerchantSecretCleanupService } from './merchant-secret-cleanup.service';

const GRACE_SECONDS = 86_400;

describe('MerchantSecretCleanupService', () => {
  let updateMany: jest.Mock;
  let clsSet: jest.Mock;
  /** Set while the `cls.run` callback is on the stack, cleared after. */
  let userIdDuringRun: unknown;
  let service: MerchantSecretCleanupService;

  beforeEach(() => {
    updateMany = jest.fn(async () => ({ count: 0 }));
    userIdDuringRun = undefined;
    clsSet = jest.fn((key: string, value: unknown) => {
      if (key === AUDIT_USER_ID_PATH) userIdDuringRun = value;
    });

    // Stands in for ClsService. `run` invokes the callback so the work still
    // happens, and `set` records what the audit extension would have read.
    const cls = {
      run: async (callback: () => Promise<void>) => callback(),
      set: clsSet,
    };

    service = new MerchantSecretCleanupService(
      { merchantSignature: { updateMany } } as never,
      { SECRET_KEY_GRACE_SECONDS: GRACE_SECONDS } as never,
      cls as never,
    );
  });

  /**
   * The audit extension reads the actor from CLS, and a cron has no request to
   * have put one there. Without the wrapper the update stamps `updatedAt` and
   * leaves `updatedBy` null - silently, since the column is nullable.
   */
  it('runs inside a CLS context carrying the cleanup principal', async () => {
    await service.clearExpiredPreviousSecrets();

    expect(clsSet).toHaveBeenCalledWith(
      AUDIT_USER_ID_PATH,
      MERCHANT_SECRET_CLEANUP_USER_ID,
    );
    expect(userIdDuringRun).toBe(MERCHANT_SECRET_CLEANUP_USER_ID);
  });

  it('sets the principal before touching the database', async () => {
    let userIdAtUpdate: unknown;
    updateMany.mockImplementation((async () => {
      userIdAtUpdate = userIdDuringRun;
      return { count: 0 };
    }) as never);

    await service.clearExpiredPreviousSecrets();

    expect(userIdAtUpdate).toBe(MERCHANT_SECRET_CLEANUP_USER_ID);
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
