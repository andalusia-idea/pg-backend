import { ApiProperty } from '@nestjs/swagger';
import { DtoHelper } from '../../../shared/helper';

/** Generic `{ value, label }` pair for dropdowns. */
export class CommonDto {
  constructor(data: CommonDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  name: string;

  @ApiProperty()
  explain: string;
}
