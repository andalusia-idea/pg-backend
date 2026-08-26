import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for `POST transactions/purchase/{resend-callback,refresh-status,notify-merchant}`.
 *
 * STUB DTO - matches what the frontend already sends (`PurchaseCallbackAction`
 * in `transaction-purchase.type.ts`); the handlers behind it are placeholders,
 * pending the provider-integration work these three actions actually need.
 * See docs/dashboard-migration.md §2.3, rows 42-44.
 */
export class PurchaseCallbackActionDto {
  @ApiProperty({ example: '9f2c1e2a-4b3d-4e5f-8a9b-0c1d2e3f4a5b' })
  @IsString()
  @IsNotEmpty()
  purchaseId: string;
}
