import { NestFactory } from '@nestjs/core';
import { ConfigModule } from './config.module';

async function bootstrap() {
  const app = await NestFactory.create(ConfigModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
