import { Controller } from '@nestjs/common';

/**
 * Placeholder for a Swagger test surface, like the QRIS and Transfer ones.
 *
 * Not written yet: the Biller endpoints share the Transfer host, so nothing
 * here can be exercised until Flash whitelist our IP. Adding untested probe
 * routes now would only invite them being trusted.
 */
@Controller()
export class MotionPayBillerManualController {}
