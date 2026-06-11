/**
 * Canonical payment-reference codec
 *
 * Some scheduling backends (Acuity) can only persist payment metadata as a
 * freeform string (the appointment notes field), so the production wire
 * format is a human-readable marker:
 *
 *   `[PROCESSOR] Transaction: <transactionId>`
 *
 * That format is already deployed in stored production bookings and MUST NOT
 * change. What this module changes is ownership: formatting and parsing live
 * in one tested codec instead of scattered string templates and regexes
 * (previously `src/adapters/acuity.ts` and `src/core/pipelines.ts` each had
 * their own half of the contract).
 *
 * Encoding rules:
 * - `formatPaymentRef` is byte-identical to the legacy template
 *   `` `[${processor.toUpperCase()}] Transaction: ${transactionId}` ``.
 * - `parsePaymentRef` accepts every string the legacy pipeline regexes
 *   (`/\[(\w+)\]/` and `/Transaction:\s*(\S+)/`, first match each) accepted,
 *   including markers embedded in surrounding note text, and returns a typed
 *   `ValidationError` instead of silently yielding `undefined` halves.
 *
 * Round-trip guarantee: `parse(format(x))` deep-equals `x` for every
 * `PaymentReference` whose `processor` matches `/^[a-z0-9_]+$/` (canonical
 * lowercase form) and whose `transactionId` matches `/^\S+$/`. Outside that
 * domain (e.g. the hyphenated `venmo-direct` manual method) the wire string
 * is still produced exactly as the legacy template did, but it is not
 * machine-recoverable — same as before this codec existed.
 */

import { Effect } from 'effect';
import type { ValidationError } from './types.js';
import { Errors } from './types.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Canonical (lowercase) payment processor identifier.
 *
 * This is intentionally an open string, not a closed union: processors are
 * keyed by `PaymentAdapter.name`, which consuming sites choose at
 * registration time. The codec uppercases on encode and lowercases on decode.
 */
export type PaymentProcessor = string;

/**
 * Structured payment reference — the typed form of the
 * `[PROCESSOR] Transaction: <id>` wire string.
 */
export interface PaymentReference {
  readonly processor: PaymentProcessor;
  readonly transactionId: string;
}

// =============================================================================
// WIRE PATTERNS
// =============================================================================

/**
 * The intact canonical marker, wherever it sits inside surrounding note text
 * (Acuity prepends client notes; refund annotations may follow).
 */
const CANONICAL_MARKER = /\[(\w+)\]\s*Transaction:\s*(\S+)/;

/** Legacy independent scans — exactly what cancelBookingWithRefund used. */
const LEGACY_PROCESSOR = /\[(\w+)\]/;
const LEGACY_TRANSACTION = /Transaction:\s*(\S+)/;

// =============================================================================
// CODEC
// =============================================================================

/**
 * Encode a payment reference into the production wire format.
 *
 * Byte-identical to the legacy template, so newly written strings are
 * indistinguishable from existing stored ones.
 */
export const formatPaymentRef = (ref: PaymentReference): string =>
  `[${ref.processor.toUpperCase()}] Transaction: ${ref.transactionId}`;

/**
 * Decode a payment reference from the production wire format.
 *
 * Resolution order:
 * 1. First intact canonical marker (`[PROC] Transaction: id`). This is what
 *    every writer produces, and preferring it makes parsing robust against
 *    stray `[brackets]` or `Transaction:` text appearing earlier in
 *    client-authored notes (the legacy regexes would have matched those
 *    fragments instead and silently mis-resolved).
 * 2. Legacy fallback: first `/\[(\w+)\]/` + first `/Transaction:\s*(\S+)/`
 *    independently, preserving compatibility with every stored string the
 *    old pipeline could extract.
 *
 * Failures are typed `ValidationError`s (`field: 'paymentRef'`) rather than
 * the legacy behavior of silently producing `undefined` halves. A
 * `ValidationError` is used (not `PaymentError`) because the failure is about
 * the shape of a stored value, and `PaymentError` requires the `processor`
 * field — exactly the datum a parse failure could not determine.
 */
export const parsePaymentRef = (
  raw: string | undefined | null
): Effect.Effect<PaymentReference, ValidationError> => {
  if (!raw) {
    return Effect.fail(
      Errors.validation('paymentRef', 'Payment reference is missing or empty', raw ?? undefined)
    );
  }

  const canonical = CANONICAL_MARKER.exec(raw);
  if (canonical) {
    return Effect.succeed({
      processor: canonical[1].toLowerCase(),
      transactionId: canonical[2],
    });
  }

  const processor = LEGACY_PROCESSOR.exec(raw)?.[1]?.toLowerCase();
  const transactionId = LEGACY_TRANSACTION.exec(raw)?.[1];

  if (processor && transactionId) {
    return Effect.succeed({ processor, transactionId });
  }

  const missing =
    !processor && !transactionId
      ? 'no [PROCESSOR] marker or transaction id'
      : !processor
        ? 'no [PROCESSOR] marker'
        : 'no transaction id';

  return Effect.fail(
    Errors.validation(
      'paymentRef',
      `Unparseable payment reference (${missing}); expected '[PROCESSOR] Transaction: <id>'`,
      raw
    )
  );
};
