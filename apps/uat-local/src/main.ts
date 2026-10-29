import { NestFactory } from '@nestjs/core';
import { UatLocalModule } from './uat-local.module';

async function bootstrap() {
  const app = await NestFactory.create(UatLocalModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
