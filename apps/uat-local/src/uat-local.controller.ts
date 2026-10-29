import { Controller, Get } from '@nestjs/common';
import { UatLocalService } from './uat-local.service';

@Controller()
export class UatLocalController {
  constructor(private readonly uatLocalService: UatLocalService) {}

  @Get()
  getHello(): string {
    return this.uatLocalService.getHello();
  }
}
