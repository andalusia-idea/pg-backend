import { MotionPayConfig } from '@app/configuration';
import { ProviderNameEnum, isIpAllowed } from '@app/microservice';
import { UpstreamWebhookTransferDto } from '@app/upstream';
import { Injectable, Logger } from '@nestjs/common';
import { MotionPayTransferCallbackDto } from '../dto';
import { MOTIONPAY_METADATA_KEY, mapMotionPayTransferStatus } from '../helper';

/**
 * Either a normalised notification the business layer can act on, or a reason
 * we are not going to act at all.
 */
export type MotionPayTransferTranslation =
  | { accepted: false; reason: string }
  | { accepted: true; webhook: UpstreamWebhookTransferDto };

/**
 * Translates MotionPay's Transfer callback into the provider-neutral shape.
 *
 * The sibling of `MotionPayQrisCallbackService`, and deliberately the same
 * shape: translation only, no knowledge of disbursements, fees or balances.
 * That is what keeps `upstream/` a leaf.
 *
 * **This callback is even weaker than the QRIS one.** It carries no signature,
 * no secret, and — unlike QRIS — no amount, so there is nothing in the body to
 * corroborate against at all. It is a bare "transaction X is now Y" from an
 * unauthenticated source, for a flow that moves money *out*. Treating it as
 * anything but a hint to go and re-read the real status would be indefensible.
 */
@Injectable()
export class MotionPayTransferCallbackService {
  private readonly logger = new Logger(MotionPayTransferCallbackService.name);

  constructor(private readonly motionPayConfig: MotionPayConfig) {}

  translate(
    payload: MotionPayTransferCallbackDto,
    sourceIp: string | null,
  ): MotionPayTransferTranslation {
    const systemReference = payload.data.external_id ?? '';

    if (!this.isAllowedOrigin(sourceIp)) {
      this.logger.warn({
        msg: 'Transfer callback rejected: origin not in the MotionPay allowlist',
        sourceIp,
        systemReference,
      });
      return { accepted: false, reason: 'origin not allowed' };
    }

    // Without our own reference there is nothing to look up. Unlike QRIS, the
    // provider's id is not our lookup key here - their status endpoint is keyed
    // by `external_id`, so a callback missing it is unusable.
    if (!systemReference) {
      this.logger.warn({
        msg: 'Transfer callback carried no external_id - nothing to match',
        sourceIp,
        providerReference: payload.data.transaction_id,
      });
      return { accepted: false, reason: 'no external_id' };
    }

    return {
      accepted: true,
      webhook: {
        systemReference,
        providerReference: payload.data.transaction_id ?? null,
        providerName: ProviderNameEnum.MOTIONPAY,
        status: mapMotionPayTransferStatus(payload.status.code),
        message: payload.status.message ?? null,
        metadata: { [MOTIONPAY_METADATA_KEY.CALLBACK_TRANSFER]: payload },
        rawPayload: payload as unknown as Record<string, unknown>,
      },
    };
  }

  /**
   * Empty allowlist means unrestricted, which is the current state until Flash
   * give us their egress ranges. Warned about loudly rather than passed over,
   * because an unset allowlist on an unsigned callback is a live risk, not a
   * configuration detail.
   */
  private isAllowedOrigin(sourceIp: string | null): boolean {
    const allowed = this.motionPayConfig.CALLBACK_ALLOWED_IPS;
    if (allowed.length === 0) {
      this.logger.warn({
        msg: 'MOTIONPAY_CALLBACK_ALLOWED_IPS is empty - the Transfer callback is accepting any origin. Set it before production.',
        sourceIp,
      });
      return true;
    }
    return isIpAllowed(sourceIp, allowed);
  }
}
