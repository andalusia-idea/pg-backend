import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS_KEY } from './redis.provider';
import Redis from 'ioredis';
import { ProfileConfig } from '@app/configuration';
import { PaymentMethodNameEnum, TransactionTypeEnum } from '@app/microservice';
import {
  PROFILE_BANK_KEY_PREFIX,
  PROFILE_PROVIDER_KEY_PREFIX,
} from './redis.constant';

export type ProfileProviderRedisDto = {
  providerName: string;
};

export type ProfileBankRedisDto = {
  id: number;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
};

@Injectable()
export class ProfileRedis {
  private readonly logger = new Logger(ProfileRedis.name);

  constructor(
    @Inject(REDIS_KEY)
    private readonly redis: Redis,

    private readonly profileConfig: ProfileConfig,
  ) {}

  /**
   * Per user, per transaction type, per payment method.
   *
   * `paymentMethodName` belongs in the key because it is an *input* to the
   * routing decision, not a property of the merchant: the same merchant on the
   * same transaction type resolves to a different provider depending on which
   * method their customer picked at checkout. Leaving it out would let a QRIS
   * lookup answer a VIRTUALACCOUNT one from cache - the wrong provider, for the
   * whole TTL, with nothing failing loudly.
   */
  private profileProviderKey(
    userId: number,
    transactionType: TransactionTypeEnum,
    paymentMethodName: PaymentMethodNameEnum,
  ) {
    return `${PROFILE_PROVIDER_KEY_PREFIX}:${userId}:${transactionType}:${paymentMethodName}`;
  }

  private profileBankKey(userId: number) {
    return `${PROFILE_BANK_KEY_PREFIX}:${userId}`;
  }

  async getProfileProvider(
    userId: number,
    transactionType: TransactionTypeEnum,
    paymentMethodName: PaymentMethodNameEnum,
  ): Promise<ProfileProviderRedisDto | null> {
    const key = this.profileProviderKey(
      userId,
      transactionType,
      paymentMethodName,
    );
    try {
      const raw: string | null = await this.redis.get(key);
      if (!raw) return null;
      const entry = JSON.parse(raw) as ProfileProviderRedisDto;
      return entry;
    } catch (error) {
      this.logger.warn({ msg: `${key} read failed`, error });
      return null;
    }
  }

  async setProfileProvider(
    userId: number,
    transactionType: TransactionTypeEnum,
    paymentMethodName: PaymentMethodNameEnum,
    value: ProfileProviderRedisDto,
  ): Promise<boolean> {
    const key = this.profileProviderKey(
      userId,
      transactionType,
      paymentMethodName,
    );
    try {
      const ok = await this.redis.setex(
        key,
        this.profileConfig.PROFILE_PROVIDER_TTL_SECONDS,
        JSON.stringify(value),
      );
      return ok === 'OK';
    } catch (error) {
      this.logger.warn({ msg: `${key} write failed`, error });
      return false;
    }
  }

  /**
   * Drop every cached route for one user.
   *
   * Redis `DEL` takes exact key names - there is no prefix delete - and the
   * alternatives are both wrong here: `KEYS` blocks the whole server while it
   * walks the keyspace, and `SCAN` walks it too, across many round trips, just
   * to find at most a couple of dozen keys.
   *
   * Both enums are small closed sets, so the full cross product is enumerable
   * and one variadic `DEL` clears it in a single round trip, at a cost that
   * does not grow with the keyspace. Combinations that never existed (QRIS for
   * a WITHDRAW, say) cost nothing - `DEL` on a missing key is a no-op.
   *
   * Callers therefore do not need to know which route changed, which matters
   * because the dashboard - the only writer - generally does not.
   */
  async deleteProfileProvider(userId: number) {
    const keys = Object.values(TransactionTypeEnum).flatMap((transactionType) =>
      Object.values(PaymentMethodNameEnum).map((paymentMethodName) =>
        this.profileProviderKey(userId, transactionType, paymentMethodName),
      ),
    );
    try {
      const num = await this.redis.del(keys);
      return num;
    } catch (error) {
      // The keys themselves are noise at this width; the user and the count
      // are what identify the failure.
      this.logger.error({
        msg: `${PROFILE_PROVIDER_KEY_PREFIX}:${userId} delete failed`,
        userId,
        keyCount: keys.length,
        error,
      });
      return 0;
    }
  }

  ////////////
  async getProfileBank(userId: number): Promise<ProfileBankRedisDto | null> {
    const key = this.profileBankKey(userId);
    try {
      const raw: string | null = await this.redis.get(key);
      if (!raw) return null;
      const entry = JSON.parse(raw) as ProfileBankRedisDto;
      return entry;
    } catch (error) {
      this.logger.warn({ msg: `${key} read failed`, error });
      return null;
    }
  }
  async setProfileBank(
    userId: number,
    value: ProfileBankRedisDto,
  ): Promise<boolean> {
    const key = this.profileBankKey(userId);
    try {
      const ok = await this.redis.setex(
        key,
        this.profileConfig.PROFILE_BANK_TTL_SECONDS,
        JSON.stringify(value),
      );
      return ok === 'OK';
    } catch (error) {
      this.logger.warn({ msg: `${key} write failed`, error });
      return false;
    }
  }

  async deleteProfileBank(userId: number) {
    const key = this.profileBankKey(userId);
    try {
      const num = await this.redis.del(key);
      return num;
    } catch (error) {
      this.logger.error({ msg: `${key} delete failed`, error });
      return 0;
    }
  }
}
