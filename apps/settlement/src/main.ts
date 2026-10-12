import { NestFactory } from '@nestjs/core';
import { SettlementModule } from './settlement.module';

async function bootstrap() {
  const app = await NestFactory.create(SettlementModule);
  await app.listen(process.env.port ?? 3000);
}
bootstrap();
