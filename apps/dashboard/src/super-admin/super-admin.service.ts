import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateAdminDto,
  ResetPasswordDto,
  SettlementWindowDto,
  UpsertBaseFeeDto,
  UpsertSettlementWindowDto,
} from './dto';
import { AuthHelper } from '../auth';
import {
  LOCKED_MACHINE_PASSWORD,
  MACHINE_USER_ID,
  ROLE_ID,
} from '@app/microservice';
import { ApiError } from '../shared/exception';
import { BaseFeeDto } from '../modules/config-fee';
import { MINUTES_PER_DAY, timeOfDayToMinutes } from '../shared/decorator';

/** The schema default, repeated here so an omitted field writes the same value. */
const DEFAULT_WINDOW_TIMEZONE = 'Asia/Jakarta';

type WindowShape = {
  providerName: string;
  paymentMethodName: string;
  label: string;
  windowStart: string;
  windowStartDayOffset: number;
  windowEnd: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
};

function settlementWindowKey(window: {
  providerName: string;
  paymentMethodName: string;
  label: string;
  effectiveFrom: Date;
}): string {
  return [
    window.providerName,
    window.paymentMethodName,
    window.label,
    window.effectiveFrom.toISOString(),
  ].join('|');
}

/**
 * The window as a half-open `[start, end)` run of minutes, with the start
 * shifted by `windowStartDayOffset` so a window that opens the previous day
 * sorts before one that opens on the day itself.
 *
 * Equal start and end is how the table writes a full day - the engine seed
 * stores `00:00`/`00:00` for both MotionPay rails, deliberately, because
 * writing `23:59` as MotionPay words it would drop the final minute under the
 * half-open convention. Any other end at or before the start wraps past
 * midnight, which is how a `23:30` - `00:00` window has to be expressed.
 */
function settlementWindowInterval(window: {
  windowStart: string;
  windowStartDayOffset: number;
  windowEnd: string;
}): { startMinutes: number; endMinutes: number } {
  const startMinutes =
    timeOfDayToMinutes(window.windowStart) +
    window.windowStartDayOffset * MINUTES_PER_DAY;

  let endMinutes = timeOfDayToMinutes(window.windowEnd);

  if (window.windowEnd === window.windowStart) {
    endMinutes = startMinutes + MINUTES_PER_DAY;
  } else {
    while (endMinutes <= startMinutes) endMinutes += MINUTES_PER_DAY;
  }

  return { startMinutes, endMinutes };
}

/** A null `effectiveTo` means "still current", so it never stops overlapping. */
function effectivePeriodsOverlap(
  left: WindowShape,
  right: WindowShape,
): boolean {
  const leftEnd = left.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;

  return (
    left.effectiveFrom.getTime() < rightEnd &&
    right.effectiveFrom.getTime() < leftEnd
  );
}

