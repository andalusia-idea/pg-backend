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

  /**
   * A failure has to be filed separately from the success it reports about, or
   * writing the error overwrites the payload that explains it. Every `_ERROR`
   * key therefore needs the stage key it belongs to.
   */
  it('pairs every error key with the stage it reports on', () => {
    const keys = Object.keys(METADATA_KEY);
    const orphans = keys
      .filter((key) => key.endsWith('_ERROR'))
      .filter((key) => !keys.includes(key.replace(/_ERROR$/, '')));

    expect(orphans).toEqual([]);
  });

  /**
   * Both legs of a payout can fail, and they do not mean the same thing: a
   * failed inquiry moved no money, a failed payment may have. One shared error
   * key would make those indistinguishable after the fact.
   */
  it('gives each payout leg its own error key', () => {
    expect(METADATA_KEY.TRANSFER_ACCOUNT_INQUIRY_ERROR).not.toBe(
      METADATA_KEY.TRANSFER_PAYMENT_ERROR,
    );
  });

  it('uses each key as its own value, so a rename cannot drift', () => {
    for (const [key, value] of Object.entries(METADATA_KEY)) {
      expect(value).toBe(key);
    }
  });
});
