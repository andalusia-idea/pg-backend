import { EWalletEnum, TransactionStatusEnum } from '@app/microservice';
import {
  JATELINDO_CHANNEL,
  JATELINDO_RESPONSE_CODE,
  jatelindoMapperResponseCode,
} from './jatelindo.constant';

/**
 * The channel map is money-routing data transcribed by hand from a PDF, so these
 * are about transcription integrity: a value that is not a real channel, or two
 * banks pointing at one channel, is a payout to a stranger.
 */
describe('JATELINDO_CHANNEL', () => {
  const entries = Object.entries(JATELINDO_CHANNEL);

  /** The spec lists 1..142 but omits 81 entirely: it goes 80, then 82. */
  const MISSING_FROM_SPEC = 81;

  it('maps every e-wallet to its 90x channel', () => {
    expect(JATELINDO_CHANNEL[EWalletEnum.DANA]).toBe('901');
    expect(JATELINDO_CHANNEL[EWalletEnum.SHOPEEPAY]).toBe('902');
    expect(JATELINDO_CHANNEL[EWalletEnum.GOPAY]).toBe('903');
    expect(JATELINDO_CHANNEL[EWalletEnum.OVO]).toBe('904');
  });

  it('gives every channel as a numeric string', () => {
    // An empty or non-numeric value renders as `channelId=` in the signature and
    // the provider refuses, which is the failure this guards.
    for (const [code, channel] of entries) {
      expect(channel).toMatch(/^[1-9][0-9]{0,2}$/);
      expect(code).not.toBe('');
    }
  });

  it('only uses channels the spec actually lists', () => {
    const wallets = new Set<string>(['901', '902', '903', '904']);

    for (const [code, channel] of entries) {
      if (wallets.has(channel)) continue;

      const id = Number(channel);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(142);
      expect({ code, channel: id }).not.toEqual({
        code,
        channel: MISSING_FROM_SPEC,
      });
    }
  });

  it('never points two destinations at one channel', () => {
    const owner = new Map<string, string>();

    for (const [code, channel] of entries) {
      expect(owner.get(channel)).toBeUndefined();
      owner.set(channel, code);
    }
  });

  it('keys banks by a three-digit clearing code', () => {
    const walletCodes = new Set<string>(Object.values(EWalletEnum));

    for (const [code] of entries) {
      if (walletCodes.has(code)) continue;
      expect(code).toMatch(/^[0-9]{3}$/);
    }
  });
});

describe('jatelindoMapperResponseCode', () => {
  it('leaves every SUSPECT code unresolved', () => {
    // Need Check = Y in the spec's table. A terminal state here is a merchant
    // told their payout failed, retrying, and paying the recipient twice.
    for (const code of ['A01', 'E99', 'E18'] as const) {
      expect(jatelindoMapperResponseCode(code)).toBe(
        TransactionStatusEnum.PENDING,
      );
    }
  });

  it('resolves A00 and only A00 to success', () => {
    const succeeding = Object.values(JATELINDO_RESPONSE_CODE).filter(
      (code) =>
        jatelindoMapperResponseCode(code) === TransactionStatusEnum.SUCCESS,
    );

    expect(succeeding).toEqual(['A00']);
  });

  it('never returns a state Jatelindo has no concept of', () => {
    for (const code of Object.values(JATELINDO_RESPONSE_CODE)) {
      expect(jatelindoMapperResponseCode(code)).not.toBe(
        TransactionStatusEnum.CANCELLED,
      );
      expect(jatelindoMapperResponseCode(code)).not.toBe(
        TransactionStatusEnum.EXPIRED,
      );
    }
  });

  it('treats a code it has never seen as unresolved, not failed', () => {
    expect(jatelindoMapperResponseCode('Z01' as never)).toBe(
      TransactionStatusEnum.PENDING,
    );
  });
});
