import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis.client';
import { RedisProvider } from './redis.provider';
import { MerchantSignatureRedis } from './merchant-signature.redis';
import { FeeRedis } from './fee.redis';
import { ConfigModule } from '@nestjs/config';
import { ProfileRedis } from './profile.redis';
import { TokenRedis } from './token.redis';

@Global()
@Module({
  providers: [
    RedisClient,
    RedisProvider,
    MerchantSignatureRedis,
    FeeRedis,
    ProfileRedis,
    TokenRedis,
  ],
  exports: [
    RedisProvider,
    MerchantSignatureRedis,
    FeeRedis,
    ProfileRedis,
    TokenRedis,
  ],
  imports: [ConfigModule],
})
export class RedisModule {}
