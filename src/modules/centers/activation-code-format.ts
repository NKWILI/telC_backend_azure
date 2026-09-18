import { randomInt } from 'crypto';

/**
 * The value a center reads out and a student types.
 *
 * Everything in this module follows from that: a code is spoken over the
 * phone, written on paper and forwarded on WhatsApp long before it is pasted,
 * so the cost of a character people get wrong is a support conversation, not a
 * validation error.
 */

/**
 * Digits 2–9 and the letters without the look-alikes.
 *
 * `0`/`O` and `1`/`I`/`L` are the pairs people mishear and miscopy. `U` is
 * dropped as well, following Crockford base32, so a random group cannot read
 * as an offensive word — and, conveniently, that leaves exactly 30 characters.
 */
export const ACTIVATION_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `LQ-XXXX-XXXX`, uppercase, dashes included in the stored value. */
export const ACTIVATION_CODE_PATTERN = /^LQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const GROUP_LENGTH = 4;
const GROUPS = 2;

/**
 * A fresh code.
 *
 * `randomInt` from `crypto`, never `Math.random`: the frontend's fake used the
 * latter, and a predictable generator turns a seat into something guessable
 * from codes a center has already handed out.
 *
 * Uniqueness is not attempted here. The database's unique index is the
 * authority, and a caller retries on the rare collision — a pre-check would be
 * a race dressed up as a guarantee.
 */
export function generateActivationCode(): string {
  const groups: string[] = [];

  for (let group = 0; group < GROUPS; group++) {
    let value = '';

    for (let position = 0; position < GROUP_LENGTH; position++) {
      value += ACTIVATION_CODE_ALPHABET.charAt(
        randomInt(ACTIVATION_CODE_ALPHABET.length),
      );
    }

    groups.push(value);
  }

  return `LQ-${groups.join('-')}`;
}

/**
 * What a person typed, turned into the stored form — or null when it is not a
 * code at all.
 *
 * Forgiving about case, spaces and dashes, because a student copying from
 * paper drops a dash or types in lower case and the code is still the one they
 * were given. Unforgiving about the alphabet: a code containing `O` or `I` was
 * never issued, and "helpfully" reading it as `0` or `1` could hand someone
 * another student's seat.
 */
export function normalizeActivationCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');

  if (!cleaned.startsWith('LQ')) {
    return null;
  }

  const body = cleaned.slice(2);

  if (body.length !== GROUP_LENGTH * GROUPS) {
    return null;
  }

  for (const character of body) {
    if (!ACTIVATION_CODE_ALPHABET.includes(character)) {
      return null;
    }
  }

  return `LQ-${body.slice(0, GROUP_LENGTH)}-${body.slice(GROUP_LENGTH)}`;
}
