import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { Page, Pagination } from '../../shared/pagination';
// `import type` is required: Pageable appears in a decorated signature and the
// build runs with isolatedModules + emitDecoratorMetadata.
import type { Pageable } from '../../shared/pagination';
import { ResponseDto, ResponseStatus } from '../../shared/response.dto';
import { FilterMerchantDetailDto } from './dto/filter-merchant-detail.dto';
import { MerchantDto, MerchantNameDto } from './dto/merchant.dto';
import { UpdateMerchantDetailDto } from './dto/update-merchant-detail.dto';
import { MerchantDetailService } from './merchant-detail.service';

@ApiTags('Merchant Detail')
@ApiBearerAuth()
@Controller('merchant-detail')
export class MerchantDetailController {
  constructor(private readonly merchantDetailService: MerchantDetailService) {}

  @Get()
  @CheckPolicies()
  @ApiOperation({ summary: 'List merchants (paginated)' })
  @ApiOkResponse({ type: MerchantDto, isArray: true })
  findAll(
    @Pagination() pageable: Pageable,
    @Query() filter: FilterMerchantDetailDto,
  ): Promise<Page<MerchantDto>> {
    return this.merchantDetailService.findAll(pageable, filter);
  }

  /** Must precede `:userId` so Express doesn't match "dropdown" as an id. */
  @Get('dropdown')
  @CheckPolicies()
  @ApiOperation({ summary: 'Merchant id + business name pairs for dropdowns' })
  @ApiOkResponse({ type: MerchantNameDto, isArray: true })
  findAllNames(): Promise<MerchantNameDto[]> {
    return this.merchantDetailService.findAllNames();
  }

  @Get(':userId')
  @CheckPolicies()
  @ApiOperation({ summary: 'Merchant by userId' })
  @ApiOkResponse({ type: MerchantDto })
  findOne(@Param('userId', ParseIntPipe) userId: number): Promise<MerchantDto> {
    return this.merchantDetailService.findOneThrow(userId);
  }

  @Patch('update/:userId')
  @CheckPolicies()
  @ApiOperation({ summary: 'Update merchant by userId' })
  @ApiBody({ type: UpdateMerchantDetailDto })
  async update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateMerchantDetailDto,
  ): Promise<ResponseDto<null>> {
    await this.merchantDetailService.update(userId, dto);
    return new ResponseDto({ status: ResponseStatus.UPDATED });
  }
}
