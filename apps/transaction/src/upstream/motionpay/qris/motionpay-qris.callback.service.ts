import { MotionPayConfig } from '@app/configuration';
import { ProviderNameEnum, isIpAllowed } from '@app/microservice';
import { UpstreamWebhookQrisDto } from '@app/upstream';
import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { MotionPayQrisCallbackDto } from '../dto';
import {
  MOTIONPAY_METADATA_KEY,
  mapMotionPayStatus,
  parseMotionPayTimestamp,
} from '../helper';

/**
 * Either a normalised notification the business layer can act on, or a reason
 * we are not going to act at all.
 *
 * A rejection is not an error: an unrecognised origin is a routine event on an
 * unauthenticated endpoint, and the caller answers 200 to it deliberately.
 */
export type MotionPayQrisTranslation =
  | { accepted: false; reason: string }
  | { accepted: true; webhook: UpstreamWebhookQrisDto };

/**
 * Translates MotionPay's QRIS payment notification into the provider-neutral
 * shape, and decides whether we should be listening to it at all.
 *
 * **This service does translation only.** It knows MotionPay's wire format,
 * their timestamp semantics and their (absent) authentication - and nothing
 * whatsoever about purchases, fees or settlement. That separation is what lets
 * `upstream/` stay a leaf: the business layer depends on the adapters, never
 * the other way round.
 *
 * Everything the notification claims is treated as a *trigger*, not as fact.
 * MotionPay publishes no callback signature, so the amount and status here are
 * carried forward only as corroboration - the settlement path re-reads the
 * authoritative state over an authenticated call before it moves any money.
 */
@Injectable()
export class MotionPayQrisCallbackService {
  private readonly logger = new Logger(MotionPayQrisCallbackService.name);

  constructor(private readonly motionPayConfig: MotionPayConfig) {}

  translate(
    payload: MotionPayQrisCallbackDto,
    sourceIp: string | null,
  ): MotionPayQrisTranslation {
    const providerReference = payload.transaction_id;

    if (!this.isAllowedOrigin(sourceIp)) {
      this.logger.warn({
        msg: 'QRIS callback rejected: origin not in the MotionPay allowlist',
        sourceIp,
        providerReference,
      });
      return { accepted: false, reason: 'origin not allowed' };
    }

    /**
     * Null when nothing was paid, which is the normal case for an expiry.
     *
     * Defaulting to "now" here would stamp a payment time onto a transaction
     * that was never paid - and `paidAt` is what settlement and reconciliation
     * treat as the moment money arrived.
     */
    const paidAt = parseMotionPayTimestamp(payload.paid_date);

    const status = mapMotionPayStatus({
      status: payload.status,
      description: payload.description,
      expiredDate: payload.expired_date,
      paidDate: payload.paid_date,
    });

    return {
      accepted: true,
      webhook: {
        providerReference,
        merchantReference: payload.external_id ?? null,
        providerName: ProviderNameEnum.MOTIONPAY,
        status,
        // Whole rupiah on the wire; our money is fixed-2 everywhere.
        nominal: new Decimal(payload.amount ?? 0).toFixed(2),
        paidAt,
        metadata: { [MOTIONPAY_METADATA_KEY.CALLBACK_QRIS]: payload },
        // Kept separately and unaltered: the webhook log exists to hold what
        // actually arrived, and a normalised copy is not evidence.
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
        msg: 'MOTIONPAY_CALLBACK_ALLOWED_IPS is empty - the QRIS callback is accepting any origin. Set it before production.',
        sourceIp,
      });
      return true;
    }
    return isIpAllowed(sourceIp, allowed);
  }
}
