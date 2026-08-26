import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis.client';
import { RedisProvider } from './redis.provider';
import { MerchantSignatureRedis } from './merchant-signature.redis';

@Global()
@Module({
  providers: [RedisClient, RedisProvider, MerchantSignatureRedis],
  exports: [RedisProvider, MerchantSignatureRedis],
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
