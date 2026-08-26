import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_KEY } from './redis.provider';
import { NONCE_KEY_PREFIX } from './redis.constant';

@Injectable()
export class MerchantSignatureRedis {
  constructor(
    @Inject(REDIS_KEY)
    private readonly redis: Redis,
  ) {}

  private nonceKey(clientId: string, nonce: string): string {
    return `${NONCE_KEY_PREFIX}:${clientId}:${nonce}`;
  }

  /**
   * Claim a nonce for the replay window. Returns true if it had not been seen.
   *
   * `SET NX` tests and sets in one atomic step, which is what makes this
   * correct across replicas - the deployment runs `maxReplicas: 2`, so a
   * read-then-write pair would let a replay routed to the other pod slip
   * through the gap between the two calls.
   *
   * It also must not be a read-and-delete (`GETDEL`): consuming the stored
   * nonce on a *rejected* replay leaves nothing behind, so the very next
   * replay of the same request finds a clean slate and succeeds. The nonce
   * has to survive for its full TTL regardless of how many times it is
   * presented.
   *
   * Redis failures are deliberately **not** caught. A replay check that
   * silently answers "not seen" when the store is unreachable fails open,
   * which is the wrong direction for a payment API - the caller's fail-closed
   * path should reject instead.
   */
  async claimNonce(
    clientId: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.nonceKey(clientId, nonce),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }
}
