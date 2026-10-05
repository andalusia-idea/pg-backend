import { JatelindoConfig } from '@app/configuration';
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  JatelindoInquiryRequestDto,
  JatelindoSingleTransferRequestDto,
  JatelindoTransactionStatusRequestDto,
} from '../dto';
import { JatelindoTransferAuthService } from '../transfer';

@Injectable()
export class JatelindoRequestAuthService {
  private readonly logger = new Logger(JatelindoRequestAuthService.name);

  private secretHash: string = '';

  constructor(
    private readonly authService: JatelindoTransferAuthService,
    private readonly jatelindoConfig: JatelindoConfig,
  ) {
    this.secretHash = createHash('md5')
      .update(this.jatelindoConfig.TRANSFER_SECRET)
      .digest('hex');
    console.log(this.secretHash);
  }

  async inquiry(dto: JatelindoInquiryRequestDto) {
    const token = await this.authService.getToken();
    const stringToSign = [
      'secret=',
      this.secretHash,
      '/accountNo=',
      dto.accountNo,
      '/amount=',
      dto.amount,
      '/APIKey=',
      this.jatelindoConfig.TRANSFER_API_KEY,
      '/channelId=',
      dto.channelId,
      '/description=',
      dto.description,
      '/email=',
      dto.email,
      '/name=',
      dto.name,
      '/phoneNo=',
      dto.phoneNo,
      '/token=',
      token,
    ];
    return createHash('sha256').update(stringToSign.join('')).digest('hex');
  }

  async singleTransfer(dto: JatelindoSingleTransferRequestDto) {
    const token = await this.authService.getToken();
    const stringToSign = [
      'secret=',
      this.secretHash,
      '/accountNo=',
      dto.accountNo,
      '/amount=',
      dto.amount,
      '/APIKey=',
      this.jatelindoConfig.TRANSFER_API_KEY,
      '/channelId=',
      dto.channelId,
      '/description=',
      dto.description,
      '/email=',
      dto.email,
      '/name=',
      dto.name,
      '/phoneNo=',
      dto.phoneNo,
      '/token=',
      token,
      '/traceNumber=',
      dto.traceNumber,
    ];
    return createHash('sha256').update(stringToSign.join('')).digest('hex');
  }

  async balanceInquiry() {
    const token = await this.authService.getToken();
    const stringToSign = [
      'secret=',
      this.secretHash,
      '/APIKey=',
      this.jatelindoConfig.TRANSFER_API_KEY,
      '/token=',
      token,
    ];
    return createHash('sha256').update(stringToSign.join('')).digest('hex');
  }

  async transactionStatus(dto: JatelindoTransactionStatusRequestDto) {
    const token = await this.authService.getToken();
    const stringToSign = [
      'secret=',
      this.secretHash,
      '/APIKey=',
      this.jatelindoConfig.TRANSFER_API_KEY,
      '/token=',
      token,
      '/traceNumber=',
      dto.traceNumber,
    ];
    return createHash('sha256').update(stringToSign.join('')).digest('hex');
  }
}
