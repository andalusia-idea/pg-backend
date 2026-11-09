import { TransactionTypeEnumConfig } from '@dashboard/prisma';
import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateProperty,
  ApiMoneyProperty,
  ApiPercentageProperty,
  ToJakartaISONullable,
  ToMoneyString,
  ToPercentageString,
} from '../../../shared/decorator';
import { DtoHelper, PrismaRowOf } from '../../../shared/helper';

/**
 * Provider-level fee configuration, before any per-merchant override.
 *
 * Served by three endpoints that filter differently, which is what decides
 * whether the last two fields below vary or sit constant:
 *
 * | Endpoint | Filters | So |
 * |---|---|---|
 * | `GET /super-admin/base-fee` | nothing | both vary |
 * | `GET /fee/config` | `deletedAt: null` | `isActive` varies, `deletedAt` is always null |
 * | `GET merchant/:id/config` | `isActive: true, deletedAt: null` | both constant |
 */
export class BaseFeeDto {
  constructor(
    data: PrismaRowOf<
      BaseFeeDto,
      'code',
      'feeProviderFixed' | 'feeProviderPercentage' | 'deletedAt'
    >,
  ) {
    DtoHelper.assign(this, data);
    // Derived, not stored. `BaseFee.code` used to be a column holding this
    // exact string; it was dropped because nothing checked it against the three
    // fields it was built from, so a typo could split a triple that is supposed
    // to be unique. Rebuilding it here keeps the response shape the frontend
    // already consumes, with no second copy that can drift.
    this.code = `${this.providerName}_${this.paymentMethodName}_${this.transactionType}`;
  }

  @ApiProperty()
  id: number;

  /** `PROVIDER_PAYMENTMETHOD_TRANSACTIONTYPE`, derived in the constructor. */
  @ApiProperty()
  code: string;

  @ApiProperty()
  providerName: string;

  @ApiProperty()
  paymentMethodName: string;

  @ApiProperty({ enum: TransactionTypeEnumConfig })
  transactionType: TransactionTypeEnumConfig;

  @ApiMoneyProperty()
  @ToMoneyString()
  feeProviderFixed: string;

  @ApiPercentageProperty()
  @ToPercentageString()
  feeProviderPercentage: string;

  /**
   * Whether this fee can route at all.
   *
   * The routing lookup filters `isActive: true`
   * (`ProfileProviderService.findProfileProvider`), so a `false` here is a rail
   * that is configured and dead. Returning it is not only for the super-admin
   * screen: `GET /fee/config` does **not** filter this column, so until this
   * field existed that endpoint listed deactivated fees indistinguishably from
   * live ones - which meant the `isActive` switch repaired in D25 had no
   * visible effect through any endpoint.
   */
  @ApiProperty({ type: Boolean })
  isActive: boolean;

  /**
   * Null unless the fee has been retired.
   *
   * Only `GET /super-admin/base-fee` can return a non-null value; the other two
   * readers filter it out. It is there because that endpoint is documented as
   * the configuration view that deliberately includes soft-deleted rows, on the
   * grounds that a row it cannot show is a row the operator cannot repair - and
   * without this field it returned those rows while giving no way to tell them
   * apart. It is also what explains an upsert reporting success on a row no
   * other endpoint returns.
   */
  @ApiDateProperty({ nullable: true })
  @ToJakartaISONullable()
  deletedAt: string | null;
}
