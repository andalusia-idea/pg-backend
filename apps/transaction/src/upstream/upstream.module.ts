import { Module } from '@nestjs/common';
import { MotionPayModule } from './motionpay';
import { JatelindoModule } from './jatelindo';

@Module({
  imports: [MotionPayModule, JatelindoModule],
  exports: [MotionPayModule, JatelindoModule],
})
export class UpstreamModule {}
