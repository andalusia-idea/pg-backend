import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis.client';
import { RedisProvider } from './redis.provider';
import { MerchantSignatureRedis } from './merchant-signature.redis';
import { FeeRedis } from './fee.redis';
import { ConfigModule } from '@nestjs/config';
import { ProfileRedis } from './profile.redis';
import { TokenRedis } from './token.redis';
import { TerminusModule } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

@Global()
@Module({
  providers: [
    RedisClient,
    RedisProvider,
    MerchantSignatureRedis,
    FeeRedis,
    ProfileRedis,
    TokenRedis,
    RedisHealthIndicator,
  ],
  exports: [
    RedisProvider,
    MerchantSignatureRedis,
    FeeRedis,
    ProfileRedis,
    TokenRedis,
    RedisHealthIndicator,
  ],
  // TerminusModule for HealthIndicatorService, which RedisHealthIndicator needs.
  imports: [ConfigModule, TerminusModule],
})
export class RedisModule {}
