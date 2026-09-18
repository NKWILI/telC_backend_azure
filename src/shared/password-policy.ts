/**
 * The one password rule, for everyone who sets one.
 *
 * Centers and students, on registration, on reset and on a change from inside
 * the app. Three places used to check three different things — the API asked
 * for eight characters, the marketing site asked for six with a symbol, and
 * the settings page asked for eight — which meant a password accepted by one
 * form was refused by the next.
 *
 * Checked only where a password is SET, never at login. Tightening a rule must
 * not lock out an account whose password was legal when it was chosen; such an
 * account keeps working until its owner changes it.
 */

export const MIN_PASSWORD_LENGTH = 8;

/**
 * bcrypt silently truncates its input at 72 bytes, so anything longer is a
 * password whose tail does nothing — and the person believes it counts.
 * Refusing is honest; accepting is a lie about how strong their password is.
 */
export const MAX_PASSWORD_BYTES = 72;

export type PasswordRefusalCode =
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_NEEDS_UPPERCASE'
  | 'PASSWORD_NEEDS_DIGIT'
  | 'PASSWORD_NEEDS_SPECIAL';

/**
 * Says what is wrong with a password, or null when nothing is.
 *
 * Returns rather than throws, so a caller decides the HTTP shape and a client
 * asking "would this be accepted" is not an error path. One rule at a time, in
 * the order a person fixes them: length first, because it is the one that
 * matters most.
 */
export function checkPassword(value: string): PasswordRefusalCode | null {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return 'PASSWORD_TOO_SHORT';
  }

  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    return 'PASSWORD_TOO_LONG';
  }

  if (!/[A-Z]/.test(value)) {
    return 'PASSWORD_NEEDS_UPPERCASE';
  }

  if (!/[0-9]/.test(value)) {
    return 'PASSWORD_NEEDS_DIGIT';
  }

  // Anything that is not a letter, a digit or a space. Deliberately broad: a
  // list of "allowed symbols" only teaches people to pick from it.
  if (!/[^A-Za-z0-9\s]/.test(value)) {
    return 'PASSWORD_NEEDS_SPECIAL';
  }

  return null;
}
