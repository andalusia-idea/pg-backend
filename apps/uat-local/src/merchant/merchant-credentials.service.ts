import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@auth/prisma';
import { PRISMA_SLAVE_AUTH_PROVIDER_KEY } from '../database';
import { UatConfig } from '../config';

export interface MerchantCredentials {
  readonly userId: number;
  readonly clientId: string;
  readonly secretKey: string;
}

/**
 * The signing credentials for whichever merchant the harness is acting as.
 *
 * **Read from `auth.MerchantSignature` on every use, not cached and not copied
 * into `.env.test`.** The design doc's §7 has a Jest run write
 * `UAT_MERCHANT_CLIENT_ID` / `UAT_MERCHANT_SECRET` into the env file; the build
 * order supersedes that, and it is right to. Inject step 07 rotates the secret,
 * so a copy anywhere is correct until the first rotation and then produces a
 * `401 4010008` - which reads as a signing bug and sends you to inspect the
 * canonical string, the one place the fault is not.
 *
 * One query per purchase is the cost, against a local Postgres at a handful of
 * purchases a minute. Cheap enough that rotation-safety is the better trade.
 *
 * The secret is never logged. Not at debug, not truncated, not once - a value
 * in a log file has left the vault, and this one authenticates money movement.
 */
@Injectable()
export class MerchantCredentialsService {
  private readonly logger = new Logger(MerchantCredentialsService.name);

  constructor(
    @Inject(PRISMA_SLAVE_AUTH_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
    private readonly config: UatConfig,
  ) {}

  /**
   * `null` rather than a throw when there is nothing to find.
   *
   * The caller is a cron, and the two reasons this comes back empty are both
   * "the harness is not set up yet" rather than "something broke": the inject
   * chain has not run, or it stopped before step 07. A throw inside a scheduled
   * task produces an unhandled rejection in the scheduler's own voice, which
   * says nothing about which step was skipped.
   */
  async current(): Promise<MerchantCredentials | null> {
    const email = this.config.MERCHANT_EMAIL;

    const row = await this.prismaSlave.merchantSignature.findFirst({
      where: { user: { email, deletedAt: null }, deletedAt: null },
      select: { userId: true, clientId: true, secretKey: true },
    });

    if (!row?.secretKey) {
      this.logger.error({
        msg: 'No signing credentials for the harness merchant',
        email,
        hint: row
          ? 'the MerchantSignature row exists but carries no secret; inject step 07 rotates it'
          : 'no MerchantSignature row at all; run node scripts/test-inject-all.js',
      });
      return null;
    }

    return {
      userId: row.userId,
      clientId: row.clientId,
      secretKey: row.secretKey,
    };
  }
}
