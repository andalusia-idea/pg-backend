import { Module } from '@nestjs/common';
import { UserProfileService } from './user-profile.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { EmailUniqueValidator } from './validator/email-unique.validator';

@Module({
  controllers: [UserController],
  // EmailUniqueValidator is resolved by class-validator through Nest's DI
  // container (wired by useContainer() in main.ts), so it must be a provider.
  providers: [UserService, UserProfileService, EmailUniqueValidator],
  exports: [UserService, UserProfileService],
})
export class UserModule {}
