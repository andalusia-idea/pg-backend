import { JatelindoConfig } from '@app/configuration';
import { Injectable, Logger } from '@nestjs/common';
import { JatelindoTransferCallbackDto } from '../dto';
import { METADATA_KEY, UpstreamWebhookTransferDto } from '@app/upstream';
import { isIpAllowed, ProviderNameEnum } from '@app/microservice';
import {
  JATELINDO_RESPONSE_CODE,
  jatelindoMapperResponseCode,
} from '../helper';

export type JatelindoTransferTranslation =
  | { accepted: false; reason: string }
  | { accepted: true; webhook: UpstreamWebhookTransferDto };

@Injectable()
export class JatelindoTransferCallbackService {
  private readonly logger = new Logger(JatelindoTransferCallbackService.name);

  constructor(private readonly jatelindoConfig: JatelindoConfig) {}

  translate(
    payload: JatelindoTransferCallbackDto,
    sourceIp: string | null,
  ): JatelindoTransferTranslation {
    const systemReference = payload.traceNumber;
    const providerReference = payload.jpaReferenceNo;

    if (!this.isAllowedOrigin(sourceIp)) {
      this.logger.warn({
        msg: 'QRIS callback rejected: origin not in the Jatelindo allowlist',
        sourceIp,
        providerReference,
      });
      return { accepted: false, reason: 'origin not allowed' };
    }

    const status = jatelindoMapperResponseCode(
      payload.status.responseCode as JATELINDO_RESPONSE_CODE,
    );

    return {
      accepted: true,
      webhook: {
        systemReference,
        providerReference,
        providerName: ProviderNameEnum.JATELINDO,
        status,
        message: payload.status.message,
        metadata: { [METADATA_KEY.TRANSFER_CALLBACK]: payload },
        rawPayload: payload,
      },
    };
  }

  private isAllowedOrigin(sourceIp: string | null): boolean {
    const allowed = this.jatelindoConfig.CALLBACK_ALLOWED_IPS;
    if (allowed.length === 0) {
      this.logger.warn({
        msg: 'JATELINDO_CALLBACK_ALLOWED_IPS is empty - the QRIS callback is accepting any origin. Set it before production.',
        sourceIp,
      });
      return true;
    }
    return isIpAllowed(sourceIp, allowed);
  }
}
