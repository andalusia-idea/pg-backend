import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  getHello(): string {
    return 'Hello World!';
  }
}
