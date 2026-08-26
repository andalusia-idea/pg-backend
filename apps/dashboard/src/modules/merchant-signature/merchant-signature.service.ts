import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { AuthInfoDto } from '../../auth/dto/auth-info.dto';
import { ApiError } from '../../shared/exception';
import { MerchantSignatureStatusDto } from './dto/merchant-signature-status.dto';
import { RegisterWebhookUrlDto } from './dto/register-webhook-url.dto';
import { generateSecretKey } from '@app/signature';

@Injectable()
export class MerchantSignatureService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
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
  async generateSharedSecretKey(authInfo: AuthInfoDto): Promise<string> {
    const { userId } = authInfo;

    const sharedSecretKey = generateSecretKey();

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

  /**
   * The caller's own signature status - when the secret was last (re)generated
   * and which webhook URLs are currently on file. A plain read with no
   * business logic to review, unlike the other new endpoints in this pass, so
   * it's wired up for real rather than stubbed: every merchant gets a
   * `MerchantSignature` row at registration (see `UserService.registerMerchant`),
   * so `signature` here is only ever null for a non-merchant caller.
   */
  async status(authInfo: AuthInfoDto): Promise<MerchantSignatureStatusDto> {
    const { userId } = authInfo;

    const signature = await this.prismaSlave.merchantSignature.findFirst({
      where: { userId, deletedAt: null },
      select: { secretKeyRotatedAt: true, payinUrl: true, payoutUrl: true },
    });

    return new MerchantSignatureStatusDto({
      secretKeyGeneratedAt: signature?.secretKeyRotatedAt ?? null,
      payinUrl: signature?.payinUrl ?? null,
      payoutUrl: signature?.payoutUrl ?? null,
    } as unknown as MerchantSignatureStatusDto);
  }
}
