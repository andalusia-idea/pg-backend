import { describe, expect, it } from '@jest/globals';
import { METADATA_KEY } from './upstream.constant';

describe('METADATA_KEY', () => {
  /**
   * These are object keys in one JSON document per transaction. Two names
   * sharing a value means the second write silently replaces the first - and the
   * failure looks like missing evidence rather than an error. This caught
   * `TRANSFER_EWALLET_ACCOUNT_INQUIRY` and `TRANSFER_EWALLET_PAYMENT` carrying
   * `TRANSFER_BANK_*` values, which would have filed every e-wallet payload
   * under a bank label.
   */
  it('has no duplicate values', () => {
    const values = Object.values(METADATA_KEY);
    const duplicates = values.filter(
      (value, index) => values.indexOf(value) !== index,
    );

    expect(duplicates).toEqual([]);
    expect(new Set(values).size).toBe(values.length);
  });

  /**
   * Keyed by event, never by provider. A key naming a provider would make the
   * same question answerable differently per row - which provider served a
   * transaction is already on the row, in `providerName`.
   */
  it('names no provider', () => {
    const providerish = /MOTIONPAY|TELEANJAR|JATELINDO|BILLER/;
    const offenders = Object.keys(METADATA_KEY).filter((key) =>
      providerish.test(key),
    );

    expect(offenders).toEqual([]);
  });

  it('uses each key as its own value, so a rename cannot drift', () => {
    for (const [key, value] of Object.entries(METADATA_KEY)) {
      expect(value).toBe(key);
    }
  });
});
