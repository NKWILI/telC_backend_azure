import {
  ACTIVATION_CODE_ALPHABET,
  ACTIVATION_CODE_PATTERN,
  generateActivationCode,
  normalizeActivationCode,
} from '../src/modules/centers/activation-code-format';

/**
 * The value a manager reads out loud and a student types.
 *
 * Everything here exists because of that sentence: no character that can be
 * misheard or miscopied, a shape that survives being written on paper, and a
 * comparison forgiving enough that a correct code is never rejected for its
 * punctuation.
 */
describe('generateActivationCode', () => {
  it('produces the documented shape', () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(generateActivationCode()).toMatch(ACTIVATION_CODE_PATTERN);
    }
  });

  it('avoids characters that are misread on paper or over the phone', () => {
    // 0/O, 1/I/L are the pairs people get wrong; U is dropped so no random
    // group can read as an offensive word.
    expect(ACTIVATION_CODE_ALPHABET).not.toMatch(/[01ILOU]/);
    expect(ACTIVATION_CODE_ALPHABET).toHaveLength(30);

    const body = Array.from({ length: 200 }, () =>
      generateActivationCode().slice(3).replace('-', ''),
    ).join('');

    expect(body).not.toMatch(/[01ILOU]/);
  });

  it('does not repeat itself, which is what the unique index is there for', () => {
    const codes = new Set(
      Array.from({ length: 500 }, () => generateActivationCode()),
    );

    // 30^8 is about 656 billion, so 500 draws colliding would mean the
    // generator is not random rather than that we were unlucky.
    expect(codes.size).toBe(500);
  });

  it('draws on the whole alphabet rather than a corner of it', () => {
    const used = new Set(
      Array.from({ length: 400 }, () =>
        generateActivationCode().slice(3).replace('-', ''),
      )
        .join('')
        .split(''),
    );

    expect(used.size).toBe(ACTIVATION_CODE_ALPHABET.length);
  });
});

describe('normalizeActivationCode', () => {
  it('accepts what a person actually types', () => {
    const code = 'LQ-7K2P-94QX';

    expect(normalizeActivationCode('  lq-7k2p-94qx  ')).toBe(code);
    expect(normalizeActivationCode('LQ7K2P94QX')).toBe(code);
    expect(normalizeActivationCode('lq 7k2p 94qx')).toBe(code);
  });

  it('returns null for anything that is not a code, rather than guessing', () => {
    expect(normalizeActivationCode('')).toBeNull();
    expect(normalizeActivationCode('LQ-7K2P')).toBeNull();
    expect(normalizeActivationCode('XX-7K2P-94QX')).toBeNull();
    // Look-alikes are not silently corrected: a code containing O or I was
    // never issued, and quietly turning it into 0 or 1 would send a student
    // to someone else's seat.
    expect(normalizeActivationCode('LQ-7K2O-94QX')).toBeNull();
  });
});
