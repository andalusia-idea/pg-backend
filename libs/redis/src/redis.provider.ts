/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Provider } from '@nestjs/common';
import { RedisClient } from './redis.client';

export const REDIS_KEY = Symbol('REDIS_KEY');

export const RedisProvider: Provider = {
  provide: REDIS_KEY,
  useFactory: (redisClient: RedisClient) => {
    return redisClient.instance;
  },
  inject: [RedisClient],
};
