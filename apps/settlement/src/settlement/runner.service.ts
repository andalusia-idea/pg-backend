import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_MASTER_TRANSACTION_PROVIDER_KEY } from '../database';
import { PrismaClient } from '@transaction/prisma';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class RunnerService {
  constructor(
    @Inject(PRISMA_MASTER_TRANSACTION_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'runner',
    waitForCompletion: true,
  })
  async drain(): Promise<void> {}
}
