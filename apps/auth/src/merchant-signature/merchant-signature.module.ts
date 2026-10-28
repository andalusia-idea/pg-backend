import { Module } from '@nestjs/common';
import { MerchantSecretCleanupService } from './merchant-secret-cleanup.service';
import { MerchantSignatureController } from './merchant-signature.controller';
import { MerchantSignatureService } from './merchant-signature.service';

@Module({
  controllers: [MerchantSignatureController],
  providers: [MerchantSignatureService, MerchantSecretCleanupService],
  exports: [MerchantSignatureService],
})
export class MerchantSignatureModule {}
