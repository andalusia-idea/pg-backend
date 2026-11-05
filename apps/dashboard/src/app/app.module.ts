import { ConfigurationModule, envFilePath } from '@app/configuration';
import { LoggerModule } from '@app/logger';
import { PrismaModule } from '@app/prisma';
import { RedisModule } from '@app/redis';
import { PrismaClient } from '@dashboard/prisma';
import { ClassSerializerInterceptor, Module } from '@nestjs/common';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
  Reflector,
} from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { auditTrailExtension } from '../database/audit.extension';
import { AgentDetailModule } from '../modules/agent-detail/agent-detail.module';
import { BalanceModule } from '../modules/balance/balance.module';
import { DisbursementModule } from '../modules/disbursement/disbursement.module';
import { PurchaseModule } from '../modules/purchase/purchase.module';
import { SettlementModule } from '../modules/settlement/settlement.module';
import { TopupModule } from '../modules/topup/topup.module';
import { WithdrawModule } from '../modules/withdraw/withdraw.module';
import { ConfigAgentModule } from '../modules/config-agent/config-agent.module';
import { ConfigCommonModule } from '../modules/config-common/config-common.module';
import { ConfigFeeModule } from '../modules/config-fee/config-fee.module';
import { ConfigMerchantModule } from '../modules/config-merchant/config-merchant.module';
import { MerchantDetailModule } from '../modules/merchant-detail/merchant-detail.module';
import { MerchantSignatureModule } from '../modules/merchant-signature/merchant-signature.module';
import { PermissionModule } from '../modules/permission/permission.module';
import { UserModule } from '../modules/user/user.module';
import {
  AllExceptionsFilter,
  InvalidRequestExceptionFilter,
  PrismaClientKnownExceptionFilter,
  ResponseExceptionFilter,
} from '../shared/filter';
import { ResponseInterceptor } from '../shared/interceptor';
import { CustomValidationPipe } from '../shared/pipe';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RolesGuard } from '../auth';
import { SuperAdminModule } from '../super-admin';

@Module({
  controllers: [AppController, HealthController],
  providers: [
    AppService,

    { provide: APP_PIPE, useClass: CustomValidationPipe },

    // Filters are applied bottom-up: the last one registered wins for a given
    // exception type, so AllExceptionsFilter must come first to stay the fallback.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: PrismaClientKnownExceptionFilter },
    { provide: APP_FILTER, useClass: ResponseExceptionFilter },
    { provide: APP_FILTER, useClass: InvalidRequestExceptionFilter },

    // ClassSerializerInterceptor runs the @ToMoneyString / @ToJakartaISO
    // transforms; ResponseInterceptor then wraps the result in ResponseDto.
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) =>
        new ClassSerializerInterceptor(reflector),
      inject: [Reflector],
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new ResponseInterceptor(reflector),
      inject: [Reflector],
    },

    { provide: APP_GUARD, useClass: JwtAuthGuard },

    // RolesGuard runs after JwtAuthGuard, which is what populates request.user
    // for it to read - global guards execute in registration order, so these
    // two must stay in this order.
    //
    // @Roles() is enforced from here on. An endpoint with no @Roles() is still
    // open to any authenticated caller, so this is coverage for the three
    // decorated sites rather than a default-deny: adding a decorator is what
    // restricts an endpoint, not registering this guard.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: envFilePath('dashboard'),
    }),
    // Carries authInfo per request so the Prisma audit extension can stamp
    // createdBy / updatedBy without threading it through every service call.
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    LoggerModule,
    // Not @app/health: its HealthController also pings tcp-auth, tcp-config
    // and tcp-transaction, which this app holds no client to and has no
    // CLIENT_* key for - so every request threw out of TCPConfig's getOrThrow.
    // The local HealthController pings Redis and the two pools, and nothing
    // else this process does not itself need.
    //
    // TerminusModule arrived with @app/health; the local controller injects the
    // same indicators, so it has to be imported here instead.
    TerminusModule,
    RedisModule,
    PrismaModule.forRoot({
      prismaClient: PrismaClient,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      applyMasterExtensions: (client) => client.$extends(auditTrailExtension),
    }),
    AuthModule,
    SuperAdminModule,

    // Feature modules, ported in the order listed in docs/dashboard-migration.md
    UserModule,
    PermissionModule,
    AgentDetailModule,
    MerchantDetailModule,
    MerchantSignatureModule,
    ConfigCommonModule,
    ConfigAgentModule,
    ConfigFeeModule,
    ConfigMerchantModule,
    BalanceModule,
    PurchaseModule,
    TopupModule,
    WithdrawModule,
    DisbursementModule,
    SettlementModule,
  ],
})
export class AppModule {}
