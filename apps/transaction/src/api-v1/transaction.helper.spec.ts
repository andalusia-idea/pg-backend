import { describe, expect, it } from '@jest/globals';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import {
  DEFAULT_SYSTEM_REFERENCE_LENGTH,
  MIN_STRUCTURED_REFERENCE_LENGTH,
  extractSystemReference,
  generateSystemReference,
} from './transaction.helper';

const base = {
  userId: 27,
  transactionType: TransactionTypeEnum.DISBURSEMENT,
  paymentMethodName: PaymentMethodNameEnum.TRANSFEREWALLET,
  providerName: ProviderNameEnum.MOTIONPAY,
};

/** `{13 ms}{1 type}{2 method}{5 provider}-{userId}` for the fixture above. */
const STRUCTURED_LENGTH_FOR_USER_27 = 24;

describe('generateSystemReference', () => {
  describe('when the pattern fits', () => {
    it('fills the budget up to our own default', () => {
      const reference = generateSystemReference({ ...base, maxLength: 50 });
      expect(reference).toHaveLength(DEFAULT_SYSTEM_REFERENCE_LENGTH);
    });

    it('never grows past the default just because the provider allows it', () => {
      // MotionPay's QRIS field is a probed 255. We still generate 32.
      const reference = generateSystemReference({ ...base, maxLength: 255 });
      expect(reference).toHaveLength(DEFAULT_SYSTEM_REFERENCE_LENGTH);
    });

    it('honours a cap below the default', () => {
      const reference = generateSystemReference({ ...base, maxLength: 26 });
      expect(reference).toHaveLength(26);
    });

    /**
     * The regression that motivated the change. The old soft `length` argument
     * returned the structured part whole when it did not fit, so asking for 21
     * produced 24 - a cap that silently failed to cap.
     */
    it('never exceeds maxLength, at any length', () => {
      for (let maxLength = 1; maxLength <= 60; maxLength++) {
        const reference = generateSystemReference({ ...base, maxLength });
        expect(reference.length).toBeLessThanOrEqual(maxLength);
      }
    });

    it('leaves the structured part alone when there is no room for a suffix', () => {
      const reference = generateSystemReference({
        ...base,
        maxLength: STRUCTURED_LENGTH_FOR_USER_27,
      });
      expect(reference).toHaveLength(STRUCTURED_LENGTH_FOR_USER_27);
      // One delimiter, before the user id - so no random suffix was appended.
      expect(reference.split('-')).toHaveLength(2);
    });
  });

  describe('when the pattern does not fit', () => {
    it('falls back to random rather than truncating', () => {
      const reference = generateSystemReference({ ...base, maxLength: 20 });

      expect(reference).toHaveLength(20);
      expect(reference).toMatch(/^[0-9a-f]{20}$/);
      expect(extractSystemReference(reference).pattern).toBe('random');
    });

    /**
     * The threshold is "the structured part does not fit", not a bare number.
     * A long user id pushes the pattern past a budget that a short one clears.
     */
    it('accounts for the width of the user id, not just the prefix', () => {
      const short = generateSystemReference({
        ...base,
        userId: 1,
        maxLength: MIN_STRUCTURED_REFERENCE_LENGTH,
      });
      const long = generateSystemReference({
        ...base,
        userId: 123456,
        maxLength: MIN_STRUCTURED_REFERENCE_LENGTH,
      });

      expect(extractSystemReference(short).pattern).toBe('structured');
      expect(extractSystemReference(long).pattern).toBe('random');
    });

    it('produces distinct values for concurrent calls', () => {
      const references = new Set(
        Array.from({ length: 500 }, () =>
          generateSystemReference({ ...base, maxLength: 16 }),
        ),
      );
      expect(references.size).toBe(500);
    });
  });

  describe('maxLength validation', () => {
    it.each([0, -1, 1.5, NaN])('rejects %p', (maxLength) => {
      expect(() => generateSystemReference({ ...base, maxLength })).toThrow(
        /maxLength must be a positive integer/,
      );
    });
  });
});

describe('extractSystemReference', () => {
  it('round-trips everything the generator put in', () => {
    const before = Date.now();
    const reference = generateSystemReference({ ...base, maxLength: 32 });
    const parts = extractSystemReference(reference);

    expect(parts).toMatchObject({
      pattern: 'structured',
      userId: base.userId,
      transactionType: base.transactionType,
      paymentMethodName: base.paymentMethodName,
      providerName: base.providerName,
    });
    if (parts.pattern !== 'structured') throw new Error('unreachable');
    expect(parts.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('round-trips a reference with no random suffix', () => {
    const reference = generateSystemReference({
      ...base,
      maxLength: STRUCTURED_LENGTH_FOR_USER_27,
    });
    expect(extractSystemReference(reference).pattern).toBe('structured');
  });

  /**
   * Not a parse failure - a valid reference we cannot say anything about. It
   * used to throw, which was defensible only while every reference was
   * structured.
   */
  it('reports random references as random instead of throwing', () => {
    expect(extractSystemReference('a3f19c2b8d4e')).toEqual({
      pattern: 'random',
      value: 'a3f19c2b8d4e',
    });
  });

  it('reports anything unparseable as random, without throwing', () => {
    for (const value of ['', 'not-a-reference', '12345', '-', 'null']) {
      expect(() => extractSystemReference(value)).not.toThrow();
      expect(extractSystemReference(value).pattern).toBe('random');
    }
  });

  /**
   * The invariant that lets the two kinds coexist without a marker character:
   * the generator emits hex, and the pattern needs a `-` followed by digits, so
   * a random reference can never be mistaken for a structured one.
   */
  it('never mistakes a random reference for a structured one', () => {
    for (let i = 0; i < 2000; i++) {
      const reference = generateSystemReference({ ...base, maxLength: 22 });
      expect(extractSystemReference(reference).pattern).toBe('random');
    }
  });
});
