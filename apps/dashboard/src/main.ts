import { NestFactory } from '@nestjs/core';
import { AppConfig } from '@app/configuration';
import { useContainer } from 'class-validator';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const appConfig = app.get(AppConfig);
  app.useLogger(app.get(Logger));

  // Lets custom class-validator constraints resolve their dependencies from Nest's DI.
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  const options = new DocumentBuilder()
    .setTitle(`${appConfig.APP_NAME} Service`)
    .setDescription(`${appConfig.APP_NAME} Service API Description`)
    .setVersion(appConfig.VERSION)
    .addServer(`http://localhost:${appConfig.PORT}`, 'Local')
    .addServer(`http://103.94.238.214:3001`, 'Production') // Adjust with Server Proxy
    .addServer(`https://api.manapay.id/dashboard`, 'Production DNS') // Adjust with Server Proxy
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

  app.enableShutdownHooks();

  await app.listen(
    appConfig.PORT,
    appConfig.IS_PRODUCTION ? '0.0.0.0' : 'localhost',
  );

  console.log(
    `${appConfig.APP_NAME} [${appConfig.NODE_ENV}] listening on port ${appConfig.PORT}`,
  );
}
void bootstrap();
