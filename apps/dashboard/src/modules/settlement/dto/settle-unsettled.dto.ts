import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/**
 * Request body for `POST settlement/settle`.
 *
 * STUB DTO - matches what the frontend already sends (`SettleUnsettledBody`
 * in `settlement.type.ts`, a batch of purchase/settlement ids); the handler
 * behind it is a placeholder pending the real settlement-write logic. See
 * docs/dashboard-migration.md §2.4, row 48.
 */
export class SettleUnsettledDto {
  @ApiProperty({ type: String, isArray: true, example: ['1', '2', '3'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}
