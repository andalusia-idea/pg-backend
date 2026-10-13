import { MerchantSignatureConfig } from '@app/configuration';
import {
  AUDIT_USER_ID_PATH,
  MERCHANT_SECRET_CLEANUP_USER_ID,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import type { PrismaClient } from '@auth/prisma';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';

/**
 * Clears retired secrets once their rotation grace window has closed.
 *
 * This is hygiene, not a control. `secretKeyPrevious` is already unusable past
 * the window - `MerchantSignatureService` checks `secretKeyRotatedAt` before
 * ever trying it - so leaving the value in place would not let anyone
 * authenticate with it. What it would do is keep a dead credential sitting in
 * the database indefinitely, which is one more secret than the row needs in a
 * dump. Removing it costs nothing.
 *
 * Lives in `apps/auth` rather than `apps/dashboard`: rotation is a merchant
 * action, but this is maintenance on auth-owned data with no user behind it.
 */
@Injectable()
export class MerchantSecretCleanupService {
  private readonly logger = new Logger(MerchantSecretCleanupService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    private readonly merchantSignatureConfig: MerchantSignatureConfig,
    private readonly cls: ClsService,
  ) {}

  /**
   * Hourly is ample against a 24-hour grace window - this only has to happen
   * eventually, and nothing observable depends on the timing.
   *
   * **No distributed lock, deliberately.** The deployment runs
   * `maxReplicas: 2`, so this fires on both pods. That is safe here because
   * the statement is idempotent: an `updateMany` that nulls an already-null
   * column changes nothing, and a row is only selected while it still matches.
   * The worst case is two pods doing the same harmless write.
   *
   * Do not copy that reasoning to the settlement and reconciliation crons
   * being ported later - those move money and are *not* idempotent, so they
   * need real leader election.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'merchant-secret-cleanup' })
  async clearExpiredPreviousSecrets(): Promise<void> {
    // `MerchantSignature` is in AUDITED_MODELS, so the extension stamps the
    // `updateMany` below - but it reads the actor out of CLS, and a @Cron has no
    // request to have put one there. Without this wrapper it sets `updatedAt`
    // and leaves `updatedBy` null, and because that column is nullable it fails
    // silently: the row simply forgets who touched it.
    //
    // The context has to be opened here rather than relying on middleware.
    // apps/auth answers TCP messages, so `ClsModule` is registered without
    // `middleware: { mount: true }` and nothing populates a context on its own.
    await this.cls.run(async () => {
      this.cls.set(AUDIT_USER_ID_PATH, MERCHANT_SECRET_CLEANUP_USER_ID);
      await this.clearOnce();
    });
  }

  private async clearOnce(): Promise<void> {
    this.logger.log('merchant-secret-cleanup started');
    const cutoff = new Date(
      Date.now() - this.merchantSignatureConfig.SECRET_KEY_GRACE_SECONDS * 1000,
    );

    try {
      const { count } = await this.prismaMaster.merchantSignature.updateMany({
        where: {
          secretKeyPrevious: { not: null },
          secretKeyRotatedAt: { lt: cutoff },
        },
        // `secretKeyRotatedAt` is deliberately left in place: it is the record
        // of when the merchant last rotated, which stays useful for support
        // long after the key it bounded is gone.
        data: { secretKeyPrevious: null },
      });

      if (count > 0) {
        this.logger.log({
          msg: 'Cleared expired previous secret keys',
          count,
          cutoff: cutoff.toISOString(),
        });
      }
      this.logger.log('merchant-secret-cleanup ended successfully');
    } catch (error) {
      // Swallowed on purpose: an unhandled rejection in a cron takes the
      // process down, and this job failing is not urgent - the data it removes
      // is already inert, and the next run picks up whatever this one missed.
      this.logger.error({
        msg: 'Failed to clear expired previous secret keys',
        error,
      });
    }
  }
}
