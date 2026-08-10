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
import { RolesGuard } from '../auth/guard/roles.guard';
import { auditTrailExtension } from '../database/audit.extension';
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
    { provide: APP_GUARD, useClass: RolesGuard },
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
  ],
})
export class AppModule {}
