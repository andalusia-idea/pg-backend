import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app/app.module';
import { AppConfig } from '@app/configuration';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_000_000 }),
    {
      bufferLogs: true,
      /**
       * Keep the raw request bytes on `req.rawBody` for the merchant
       * signature guard.
       *
       * The signature covers a SHA-256 of the bytes actually sent. Once
       * Fastify has parsed the JSON those bytes are gone, and re-serialising
       * the parsed object is not a round trip - integer-like keys reorder,
       * `1.50` becomes `1.5`, whitespace vanishes - so it would hash
       * something the merchant never sent.
       *
       * Nest registers its own body parser for this, so a hand-rolled
       * `addContentTypeParser` is not needed. Read it in the guard with
       * `RawBodyRequest<FastifyRequest>` from `@nestjs/common`.
       */
      rawBody: true,
    },
  );

  const appConfig = app.get(AppConfig);
  const logger = app.get(Logger);
  app.useLogger(logger);

  app.enableShutdownHooks();

  await app.listen(
    appConfig.PORT,
    appConfig.IS_PRODUCTION ? '0.0.0.0' : 'localhost',
  );
  logger.log(
    `${appConfig.APP_NAME} [${appConfig.NODE_ENV}] listening on port ${appConfig.PORT}`,
  );
  console.log(
    `${appConfig.APP_NAME} [${appConfig.NODE_ENV}] listening on port ${appConfig.PORT}`,
  );
}
void bootstrap();
