import { TokenCryptoService } from '../src/modules/auth/token-crypto.service';

describe('TokenCryptoService', () => {
  let service: TokenCryptoService;

  beforeAll(() => {
    process.env.TOKEN_HMAC_SECRET =
      'test-hmac-secret-that-is-long-and-secure-for-unit-tests-1234567890';
  });

  beforeEach(() => {
    const configService = {
      getOrThrow: (key: string) => {
        const value = process.env[key];
        if (!value) {
          throw new Error(`Missing env var: ${key}`);
        }
        return value;
      },
    };

    service = new TokenCryptoService(configService as any);
  });

  describe('generateToken', () => {
    it('returns a random 64-character hex token', () => {
      const token = service.generateToken();

      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns a different token on each call', () => {
      const tokenA = service.generateToken();
      const tokenB = service.generateToken();

      expect(tokenA).not.toBe(tokenB);
    });
  });

  describe('hashToken', () => {
    it('returns deterministic hash for same input', () => {
      const input = 'same-input-token';

      expect(service.hashToken(input)).toBe(service.hashToken(input));
    });

    it('returns different hashes for different inputs', () => {
      const hashA = service.hashToken('input-a');
      const hashB = service.hashToken('input-b');

      expect(hashA).not.toBe(hashB);
    });
  });

  describe('generateNumericCode', () => {
    it('returns a string of the requested length', () => {
      const code = service.generateNumericCode(6);

      expect(code).toHaveLength(6);
    });

    it('returns only digits 0-9', () => {
      for (let i = 0; i < 50; i++) {
        const code = service.generateNumericCode(6);
        expect(code).toMatch(/^\d{6}$/);
      }
    });

    it('preserves leading zeros (always 6 chars even for small ints)', () => {
      // Run many iterations; with 1M possible values, at least one
      // out of 200 attempts should land below 100_000 (10% prob each).
      let sawLeadingZero = false;
      for (let i = 0; i < 200; i++) {
        if (service.generateNumericCode(6).startsWith('0')) {
          sawLeadingZero = true;
          break;
        }
      }
      expect(sawLeadingZero).toBe(true);
    });

    it('returns different values across calls', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        codes.add(service.generateNumericCode(6));
      }
      // 20 codes from a 1M space — collisions effectively impossible
      expect(codes.size).toBe(20);
    });

    it('supports custom length', () => {
      expect(service.generateNumericCode(4)).toMatch(/^\d{4}$/);
      expect(service.generateNumericCode(8)).toMatch(/^\d{8}$/);
    });
  });

  describe('isExpired', () => {
    it('returns true for a past date', () => {
      const past = new Date(Date.now() - 1_000);

      expect(service.isExpired(past)).toBe(true);
    });

    it('returns false for a future date', () => {
      const future = new Date(Date.now() + 60_000);

      expect(service.isExpired(future)).toBe(false);
    });
  });
});