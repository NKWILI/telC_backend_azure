import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  checkPassword,
} from '../src/shared/password-policy';

/**
 * One rule, wherever a password is set.
 *
 * Three forms used to ask for three different things — the API eight
 * characters, the marketing site six with a symbol, the settings page eight —
 * so a password accepted by one was refused by the next. This is the single
 * answer they all read.
 */
describe('checkPassword', () => {
  it('accepts a password that satisfies every rule', () => {
    expect(checkPassword('Lerniqo2027!')).toBeNull();
  });

  it('names the one thing that is wrong, not every rule at once', () => {
    expect(checkPassword('Short1!')).toBe('PASSWORD_TOO_SHORT');
    expect(checkPassword('lerniqo2027!')).toBe('PASSWORD_NEEDS_UPPERCASE');
    expect(checkPassword('LerniqoDouala!')).toBe('PASSWORD_NEEDS_DIGIT');
    expect(checkPassword('Lerniqo20271')).toBe('PASSWORD_NEEDS_SPECIAL');
  });

  it('refuses anything past what bcrypt actually hashes', () => {
    const tooLong = 'Aa1!' + 'x'.repeat(MAX_PASSWORD_BYTES);

    // bcrypt truncates at 72 bytes, so the tail would do nothing while the
    // person believed it counted. Refusing is honest; accepting is not.
    expect(checkPassword(tooLong)).toBe('PASSWORD_TOO_LONG');
  });

  it('counts bytes rather than characters, because bcrypt does', () => {
    // 18 four-byte characters plus the rest is well past 72 bytes while being
    // far short of 72 characters.
    const emoji = 'Aa1!' + '😀'.repeat(18);

    expect(emoji.length).toBeLessThan(MAX_PASSWORD_BYTES);
    expect(checkPassword(emoji)).toBe('PASSWORD_TOO_LONG');
  });

  it('accepts a long passphrase, which is the strongest thing people choose', () => {
    expect(checkPassword('Correct Horse Battery Staple 2027!')).toBeNull();
  });

  it('holds the boundary at the documented minimum', () => {
    const exact = 'Aa1!bcde';

    expect(exact).toHaveLength(MIN_PASSWORD_LENGTH);
    expect(checkPassword(exact)).toBeNull();
    expect(checkPassword(exact.slice(1))).toBe('PASSWORD_TOO_SHORT');
  });
});
