import { Global, Module } from '@nestjs/common';
import {
  PrismaMasterTransactionProvider,
  PrismaSlaveTransactionProvider,
} from './prisma-transaction.provider';
import { PrismaConnectionRegistry } from '@app/prisma';

/**
 * This app's own Prisma wiring, in place of `PrismaModule.forRoot()`.
 *
 * `PrismaModule` builds exactly one master/slave pair from one client class,
 * which does not fit here: the settlement app reaches more than one schema, so
 * it needs a client per schema rather than a client per app.
 *
 * The auth and config providers are commented out until something consumes
 * them - each pair is two more connection pools, and `PrismaConnectionRegistry`
 * puts the budget at roughly 80 of a default `max_connections` of 100 across
 * the other four apps already. Their DSNs are commented out of `.env.example`
 * to match, so `getOrThrow` cannot fire for a key nothing reads.
 */
@Global()
@Module({
  providers: [
    // Must be a provider *here*, not merely imported: Nest only runs
    // `onApplicationShutdown` on providers it instantiates itself, and that
    // hook is the only thing that closes these pools. `PrismaModule` carries
    // the same note for the same reason.
    PrismaConnectionRegistry,
    // PrismaMasterAuthProvider,
    // PrismaSlaveAuthProvider,
    // PrismaMasterConfigProvider,
    // PrismaSlaveConfigProvider,
    PrismaMasterTransactionProvider,
    PrismaSlaveTransactionProvider,
  ],
  exports: [
    // PrismaMasterAuthProvider,
    // PrismaSlaveAuthProvider,
    // PrismaMasterConfigProvider,
    // PrismaSlaveConfigProvider,
    PrismaMasterTransactionProvider,
    PrismaSlaveTransactionProvider,
  ],
})
export class DatabaseModule {}
