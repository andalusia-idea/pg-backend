import { MerchantSignatureConfig } from '@app/configuration';
import {
  FilterMerchantSignatureValidationDto,
  FilterMerchantWebhookUrlDto,
  MerchantSignatureFailureEnum,
  MerchantSignatureStatusEnum,
  MerchantSignatureValidationDto,
  MerchantWebhookUrlDto,
  isIpAllowed,
} from '@app/microservice';
import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { MerchantSignatureRedis, MerchantSignatureRedisDto } from '@app/redis';
import { buildCanonical, verifySignature } from '@app/signature';
// Type-only: `PrismaClient` is never used as a value here, and erasing the
// import keeps unit tests from having to load the whole generated ESM client.
import type { PrismaClient } from '@auth/prisma';
import { Inject, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MerchantSignatureService {
  private readonly logger = new Logger(MerchantSignatureService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
    private readonly merchantSignatureRedis: MerchantSignatureRedis,
    private readonly merchantSignatureConfig: MerchantSignatureConfig,
  ) {}

  async findMerchantWebhookUrl(dto: FilterMerchantWebhookUrlDto) {
    const { userId } = dto;
    const merchantSignature =
      await this.prismaMaster.merchantSignature.findUniqueOrThrow({
        where: { userId: userId },
        select: {
          payinUrl: true,
          payoutUrl: true,
        },
      });

    return {
      payinUrl: merchantSignature.payinUrl,
      payoutUrl: merchantSignature.payoutUrl,
    } as MerchantWebhookUrlDto;
  }

  /**
   * Verify a merchant request signature.
   *
   * Handles only what needs the secret or shared state. Header presence and
   * the format of the signature, nonce and timestamp are rejected by the
   * guard in `apps/transaction` before this is called, so those failure codes
   * never originate here.
   *
   * Errors are **not** swallowed into a rejection. If Redis or the database
   * is unreachable that is an outage, not a bad signature - Prisma throws
   * rather than returning null, and letting it propagate turns into a 503 at
   * the edge. Answering 401 instead would be worse than unhelpful: it tells
   * every merchant their credentials are wrong, sending them to debug their
   * signing code mid-incident, and tells well-behaved clients to stop
   * retrying transactions that would have succeeded.
   *
   * **Reads go to master, deliberately.** This is the one query where replica
   * lag produces a false rejection of a valid merchant: a freshly onboarded
   * row that has not replicated yet reads as UNKNOWN_CLIENT, and a stale row
   * read straight after a key rotation matches neither the new secret nor the
   * recorded previous one, giving INVALID_SIGNATURE. Both are merchant
   * outages, which outranks spreading read load - and the Redis cache planned
   * for this lookup removes the query from the hot path anyway.
   */
  async validateSignature(
    dto: FilterMerchantSignatureValidationDto,
  ): Promise<MerchantSignatureValidationDto> {
    const merchantSignature = await this.findMerchantSignature(dto.clientId);

    if (!merchantSignature) {
      return this.reject(null, MerchantSignatureFailureEnum.UNKNOWN_CLIENT);
    }

    const { userId } = merchantSignature;

    if (merchantSignature.status !== MerchantSignatureStatusEnum.ACTIVE) {
      return this.reject(userId, MerchantSignatureFailureEnum.CLIENT_SUSPENDED);
    }

    if (!merchantSignature.secretKey) {
      return this.reject(
        userId,
        MerchantSignatureFailureEnum.SECRET_KEY_NOT_GENERATED,
      );
    }

    // Fields are passed explicitly rather than spread: `buildCanonical` takes
    // a subset of this DTO, and a spread would silently pass `undefined` for
    // any field later renamed on either side - producing a canonical string
    // that fails to match for every merchant, with nothing to point at.
    const canonical = buildCanonical({
      httpMethod: dto.httpMethod,
      endpoint: dto.endpoint,
      nonce: dto.nonce,
      bodyHash: dto.bodyHash,
      timestampIso: dto.timestampIso,
    });

    const matchedKey = this.matchSecretKey(merchantSignature, canonical, dto);
    if (!matchedKey) {
      return this.reject(
        userId,
        MerchantSignatureFailureEnum.INVALID_SIGNATURE,
      );
    }

    if (matchedKey === 'previous') {
      // A merchant still signing with the retired key is heading for an
      // outage when the grace window closes, and nothing else surfaces it.
      this.logger.warn({
        msg: 'Merchant signed with the previous secret key',
        userId,
        rotatedAt: merchantSignature.secretKeyRotatedAt?.toISOString(),
      });
    }

    // After the signature, deliberately. Rejecting on origin first would mean
    // never learning that a secret had leaked: this rejection is only
    // reachable by a caller who *proved* they hold the merchant's key, which
    // makes it the highest-fidelity credential-compromise signal available.
    // `clientId` travels in a header and is not secret; `secretKey` is.
    //
    // Before the nonce claim, also deliberately: a request rejected on origin
    // must not burn its nonce, or a merchant who fixes their allowlist and
    // retries the same signed request gets REPLAYED_NONCE instead.
    if (!isIpAllowed(dto.ipAddress, merchantSignature.allowedIps)) {
      this.logger.warn({
        msg: 'Valid signature from an address outside the merchant allowlist',
        userId,
        ipAddress: dto.ipAddress,
      });
      return this.reject(userId, MerchantSignatureFailureEnum.IP_NOT_ALLOWED);
    }

    // Last, and only once the signature has proved knowledge of the secret:
    // claiming earlier would let unauthenticated traffic populate the store.
    const nonceClaimed = await this.merchantSignatureRedis.claimNonce(
      dto.clientId,
      dto.nonce,
    );
    if (!nonceClaimed) {
      return this.reject(userId, MerchantSignatureFailureEnum.REPLAYED_NONCE);
    }

    return {
      isValid: true,
      userId,
      reason: null,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * Cache-aside read of the merchant's signature row.
   *
   * The write happens **only on a miss**. Writing on every request would
   * refresh the TTL on each hit, so a busy merchant's entry would never
   * expire - and expiry is the only backstop if an invalidation is ever
   * missed.
   *
   * An unknown client is deliberately not cached. Negative caching would blunt
   * a clientId-spraying attack, but it also means a merchant onboarded moments
   * ago can read as unknown for a full TTL; the row is only written once the
   * database has confirmed it exists.
   */
  private async findMerchantSignature(
    clientId: string,
  ): Promise<MerchantSignatureRedisDto | null> {
    const cached =
      await this.merchantSignatureRedis.getMerchantSignature(clientId);
    if (cached) return cached;

    const merchantSignature =
      await this.prismaMaster.merchantSignature.findUnique({
        where: { clientId, deletedAt: null },
        select: {
          userId: true,
          status: true,
          secretKey: true,
          secretKeyPrevious: true,
          secretKeyRotatedAt: true,
          allowedIps: true,
        },
      });

    if (merchantSignature) {
      await this.merchantSignatureRedis.setMerchantSignature(
        clientId,
        merchantSignature,
      );
    }

    return merchantSignature;
  }

  /**
   * Try the current secret, then the previous one while the grace window from
   * the last rotation is still open.
   *
   * Both branches run `verifySignature`, which compares in constant time; the
   * result reveals which key matched but not any part of either key.
   */
  private matchSecretKey(
    merchantSignature: {
      secretKey: string | null;
      secretKeyPrevious: string | null;
      secretKeyRotatedAt: Date | null;
    },
    canonical: string,
    dto: FilterMerchantSignatureValidationDto,
  ): 'current' | 'previous' | null {
    const signatureReceived = dto.signature;

    if (
      merchantSignature.secretKey &&
      verifySignature({
        secretKey: merchantSignature.secretKey,
        canonical,
        signatureReceived,
      })
    ) {
      return 'current';
    }

    if (
      merchantSignature.secretKeyPrevious &&
      this.isWithinGraceWindow(merchantSignature.secretKeyRotatedAt) &&
      verifySignature({
        secretKey: merchantSignature.secretKeyPrevious,
        canonical,
        signatureReceived,
      })
    ) {
      return 'previous';
    }

    return null;
  }

  private isWithinGraceWindow(rotatedAt: Date | null): boolean {
    if (!rotatedAt) return false;

    const graceMs =
      this.merchantSignatureConfig.SECRET_KEY_GRACE_SECONDS * 1000;
    return Date.now() - rotatedAt.getTime() <= graceMs;
  }

  /** Every rejection carries `serverTime` so the guard can echo it. */
  private reject(
    userId: number | null,
    reason: MerchantSignatureFailureEnum,
  ): MerchantSignatureValidationDto {
    return {
      isValid: false,
      userId,
      reason,
      serverTime: new Date().toISOString(),
    };
  }
}
