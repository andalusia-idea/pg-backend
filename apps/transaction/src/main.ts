import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app/app.module';
import { AppConfig, TCPConfig } from '@app/configuration';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

/**
 * What Fastify treats as a trusted proxy when resolving `request.ip`.
 *
 * Read from `process.env` rather than `AppConfig` because the adapter is
 * constructed before Nest boots, so no injected config exists yet. In k8s this
 * arrives as a real environment variable; locally it is normally unset, since
 * there is no proxy in front.
 *
 * **Unset means do not trust `X-Forwarded-For` at all**, so `request.ip` is the
 * socket address - behind an ingress that is the proxy's own address, identical
 * for every caller. Set it to the ingress CIDR (e.g. `10.42.0.0/16`) in any
 * environment where merchant IP allowlisting is in use.
 *
 * Trust by **address**. Never `true`, which means believing whatever
 * `X-Forwarded-For` claims - anyone could then assert any origin and the
 * allowlist becomes theatre. Never a hop count either: that is spoofable by
 * anything able to reach the pod directly, which inside a cluster is every
 * other pod.
 *
 * Leaving it unset does not silently disable the control - an origin that
 * cannot be resolved is rejected rather than allowed (`isIpAllowed`).
 */
const trustProxy = process.env.TRUST_PROXY || false;

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_000_000, trustProxy }),
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
  const tcpConfig = app.get(TCPConfig);
  app.useLogger(app.get(Logger));

  const options = new DocumentBuilder()
    .setTitle(`${appConfig.APP_NAME} Service`)
    .setDescription(`${appConfig.APP_NAME} Service API Description`)
    .setVersion(appConfig.VERSION)
    .addServer(`http://localhost:${appConfig.PORT}`, 'Local')
    .addServer(`http://103.94.238.214:3003`, 'Production') // Adjust with Server Proxy
    .addServer(`https://api.manapay.id/transaction`, 'Production DNS') // Adjust with Server Proxy
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('/swag-rwz', app, document);

  app.enableCors({
    origin: appConfig.IS_PRODUCTION ? appConfig.CORS_ORIGINS : true,
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: tcpConfig.TRANSACTION.HOST,
      port: tcpConfig.TRANSACTION.PORT,
    },
  });

  app.enableShutdownHooks();
  await app.startAllMicroservices();

  await app.listen(
    appConfig.PORT,
    appConfig.IS_PRODUCTION ? '0.0.0.0' : 'localhost',
  );

  console.log(
    `${appConfig.APP_NAME} [${appConfig.NODE_ENV}] listening on port ${appConfig.PORT}`,
  );
  console.log(
    `TCP Name [${tcpConfig.TRANSACTION.NAME}], TCP Host [${tcpConfig.TRANSACTION.HOST}], TCP PORT [${tcpConfig.TRANSACTION.PORT}]`,
  );
}

void bootstrap();