function windowIntervalsOverlap(
  left: WindowShape,
  right: WindowShape,
): boolean {
  const a = settlementWindowInterval(left);
  const b = settlementWindowInterval(right);

  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

@Injectable()
export class SuperAdminService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  async registerAdmin(dto: CreateAdminDto) {
    const hashedPassword = await AuthHelper.hashPassword(dto.password);

    await this.prismaMaster.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          roleId: ROLE_ID.ADMIN,
          email: dto.email,
          password: hashedPassword,
        },
        select: { id: true },
      });

      await tx.adminDetail.create({
        data: {
          userId: user.id,
          fullname: dto.fullname,
          address: dto.address,
          phone: dto.phone,
        },
      });
    });
  }

  /**
   * Sets any account's password. This is the activation step for the two named
   * principals - the first thing to run after a production cutover, which
   * replaces their UNSET_PASSWORD sentinel with a real argon2 hash and retires
   * INITIAL_SUPER_ADMIN_PASSWORD / INITIAL_AGENT_INTERNAL_PASSWORD as live
   * credentials.
   *
   * Machine principals are refused. Ids 1-20 are pinned by
   * `20261009090000_machine_principals` with LOCKED_MACHINE_PASSWORD, a value
   * no argon2 verification accepts, and that is the whole of what makes them
   * unable to sign in. A migration can pin a row but cannot stop an API from
   * updating it afterwards, so without this check one call here would turn a
   * locked system account into a working login - and SYSTEM_01 is the id that
   * stamps `createdBy` on engine data.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prismaMaster.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true, password: true },
    });
    if (!user) throw ApiError.notFound('User');

    // Checked two ways on purpose. The id band is the rule; the stored sentinel
    // catches a machine principal that somehow sits outside it, and costs one
    // comparison.
    if (
      user.id <= MACHINE_USER_ID.SCHEDULER_10 ||
      user.password === LOCKED_MACHINE_PASSWORD
    ) {
      throw ApiError.forbidden(
        `User ${user.id} is a machine principal and cannot be given a password`,
      );
    }

    const hashedPassword = await AuthHelper.hashPassword(dto.password);

    await this.prismaMaster.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });
  }

  /**
   * Upserts provider-level base fees in one transaction, keyed on the natural
   * key `(providerName, paymentMethodName, transactionType)` - the same triple
   * the model's `@@unique` constraint uses.
   *
   * The whole payload is checked before anything is written. These are fee
   * rows: every rejection below describes a request that would otherwise be
   * answered 201 and quietly do something other than what it said.
   *
   * `createdBy` / `updatedBy` are not set here on purpose. `auditTrailExtension`
   * handles `upsert` and stamps both branches from the request's user id.
   */
  async upsertBaseFee(dtos: UpsertBaseFeeDto[]) {
    if (dtos.length === 0) {
      throw ApiError.badRequest('At least one base fee is required');
    }

    this.assertDistinctBaseFeeKeys(dtos);
    await this.assertBaseFeeReferencesResolve(dtos);

    await this.prismaMaster.$transaction(
      dtos.map((dto) => {
        return this.prismaMaster.baseFee.upsert({
          where: {
            providerName_paymentMethodName_transactionType: {
              providerName: dto.providerName,
              paymentMethodName: dto.paymentMethodName,
              transactionType: dto.transactionType,
            },
          },
          create: {
            providerName: dto.providerName,
            paymentMethodName: dto.paymentMethodName,
            transactionType: dto.transactionType,
            isActive: dto.isActive,
            feeProviderFixed: dto.feeProviderFixed,
            feeProviderPercentage: dto.feeProviderPercentage,
          },
          update: {
            isActive: dto.isActive,
            feeProviderFixed: dto.feeProviderFixed,
            feeProviderPercentage: dto.feeProviderPercentage,
            // The unique constraint does not span `deletedAt`, so the `where`
            // above matches a soft-deleted row and updates it. Leaving the
            // tombstone in place would answer 201 for a row that stays
            // invisible to every reader that filters on `deletedAt` - GET
            // /fee/config and the merchant fee config among them. Clearing it
            // also makes the audit extension classify this as a restore.
            deletedAt: null,
            deletedBy: null,
          },
        });
      }),
    );
  }

  /**
   * Two entries sharing a natural key are an operator mistake rather than a
   * request to apply both: the transaction would upsert one row twice and the
   * later entry would win with nothing said about it.
   */
  private assertDistinctBaseFeeKeys(dtos: UpsertBaseFeeDto[]): void {
    const seen = new Set<string>();

    for (const dto of dtos) {
      const key = `${dto.providerName}_${dto.paymentMethodName}_${dto.transactionType}`;

      if (seen.has(key)) {
        throw ApiError.badRequest(`Duplicate base fee in request: ${key}`);
      }

      seen.add(key);
    }
  }

  /**
   * Checks each triple against the tables behind it before the write.
   *
   * `providerName` and `paymentMethodName` are real foreign keys, so Postgres
   * would catch a bad value - but as a P2003 whose message names neither the
   * value nor which of the two columns it came from.
   *
   * `transactionType` has nothing behind it at all. The types a method supports
   * live in `PaymentMethod.transactionTypes`, an array column, and no
   * constraint relates the two. So a QRIS + WITHDRAW row inserts successfully
   * and then never matches a transaction for the rest of its life - the same
   * failure mode as a misspelled provider name in the engine migrations, where
   * the row is written and simply unreachable.
   */
  private async assertBaseFeeReferencesResolve(
    dtos: UpsertBaseFeeDto[],
  ): Promise<void> {
    const { knownProviders, typesByPaymentMethod } =
      await this.loadProviderCatalogue(dtos);

    // Every offending entry at once, indexed as the caller sent them - a screen
    // posting the whole fee table should not have to fix one row per round trip.
    const fields: Record<string, string> = {};

    dtos.forEach((dto, index) => {
      if (!knownProviders.has(dto.providerName)) {
        fields[`[${index}].providerName`] =
          `provider '${dto.providerName}' is not configured`;
      }

      const supported: string[] | undefined = typesByPaymentMethod.get(
        dto.paymentMethodName,
      );

      if (supported === undefined) {
        fields[`[${index}].paymentMethodName`] =
          `payment method '${dto.paymentMethodName}' is not configured`;
        return;
      }

      if (!supported.includes(dto.transactionType)) {
        fields[`[${index}].transactionType`] =
          `${dto.paymentMethodName} supports ${supported.join(', ')}, not ${dto.transactionType}`;
      }
    });

    if (Object.keys(fields).length > 0) {
      throw ApiError.validationFailed(fields);
    }
  }

  /**
   * The provider names and the payment-method vocabulary both base fees and
   * settlement windows are checked against, in one pair of queries.
   *
   * Both are real foreign keys, so Postgres would catch a bad value - but as a
   * P2003 whose message names neither the value nor which column it came from.
   */
  private async loadProviderCatalogue(
    dtos: { providerName: string; paymentMethodName: string }[],
  ): Promise<{
    knownProviders: Set<string>;
    typesByPaymentMethod: Map<string, string[]>;
  }> {
    const [providers, paymentMethods] = await Promise.all([
      this.prismaMaster.provider.findMany({
        where: {
          name: { in: dtos.map((dto) => dto.providerName) },
          deletedAt: null,
        },
        select: { name: true },
      }),
      this.prismaMaster.paymentMethod.findMany({
        where: {
          name: { in: dtos.map((dto) => dto.paymentMethodName) },
          deletedAt: null,
        },
        select: { name: true, transactionTypes: true },
      }),
    ]);

    return {
      knownProviders: new Set(providers.map((provider) => provider.name)),
      typesByPaymentMethod: new Map(
        paymentMethods.map((method) => [method.name, method.transactionTypes]),
      ),
    };
  }

  /**
   * Every base fee, inactive and soft-deleted rows included.
   *
   * Deliberately wider than `GET /fee/config`, which filters `deletedAt: null`
   * and is the operational read. This is the configuration screen behind the
   * upsert above, and a row it cannot show is a row the operator cannot repair.
   * It is also the only way a tombstone is visible, which is what explains an
   * upsert that reports success on a row no other endpoint returns.
   *
   * Reads from master on purpose: the screen posts and re-reads immediately, so
   * a replica read would show stale fees for as long as replication takes.
   */
  async findAllBaseFee(): Promise<BaseFeeDto[]> {
    const baseFees = await this.prismaMaster.baseFee.findMany({
      orderBy: [
        { providerName: 'asc' },
        { paymentMethodName: 'asc' },
        { transactionType: 'asc' },
      ],
    });

    return baseFees.map((baseFee) => new BaseFeeDto(baseFee));
  }

  /**
   * Upserts upstream settlement windows, keyed on the natural key
   * `(providerName, paymentMethodName, label, effectiveFrom)`.
   *
   * These rows are a transcription of what a partner has told us about when
   * they release our money - not recorded activity - which is why they are
   * admin-managed here rather than written by the transactional apps, and why
   * the engine seed's own `update: {}` never overwrites a correction made
   * through this endpoint.
   *
   * It is also why the checks below are heavier than the base-fee ones. A wrong
   * fee is wrong for one merchant; an hour entered wrong here moves the payout
   * time for *every* merchant on that rail, and nothing fails while it does.
   */
  async upsertSettlementWindow(dtos: UpsertSettlementWindowDto[]) {
    if (dtos.length === 0) {
      throw ApiError.badRequest('At least one settlement window is required');
    }

    this.assertDistinctSettlementWindowKeys(dtos);
    await this.assertSettlementWindowsAreUsable(dtos);
    await this.assertSettlementWindowsDoNotOverlap(dtos);

    await this.prismaMaster.$transaction(
      dtos.map((dto) =>
        this.prismaMaster.upstreamSettlementWindow.upsert({
          where: {
            providerName_paymentMethodName_label_effectiveFrom: {
              providerName: dto.providerName,
              paymentMethodName: dto.paymentMethodName,
              label: dto.label,
              effectiveFrom: dto.effectiveFrom,
            },
          },
          create: {
            providerName: dto.providerName,
            paymentMethodName: dto.paymentMethodName,
            label: dto.label,
            windowStart: dto.windowStart,
            windowStartDayOffset: dto.windowStartDayOffset,
            windowEnd: dto.windowEnd,
            settlementOffset: dto.settlementOffset,
            settlementTime: dto.settlementTime ?? null,
            businessDaysOnly: dto.businessDaysOnly,
            timezone: dto.timezone ?? DEFAULT_WINDOW_TIMEZONE,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo ?? null,
          },
          update: {
            windowStart: dto.windowStart,
            windowStartDayOffset: dto.windowStartDayOffset,
            windowEnd: dto.windowEnd,
            settlementOffset: dto.settlementOffset,
            settlementTime: dto.settlementTime ?? null,
            businessDaysOnly: dto.businessDaysOnly,
            timezone: dto.timezone ?? DEFAULT_WINDOW_TIMEZONE,
            effectiveTo: dto.effectiveTo ?? null,
            // Same reasoning as the base-fee upsert: the unique key does not
            // span `deletedAt`, so without this a retired window is updated and
            // stays retired, reported as a success.
            deletedAt: null,
            deletedBy: null,
          },
        }),
      ),
    );
  }

  private assertDistinctSettlementWindowKeys(
    dtos: UpsertSettlementWindowDto[],
  ): void {
    const seen = new Set<string>();

    for (const dto of dtos) {
      const key = settlementWindowKey(dto);

      if (seen.has(key)) {
        throw ApiError.badRequest(
          `Duplicate settlement window in request: ${key}`,
        );
      }

      seen.add(key);
    }
  }

  /**
   * Field-level checks that need more than a decorator can express.
   *
   * `businessDaysOnly` is refused outright for now. The holiday calendar behind
   * it is deliberately unbuilt - no partner has given us their policy - and
   * `apps/settlement/src/policy/policy.eligibility.ts` throws rather than
   * treating the flag as false, on the grounds that failing a run is
   * recoverable and paying early is not. Saving the flag here would therefore
   * stop payouts for every merchant on the rail, from a checkbox, with the
   * failure appearing somewhere else entirely.
   */
  private async assertSettlementWindowsAreUsable(
    dtos: UpsertSettlementWindowDto[],
  ): Promise<void> {
    const { knownProviders, typesByPaymentMethod } =
      await this.loadProviderCatalogue(dtos);

    const fields: Record<string, string> = {};

    dtos.forEach((dto, index) => {
      if (!knownProviders.has(dto.providerName)) {
        fields[`[${index}].providerName`] =
          `provider '${dto.providerName}' is not configured`;
      }

      if (!typesByPaymentMethod.has(dto.paymentMethodName)) {
        fields[`[${index}].paymentMethodName`] =
          `payment method '${dto.paymentMethodName}' is not configured`;
      }

      if (dto.businessDaysOnly) {
        fields[`[${index}].businessDaysOnly`] =
          'not supported yet - BusinessDayCalendar is unbuilt, and settlement ' +
          'eligibility refuses any window carrying this flag rather than ' +
          'guessing a holiday policy';
      }

      const { startMinutes, endMinutes } = settlementWindowInterval(dto);
      const length = endMinutes - startMinutes;

      if (length > MINUTES_PER_DAY) {
        fields[`[${index}].windowStartDayOffset`] =
          `window is ${Math.round((length / 60) * 10) / 10} hours long, which ` +
          'is more than a day - windowStartDayOffset is probably wrong';
      }

      if (dto.effectiveTo && dto.effectiveTo <= dto.effectiveFrom) {
        fields[`[${index}].effectiveTo`] =
          'must be after effectiveFrom, or null while the schedule is current';
      }
    });

    if (Object.keys(fields).length > 0) {
      throw ApiError.validationFailed(fields);
    }
  }

  /**
   * Two windows on one rail must not claim the same minute.
   *
   * This is the check that earns its keep. `label` is in the natural key, so a
   * misspelt one does not correct the existing window - it creates a second,
   * and the rail then has two schedules covering the same transactions with
   * nothing to say which wins. Teleanjar's batch 1 and batch 2 are a legitimate
   * pair precisely because their intervals do not touch.
   *
   * Stored rows are compared too, not just the payload, and a payload entry
   * replaces the stored row it shares a natural key with - otherwise correcting
   * a window would collide with the version of itself already in the table.
   */
  private async assertSettlementWindowsDoNotOverlap(
    dtos: UpsertSettlementWindowDto[],
  ): Promise<void> {
    const rails = new Set(
      dtos.map((dto) => `${dto.providerName}|${dto.paymentMethodName}`),
    );

    const stored = await this.prismaMaster.upstreamSettlementWindow.findMany({
      where: {
        deletedAt: null,
        OR: [...rails].map((rail) => {
          const [providerName, paymentMethodName] = rail.split('|');
          return { providerName, paymentMethodName };
        }),
      },
    });

    const incomingKeys = new Set(dtos.map(settlementWindowKey));
    const candidates = [
      ...stored
        .filter((row) => !incomingKeys.has(settlementWindowKey(row)))
        .map((row) => ({ row, index: null as number | null })),
      ...dtos.map((dto, index) => ({ row: dto, index })),
    ];

    const fields: Record<string, string> = {};

    for (let a = 0; a < candidates.length; a++) {
      for (let b = a + 1; b < candidates.length; b++) {
        const left = candidates[a];
        const right = candidates[b];

        if (
          left.row.providerName !== right.row.providerName ||
          left.row.paymentMethodName !== right.row.paymentMethodName
        ) {
          continue;
        }

        if (!effectivePeriodsOverlap(left.row, right.row)) continue;
        if (!windowIntervalsOverlap(left.row, right.row)) continue;

        // Report against whichever side the caller actually sent.
        const reported = left.index ?? right.index;
        if (reported === null) continue;

        const other = left.index === reported ? right : left;
        fields[`[${reported}].label`] =
          `overlaps ${other.row.label} on ${other.row.providerName} ` +
          `${other.row.paymentMethodName} ` +
          `(${other.row.windowStart} - ${other.row.windowEnd})` +
          (other.index === null
            ? ', already stored'
            : ', also in this request');
      }
    }

    if (Object.keys(fields).length > 0) {
      throw ApiError.validationFailed(fields);
    }
  }

  /**
   * Every upstream settlement window, retired ones included.
   *
   * Same reasoning as `findAllBaseFee`: this is the configuration screen, and a
   * retired window is history worth reading - `effectiveFrom` is in the natural
   * key precisely so a schedule change keeps what the old payouts were computed
   * from.
   */
  async findAllSettlementWindow(): Promise<SettlementWindowDto[]> {
    const windows = await this.prismaMaster.upstreamSettlementWindow.findMany({
      orderBy: [
        { providerName: 'asc' },
        { paymentMethodName: 'asc' },
        { effectiveFrom: 'desc' },
        { label: 'asc' },
      ],
    });

    return windows.map((window) => new SettlementWindowDto(window));
  }
}
