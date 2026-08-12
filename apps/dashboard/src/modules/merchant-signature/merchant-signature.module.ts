import { Module } from '@nestjs/common';
import { MerchantSignatureController } from './merchant-signature.controller';
import { MerchantSignatureService } from './merchant-signature.service';

@Module({
  controllers: [MerchantSignatureController],
  providers: [MerchantSignatureService],
  exports: [MerchantSignatureService],
})
export class MerchantSignatureModule {}
