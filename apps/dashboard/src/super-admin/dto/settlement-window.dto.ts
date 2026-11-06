import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaymentMethodNameEnum, ProviderNameEnum } from '@app/microservice';
import {
  ApiDateProperty,
  ApiTimeOfDayProperty,
  DtoHelper,
  IsTimeOfDay,
  PrismaRowOf,
  ToJakartaISO,
  ToJakartaISONullable,
  ToJsDate,
  ToJsDateNullable,
} from '../../shared';

/**
 * Labels are part of the natural key, so a typo creates a second window rather
 * than correcting the first. The pattern keeps them to one shape; the overlap
 * check in `SuperAdminService` is what actually catches a duplicate schedule
 * hiding behind a misspelt label.
 */
export const WINDOW_LABEL_PATTERN = /^[A-Z][A-Z0-9_]{1,23}$/;

/** A partner releasing more than a month after the window closes is a typo. */
const MAX_SETTLEMENT_OFFSET_DAYS = 31;

export class UpsertSettlementWindowDto {
  @ApiProperty({ enum: ProviderNameEnum })
  @IsEnum(ProviderNameEnum)
  providerName: ProviderNameEnum;

  @ApiProperty({ enum: PaymentMethodNameEnum })
  @IsEnum(PaymentMethodNameEnum)
  paymentMethodName: PaymentMethodNameEnum;

  @ApiProperty({
    example: 'DAILY',
    description:
      'One window of a partner schedule. DAILY when they run one; BATCH_1 / ' +
      'BATCH_2 when they run several on the same rail, as Teleanjar does.',
  })
  @Matches(WINDOW_LABEL_PATTERN, {
    message:
      'label must be 2-24 characters, upper-case letters, digits and ' +
      'underscores, starting with a letter (e.g. "DAILY", "BATCH_1")',
  })
  label: string;

  @ApiTimeOfDayProperty({
    example: '18:00',
    description:
      'Start of the transaction window, half-open [start, end). Equal to ' +
      'windowEnd means the window spans the whole day.',
  })
  @IsTimeOfDay()
  windowStart: string;

  @ApiProperty({
    example: 0,
    description:
      '-1 when the window opens on the previous day, as Teleanjar batch 1 ' +
      'does at 18:00 for a window closing at 12:00. 0 otherwise.',
  })
  @IsInt()
  @Min(-1)
  @Max(0)
  windowStartDayOffset: number;

  @ApiTimeOfDayProperty({ example: '12:00' })
  @IsTimeOfDay()
  windowEnd: string;

  @ApiProperty({
    example: 1,
    description:
      'Days between the window closing and the upstream releasing: 0 same ' +
      'day, 1 for H+1, 3 for H+3.',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_SETTLEMENT_OFFSET_DAYS)
  settlementOffset: number;

  @ApiTimeOfDayProperty({
    required: false,
    nullable: true,
    example: '15:00',
    description:
      'Null when the partner publishes no time. Eligibility then treats it as ' +
      'end of day, so we never release before the upstream plausibly has.',
  })
  @IsOptional()
  @IsTimeOfDay()
  settlementTime?: string | null;

  /**
   * Accepted but refused while it is `true` - see
   * `SuperAdminService.assertSettlementWindowsAreUsable`. The holiday calendar
   * behind it is deliberately unbuilt, and `policy.eligibility.ts` throws
   * rather than guessing, so a row saved with this set would stop payouts for
   * every merchant on the rail. The field stays in the DTO so the shape is
   * right the day Pakailink arrives with it.
   */
  @ApiProperty({ type: Boolean, default: false })
  @IsBoolean()
  businessDaysOnly: boolean;

  @ApiProperty({ example: 'Asia/Jakarta', required: false })
  @IsOptional()
  @Matches(/^[A-Za-z]+\/[A-Za-z_\-+0-9]+$/, {
    message: 'timezone must be an IANA zone name such as "Asia/Jakarta"',
  })
  timezone?: string;

  @ApiDateProperty({
    description:
      'When this schedule comes into force. Part of the natural key, so a ' +
      'partner changing their times is a new row from the new date, not an ' +
      'edit that erases what the old payouts were computed from.',
  })
  @ToJsDate()
  effectiveFrom: Date;

  @ApiDateProperty({
    required: false,
    nullable: true,
    description: 'When it stopped applying. Null while it is the current one.',
  })
  @IsOptional()
  @ToJsDateNullable()
  effectiveTo?: Date | null;
}

/** One upstream settlement window, as stored. */
export class SettlementWindowDto {
  constructor(
    data: PrismaRowOf<
      SettlementWindowDto,
      'window' | 'releases',
      'effectiveFrom' | 'effectiveTo' | 'deletedAt'
    >,
  ) {
    DtoHelper.assign(this, data);

    const offset =
      this.windowStartDayOffset === 0 ? '' : ` (D${this.windowStartDayOffset})`;
    this.window = `${this.windowStart}${offset} - ${this.windowEnd}`;
    this.releases =
      `H+${this.settlementOffset} ` + (this.settlementTime ?? 'end of day');
  }

  @ApiProperty()
  id: number;

  @ApiProperty()
  providerName: string;

  @ApiProperty()
  paymentMethodName: string;

  @ApiProperty()
  label: string;

  /** Derived: the window as one readable string, for a listing row. */
  @ApiProperty({ example: '18:00 (D-1) - 12:00' })
  window: string;

  /** Derived: the release rule as one readable string. */
  @ApiProperty({ example: 'H+1 15:00' })
  releases: string;

  @ApiTimeOfDayProperty()
  windowStart: string;

  @ApiProperty()
  windowStartDayOffset: number;

  @ApiTimeOfDayProperty()
  windowEnd: string;

  @ApiProperty()
  settlementOffset: number;

  @ApiTimeOfDayProperty({ nullable: true })
  settlementTime: string | null;

  @ApiProperty()
  businessDaysOnly: boolean;

  @ApiProperty()
  timezone: string;

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
