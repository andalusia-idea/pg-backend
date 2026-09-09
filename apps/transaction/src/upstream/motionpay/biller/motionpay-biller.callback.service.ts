import { MotionPayConfig } from '@app/configuration';
import { ProviderNameEnum, isIpAllowed } from '@app/microservice';
import { UpstreamWebhookTransferDto } from '@app/upstream';
import { Injectable, Logger } from '@nestjs/common';
import { MotionPayBillerCallbackDto } from '../dto';
import {
  MOTIONPAY_METADATA_KEY,
  mapMotionPayBillerStatus,
  motionPayBillerSystemReference,
} from '../helper';

export type MotionPayBillerTranslation =
  | { accepted: false; reason: string }
  | { accepted: true; webhook: UpstreamWebhookTransferDto };

/**
 * Translates MotionPay's Biller callback into the provider-neutral payout
 * shape.
 *
 * Third sibling of the QRIS and Transfer translators, same contract: origin
 * check plus wire mapping, no knowledge of disbursements or fees.
 *
 * It emits `UpstreamWebhookTransferDto` rather than a biller-specific type on
 * purpose. From the business layer's point of view a settled e-wallet top-up
 * and a settled bank transfer are the same event - a payout reached a terminal
 * state - and the only reason two upstream paths exist is price. One neutral
 * shape is what keeps that a routing detail instead of a fork in the settlement
 * logic.
 *
 * Like the other two, this callback is unauthenticated, so nothing in it is
 * acted on until an authenticated status read confirms it.
 */
@Injectable()
export class MotionPayBillerCallbackService {
  private readonly logger = new Logger(MotionPayBillerCallbackService.name);

  constructor(private readonly motionPayConfig: MotionPayConfig) {}

  translate(
    payload: MotionPayBillerCallbackDto,
    sourceIp: string | null,
  ): MotionPayBillerTranslation {
    const data = payload.data as Record<string, string> | null;
    const paymentReference = data?.external_id ?? '';

    if (!this.isAllowedOrigin(sourceIp)) {
      this.logger.warn({
        msg: 'Biller callback rejected: origin not in the MotionPay allowlist',
        sourceIp,
        paymentReference,
      });
      return { accepted: false, reason: 'origin not allowed' };
    }

    if (!paymentReference) {
      this.logger.warn({
        msg: 'Biller callback carried no external_id - nothing to match',
        sourceIp,
      });
      return { accepted: false, reason: 'no external_id' };
    }

    return {
      accepted: true,
      webhook: {
        // The callback echoes the *payment* leg's external_id, which is our
        // systemReference plus a suffix. Stripping it here is what lets the
        // business layer look the row up by the reference it actually stores.
        systemReference: motionPayBillerSystemReference(paymentReference),
        providerReference: data?.transaction_id ?? null,
        providerName: ProviderNameEnum.MOTIONPAY,
        status: mapMotionPayBillerStatus(payload.status),
        message: payload.description || payload.message || null,
        metadata: { [MOTIONPAY_METADATA_KEY.CALLBACK_BILLER]: payload },
        rawPayload: payload as unknown as Record<string, unknown>,
      },
    };
  }

  private isAllowedOrigin(sourceIp: string | null): boolean {
    const allowed = this.motionPayConfig.CALLBACK_ALLOWED_IPS;
    if (allowed.length === 0) {
      this.logger.warn({
        msg: 'MOTIONPAY_CALLBACK_ALLOWED_IPS is empty - the Biller callback is accepting any origin. Set it before production.',
        sourceIp,
      });
      return true;
    }
    return isIpAllowed(sourceIp, allowed);
  }
}
