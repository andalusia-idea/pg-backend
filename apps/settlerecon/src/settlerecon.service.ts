import { Injectable } from '@nestjs/common';

@Injectable()
export class SettlereconService {
  getHello(): string {
    return 'Hello World!';
  }
}
