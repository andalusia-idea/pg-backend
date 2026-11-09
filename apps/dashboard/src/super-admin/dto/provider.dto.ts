import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ProviderNameEnum } from '@app/microservice';
import {
  ApiDateProperty,
  DtoHelper,
  PrismaRowOf,
  ToJakartaISO,
  ToJakartaISONullable,
} from '../../shared';

/**
 * One upstream to activate.
 *
 * `@IsEnum(ProviderNameEnum)` is the entire validation, and it is also the
 * boundary that matters: there is no table behind a provider name, so the enum
 * is the only thing that says this system has an upstream client able to route
 * to it. An arbitrary string would insert happily, satisfy every foreign key a
 * base fee needs, appear in the dropdowns, and then fail at the first
 * transaction - which is the shape of bug the base-fee and settlement-window
 * checks exist to prevent one layer up.
 *
 * `INTERNAL` is accepted even though the migrations already insert it. It is
 * the house provider rather than a commercial one, so re-posting it is a no-op
 * except for restoring it if someone has soft-deleted it, which is the right
 * outcome.
 */
export class UpsertProviderDto {
  @ApiProperty({ enum: ProviderNameEnum })
  @IsEnum(ProviderNameEnum)
  name: ProviderNameEnum;
}

/**
 * One upstream to retire.
 *
 * Same single field as `UpsertProviderDto` and deliberately a separate class,
 * because the constraints are not the same and this is where they belong.
 *
 * **Retiring is a soft delete, and on its own it is cosmetic.** It takes the
 * provider out of `GET common/div?div=PROVIDER`, which filters
 * `deletedAt: null` - but nothing in the routing path looks at this table.
 * `ProfileProviderService.findProfileProvider` resolves a merchant's provider
 * through `merchantFee.baseFee`, filtering on the *base fee's* `isActive` and
 * `deletedAt` and never the provider's. So a provider retired while its fees
 * are still live disappears from the dropdown and keeps taking transactions,
 * which is the worst of both. `SuperAdminService.retireProvider` refuses that
 * case rather than performing it.
 *
 * `INTERNAL` is refused outright. It is the house provider: the migrations
 * insert it as engine data, `config-common` excludes it from the dropdown
 * because no merchant routes to it, and `findProfileProvider` returns it as the
 * fallback for admins and for agents with no provider of their own. Nothing
 * about retiring it is ever meant.
 */
export class RetireProviderDto {
  @ApiProperty({ enum: ProviderNameEnum })
  @IsEnum(ProviderNameEnum)
  name: ProviderNameEnum;
}

/** A configured upstream, as stored. */
export class ProviderDto {
  constructor(
    data: PrismaRowOf<ProviderDto, never, 'createdAt' | 'deletedAt'>,
  ) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty({ example: ProviderNameEnum.MOTIONPAY })
  name: string;

  /**
   * When this upstream was activated. Worth returning: for a commercial
   * integration it is the closest thing the database holds to "when did we go
   * live with this partner", and nothing else records it.
   */
  @ApiDateProperty()
  @ToJakartaISO()
  createdAt: string;

  /**
   * Null while the provider is active.
   *
   * Carried deliberately, unlike `BaseFeeDto`, which omits both `isActive` and
   * `deletedAt` and so cannot distinguish a live row from a retired one even
   * though `GET /super-admin/base-fee` returns both. A configuration screen
   * that cannot see a tombstone cannot explain why an upsert reported success
   * on a row no other endpoint returns.
   */
  @ApiDateProperty({ nullable: true })
  @ToJakartaISONullable()
  deletedAt: string | null;
}
