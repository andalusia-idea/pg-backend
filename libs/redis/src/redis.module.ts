import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis.client';
import { RedisProvider } from './redis.provider';
import { MerchantSignatureRedis } from './merchant-signature.redis';
import { FeeRedis } from './fee.redis';
import { ConfigModule } from '@nestjs/config';
import { ProfileRedis } from './profile.redis';

@Global()
@Module({
  providers: [
    RedisClient,
    RedisProvider,
    MerchantSignatureRedis,
    FeeRedis,
    ProfileRedis,
  ],
  exports: [RedisProvider, MerchantSignatureRedis, FeeRedis, ProfileRedis],
  imports: [ConfigModule],
})
export class RedisModule {}
