import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  BadGatewayException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { CefrLevel } from '@prisma/client';
import { PrismaService } from '../../shared/services/prisma.service';
import { TokenService } from './token.service';
import { TokenCryptoService } from './token-crypto.service';
import { EmailService } from './email.service';
import { Student } from '../../shared/interfaces/student.interface';
import { DeviceSession } from '../../shared/interfaces/device-session.interface';
import { AuthTokenResponse } from './dto/auth-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { VerifyEmailRequestDto } from './dto/verify-email-request.dto';
import { ValkeyService } from '../../shared/services/valkey.service';
import {
  StudentEntitlementService,
  type StudentEntitlement,
} from '../../shared/services/student-entitlement.service';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Sessions a student may hold at once (D21, changed to 1 on 2026-09-18).
 *
 * One, so that sharing an account means signing each other out — the
 * deterrent. The accepted cost is that a student who moves between the phone
 * and the web app signs in again each time. The per-student AI quota still
 * caps whatever sharing remains.
 */
const MAX_ACTIVE_STUDENT_DEVICES = 1;
const PASSWORD_RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 2 * 60 * 1000;

type VerificationStudentRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_verified: boolean;
  email_verification_expires: Date | null;
  password_hash?: string | null;
  password_reset_expires?: Date | null;
};

type AuthStudentRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly emailService: EmailService,
    // Required, not optional. Optional injection would let a wiring mistake
    // drop subscription reporting from every response with no error anywhere
    // — the field would simply stop appearing, and nothing would say so.
    private readonly entitlementService: StudentEntitlementService,
    @Optional() private readonly valkeyService?: ValkeyService,
  ) {}

  /**
   * Reads the student's entitlement for reporting, never for enforcement.
   *
   * Failure is swallowed on purpose. This field exists so a client can explain
   * itself before its first learning call; refusing a valid sign-in because a
   * subscription row could not be read would trade a working login for a
   * cosmetic detail. StudentSubscriptionGuard is what actually refuses access,
   * and it answers a read failure with 503 rather than letting it pass.
   */
  private async readEntitlement(
    studentId: string,
  ): Promise<StudentEntitlement | undefined> {
    try {
      return await this.entitlementService.forStudent(studentId);
    } catch (error) {
      this.logger.warn(
        `could not read entitlement for ${studentId}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * Create device session
   * Creates a new device session for a student
   * Stores the hashed refresh token for validation
   */
  async createDeviceSession(
    studentId: string,
    deviceId: string,
    refreshTokenHash: string,
    deviceName?: string,
  ): Promise<DeviceSession> {
    return this.upsertDeviceSession(
      studentId,
      deviceId,
      refreshTokenHash,
      deviceName,
    );
  }

  async register(dto: RegisterRequestDto): Promise<{ message: string }> {
    const existingStudent = (await this.prisma.student.findUnique({
      where: { email: dto.email },
    })) as VerificationStudentRecord | null;

    if (existingStudent?.email_verified) {
      return { message: 'verification email sent' };
    }

    const rawToken = this.tokenCrypto.generateToken();
    const tokenHash = this.tokenCrypto.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

    if (existingStudent) {
      if (
        existingStudent.email_verification_expires &&
        this.wasVerificationSentRecently(
          existingStudent.email_verification_expires,
        )
      ) {
        return { message: 'verification email sent' };
      }

      // Only the verification token is refreshed. dto.password, dto.firstName
      // and dto.lastName are deliberately discarded.
      //
      // Nobody has proven they own this address yet, so anyone who knows it can
      // reach this branch. Writing the caller's credentials here is the account
      // pre-hijacking pattern (USENIX Security '22, Sudhodanan/Paverd; cf.
      // MantisBT CVE-2024-34077): an attacker re-registers a victim's
      // unverified address, the victim clicks the verification link that lands
      // in their own inbox, and the attacker's password is now the account
      // password. The published mitigation is to allow no action on an
      // unverified identifier, which is what this does.
      //
      // The cost is that a genuine returning user does not get the new password
      // they just typed — so the email below explains that and points them at
      // password reset. Enforced by a test in auth.service.spec.ts.
      await this.prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id: existingStudent.id },
          data: {
            email_verification_token: tokenHash,
            email_verification_expires: expiresAt,
          },
        });

        try {
          await this.emailService.sendExistingAccountVerificationEmail(
            dto.email,
            rawToken,
          );
        } catch {
          throw new BadGatewayException('EMAIL_DELIVERY_FAILED');
        }
      });

      return { message: 'verification email sent' };
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.student.create({
        data: {
          first_name: dto.firstName,
          last_name: dto.lastName,
          email: dto.email,
          level: dto.level ?? null,
          password_hash: passwordHash,
          email_verified: false,
          email_verification_token: tokenHash,
          email_verification_expires: expiresAt,
        },
      });

      try {
        await this.emailService.sendVerificationEmail(dto.email, rawToken);
      } catch {
        throw new BadGatewayException('EMAIL_DELIVERY_FAILED');
      }
    });

    return { message: 'verification email sent' };
  }

  async login(dto: LoginRequestDto): Promise<AuthTokenResponse> {
    const student = (await this.prisma.student.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        password_hash: true,
        email_verified: true,
        email_verification_token: true,
        email_verification_expires: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    })) as VerificationStudentRecord | null;

    if (!student) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const isValid = student.password_hash
      ? await bcrypt.compare(dto.password, student.password_hash)
      : false;

    if (!isValid) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    if (!student.email_verified) {
      if (
        student.email_verification_expires &&
        this.wasVerificationSentRecently(student.email_verification_expires)
      ) {
        throw new ForbiddenException({
          error: 'EMAIL_NOT_VERIFIED',
          verified: false,
          message: 'Please verify your email to continue.',
        });
      }

      const rawToken = this.tokenCrypto.generateToken();
      const tokenHash = this.tokenCrypto.hashToken(rawToken);
      const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

      await this.prisma.student.update({
        where: { id: student.id },
        data: {
          email_verification_token: tokenHash,
          email_verification_expires: expiresAt,
        },
      });

      this.emailService
        .sendVerificationEmail(student.email ?? '', rawToken)
        .catch((err: Error) =>
          this.logger.warn(
            `login: verification email delivery failed for ${student.email}: ${err.message}`,
          ),
        );

      throw new ForbiddenException({
        error: 'EMAIL_NOT_VERIFIED',
        verified: false,
        message: 'Please verify your email to continue.',
      });
    }

    return this.issueAuthResponse(student, dto.deviceId, dto.deviceName);
  }

  async verifyEmail(dto: VerifyEmailRequestDto): Promise<AuthTokenResponse> {
    const tokenHash = this.tokenCrypto.hashToken(dto.token);
    const student = (await this.prisma.student.findFirst({
      where: { email_verification_token: tokenHash },
    })) as VerificationStudentRecord | null;

    if (!student) {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    if (
      student.email_verification_expires &&
      this.tokenCrypto.isExpired(student.email_verification_expires)
    ) {
      throw new BadRequestException('VERIFICATION_TOKEN_EXPIRED');
    }

    if (!student.email_verified) {
      const updatedStudent = await this.prisma.student.update({
        where: { id: student.id },
        data: { email_verified: true },
      });

      return this.issueAuthResponse(
        updatedStudent,
        dto.deviceId,
        dto.deviceName,
      );
    }

    return this.issueAuthResponse(student, dto.deviceId, dto.deviceName);
  }

  async verifyEmailPublic(token: string): Promise<{ verified: true }> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    const tokenHash = this.tokenCrypto.hashToken(token);
    const student = (await this.prisma.student.findFirst({
      where: { email_verification_token: tokenHash },
    })) as VerificationStudentRecord | null;

    if (!student) {
      throw new BadRequestException('VERIFICATION_TOKEN_INVALID');
    }

    if (
      student.email_verification_expires &&
      this.tokenCrypto.isExpired(student.email_verification_expires)
    ) {
      throw new BadRequestException('VERIFICATION_TOKEN_EXPIRED');
    }

    if (!student.email_verified) {
      await this.prisma.student.update({
        where: { id: student.id },
        data: { email_verified: true },
      });
    }

    return { verified: true };
  }

  async forgotPassword(
    dto: import('./dto/forgot-password-request.dto').ForgotPasswordRequestDto,
  ): Promise<{ message: string }> {
    const GENERIC_RESPONSE = {
      message: 'If that email exists, a reset link was sent.',
    };

    const student = await this.prisma.student.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (!student) return GENERIC_RESPONSE;

    const rawCode = this.tokenCrypto.generateNumericCode(6);
    const tokenHash = this.tokenCrypto.hashToken(rawCode);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

    await this.prisma.student.update({
      where: { id: student.id },
      data: {
        password_reset_token: tokenHash,
        password_reset_expires: expiresAt,
      },
    });

    try {
      await this.emailService.sendPasswordResetEmail(dto.email, rawCode);
    } catch (err) {
      this.logger.warn(
        `forgotPassword: email delivery failed for ${dto.email}: ${(err as Error).message}`,
      );
    }

    return GENERIC_RESPONSE;
  }

  async resetPassword(
    dto: import('./dto/reset-password-request.dto').ResetPasswordRequestDto,
  ): Promise<AuthTokenResponse> {
    const tokenHash = this.tokenCrypto.hashToken(dto.token);
    const student = (await this.prisma.student.findFirst({
      where: { password_reset_token: tokenHash },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        password_reset_expires: true,
      } as any,
    })) as VerificationStudentRecord | null;

    if (!student) throw new BadRequestException('RESET_TOKEN_INVALID');

    if (
      student.password_reset_expires &&
      this.tokenCrypto.isExpired(student.password_reset_expires)
    ) {
      throw new BadRequestException('RESET_TOKEN_EXPIRED');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    const sessionsToRevoke = await this.prisma.deviceSession.findMany({
      where: { student_id: student.id, revoked_at: null },
      select: { id: true },
    });

    // rotate password and remove tokens, revoke sessions, then issue a session
    await this.prisma.$transaction(async (tx) => {
      await tx.deviceSession.deleteMany({ where: { student_id: student.id } });
      await tx.student.update({
        where: { id: student.id },
        data: {
          password_hash: passwordHash,
          password_reset_token: null,
          password_reset_expires: null,
        },
      });
    });

    const valkeyService = this.valkeyService;
    if (valkeyService) {
      await Promise.all(
        sessionsToRevoke.map(({ id }) => valkeyService.revokeSession(id)),
      );
    }

    // issue tokens for the provided device
    return this.issueAuthResponse(student, dto.deviceId, dto.deviceName);
  }

  /**
   * Upsert device session
   * Ensures a maximum of 3 active sessions by evicting the oldest session
   * for new devices, then upserts by student_id + device_id in one transaction.
   */
  async upsertDeviceSession(
    studentId: string,
    deviceId: string,
    refreshTokenHash: string,
    deviceName?: string,
  ): Promise<DeviceSession> {
    if (!studentId?.trim() || !deviceId?.trim() || !refreshTokenHash?.trim()) {
      throw new BadRequestException('MISSING_REQUIRED_FIELDS');
    }

    // Filled inside the transaction, acted on after it: the Valkey mark is
    // not part of the database write, and must not run if that write rolls
    // back.
    let evictedSessionIds: string[] = [];

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const existingSession = await tx.deviceSession.findFirst({
          where: {
            student_id: studentId,
            device_id: deviceId,
            revoked_at: null,
          },
          select: { id: true },
        });

        const activeCount = await tx.deviceSession.count({
          where: { student_id: studentId, revoked_at: null },
        });

        // A new device beyond the limit is let in, never refused: without a
        // "my devices" screen a refusal would leave the student no way
        // forward. It signs out the sessions used longest ago — as many as it
        // takes to get back under the limit, because a student who signed in
        // under the older, larger limit may still hold several.
        if (!existingSession && activeCount >= MAX_ACTIVE_STUDENT_DEVICES) {
          const evicted = await tx.deviceSession.findMany({
            where: { student_id: studentId, revoked_at: null },
            orderBy: [{ last_used_at: 'asc' }, { created_at: 'asc' }],
            take: activeCount - MAX_ACTIVE_STUDENT_DEVICES + 1,
            select: { id: true },
          });

          if (evicted.length > 0) {
            evictedSessionIds = evicted.map(({ id }) => id);
            // Revoked, not deleted: the old device's refresh then finds its
            // session and answers SESSION_REVOKED, which is how the app knows
            // to say "you signed in on another device". A deleted row reads
            // as INVALID_SESSION, indistinguishable from a broken token.
            await tx.deviceSession.updateMany({
              where: { id: { in: evictedSessionIds }, revoked_at: null },
              data: { revoked_at: new Date() },
            });
          }
        }

        const upsertedSession = await tx.deviceSession.upsert({
          where: {
            student_id_device_id: {
              student_id: studentId,
              device_id: deviceId,
            },
          },
          update: {
            device_name: deviceName?.trim() || null,
            refresh_token_hash: refreshTokenHash,
            revoked_at: null,
            last_used_at: new Date(),
          },
          create: {
            student_id: studentId,
            device_id: deviceId,
            device_name: deviceName?.trim() || null,
            refresh_token_hash: refreshTokenHash,
          },
        });

        return upsertedSession as unknown as DeviceSession;
      });

      // Production runs without Valkey: the guard then reads the database,
      // finds the evicted row revoked, and the old device is signed out on its
      // next request. If Valkey is running, the guard trusts it and skips the
      // database — so the evicted sessions are marked there too, and the rule
      // holds either way. Best effort: a failed mark is the cache's problem,
      // not the login's.
      if (this.valkeyService && evictedSessionIds.length > 0) {
        const valkey = this.valkeyService;
        await Promise.all(
          evictedSessionIds.map((id) => valkey.revokeSession(id)),
        );
      }

      return session;
    } catch (error) {
      throw new BadRequestException('DEVICE_SESSION_CREATION_FAILED');
    }
  }

  private wasVerificationSentRecently(expiresAt: Date): boolean {
    const sentAt = expiresAt.getTime() - VERIFICATION_TOKEN_TTL_MS;
    return Date.now() - sentAt < VERIFICATION_RESEND_COOLDOWN_MS;
  }

  private async issueAuthResponse(
    student: AuthStudentRecord,
    deviceId: string,
    deviceName?: string,
  ): Promise<AuthTokenResponse> {
    const tokens = await this.issueTokenPairForDevice(
      student.id,
      deviceId,
      deviceName,
    );

    await this.updateStudentLastSeen(student.id);

    const subscription = await this.readEntitlement(student.id);

    return {
      ...tokens,
      student: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        email: student.email ?? '',
        emailVerified: true,
      },
      ...(subscription ? { subscription } : {}),
    };
  }

  /**
   * Issues a normal student session for an account that already exists.
   *
   * Used by center-managed activation, where the account was created by a
   * center and the student has just set their own password. Deliberately a
   * thin public door onto the existing private path, so an activated student
   * gets byte-for-byte the same session shape as a registered one.
   */
  async issueSessionForStudent(
    studentId: string,
    deviceId: string,
    deviceName?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.issueTokenPairForDevice(studentId, deviceId, deviceName);
  }

  private async issueTokenPairForDevice(
    studentId: string,
    deviceId: string,
    deviceName?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const provisionalToken = this.tokenCrypto.generateToken();
    const provisionalHash = this.tokenCrypto.hashToken(provisionalToken);

    const session = await this.upsertDeviceSession(
      studentId,
      deviceId,
      provisionalHash,
      deviceName,
    );

    const tokens = this.tokenService.generateTokenPair({
      studentId,
      deviceId,
      sessionId: session.id,
    });

    const refreshHash = await this.tokenService.hashRefreshToken(
      tokens.refreshToken,
    );
    await this.updateDeviceSessionRefreshHash(session.id, refreshHash);

    return tokens;
  }

  /**
   * Validate refresh token
   * Validates that a device session exists and is not revoked
   * Updates the last_used_at timestamp
   */
  async validateRefreshToken(
    sessionId: string,
    studentId: string,
  ): Promise<DeviceSession> {
    if (!sessionId?.trim() || !studentId?.trim()) {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    try {
      const session = await this.prisma.deviceSession.findFirst({
        where: { id: sessionId, student_id: studentId },
      });

      if (!session) {
        throw new UnauthorizedException('INVALID_SESSION');
      }

      if (session.revoked_at !== null) {
        throw new UnauthorizedException('SESSION_REVOKED');
      }

      await this.prisma.deviceSession.update({
        where: { id: sessionId },
        data: { last_used_at: new Date() },
      });

      return session as unknown as DeviceSession;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('INVALID_SESSION');
    }
  }

  /**
   * Fetch a student by id
   */
  async getStudentById(studentId: string): Promise<Student> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });

    if (!student) {
      throw new BadRequestException('STUDENT_NOT_FOUND');
    }

    return student as unknown as Student;
  }

  /**
   * Update student profile details
   */
  async updateStudentProfile(
    studentId: string,
    updates: {
      firstName?: string;
      lastName?: string;
      email?: string;
      level?: CefrLevel;
    },
  ): Promise<Student> {
    const data: {
      first_name?: string;
      last_name?: string;
      email?: string;
      level?: CefrLevel;
      updated_at: Date;
    } = { updated_at: new Date() };

    if (updates.firstName?.trim()) data.first_name = updates.firstName.trim();
    if (updates.lastName?.trim()) data.last_name = updates.lastName.trim();
    if (updates.email?.trim()) data.email = updates.email.trim().toLowerCase();
    if (updates.level) data.level = updates.level;

    try {
      const student = await this.prisma.student.update({
        where: { id: studentId },
        data,
      });
      return student as unknown as Student;
    } catch {
      throw new BadRequestException('PROFILE_UPDATE_FAILED');
    }
  }

  /**
   * Update a device session refresh token hash
   */
  async updateDeviceSessionRefreshHash(
    sessionId: string,
    refreshTokenHash: string,
  ): Promise<void> {
    try {
      await this.prisma.deviceSession.update({
        where: { id: sessionId },
        data: {
          refresh_token_hash: refreshTokenHash,
          last_used_at: new Date(),
        },
      });
    } catch {
      throw new BadRequestException('SESSION_UPDATE_FAILED');
    }
  }

  /**
   * Atomically rotate a refresh-token hash. Only the request that validated
   * the currently stored hash can update it; concurrent requests lose safely.
   */
  async rotateDeviceSessionRefreshHash(
    sessionId: string,
    expectedRefreshTokenHash: string,
    newRefreshTokenHash: string,
  ): Promise<boolean> {
    const result = await this.prisma.deviceSession.updateMany({
      where: {
        id: sessionId,
        refresh_token_hash: expectedRefreshTokenHash,
        revoked_at: null,
      },
      data: {
        refresh_token_hash: newRefreshTokenHash,
        last_used_at: new Date(),
      },
    });
    return result.count === 1;
  }

  /**
   * Revoke a device session
   */
  async revokeDeviceSession(sessionId: string): Promise<void> {
    try {
      await this.prisma.deviceSession.update({
        where: { id: sessionId },
        data: { revoked_at: new Date() },
      });
      await this.valkeyService?.revokeSession(sessionId);
    } catch {
      throw new BadRequestException('SESSION_REVOKE_FAILED');
    }
  }

  async revokeStudentDeviceSession(
    studentId: string,
    sessionId: string,
  ): Promise<void> {
    const result = await this.prisma.deviceSession.updateMany({
      where: { id: sessionId, student_id: studentId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    if (result.count !== 1) {
      throw new UnauthorizedException('INVALID_SESSION');
    }
    await this.valkeyService?.revokeSession(sessionId);
  }

  async updateStudentLastSeen(studentId: string): Promise<void> {
    await this.prisma.student.update({
      where: { id: studentId },
      data: { last_seen_at: new Date() },
    });
  }

  async getDeviceSessions(studentId: string): Promise<
    {
      id: string;
      device_id: string;
      device_name: string | null;
      last_used_at: Date;
      created_at: Date;
    }[]
  > {
    return this.prisma.deviceSession.findMany({
      where: { student_id: studentId, revoked_at: null },
      orderBy: { last_used_at: 'desc' },
      select: {
        id: true,
        device_id: true,
        device_name: true,
        last_used_at: true,
        created_at: true,
      },
    }) as any;
  }

  /**
   * Get active device session for a student and device
   * Used when rotating tokens without creating new session
   */
  async getActiveDeviceSession(
    studentId: string,
    deviceId: string,
  ): Promise<DeviceSession> {
    const session = await this.prisma.deviceSession.findFirst({
      where: { student_id: studentId, device_id: deviceId, revoked_at: null },
      orderBy: { created_at: 'desc' },
    });

    if (!session) {
      throw new UnauthorizedException('NO_ACTIVE_SESSION');
    }

    return session as unknown as DeviceSession;
  }
}
