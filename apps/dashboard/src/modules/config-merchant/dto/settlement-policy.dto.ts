import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { SettlementModeEnum } from '@app/microservice';
import {
  ApiDateProperty,
  DtoHelper,
  IsTimeOfDay,
  PrismaRowOf,
  ToJakartaISO,
  ToJakartaISONullable,
  ToJsDate,
  ToJsDateNullable,
} from '../../../shared';

/**
 * `'*'` means "this merchant's default, every payment method"; a real method
 * name is an override that beats it.
 *
 * It is a sentinel rather than `NULL` because Postgres treats `NULL`s as
 * distinct in a unique index, so `@@unique([merchantId, paymentMethodName,
 * effectiveFrom])` would not stop two default policies for one merchant - and
 * "most specific wins" then has no single answer. An admin form must submit the
 * literal `'*'`, never an empty field.
 */
export const DEFAULT_PAYMENT_METHOD = '*';

/** `'*'`, or an upper-case method name. The service checks the name exists. */
const PAYMENT_METHOD_PATTERN = /^(\*|[A-Z][A-Z0-9_]{1,31})$/;

/** A merchant waiting more than a month for their own money is a typo. */
const MAX_DELAY_DAYS = 31;

/** One release every ten minutes is already beyond what a schedule expresses. */
const MAX_RELEASE_TIMES = 48;

/**
 * One merchant's settlement terms, from one date.
 *
 * ## A change is two rows, and this endpoint writes both
 *
 * A batch that ran last month ran under last month's terms, so editing a policy
 * in place destroys the only answer to "why was this merchant paid T+1 in
 * September when their contract says T+2?". Posting a **new `effectiveFrom`**
 * for a pairing therefore closes the row in force before it - setting its
 * `effectiveTo` to this row's `effectiveFrom` - and inserts this one, in one
 * transaction. Posting an **existing `effectiveFrom`** corrects that row in
 * place, which is what a typo needs.
 *
 * The server does the closing rather than asking for two entries, because the
 * invariant is "at most one row in force per pairing" and a caller that has to
 * restate the old row's exact key to maintain it will eventually get it wrong.
 *
 * ## The column matrix is not enforceable by the database
 *
 * `delayDays` is required for `FIXED_DELAY` and meaningless elsewhere;
 * `releaseTimes` needs exactly one entry for `FIXED_DELAY` and at least one for
 * `SCHEDULED`. Nothing in Postgres can say that, so the service refuses here -
 * the alternative is the settlement runner throwing at 2am, on one merchant,
 * where nobody is looking.
 */
export class UpsertMerchantSettlementPolicyDto {
  // No `merchantId`: it is the `:merchantId` path parameter, like every other
  // write in this module. A body that could name a different merchant than the
  // path is a body that will eventually name the wrong one.

  @ApiProperty({
    example: DEFAULT_PAYMENT_METHOD,
    description:
      "'*' for this merchant's default across every method, or a configured " +
      'payment method name to override just that one.',
  })
  @Matches(PAYMENT_METHOD_PATTERN, {
    message:
      "paymentMethodName must be '*' for the merchant default, or a payment " +
      'method name in upper case',
  })
  paymentMethodName: string;

  @ApiProperty({
    enum: SettlementModeEnum,
    example: SettlementModeEnum.FOLLOW_UPSTREAM,
    description:
      'FOLLOW_UPSTREAM is the honest default - the merchant is paid once the ' +
      'provider has paid us. Every other mode advances money we have not ' +
      'received yet, which is a commercial decision rather than a technical ' +
      'one.',
  })
  @IsEnum(SettlementModeEnum)
  mode: SettlementModeEnum;

