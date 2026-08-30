import { Module } from '@nestjs/common';
import { MotionPayModule } from './motionpay';

@Module({ imports: [MotionPayModule] })
export class UpstreamModule {}
