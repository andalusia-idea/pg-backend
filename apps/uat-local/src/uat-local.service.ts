import { Injectable } from '@nestjs/common';

@Injectable()
export class UatLocalService {
  getHello(): string {
    return 'Hello World!';
  }
}