  @ApiPropertyOptional({
    example: 2,
    nullable: true,
    description:
      'FIXED_DELAY only, and required for it: 2 = T+2. Counted in calendar ' +
      'days from the payment date, so a payment at 23:59 does not wait an ' +
      'extra day. Ignored by every other mode.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DELAY_DAYS)
  delayDays?: number | null;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    example: ['06:00', '12:00', '18:00', '23:00'],
    description:
      'SCHEDULED: every release time. FIXED_DELAY: exactly one. Ignored by ' +
      'INSTANT and FOLLOW_UPSTREAM. Order does not matter - zero-padded HH:MM ' +
      'sorts chronologically as text, which is how the next release time is ' +
      'found without parsing anything.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RELEASE_TIMES)
  @IsTimeOfDay({
    each: true,
    message:
      'each releaseTimes entry must be a zero-padded 24-hour time of day as ' +
      '"HH:MM" (e.g. "06:00"); "24:00" and "7:00" are both refused',
  })
  releaseTimes?: string[];

  /**
   * Accepted but refused while it is `true`, exactly as on the settlement
   * window. `BusinessDayCalendar` is unbuilt, and `settlementReleaseAt` throws
   * rather than guessing a holiday policy - so a row saved with this set would
   * stop this merchant's payouts rather than skipping a holiday. Failing one
   * merchant's run is recoverable; paying early is not.
   *
   * It stays in the DTO so the shape is right the day the calendar arrives.
   * **Do not offer the checkbox in the admin UI yet.**
   */
  @ApiProperty({ type: Boolean, default: false })
  @IsBoolean()
  businessDaysOnly: boolean;

  @ApiDateProperty({
    description:
      'When these terms come into force. Part of the natural key: a new value ' +
      'supersedes the row before it, the same value corrects this one.',
  })
  @ToJsDate()
  effectiveFrom: Date;

  @ApiDateProperty({
    required: false,
    nullable: true,
    description:
      'Null while the terms are current. Set it only for a term that is ' +
      'known to end - superseding is automatic and needs no end date here.',
  })
  @IsOptional()
  @ToJsDateNullable()
  effectiveTo?: Date | null;
}

/**
 * A settlement policy as the configuration screen reads it.
 *
 * Retired and superseded rows included, because `effectiveFrom` is part of the
 * key: an old row is what an old payout was computed from, and hiding it leaves
 * "why was this merchant paid T+1 in September" unanswerable.
 */
export class MerchantSettlementPolicyDto {
  constructor(
    data: PrismaRowOf<
      MerchantSettlementPolicyDto,
      'releases',
      'effectiveFrom' | 'effectiveTo' | 'deletedAt'
    >,
  ) {
    DtoHelper.assign(this, data);

    this.releases = describeRelease(this);
  }

  @ApiProperty()
  id: number;

  /** Kept on the read even though the write takes it from the path: a listing
   * row is read on its own, and a policy with no merchant on it is ambiguous. */
  @ApiProperty()
  merchantId: number;

  @ApiProperty({ example: DEFAULT_PAYMENT_METHOD })
  paymentMethodName: string;

  @ApiProperty({ enum: SettlementModeEnum })
  mode: SettlementModeEnum;

  /**
   * Derived: the whole rule as one readable string, so a listing row needs no
   * mode-switching logic on the frontend's side. The same reason
   * `SettlementWindowDto` carries `window` and `releases`.
   */
  @ApiProperty({ example: 'T+2 at 10:00' })
  releases: string;

  @ApiProperty({ nullable: true })
  delayDays: number | null;

  @ApiProperty({ type: String, isArray: true })
  releaseTimes: string[];

  @ApiProperty()
  businessDaysOnly: boolean;

  @ApiDateProperty()
  @ToJakartaISO()
  effectiveFrom: string;

  @ApiDateProperty({ nullable: true })
  @ToJakartaISONullable()
  effectiveTo: string | null;

  @ApiDateProperty({ nullable: true })
  @ToJakartaISONullable()
  deletedAt: string | null;
}

/**
 * Built from the mode rather than from whichever columns happen to be set, so a
 * leftover `delayDays` on a `SCHEDULED` row cannot show up in the description
 * of a rule that ignores it.
 */
function describeRelease(policy: {
  mode: SettlementModeEnum;
  delayDays: number | null;
  releaseTimes: string[];
}): string {
  const times = [...(policy.releaseTimes ?? [])].sort();

  switch (policy.mode) {
    case SettlementModeEnum.INSTANT:
      return 'immediately on capture';

    case SettlementModeEnum.FOLLOW_UPSTREAM:
      return 'when the upstream settles';

    case SettlementModeEnum.FIXED_DELAY:
      return `T+${policy.delayDays ?? '?'} at ${times[0] ?? '?'}`;

    case SettlementModeEnum.SCHEDULED:
      return times.length > 0 ? `daily at ${times.join(', ')}` : 'daily at ?';

    default:
      return 'unknown';
  }
}
