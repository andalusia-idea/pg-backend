import { Injectable } from '@nestjs/common';

@Injectable()
export class SettlementService {
  getHello(): string {
    return 'Hello World!';
  }
}
