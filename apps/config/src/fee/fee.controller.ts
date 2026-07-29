import {
  AjvPipe,
  CONFIG_CMD,
  type FilterPurchaseFeeDto,
  FilterPurchaseFeeSchema,
  type FilterDisbursementFeeDto,
  FilterDisbursementFeeSchema,
} from '@app/microservice';
import { Controller, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PurchaseFeeService } from './purchase-fee.service';
import { DisbursementFeeService } from './disbursement-fee.service';

@Controller()
export class FeeController {
  constructor(
    private readonly purchaseFeeService: PurchaseFeeService,
    private readonly disbursementFeeService: DisbursementFeeService,
  ) {}

  // @Post('purchase')
  // @RouteSchema({ body: PurchaseFeeFilterSchema })
  // purchaseaaa(@Body() body: PurchaseFeeFilterDto) {}

  @MessagePattern({ cmd: CONFIG_CMD.CALCULATE_FEE_PURCHASE })
  @UsePipes(AjvPipe<FilterPurchaseFeeDto>(FilterPurchaseFeeSchema))
  purchase(@Payload() payload: FilterPurchaseFeeDto) {
    return this.purchaseFeeService.calculate(payload);
  }

  @MessagePattern({ cmd: CONFIG_CMD.CALCULATE_FEE_DISBURSEMENT })
  @UsePipes(AjvPipe<FilterDisbursementFeeDto>(FilterDisbursementFeeSchema))
  disbursement(@Payload() payload: FilterDisbursementFeeDto) {
    return this.disbursementFeeService.calculate(payload);
  }
}
