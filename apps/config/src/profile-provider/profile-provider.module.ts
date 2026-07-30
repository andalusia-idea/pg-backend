import { Module } from '@nestjs/common';
import { ProfileProviderController } from './profile-provider.controller';
import { ProfileProviderService } from './profile-provider.service';

@Module({
  controllers: [ProfileProviderController],
  providers: [ProfileProviderService],
  exports: [ProfileProviderService],
})
export class ProfileProviderModule {}
