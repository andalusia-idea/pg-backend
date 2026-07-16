import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { AppConfig, TCPConfig } from '@app/configuration';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const appConfig = app.get(AppConfig);
  const tcpConfig = app.get(TCPConfig);

  app.setGlobalPrefix(appConfig.API_PREFIX, {
    exclude: ['/metrics'],
  });

  app.enableCors({
    origin: appConfig.IS_PRODUCTION ? [''] : true,
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: tcpConfig.SETTLERECON.HOST,
      port: tcpConfig.SETTLERECON.PORT,
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
    `TCP Name [${tcpConfig.SETTLERECON.NAME}], TCP Host [${tcpConfig.SETTLERECON.HOST}], TCP PORT [${tcpConfig.SETTLERECON.PORT}]`,
  );
}

void bootstrap();
