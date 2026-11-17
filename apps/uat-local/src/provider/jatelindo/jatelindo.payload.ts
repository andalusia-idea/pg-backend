import { FakeTransaction, OUTCOME, Outcome } from '../provider.store';
import {
  JATELINDO_CODE,
  JatelindoCode,
  jatelindoEnvelope,
  jatelindoTransactionNumber,
} from './jatelindo.fake.helper';

/**
 * Jatelindo's asynchronous transfer callback, in their vocabulary.
 *
 * Hand-written against the provider's spec rather than built from
 * `JatelindoTransferCallbackSchema`, for the reason the create payloads are:
 * a fake that shares our parser cannot catch a wrong parser.
 *
 * **The callback body is the single-transfer response shape**, which is not an
 * accident of this fake - `JatelindoTransferCallbackSchema` is literally
 * `JatelindoSingleTransferResponseSchema` - so the controller's `Value.Check`
 * will reject a thinner envelope. The code in `status.responseCode` is the only
 * thing that differs between the accept and the outcome, and it is the only
 * field `translate` reads apart from the two references.
 *
 * There are no timestamps here, which is worth noticing rather than assuming:
 * Jatelindo's callback carries none, so `paidAt` on a completed payout is set
 * from our own clock when the callback lands. That is a difference from the
 * QRIS rail, where `paid_date` comes from the provider.
 *
 * **Both references are passed in rather than read off `row`.** The dispatcher
 * owns which one a scenario is allowed to lie about, and on this rail that is
 * the `traceNumber` - the transfer callback is looked up by it, not by
 * `jpaReferenceNo`. See `envelope` for the whole argument.
 */
export function jatelindoTransferCallback(
  row: FakeTransaction,
  outcome: Outcome,
  references: { systemReference: string; providerReference: string },
): Record<string, unknown> {
  const { code, message } = statusFor(row, outcome);
  const { systemReference, providerReference } = references;

  return {
    traceNumber: systemReference,
    jpaReferenceNo: providerReference,

    /**
     * One entry, as the provider sends on a resolved transfer.
     *
     * Nothing in `translate` reads it - it travels into the stored
     * `TRANSFER_CALLBACK` metadata and no further - but the schema requires the
     * key, and an empty array here would make every callback look like the
     * defect the empty-array probe exists to produce deliberately.
     */
    DisbursementResponse: [
      {
        transactionType: { name: 'SINGLE_TRANSFER' },
        traceNumber: systemReference,
        sourceAccount: { fromName: 'UAT Pool', fromUsername: 'uat' },
        transactionNumber: jatelindoTransactionNumber(providerReference),
        destinationAccount: {
          accountName: 'UAT BENEFICIARY',
          accountNo: row.destinationAccount ?? '',
          bankName: 'UAT BANK',
        },
      },
    ],

    status: jatelindoEnvelope(code, message),
  };
}

/**
 * Our neutral outcome, as one of Jatelindo's codes.
 *
 * **`EXPIRED` has no honest translation, and is not quietly made into one.**
 * `jatelindo.constant.ts` says it outright: *"Nothing maps to CANCELLED or
 * EXPIRED: Jatelindo has neither concept for a payout."* An expiry is a QRIS
 * idea - a code nobody scanned - and a payout either goes or it does not.
 *
 * So the nearest *truthful* code is `E18 TIMEOUT`, one of the three the spec
 * marks `Need Check = Y` and calls SUSPECT: the provider is saying it cannot
 * confirm the outcome. That maps to `PENDING`, so the callback arrives, is
 * accepted, and changes nothing - which is the correct behaviour and a case
 * worth watching in its own right.
 *
 * Mapping it to `T40 FAILED` instead would be the tempting shortcut and the
 * wrong one twice over: it would assert a verified failure the provider never
 * gave, and it would make the `EXPIRED` band on this rail silently pass for the
 * `FAILED_BY_CALLBACK` band in Step 9.
 *
 * Unreached so far, and not unreachable: send a payout whose amount ends
 * `78`-`81` with the switchboard on and it arrives. With the switchboard off
 * the row is held rather than delivered, which is why nothing has produced one
 * yet.
 */
function statusFor(
  row: FakeTransaction,
  outcome: Outcome,
): { code: JatelindoCode; message: string } {
  if (outcome === OUTCOME.SUCCESS) {
    return { code: JATELINDO_CODE.PROCESSED, message: 'Transaction processed' };
  }

  if (outcome === OUTCOME.EXPIRED) {
    return {
      code: JATELINDO_CODE.TIMEOUT,
      message: `UAT ${row.scenario}: no expiry concept on this rail, reported as SUSPECT`,
    };
  }

  return { code: JATELINDO_CODE.FAILED, message: `UAT ${row.scenario}` };
}
