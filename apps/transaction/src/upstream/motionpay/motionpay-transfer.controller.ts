import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AppConfig } from '@app/configuration';
import { AjvPipe, ProviderNameEnum } from '@app/microservice';
import { UpstreamException } from '@app/upstream';
import Decimal from 'decimal.js';
import { MotionPayTransferService } from './motionpay-transfer.service';
import { MotionPayTransferAuthService } from './motionpay-transfer.auth.service';
import { MOTIONPAY_BANK_CODE } from './motionpay.constant';
import {
  type MotionPayAccountInquiryRequestDto,
  MotionPayAccountInquiryRequestSchema,
  type MotionPayFundTransferRequestDto,
  MotionPayFundTransferRequestSchema,
} from './dto';

/**
 * Manual test surface for the MotionPay Transfer (payout) integration.
 *
 * Same shape as the QRIS test controller: takes MotionPay's wire contract
 * verbatim so their documented examples can be pasted straight in, persists
 * nothing, and is blocked in production.
 *
 * The production block matters more here than it does for QRIS. Fund Transfer
 * **moves real money** out of the Flash deposit, and these endpoints are
 * unauthenticated. Delete this controller, or put it behind the real auth
 * guards, before the payout flow goes live.
 */
@ApiTags('Upstream · MotionPay Transfer (manual test)')
@Controller('upstream/motionpay/transfer')
export class MotionPayTransferController {
  private readonly logger = new Logger(MotionPayTransferController.name);

  constructor(
    private readonly transferService: MotionPayTransferService,
    private readonly transferAuthService: MotionPayTransferAuthService,
    private readonly appConfig: AppConfig,
  ) {}

  @Get('token')
  @ApiOperation({
    summary: 'Verify Transfer credentials',
    description:
      'Fetches a Transfer token to confirm the transfer credentials, the ' +
      'secure base URL, and — importantly — that this machine’s public IP is ' +
      'whitelisted by Flash. Returns only the decoded expiry, never the token.',
  })
  async checkToken() {
    this.assertNotProduction();

    return this.surfaceUpstreamErrors(async () => {
      const token = await this.transferAuthService.getToken();
      return {
        ok: true,
        tokenPreview: `${token.slice(0, 12)}…(${token.length} chars)`,
      };
    });
  }

  @Get('balance')
  @ApiOperation({
    summary: 'Check deposit balance',
    description:
      'Remaining Flash deposit available to fund payouts. Cheapest call to ' +
      'prove the whole Transfer chain works end to end — it moves no money.',
  })
  async checkBalance() {
    this.assertNotProduction();

    return this.surfaceUpstreamErrors(() =>
      this.transferService.checkBalance(),
    );
  }

  @Post('inquiry')
  @ApiOperation({
    summary: 'Account inquiry (raw wire contract)',
    description:
      'Validates a beneficiary account name. Takes MotionPay’s request body ' +
      'verbatim. A failed lookup is not an error — it returns HTTP 200 with ' +
      '`status.success = false` and an empty `name`.',
  })
  @ApiBody({
    schema: MotionPayAccountInquiryRequestSchema as Record<string, any>,
    examples: {
      documented: {
        summary: "MotionPay's documented example",
        value: {
          bank_code: '013',
          bank_account: '123456780',
          external_id: 'A-029183',
        },
      },
    },
  })
  async accountInquiry(
    @Body(
      AjvPipe<MotionPayAccountInquiryRequestDto>(
        MotionPayAccountInquiryRequestSchema,
      ),
    )
    body: MotionPayAccountInquiryRequestDto,
  ) {
    this.assertNotProduction();

    return this.surfaceUpstreamErrors(() =>
      this.transferService.accountInquiry({
        bankCode: body.bank_code,
        accountNumber: body.bank_account,
        code: body.external_id,
      }),
    );
  }

  @Post('payment')
  @ApiOperation({
    summary: '⚠️ Fund transfer — MOVES REAL MONEY (raw wire contract)',
    description:
      'Debits the Flash deposit and sends money to the recipient. Against ' +
      'production credentials this is irreversible; against sandbox it is ' +
      'safe. Run `inquiry` first to confirm the account resolves.\n\n' +
      'Expect `0002 / On Process`, not `0001` — settlement is asynchronous, ' +
      'with the final state arriving by callback or a `status` poll.',
  })
  @ApiBody({
    schema: MotionPayFundTransferRequestSchema as Record<string, any>,
    examples: {
      documented: {
        summary: "MotionPay's documented example",
        value: {
          recipient_bank: '014',
          recipient_account: '003600350346',
          recipient_name: 'John Doe',
          amount: 10000,
          note: 'Transfer note',
          external_id: '02-21',
        },
      },
    },
  })
  async fundTransfer(
    @Body(
      AjvPipe<MotionPayFundTransferRequestDto>(
        MotionPayFundTransferRequestSchema,
      ),
    )
    body: MotionPayFundTransferRequestDto,
  ) {
    this.assertNotProduction();

    this.logger.warn({
      msg: 'Manual test fund transfer requested',
      externalId: body.external_id,
      amount: body.amount,
    });

    return this.surfaceUpstreamErrors(() =>
      this.transferService.fundTransfer({
        code: body.external_id,
        bankCode: body.recipient_bank,
        accountNumber: body.recipient_account,
        accountHolderName: body.recipient_name,
        nominal: new Decimal(body.amount),
        note: body.note,
      }),
    );
  }

  @Get('status/:externalId')
  @ApiOperation({
    summary: 'Check transfer status',
    description:
      'Keyed by OUR `external_id` — the opposite of the QRIS status endpoint, ' +
      'which is keyed by MotionPay’s transaction id.',
  })
  @ApiParam({
    name: 'externalId',
    example: '02-21',
    description: 'The external_id sent on the fund transfer request.',
  })
  async checkStatus(@Param('externalId') externalId: string) {
    this.assertNotProduction();

    return this.surfaceUpstreamErrors(() =>
      this.transferService.checkTransferStatus(externalId),
    );
  }

  @Get('bank-codes')
  @ApiOperation({
    summary: 'List supported bank / e-wallet codes',
    description:
      'Local reference copy of MotionPay’s published list — no upstream call. ' +
      'Note codes are not all 3 characters: Syariah variants add an `S` and ' +
      'e-wallets are words.',
  })
  bankCodes() {
    this.assertNotProduction();
    return {
      count: Object.keys(MOTIONPAY_BANK_CODE).length,
      codes: MOTIONPAY_BANK_CODE,
    };
  }

  private async surfaceUpstreamErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof UpstreamException) {
        this.logger.error({
          msg: 'MotionPay Transfer call failed',
          provider: error.provider,
          reason: error.message,
          context: error.context,
        });

        throw new HttpException(
          {
            provider: error.provider,
            message: error.message,
            context: error.context,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw error;
    }
  }

  private assertNotProduction(): void {
    if (this.appConfig.IS_PRODUCTION) {
      throw new ForbiddenException(
        `${ProviderNameEnum.MOTIONPAY} transfer manual test endpoints are disabled in production`,
      );
    }
  }
}
