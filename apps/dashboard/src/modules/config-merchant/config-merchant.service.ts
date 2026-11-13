import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ApiError } from '../../shared/exception';
import { BaseFeeDto } from '../config-fee/dto/base-fee.dto';
import {
  ActionEnum,
  AGENT_SHAREHOLDER_TOTAL_PERCENTAGE,
} from './config-merchant.constant';
import {
  AgentShareholderDto,
  MerchantBaseFeeConfigDto,
  MerchantConfigDto,
  MerchantFeeDto,
  MerchantIntervalDto,
} from './dto/merchant-config.dto';
import {
  DEFAULT_PAYMENT_METHOD,
  MerchantSettlementPolicyDto,
  UpsertMerchantSettlementPolicyDto,
} from './dto/settlement-policy.dto';
import {
  UpsertMerchantAgentShareholderDto,
  UpsertMerchantFeeDto,
} from './dto/upsert-merchant-fee.dto';
import { FeeRedis } from '@app/redis';
import { SettlementModeEnum } from '@app/microservice';

const ZERO = '0';

/**
 * The natural key of `MerchantSettlementPolicy` within one merchant, as one
 * comparable string. `merchantId` is not in it because every caller is already
 * scoped to one merchant by the path parameter.
 */
function settlementPolicyKey(policy: {
  paymentMethodName: string;
  effectiveFrom: Date;
}): string {
  return [policy.paymentMethodName, policy.effectiveFrom.toISOString()].join(
    '|',
  );
}

