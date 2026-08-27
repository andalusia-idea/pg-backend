import { Module } from '@nestjs/common';
import { PurchaseController } from './purchase.controller';

@Module({ controllers: [PurchaseController] })
export class PurchaseModule {}
