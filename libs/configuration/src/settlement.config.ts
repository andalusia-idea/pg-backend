import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';

@Injectable()
export class SettlementConfig {
  constructor(private readonly configService: ConfigService) {}
  private portValidator(key: string): number {
    const value = this.configService.getOrThrow<number>(key);

    const port = Number(value);

    if (!Number.isInteger(port)) {
      throw new Error(
        `key [${key}] value [${value}] PORT must be a valid integer`,
      );
    }
    return port;
  }

  get POSTGRESQL_URL_MASTER_AUTH(): string {
    return this.configService.getOrThrow<string>('POSTGRESQL_URL_MASTER_AUTH');
  }
  get POSTGRESQL_URL_SLAVE_AUTH(): string {
    return this.configService.getOrThrow<string>('POSTGRESQL_URL_SLAVE_AUTH');
  }

  get POSTGRESQL_URL_MASTER_CONFIG(): string {
    return this.configService.getOrThrow<string>(
      'POSTGRESQL_URL_MASTER_CONFIG',
    );
  }
  get POSTGRESQL_URL_SLAVE_CONFIG(): string {
    return this.configService.getOrThrow<string>('POSTGRESQL_URL_SLAVE_CONFIG');
  }

  get POSTGRESQL_URL_MASTER_TRANSACTION(): string {
    return this.configService.getOrThrow<string>(
      'POSTGRESQL_URL_MASTER_TRANSACTION',
    );
  }

  get POSTGRESQL_URL_SLAVE_TRANSACTION(): string {
    return this.configService.getOrThrow<string>(
      'POSTGRESQL_URL_SLAVE_TRANSACTION',
    );
  }

  get REDIS_HOST(): string {
    return this.configService.getOrThrow<string>('REDIS_HOST');
  }
  get REDIS_PORT(): number {
    return this.portValidator('REDIS_PORT');
  }
  get REDIS_USERNAME(): string {
    return this.configService.getOrThrow<string>('REDIS_USERNAME');
  }
  get REDIS_PASSWORD(): string {
    return this.configService.getOrThrow<string>('REDIS_PASSWORD');
  }

  /**
   * Which *process instance* this is, for `SettlementRun.claimedBy`.
   *
   * Not a `MACHINE_USER_ID`: a machine principal names a role and every
   * settlement pod authenticates as the same one, so storing it would write an
   * identical value on every row. A lease column has to distinguish instances,
   * because the question asked of it is "which process died holding this run,
   * and whose logs do I read".
   *
   * `get`, not `getOrThrow`: in Kubernetes a container's hostname already *is*
   * the pod name, so this needs no manifest change to be useful. Set `POD_NAME`
   * explicitly where that is not true - running several processes on one
   * machine locally, for instance, where the hostname cannot tell them apart.
   *
   * Truncated to 100 characters because `claimedBy` is `VarChar(100)`; a longer
   * value would fail the claim rather than just reading oddly.
   */
  get POD_IDENTITY(): string {
    const configured = this.configService.get<string>('POD_NAME');

    return (configured ?? hostname()).slice(0, 100);
  }
}