@Injectable()
export class ConfigMerchantService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,

    private readonly feeRedis: FeeRedis,
  ) {}

  async findMerchantIntervalById(
    merchantId: number,
  ): Promise<MerchantIntervalDto> {
    const merchant = await this.prismaSlave.merchant.findFirst({
      where: { id: merchantId, deletedAt: null },
      select: { id: true },
    });
    if (!merchant) throw ApiError.notFound('Merchant config');

    return new MerchantIntervalDto({
      userId: merchant.id,
    });
  }

  /**
   * Every active base fee, each paired with this merchant's override if one
   * exists, plus the merchant's agent shareholders and settlement interval.
   */
  async findAllConfigByMerchantId(
    merchantId: number,
  ): Promise<MerchantConfigDto> {
    const merchant = await this.prismaSlave.merchant.findFirst({
      where: { id: merchantId, deletedAt: null },
    });
    if (!merchant) throw ApiError.notFound('Merchant config');

    const [agentShareholders, baseFees] = await Promise.all([
      this.prismaSlave.agentShareholder.findMany({
        where: { merchantId, deletedAt: null },
        orderBy: { agentId: 'asc' },
      }),
      // One query with a filtered relation rather than N+1: each
      // merchantId+baseFeeId pair is unique, so at most one override per row.
      this.prismaSlave.baseFee.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [
          { providerName: 'asc' },
          { paymentMethodName: 'asc' },
          { transactionType: 'asc' },
        ],
        include: {
          merchantFees: {
            where: { merchantId, deletedAt: null },
            take: 1,
          },
        },
      }),
    ]);

    const fees = baseFees
      .map(
        (baseFee) =>
          new MerchantBaseFeeConfigDto({
            baseFeeConfig: new BaseFeeDto(baseFee),
            merchantFeeConfig: baseFee.merchantFees[0]
              ? new MerchantFeeDto(baseFee.merchantFees[0])
              : null,
          }),
      )
      // Configured fees first, then unconfigured; each group by code.
      .sort((a, b) => {
        const aConfigured = a.merchantFeeConfig !== null;
        const bConfigured = b.merchantFeeConfig !== null;
        if (aConfigured !== bConfigured) return aConfigured ? -1 : 1;
        return a.baseFeeConfig.code.localeCompare(b.baseFeeConfig.code);
      });

    return new MerchantConfigDto({
      agentShareholders:
        agentShareholders.length === 0
          ? null
          : agentShareholders.map(
              (shareholder) => new AgentShareholderDto(shareholder),
            ),
      fees,
    });
  }

  /** Applies a batch of fee inserts/updates/deletes atomically. */
  async upsertProvider(
    merchantId: number,
    body: UpsertMerchantFeeDto[],
  ): Promise<void> {
    await this.prismaMaster.$transaction(async (tx) => {
      for (const fee of body) {
        const {
          action,
          baseFeeId,
          feeInternalFixed,
          feeInternalPercentage,
          feeAgentFixed,
          feeAgentPercentage,
        } = fee;

        const key = { merchantId_baseFeeId: { merchantId, baseFeeId } };

        if (action === ActionEnum.D) {
          await tx.merchantFee.delete({ where: key });
          continue;
        }

        const values = {
          feeInternalFixed,
          feeInternalPercentage,
          feeAgentFixed: feeAgentFixed ?? ZERO,
          feeAgentPercentage: feeAgentPercentage ?? ZERO,
        };

        await tx.merchantFee.upsert({
          where: key,
          create: { merchantId, baseFeeId, ...values },
          update: values,
        });

        await this.feeRedis.deleteMerchantFee(merchantId, baseFeeId);
      }
    });
  }

  /** Applies a batch of shareholder changes atomically. */
  async upsertAgentShareholder(
    merchantId: number,
    body: UpsertMerchantAgentShareholderDto[],
  ): Promise<void> {
    this.assertShareholderPercentagesTotal(body);

    await this.prismaMaster.$transaction(async (tx) => {
      for (const shareholder of body) {
        const { action, agentId, percentagePerAgent } = shareholder;
        const key = { agentId_merchantId: { agentId, merchantId } };

        if (action === ActionEnum.D) {
          await tx.agentShareholder.delete({ where: key });
          continue;
        }

        await tx.agentShareholder.upsert({
          where: key,
          create: { merchantId, agentId, percentagePerAgent },
          update: { percentagePerAgent },
        });

        await this.feeRedis.deleteAgentShareholder(merchantId);
      }
    });
  }

  /**
   * The surviving shareholders must account for exactly 100% of the merchant.
   *
   * Checks the submitted batch, not the resulting table - so the frontend has to
   * post the merchant's complete shareholder set, which is what it does.
   * Summed with Decimal rather than floats: 33.3333 x 3 does not reach 100 in
   * binary floating point.
   */
  private assertShareholderPercentagesTotal(
    body: UpsertMerchantAgentShareholderDto[],
  ): void {
    const total = body
      .filter((shareholder) => shareholder.action !== ActionEnum.D)
      .reduce(
        (sum, shareholder) =>
          sum.plus(new Decimal(shareholder.percentagePerAgent)),
        new Decimal(0),
      );

    if (!total.eq(AGENT_SHAREHOLDER_TOTAL_PERCENTAGE)) {
      throw ApiError.badRequest(
        `Sum of agent shareholder percentage must be ${AGENT_SHAREHOLDER_TOTAL_PERCENTAGE}%`,
        { percentagePerAgent: `Current sum is ${total.toFixed(4)}%` },
      );
    }
  }

  /**
   * Writes this merchant's settlement terms - when their money stops being
   * "coming" and becomes theirs to spend.
   *
   * **This is the write path `MerchantSettlementPolicy` never had.** The table
   * has existed since the `settlementInterval` integer was retired, the
   * settlement enqueuer and runner read it, and `auditTrailExtension` covers
   * it - but the only writer in the tree was `registerMerchant`, which creates
   * the default `FOLLOW_UPSTREAM` row on `'*'` and never comes back. So a
   * merchant's terms were fixed at registration and could not be changed
   * through the API at all, which left `INSTANT`, `FIXED_DELAY` and `SCHEDULED`
   * unreachable in production however the contract was written.
   *
   * It lives beside the fee and shareholder writes rather than under
   * `/super-admin` because it is per-merchant commercial configuration and an
   * ADMIN owns it - the same reasoning that puts `MerchantFee` here. Upstream
   * settlement *windows* stay in super-admin: those are partner-wide and
   * describe someone else's schedule.
   *
   * Superseding is the server's job, for the reason the DTO's doc block gives.
   *
   * `createdBy` / `updatedBy` are not set here: the model is in
   * `AUDITED_MODELS`, so `auditTrailExtension` stamps both branches from the
   * request's user id.
   */
  async upsertSettlementPolicy(
    merchantId: number,
    body: UpsertMerchantSettlementPolicyDto[],
  ): Promise<void> {
    if (body.length === 0) {
      throw ApiError.badRequest('At least one settlement policy is required');
    }

    await this.assertMerchantExists(merchantId);
    this.assertDistinctSettlementPolicyKeys(body);
    await this.assertSettlementPoliciesAreUsable(body);

    const superseded = await this.resolveSupersededPolicies(merchantId, body);

    await this.prismaMaster.$transaction([
      // Closing the outgoing rows first keeps the moment where two policies are
      // in force at once inside this transaction, rather than visible to the
      // settlement enqueuer between two statements.
      ...superseded.map(({ id, effectiveTo }) =>
        this.prismaMaster.merchantSettlementPolicy.update({
          where: { id },
          data: { effectiveTo },
        }),
      ),
      ...body.map((dto) =>
        this.prismaMaster.merchantSettlementPolicy.upsert({
          where: {
            merchantId_paymentMethodName_effectiveFrom: {
              merchantId,
              paymentMethodName: dto.paymentMethodName,
              effectiveFrom: dto.effectiveFrom,
            },
          },
          create: {
            merchantId,
            paymentMethodName: dto.paymentMethodName,
            mode: dto.mode,
            delayDays: dto.delayDays ?? null,
            releaseTimes: dto.releaseTimes ?? [],
            businessDaysOnly: dto.businessDaysOnly,
            effectiveFrom: dto.effectiveFrom,
            effectiveTo: dto.effectiveTo ?? null,
          },
          update: {
            mode: dto.mode,
            delayDays: dto.delayDays ?? null,
            releaseTimes: dto.releaseTimes ?? [],
            businessDaysOnly: dto.businessDaysOnly,
            // Only when the caller said something about it. An omitted
            // `effectiveTo` arrives as `undefined` and an explicit one as
            // `null`, measured, and the difference matters: a superseded row
            // carries the end date supersession gave it, so writing `?? null`
            // here would re-open it and leave two rows in force on one
            // pairing. Clearing an end date stays possible by sending `null`.
            ...(dto.effectiveTo !== undefined
              ? { effectiveTo: dto.effectiveTo }
              : {}),
            // The unique key does not span `deletedAt`, so without this a
            // retired policy is updated and stays retired while the call
            // reports success - the same trap the fee and window upserts clear.
            deletedAt: null,
            deletedBy: null,
          },
        }),
      ),
    ]);
  }

  /**
   * Every settlement policy for this merchant, superseded and retired included.
   *
   * Newest terms first per method, so a listing reads top to bottom as the
   * current rule followed by its history. Note that `'*'` sorts *before* a real
   * method name - `*` is ASCII 42 - which is the opposite of resolution order,
   * where an exact method match beats the default. The listing is history, not
   * precedence.
   *
   * Reads from master, unlike this module's other GETs: the configuration
   * screen posts and re-reads immediately, and a replica read would show the
   * admin the terms they just replaced.
   */
  async findAllSettlementPolicyByMerchantId(
    merchantId: number,
  ): Promise<MerchantSettlementPolicyDto[]> {
    await this.assertMerchantExists(merchantId);

    const policies = await this.prismaMaster.merchantSettlementPolicy.findMany({
      where: { merchantId },
      orderBy: [{ paymentMethodName: 'asc' }, { effectiveFrom: 'desc' }],
    });

    return policies.map((policy) => new MerchantSettlementPolicyDto(policy));
  }

  private async assertMerchantExists(merchantId: number): Promise<void> {
    const merchant = await this.prismaMaster.merchant.findFirst({
      where: { id: merchantId, deletedAt: null },
      select: { id: true },
    });

    if (!merchant) throw ApiError.notFound('Merchant config');
  }

  /**
   * Two entries on one method and date would upsert one row twice, and the
   * later one would win in silence.
   */
  private assertDistinctSettlementPolicyKeys(
    body: UpsertMerchantSettlementPolicyDto[],
  ): void {
    const seen = new Set<string>();

    for (const dto of body) {
      const key = settlementPolicyKey(dto);

      if (seen.has(key)) {
        throw ApiError.badRequest(
          `Duplicate settlement policy in request: ${key}`,
        );
      }

      seen.add(key);
    }
  }

  /**
   * Everything the database cannot say, and the settlement runner would
   * otherwise discover at 2am.
   *
   * The mode/column matrix is the bulk of it: `delayDays` is required for
   * `FIXED_DELAY` and meaningless elsewhere, `releaseTimes` needs exactly one
   * entry for `FIXED_DELAY` and at least one for `SCHEDULED`. Nothing in
   * Postgres can express that, and `policy.eligibility.ts` throws on each case
   * rather than guessing - so a row that violates one is a merchant whose
   * settlement stops. Caught here it is a 422 on a form field.
   */
  private async assertSettlementPoliciesAreUsable(
    body: UpsertMerchantSettlementPolicyDto[],
  ): Promise<void> {
    const knownPaymentMethods = await this.loadPaymentMethodNames(body);

    const fields: Record<string, string> = {};

    body.forEach((dto, index) => {
      if (
        dto.paymentMethodName !== DEFAULT_PAYMENT_METHOD &&
        !knownPaymentMethods.has(dto.paymentMethodName)
      ) {
        fields[`[${index}].paymentMethodName`] =
          `payment method '${dto.paymentMethodName}' is not configured - use ` +
          `'${DEFAULT_PAYMENT_METHOD}' for the merchant default`;
      }

      if (dto.businessDaysOnly) {
        fields[`[${index}].businessDaysOnly`] =
          'not supported yet - BusinessDayCalendar is unbuilt, and settlement ' +
          'eligibility refuses any policy carrying this flag rather than ' +
          'guessing a holiday policy';
      }

      const releaseTimes = dto.releaseTimes ?? [];

      if (dto.mode === SettlementModeEnum.FIXED_DELAY) {
        if (dto.delayDays === null || dto.delayDays === undefined) {
          fields[`[${index}].delayDays`] =
            'required for FIXED_DELAY - it is the N in T+N';
        }

        if (releaseTimes.length !== 1) {
          fields[`[${index}].releaseTimes`] =
            `FIXED_DELAY needs exactly one release time, got ${releaseTimes.length}` +
            ' - several releases a day is SCHEDULED, which answers a different' +
            ' question';
        }
      }

      if (
        dto.mode === SettlementModeEnum.SCHEDULED &&
        releaseTimes.length === 0
      ) {
        fields[`[${index}].releaseTimes`] =
          'SCHEDULED needs at least one release time';
      }

      if (new Set(releaseTimes).size !== releaseTimes.length) {
        fields[`[${index}].releaseTimes`] =
          'duplicate release times - a batch cannot run twice at one moment';
      }

      if (dto.effectiveTo && dto.effectiveTo <= dto.effectiveFrom) {
        fields[`[${index}].effectiveTo`] =
          'must be after effectiveFrom, or null while the terms are current';
      }
    });

    if (Object.keys(fields).length > 0) {
      throw ApiError.validationFailed(fields);
    }
  }

  private async loadPaymentMethodNames(
    body: UpsertMerchantSettlementPolicyDto[],
  ): Promise<Set<string>> {
    const names = body
      .map((dto) => dto.paymentMethodName)
      .filter((name) => name !== DEFAULT_PAYMENT_METHOD);

    if (names.length === 0) return new Set();

    const methods = await this.prismaMaster.paymentMethod.findMany({
      where: { name: { in: names }, deletedAt: null },
      select: { name: true },
    });

    return new Set(methods.map((method) => method.name));
  }

  /**
   * The stored rows a payload supersedes, each with the `effectiveTo` to close
   * it at.
   *
   * A row is superseded when it covers the same method, started strictly
   * earlier, and has not already ended by the time the new terms begin.
   *
   * **Inserting behind a later schedule is refused** rather than guessed at.
   * Closing the *new* row at the later one's start would be a reasonable
   * reading, and so would leaving the later row alone and overlapping; since
   * both are defensible the admin has to say which they meant.
   */
  private async resolveSupersededPolicies(
    merchantId: number,
    body: UpsertMerchantSettlementPolicyDto[],
  ): Promise<{ id: number; effectiveTo: Date }[]> {
    const stored = await this.prismaMaster.merchantSettlementPolicy.findMany({
      where: {
        merchantId,
        deletedAt: null,
        paymentMethodName: {
          in: [...new Set(body.map((dto) => dto.paymentMethodName))],
        },
      },
      select: {
        id: true,
        paymentMethodName: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });

    const storedKeys = new Set(stored.map(settlementPolicyKey));
    const closing: { id: number; effectiveTo: Date }[] = [];
    const fields: Record<string, string> = {};

    body.forEach((dto, index) => {
      // An entry whose key already exists is an edit of one historical row, not
      // a succession - so it neither closes anything nor cares what comes after
      // it. Without this, correcting a typo in September's terms would be
      // refused for as long as any later schedule existed, which is every row
      // that has ever been superseded.
      if (storedKeys.has(settlementPolicyKey(dto))) return;

      for (const row of stored) {
        if (row.paymentMethodName !== dto.paymentMethodName) continue;

        if (row.effectiveFrom.getTime() >= dto.effectiveFrom.getTime()) {
          fields[`[${index}].effectiveFrom`] =
            `a later schedule for this method already starts at ` +
            `${row.effectiveFrom.toISOString()} - retire it first, or choose ` +
            'an effectiveFrom after it';
          continue;
        }

        const endsAfter =
          row.effectiveTo === null ||
          row.effectiveTo.getTime() > dto.effectiveFrom.getTime();

        if (endsAfter) {
          closing.push({ id: row.id, effectiveTo: dto.effectiveFrom });
        }
      }
    });

    if (Object.keys(fields).length > 0) {
      throw ApiError.validationFailed(fields);
    }

    return closing;
  }
}
