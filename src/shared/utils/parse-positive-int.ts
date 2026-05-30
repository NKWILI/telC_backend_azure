/**
 * Parse an env-style string into a positive integer, falling back to a default
 * for undefined, empty, non-numeric, zero, or negative input.
 *
 * Plain `Number(x) || fallback` and `x ?? fallback` both mishandle cases that
 * matter here: `?? '5'` lets an empty string through to NaN, and `'abc' || '5'`
 * keeps the truthy 'abc' which then parses to NaN. Callers that feed the result
 * into something strict (e.g. p-limit, which throws on NaN/0) need this guard.
 */
export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}
