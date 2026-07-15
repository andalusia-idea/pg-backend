import { NestFactory } from '@nestjs/core';
import { SettlereconModule } from './settlerecon.module';

async function bootstrap() {
  const app = await NestFactory.create(SettlereconModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
