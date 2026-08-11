import { ConfigurationModule } from '@app/configuration';
import { HealthModule } from '@app/health';
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

@Module({
  controllers: [AppController],
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

    // RolesGuard is deliberately NOT registered: @Roles() is metadata-only for
    // now, marking intended access while the role model is settled internally.
    // Authentication (JwtAuthGuard) is the only thing enforced today.
    // Re-enabling is this one line:
    //   { provide: APP_GUARD, useClass: RolesGuard },
  ],
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/dashboard/.env.local', 'apps/dashboard/.env'],
    }),
    // Carries authInfo per request so the Prisma audit extension can stamp
    // createdBy / updatedBy without threading it through every service call.
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    LoggerModule,
    HealthModule,
    RedisModule,
    PrismaModule.forRoot({
      prismaClient: PrismaClient,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      applyMasterExtensions: (client) => client.$extends(auditTrailExtension),
    }),
    AuthModule,

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
  ],
})
export class AppModule {}
