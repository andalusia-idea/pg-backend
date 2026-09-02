import { Global, Module } from '@nestjs/common';
import { MotionPayModule } from './motionpay';

@Global()
@Module({ imports: [MotionPayModule] })
export class UpstreamModule {}
