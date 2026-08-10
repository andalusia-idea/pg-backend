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

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
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

  app.setGlobalPrefix(appConfig.API_PREFIX, {
    exclude: ['/metrics'],
  });

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
