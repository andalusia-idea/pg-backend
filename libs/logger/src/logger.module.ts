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
          // Kubernetes liveness/readiness probes hit /health continuously and
          // would otherwise dominate the logs. Skip the automatic
          // request/response lines for probe and docs traffic; genuine errors
          // are still logged by LoggerErrorInterceptor.
          autoLogging: {
            ignore: (req: { url?: string }) => {
              const url = req.url ?? '';
              return (
                url.startsWith('/health') ||
                url.startsWith('/metrics') ||
                url.includes('/swag-rwz')
              );
            },
          },
          // pino-http binds the serialized request onto the child logger, so
          // whatever these return is prepended to *every* line logged during
          // that request. The default req serializer includes all headers,
          // which buries your own log values behind ~15 lines of user-agent
          // and sec-ch-ua noise. Keep only what identifies the request.
          serializers: {
            req: (req: { id?: unknown; method?: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode?: number }) => ({
              statusCode: res.statusCode,
            }),
          },
          // Defence in depth for credentials that should never be logged.
          // Redaction is not a licence to log secrets — it only catches the
          // ones that slip through.
          redact: {
            paths: [
              'req.headers.authorization',
              'headers.authorization',
              'headers.Authorization',
              'config.headers.Authorization',
              'token',
              'token.token',
              'accessToken',
              '*.accessToken',
            ],
            censor: '[REDACTED]',
          },
          transport: {
            targets: appConfig.IS_PRODUCTION
              ? [
                  // Production: raw JSON to stdout (fd 1) and nothing else.
                  // That is what the container runtime captures and what the
                  // log shipper (Promtail / Grafana Alloy) forwards to Loki.
                  //
                  // No file target on purpose: rotating files written inside a
                  // container are lost on every restart, consume the pod's
                  // ephemeral disk, and are invisible to the platform's log
                  // collector. stdout is the only durable path in k8s.
                  { target: 'pino/file', options: { destination: 1 } },
                ]
              : [
                  {
                    target: 'pino-pretty',
                    options: {
                      singleLine: true,
                      // Console only - the file target below keeps the full
                      // record. `req` is dropped here because even the trimmed
                      // version is noise while reading your own log lines; the
                      // HTTP completion line still reports it.
                      ignore: 'pid,hostname,req',
                    },
                  },
                  // Local rotating file, dev only - handy for grepping a
                  // session after the fact without scrollback.
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
