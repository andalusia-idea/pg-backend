import { describe, expect, it } from '@jest/globals';
import { ClsServiceManager } from 'nestjs-cls';
import { AUDIT_USER_ID_PATH, getAuditUserId } from './audit.helper';

/**
 * The contract several separate things depend on: each app's audit extension,
 * for top-level writes, and the fee-detail builders, which have to set
 * `createdBy` themselves because an extension does not walk into nested
 * creates.
 */
describe('getAuditUserId', () => {
  const cls = ClsServiceManager.getClsService();

  it('returns the principal the current context is acting as', () => {
    const seen = cls.run(() => {
      cls.set(AUDIT_USER_ID_PATH, 24);
      return getAuditUserId();
    });

    expect(seen).toBe(24);
  });

  /**
   * `ClsService.set` throws outside an active context but `get` does not, which
   * is why a cron writing without a `cls.run()` wrapper produced null audit
   * columns instead of an error. If that ever changes, every write outside a
   * request starts throwing, so it is worth pinning.
   */
  it('returns undefined outside a context rather than throwing', () => {
    expect(cls.isActive()).toBe(false);
    expect(getAuditUserId()).toBeUndefined();
  });

  it('returns undefined when nothing set a principal', () => {
    const seen = cls.run(() => getAuditUserId());

    expect(seen).toBeUndefined();
  });

  /**
   * Ids are `auth.User.id` values, so anything that is not a positive integer
   * is a bug upstream - better undefined, and a visibly unattributed row, than
   * a foreign key pointing at nothing.
   */
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['a numeric string', '24'],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    const seen = cls.run(() => {
      cls.set(AUDIT_USER_ID_PATH, value);
      return getAuditUserId();
    });

    expect(seen).toBeUndefined();
  });
});
