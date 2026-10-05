import { Global, Module } from '@nestjs/common';
import { MotionPayModule } from './motionpay';
import { JatelindoModule } from './jatelindo';

@Global()
@Module({ imports: [MotionPayModule, JatelindoModule] })
export class UpstreamModule {}
