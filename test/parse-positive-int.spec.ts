import { parsePositiveInt } from '../src/shared/utils/parse-positive-int';

describe('parsePositiveInt', () => {
  it('parses a valid positive integer string', () => {
    expect(parsePositiveInt('10', 5)).toBe(10);
    expect(parsePositiveInt('1', 5)).toBe(1);
  });

  it('falls back when the value is undefined', () => {
    expect(parsePositiveInt(undefined, 5)).toBe(5);
  });

  it('falls back on an empty string', () => {
    expect(parsePositiveInt('', 5)).toBe(5);
  });

  it('falls back on a non-numeric string', () => {
    expect(parsePositiveInt('abc', 5)).toBe(5);
  });

  it('falls back on zero (not a positive integer)', () => {
    expect(parsePositiveInt('0', 5)).toBe(5);
  });

  it('falls back on a negative value', () => {
    expect(parsePositiveInt('-3', 5)).toBe(5);
  });

  it('truncates a decimal to its integer part when positive', () => {
    expect(parsePositiveInt('7.9', 5)).toBe(7);
  });

  it('falls back on whitespace-only input', () => {
    expect(parsePositiveInt('   ', 5)).toBe(5);
  });
});
