import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis.client';
import { RedisProvider } from './redis.provider';
import { MerchantSignatureRedis } from './merchant-signature.redis';
import { FeeRedis } from './fee.redis';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  providers: [RedisClient, RedisProvider, MerchantSignatureRedis, FeeRedis],
  exports: [RedisProvider, MerchantSignatureRedis, FeeRedis],
  imports: [ConfigModule],
})
export class RedisModule {}

// │   ├── src/
// │   │   ├── module/
// │   │   │   redis.module.ts
// │   │   │
// │   │   ├── client/
// │   │   │   redis.client.ts
// │   │   │
// │   │   ├── services/
// │   │   │   cache.service.ts
// │   │   │   session.service.ts
// │   │   │   rate-limit.service.ts
// │   │   │   idempotency.service.ts
// │   │   │
// │   │   ├── constants/
// │   │   ├── interfaces/
// │   │   └── index.ts
