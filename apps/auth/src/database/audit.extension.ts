/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Prisma } from '@auth/prisma';
import { ClsServiceManager } from 'nestjs-cls';

const AUDITED_MODELS = new Set<string>([
  'Role',
  'Permission',
  'User',
  'AdminDetail',
  'AgentDetail',
  'MerchantDetail',
  'MerchantSignature',
]);

const AUDIT_USER_ID_PATH = 'authInfo.userId';

type MutableRecord = Record<string, unknown>;

type QueryArguments = {
  data?: unknown;
  create?: unknown;
  update?: unknown;
};

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAuditUserId(): number | undefined {
  const cls = ClsServiceManager.getClsService();
  const value = cls.get(AUDIT_USER_ID_PATH);

  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function isAuditedModel(model: string | undefined): model is string {
  return model !== undefined && AUDITED_MODELS.has(model);
}

function mergeData(data: unknown, fields: MutableRecord): unknown {
  if (!isRecord(data)) {
    return data;
  }

  return {
    ...data,
    ...fields,
  };
}

function mergeManyData(data: unknown, fields: MutableRecord): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => mergeData(item, fields));
  }

  return mergeData(data, fields);
}

function hasProperty(value: unknown, property: string): value is MutableRecord {
  return (
    isRecord(value) && Object.prototype.hasOwnProperty.call(value, property)
  );
}

function isSoftDelete(data: unknown): boolean {
  return (
    hasProperty(data, 'deletedAt') &&
    data.deletedAt !== null &&
    data.deletedAt !== undefined
  );
}

function isRestore(data: unknown): boolean {
  return hasProperty(data, 'deletedAt') && data.deletedAt === null;
}

function creationAuditFields(
  userId: number | undefined,
  now: Date,
): MutableRecord {
  return {
    createdAt: now,
    ...(userId !== undefined ? { createdBy: userId } : {}),
  };
}

function updateAuditFields(
  userId: number | undefined,
  now: Date,
): MutableRecord {
  return {
    updatedAt: now,
    ...(userId !== undefined ? { updatedBy: userId } : {}),
  };
}

function deletionAuditFields(
  userId: number | undefined,
  now: Date,
): MutableRecord {
  return {
    deletedAt: now,
    updatedAt: now,
    ...(userId !== undefined
      ? {
          deletedBy: userId,
          updatedBy: userId,
        }
      : {}),
  };
}

function restorationAuditFields(
  userId: number | undefined,
  now: Date,
): MutableRecord {
  return {
    deletedAt: null,
    deletedBy: null,
    updatedAt: now,
    ...(userId !== undefined ? { updatedBy: userId } : {}),
  };
}

function resolveUpdateAuditFields(
  data: unknown,
  userId: number | undefined,
  now: Date,
): MutableRecord {
  if (isRestore(data)) {
    return restorationAuditFields(userId, now);
  }

  if (isSoftDelete(data)) {
    return deletionAuditFields(userId, now);
  }

  return updateAuditFields(userId, now);
}

export const PRISMA_AUDIT_EXTENSION_KEY = 'PRISMA_AUDIT_EXTENSION_KEY';

export const auditTrailExtension = Prisma.defineExtension({
  name: PRISMA_AUDIT_EXTENSION_KEY,

  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!isAuditedModel(model)) {
          return query(args);
        }

        const userId = getAuditUserId();
        const now = new Date();

        const mutableArgs = args as QueryArguments;

        switch (operation) {
          case 'create': {
            mutableArgs.data = mergeData(
              mutableArgs.data,
              creationAuditFields(userId, now),
            );

            break;
          }

          case 'createMany':
          case 'createManyAndReturn': {
            mutableArgs.data = mergeManyData(
              mutableArgs.data,
              creationAuditFields(userId, now),
            );

            break;
          }

          case 'update':
          case 'updateMany':
          case 'updateManyAndReturn': {
            mutableArgs.data = mergeData(
              mutableArgs.data,
              resolveUpdateAuditFields(mutableArgs.data, userId, now),
            );

            break;
          }

          case 'upsert': {
            mutableArgs.create = mergeData(
              mutableArgs.create,
              creationAuditFields(userId, now),
            );

            mutableArgs.update = mergeData(
              mutableArgs.update,
              resolveUpdateAuditFields(mutableArgs.update, userId, now),
            );

            break;
          }

          default:
            break;
        }

        return query(args);
      },
    },
  },
});
