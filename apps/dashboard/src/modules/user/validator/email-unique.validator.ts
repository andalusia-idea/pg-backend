import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Rejects an email already taken by another user.
 *
 * Resolved through Nest's DI (enabled by `useContainer()` in main.ts), so it can
 * reach Prisma. Note this is a check-then-act race: two concurrent registrations
 * with the same email can both pass here. The unique index on `auth.User.email`
 * is the real guarantee - it surfaces as a 409 via the Prisma exception filter.
 */
@Injectable()
@ValidatorConstraint({ name: 'EmailUnique', async: true })
export class EmailUniqueValidator implements ValidatorConstraintInterface {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async validate(value: unknown): Promise<boolean> {
    if (typeof value !== 'string' || value === '') return false;

    const existing = await this.prismaSlave.user.findFirst({
      where: { email: value },
      select: { id: true },
    });

    return existing === null;
  }

  defaultMessage(validationArguments?: ValidationArguments): string {
    return `${validationArguments?.property} is already registered`;
  }
}

export function EmailUnique(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: EmailUniqueValidator,
    });
  };
}
