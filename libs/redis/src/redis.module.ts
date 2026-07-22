import { Global, Module } from '@nestjs/common';
import { RedisClient } from './redis.client';
import { RedisProvider } from './redis.provider';

@Global()
@Module({
  providers: [RedisClient, RedisProvider],
  exports: [RedisProvider],
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
