import { DatabaseConfig } from '@app/configuration';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisClient implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;

  /**
   * Constructed here, **not** in `onModuleInit`.
   *
   * `RedisProvider`'s factory reads `.instance` to bind `REDIS_KEY`, and Nest
   * runs every provider factory during dependency resolution - before any
   * `onModuleInit`. Assigning the client in that hook therefore bound
   * `REDIS_KEY` to `undefined` permanently, for every consumer of it:
   * `MerchantSignatureRedis`, `TokenRedis`, `FeeRedis`, `ProfileRedis`. It went
   * unnoticed because their unit tests construct them with a mock rather than
   * through DI, and the first thing to actually call a method on the injected
   * client was the health indicator.
   *
   * Safe to do in a constructor: `new Redis()` does not block. ioredis opens
   * the socket in the background and queues commands until it is ready, which
   * is what `onModuleInit`'s ping then waits for.
   */
  constructor(private readonly databaseConfig: DatabaseConfig) {
    this.client = new Redis({
      host: this.databaseConfig.REDIS_HOST,
      port: this.databaseConfig.REDIS_PORT,
      username: this.databaseConfig.REDIS_USERNAME,
      password: this.databaseConfig.REDIS_PASSWORD,

      retryStrategy(times) {
        return Math.min(times * 50, 200); // Reconnect Logic
      },
      enableReadyCheck: true, // Ensures Redis is ready before proceeding
      maxRetriesPerRequest: 1, // Limits retry attempts to avoid hanging
    });

    this.client.on('error', (error) => {
      console.error(error);
    });
    this.client.on('connect', () => {
      console.log('Redis Client Connect');
    });
  }

  get instance(): Redis {
    return this.client;
  }

  /** Readiness gate: refuse to finish booting if Redis cannot be reached. */
  async onModuleInit() {
    await this.client.ping();
  }
  async onModuleDestroy() {
    await this.client.quit();
    console.log('Redis Connection Closed');
  }

  /**
   * Set a value in Redis under the given key.
   * If the value is an object, we convert it to a JSON string before saving,
   * because Redis only stores strings.
   */
  // async set(key: string, value: any): Promise<string> {
  //   try {
  //     const stringValue =
  //       typeof value === 'object' ? JSON.stringify(value) : String(value);

  //     return await this.redisClient.set(key, stringValue);
  //   } catch (error) {
  //     console.error(`Error setting key "${key}":`, error);
  //     throw error;
  //   }
  // }

  /**
   * Get a value from Redis using a key.
   * If the value is in JSON format, we parse it to convert it back to an object.
   */
  // async get<T = any>(key: string): Promise<T | null> {
  //   try {
  //     const value = await this.redisClient.get(key);
  //     if (!value) return null;

  //     try {
  //       // Try to parse JSON string back to object
  //       return JSON.parse(value);
  //     } catch {
  //       // If parsing fails, just return the raw string value
  //       return value as T;
  //     }
  //   } catch (error) {
  //     console.error(`Error getting key "${key}":`, error);
  //     return null;
  //   }
  // }
}
