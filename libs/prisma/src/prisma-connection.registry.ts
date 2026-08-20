import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * How long to wait for a pool to drain before giving up on it.
 *
 * `pool.end()` waits for every checked-out client to be released, so a query
 * that never returns would otherwise hang shutdown forever - and a process that
 * ignores SIGTERM gets SIGKILLed by the orchestrator, which is the abrupt
 * disconnect this class exists to avoid. Bounding the wait keeps a stuck query
 * from turning a graceful shutdown into a forced one.
 */
const DRAIN_TIMEOUT_MS = 10_000;

type RegisteredConnection = {
  label: string;
  client: { $disconnect: () => Promise<void> };
  pool: Pool;
  closed: boolean;
};

/**
 * Closes the Prisma clients and their underlying `pg` pools when Nest shuts down.
 *
 * ---
 * **Why this is needed at all.**
 *
 * `prisma.$disconnect()` does not close these pools. The adapter distinguishes a
 * pool it created from one handed to it, and only closes the former
 * (`@prisma/adapter-pg` 7.8.0):
 *
 * ```js
 * if (this.externalPool) {
 *   if (this.options?.disposeExternalPool) {
 *     await this.externalPool.end();
 *   } else {
 *     this.externalPool.removeListener('error', onIdleClientError);  // left open
 *   }
 * } else {
 *   await client.end();
 * }
 * ```
 *
 * The provider factories construct the `Pool` themselves and pass the instance
 * in, so every pool lands in the `externalPool` branch and survives
 * `$disconnect()`. Passing `{ disposeExternalPool: true }` to the adapter is the
 * other way to solve this; closing the pool here is preferred because the
 * ownership is then visible in the code rather than resting on an adapter flag.
 *
 * ---
 * **What goes wrong without it.**
 *
 * Nothing while the app runs - `pg.Pool` defaults to `idleTimeoutMillis: 10000`,
 * so idle connections are reaped and there is no leak. The cost is all at exit:
 *
 * - Sockets die with the process instead of closing cleanly, so Postgres logs
 *   `unexpected EOF on client connection` and any in-flight query is killed
 *   mid-flight rather than allowed to finish.
 * - On a rolling deploy the old process's connections linger until Postgres
 *   notices they are dead, so old and new overlap. Four apps x two pools x the
 *   default `max: 10` is 80 possible connections against a default
 *   `max_connections` of 100 - doubling that window risks
 *   `FATAL: sorry, too many clients already`.
 * - `allowExitOnIdle` is false by default, so an open pool keeps the event loop
 *   alive: the process ignores SIGTERM and is eventually SIGKILLed, which
 *   produces the abrupt disconnects above on every single deploy.
 *
 * ---
 * `onApplicationShutdown` rather than `onModuleDestroy` deliberately: it is the
 * last hook Nest runs, so any module that still needs the database during its own
 * teardown finds it open.
 *
 * Requires `app.enableShutdownHooks()` in main.ts, which all four apps call.
 */
@Injectable()
export class PrismaConnectionRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(PrismaConnectionRegistry.name);
  private readonly connections: RegisteredConnection[] = [];

  /**
   * Called by the provider factories as each client is constructed. The client
   * registered here is the base one, before extensions - `$extends` returns a
   * proxy over the same engine, so disconnecting either works, and the base
   * reference keeps the type simple.
   */
  register(
    label: string,
    client: { $disconnect: () => Promise<void> },
    pool: Pool,
  ): void {
    this.connections.push({ label, client, pool, closed: false });
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.connections.length === 0) return;

    this.logger.log(
      `Closing ${this.connections.length} database connection(s)${signal ? ` on ${signal}` : ''}`,
    );

    // allSettled, not all: one pool failing to drain must not prevent the others
    // from closing. A half-closed shutdown is worse than a slow one.
    await Promise.allSettled(
      this.connections.map((connection) => this.close(connection)),
    );
  }

  private async close(connection: RegisteredConnection): Promise<void> {
    // Guards a second shutdown signal, and `pool.end()` rejects with
    // "Called end on pool more than once" if it is ever reached twice.
    if (connection.closed) return;
    connection.closed = true;

    try {
      // Order matters: $disconnect first so Prisma releases the client it holds
      // back to the pool, otherwise pool.end() waits on a client nothing will
      // return and burns the full drain timeout.
      await connection.client.$disconnect();
      await this.withTimeout(connection.pool.end(), connection.label);
      this.logger.log(`${connection.label} connection closed`);
    } catch (error) {
      this.logger.error(
        `Failed to close ${connection.label} connection`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async withTimeout(
    promise: Promise<void>,
    label: string,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${label} pool did not drain within ${DRAIN_TIMEOUT_MS}ms - ` +
                    'a query is probably still running. Abandoning it so the ' +
                    'process can exit.',
                ),
              ),
            DRAIN_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
