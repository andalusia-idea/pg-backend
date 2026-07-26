import { AppConfig, ConfigurationModule } from '@app/configuration';
import { Global, Module, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  LoggerErrorInterceptor,
  LoggerModule as PinoLoggerModule,
} from 'nestjs-pino';

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigurationModule],
      inject: [AppConfig],
      useFactory: (appConfig: AppConfig) => ({
        pinoHttp: {
          level: appConfig.IS_PRODUCTION ? 'info' : 'debug',
          customProps: () => ({ context: 'HTTP' }),
          transport: {
            targets: [
              // Console: pretty in dev, raw JSON to stdout in prod (fd 1) -
              // this is what Docker captures and a log shipper (Promtail /
              // Grafana Alloy) reads to forward into Loki. No other
              // app-side config needed for logs to reach Grafana.
              appConfig.IS_PRODUCTION
                ? { target: 'pino/file', options: { destination: 1 } }
                : { target: 'pino-pretty', options: { singleLine: true } },
              // Also write to a local rotating file. Not required once the
              // log shipper above is in place - comment this target out if
              // you don't want it.
              {
                target: 'pino-roll',
                options: {
                  file: `./logs/${appConfig.APP_NAME}`,
                  frequency: 'daily',
                  size: '10m',
                  mkdir: true,
                },
              },
            ],
          },
        },
        // Explicit named wildcard - avoids nestjs-pino's default '*' route,
        // which Express 5's path-to-regexp no longer accepts and Nest has
        // to auto-convert (with a warning) on every boot.
        forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      }),
    }),
  ],
  providers: [
    /// INTERCEPTOR
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggerErrorInterceptor,
    },
  ],
})
export class LoggerModule {}
