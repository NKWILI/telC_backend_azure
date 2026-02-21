import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../src/modules/auth/token.service';

describe('TokenService', () => {
  let tokenService: TokenService;

  beforeAll(() => {
    // Set env vars for testing
    process.env.JWT_SECRET =
      'test-secret-key-that-is-long-enough-for-testing-purposes-1234567890';
    process.env.JWT_ACCESS_TOKEN_EXPIRY = '1h';
    process.env.JWT_REFRESH_TOKEN_EXPIRY = '30d';
  });

  beforeEach(() => {
    tokenService = new TokenService();
  });

  // ─── Access Token Tests ──────────────────────────────

  describe('generateAccessToken', () => {
    it('should generate a valid JWT string', () => {
      const token = tokenService.generateAccessToken({
        studentId: 'student-123',
        isRegistered: false,
        deviceId: 'device-456',
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include correct payload claims', () => {
      const token = tokenService.generateAccessToken({
        studentId: 'student-123',
        isRegistered: true,
        deviceId: 'device-456',
      });

      const decoded = tokenService.verifyAccessToken(token);
      expect(decoded.studentId).toBe('student-123');
      expect(decoded.isRegistered).toBe(true);
      expect(decoded.deviceId).toBe('device-456');
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify and decode a valid token', () => {
      const token = tokenService.generateAccessToken({
        studentId: 'student-123',
        isRegistered: false,
        deviceId: 'device-456',
      });

      const decoded = tokenService.verifyAccessToken(token);
      expect(decoded.studentId).toBe('student-123');
      expect(decoded.isRegistered).toBe(false);
      expect(decoded.deviceId).toBe('device-456');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should reject a token with tampered signature', () => {
      const token = tokenService.generateAccessToken({
        studentId: 'student-123',
        isRegistered: false,
        deviceId: 'device-456',
      });

      // Tamper with the signature (last part of JWT)
      const tampered = token.slice(0, -5) + 'XXXXX';

      expect(() => tokenService.verifyAccessToken(tampered)).toThrow(
        UnauthorizedException,
      );
    });

    it('should reject a token signed with wrong secret', () => {
      const jwt = require('jsonwebtoken');
      const wrongToken = jwt.sign(
        {
          studentId: 'student-123',
          isRegistered: false,
          deviceId: 'device-456',
        },
        'wrong-secret-key',
        { expiresIn: '1h' },
      );

      expect(() => tokenService.verifyAccessToken(wrongToken)).toThrow(
        UnauthorizedException,
      );
    });

    it('should reject an expired token', () => {
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        {
          studentId: 'student-123',
          isRegistered: false,
          deviceId: 'device-456',
        },
        process.env.JWT_SECRET,
        { expiresIn: '0s' }, // Immediately expired
      );

      // Small delay to ensure expiry
      expect(() => tokenService.verifyAccessToken(expiredToken)).toThrow(
        UnauthorizedException,
      );
    });

    it('should reject a malformed token', () => {
      expect(() => tokenService.verifyAccessToken('not-a-jwt')).toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── Refresh Token Tests ─────────────────────────────

  describe('generateRefreshToken', () => {
    it('should generate a valid JWT string', () => {
      const token = tokenService.generateRefreshToken({
        studentId: 'student-123',
        deviceId: 'device-456',
        sessionId: 'session-789',
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include correct payload claims', () => {
      const token = tokenService.generateRefreshToken({
        studentId: 'student-123',
        deviceId: 'device-456',
        sessionId: 'session-789',
      });

      const decoded = tokenService.verifyRefreshToken(token);
      expect(decoded.studentId).toBe('student-123');
      expect(decoded.deviceId).toBe('device-456');
      expect(decoded.sessionId).toBe('session-789');
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify and decode a valid refresh token', () => {
      const token = tokenService.generateRefreshToken({
        studentId: 'student-123',
        deviceId: 'device-456',
        sessionId: 'session-789',
      });

      const decoded = tokenService.verifyRefreshToken(token);
      expect(decoded.studentId).toBe('student-123');
      expect(decoded.deviceId).toBe('device-456');
      expect(decoded.sessionId).toBe('session-789');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should reject a tampered refresh token', () => {
      const token = tokenService.generateRefreshToken({
        studentId: 'student-123',
        deviceId: 'device-456',
        sessionId: 'session-789',
      });

      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(() => tokenService.verifyRefreshToken(tampered)).toThrow(
        UnauthorizedException,
      );
    });

    it('should reject refresh token signed with wrong secret', () => {
      const jwt = require('jsonwebtoken');
      const wrongToken = jwt.sign(
        {
          studentId: 'student-123',
          deviceId: 'device-456',
          sessionId: 'session-789',
        },
        'wrong-secret',
        { expiresIn: '30d' },
      );

      expect(() => tokenService.verifyRefreshToken(wrongToken)).toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── Token Pair Tests ────────────────────────────────

  describe('generateTokenPair', () => {
    it('should generate both access and refresh tokens', () => {
      const tokens = tokenService.generateTokenPair({
        studentId: 'student-123',
        isRegistered: false,
        deviceId: 'device-456',
        sessionId: 'session-789',
      });

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.accessToken).not.toBe(tokens.refreshToken);
    });

    it('should generate tokens with consistent claims', () => {
      const tokens = tokenService.generateTokenPair({
        studentId: 'student-123',
        isRegistered: true,
        deviceId: 'device-456',
        sessionId: 'session-789',
      });

      const accessDecoded = tokenService.verifyAccessToken(tokens.accessToken);
      const refreshDecoded = tokenService.verifyRefreshToken(
        tokens.refreshToken,
      );

      expect(accessDecoded.studentId).toBe(refreshDecoded.studentId);
      expect(accessDecoded.deviceId).toBe(refreshDecoded.deviceId);
    });
  });

  // ─── Refresh Token Hashing Tests ─────────────────────

  describe('hashRefreshToken', () => {
    it('should produce a hash different from the input', async () => {
      const token = 'some-refresh-token';
      const hash = await tokenService.hashRefreshToken(token);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(token);
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await tokenService.hashRefreshToken('token-1');
      const hash2 = await tokenService.hashRefreshToken('token-2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('compareRefreshToken', () => {
    it('should return true for matching token and hash', async () => {
      const token = 'my-refresh-token';
      const hash = await tokenService.hashRefreshToken(token);
      const isMatch = await tokenService.compareRefreshToken(token, hash);

      expect(isMatch).toBe(true);
    });

    it('should return false for non-matching token and hash', async () => {
      const hash = await tokenService.hashRefreshToken('correct-token');
      const isMatch = await tokenService.compareRefreshToken(
        'wrong-token',
        hash,
      );

      expect(isMatch).toBe(false);
    });
  });
});
