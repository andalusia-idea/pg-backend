import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthInfoDto } from '../../auth/dto/auth-info.dto';
import { ApiError } from '../../shared/exception';
import { RegisterWebhookUrlDto } from './dto/register-webhook-url.dto';

const SHARED_SECRET_BYTES = 32;

@Injectable()
export class MerchantSignatureService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  /**
   * Rotates the caller's shared secret and returns the new value.
   *
   * The plaintext secret is returned exactly once, here - it is stored so the
   * signature check can recompute HMACs, and there is no other endpoint that
   * reads it back. The outgoing secret moves to `secretKeyPrevious` so requests
   * signed with it during the changeover can still be honoured.
   *
   * `secretKeyRotatedAt` is what bounds that changeover: signature validation
   * only falls back to `secretKeyPrevious` while this timestamp is inside the
   * grace window, so it must be stamped on every rotation or the fallback can
   * never apply.
   *
   * Read-then-write in one transaction: without it, two concurrent rotations
   * could both read the same current secret and the older one would be lost.
   */
  async generateSecretKey(authInfo: AuthInfoDto): Promise<string> {
    const { userId } = authInfo;
    const sharedSecretKey = randomBytes(SHARED_SECRET_BYTES).toString('base64');

    await this.prismaMaster.$transaction(async (tx) => {
      const signature = await tx.merchantSignature.findFirst({
        where: { userId, deletedAt: null },
        select: { secretKey: true },
      });
      if (!signature) throw ApiError.notFound('Merchant signature');

      await tx.merchantSignature.update({
        where: { userId },
        data: {
          secretKey: sharedSecretKey,
          secretKeyPrevious: signature.secretKey,
          secretKeyRotatedAt: new Date(),
        },
      });
    });

    return sharedSecretKey;
  }

  async registerWebhook(
    authInfo: AuthInfoDto,
    dto: RegisterWebhookUrlDto,
  ): Promise<void> {
    const { userId } = authInfo;

    const signature = await this.prismaMaster.merchantSignature.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!signature) throw ApiError.notFound('Merchant signature');

    await this.prismaMaster.merchantSignature.update({
      where: { userId },
      data: { payinUrl: dto.payinUrl, payoutUrl: dto.payoutUrl },
    });
  }
}
