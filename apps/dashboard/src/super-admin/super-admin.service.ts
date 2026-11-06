import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { CreateAdminDto, ResetPasswordDto, UpsertBaseFeeDto } from './dto';
import { AuthHelper } from '../auth';
import {
  LOCKED_MACHINE_PASSWORD,
  MACHINE_USER_ID,
  ROLE_ID,
} from '@app/microservice';
import { ApiError } from '../shared/exception';
import { BaseFeeDto } from '../modules/config-fee';

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

    const knownProviders = new Set(providers.map((provider) => provider.name));
    const typesByPaymentMethod = new Map(
      paymentMethods.map((method) => [method.name, method.transactionTypes]),
    );

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
}
