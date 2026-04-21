import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service';
import { TokenService } from './token.service';
import { Student } from '../../shared/interfaces/student.interface';
import { DeviceSession } from '../../shared/interfaces/device-session.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Validate activation code and return associated student (if any).
   * - status 'available': first-time activation, returns null student
   * - status 'active': returning user, returns existing student
   * - any other status: throws
   */
  async validateActivationCode(
    code: string,
  ): Promise<{ student: Student | null; activationCodeId: string }> {
    if (!code || code.trim().length === 0) {
      throw new BadRequestException('INVALID_ACTIVATION_CODE');
    }

    try {
      const acData = await this.prisma.activationCode.findUnique({
        where: { code: code.trim() },
        select: { code: true, student_id: true, status: true, expires_at: true },
      });

      if (!acData) {
        throw new BadRequestException('INVALID_ACTIVATION_CODE');
      }

      if (acData.status === 'available') {
        return { student: null, activationCodeId: acData.code };
      }

      if (acData.status === 'active') {
        if (acData.expires_at && (acData.expires_at as Date) < new Date()) {
          throw new ForbiddenException('MEMBERSHIP_EXPIRED');
        }

        const student = await this.prisma.student.findUnique({
          where: { id: acData.student_id! },
        });

        if (!student) {
          throw new BadRequestException('STUDENT_NOT_FOUND');
        }

        return { student: student as unknown as Student, activationCodeId: acData.code };
      }

      throw new BadRequestException('ACTIVATION_CODE_ALREADY_USED');
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new BadRequestException('INVALID_ACTIVATION_CODE');
    }
  }

  /**
   * Activate a student account.
   * - First-time: creates student record, claims activation code (30-day expiry)
   * - Returning: throws if already registered
   * Always sets profile fields and is_registered = true.
   */
  async createStudent(
    activationCode: string,
    firstName: string,
    lastName: string,
    email: string,
  ): Promise<Student> {
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      throw new BadRequestException('MISSING_REQUIRED_FIELDS');
    }

    try {
      const { student, activationCodeId } =
        await this.validateActivationCode(activationCode);

      if (!student) {
        // First-time activation: create student, claim code
        const newStudent = await this.prisma.student.create({
          data: {
            activation_code: activationCode.trim(),
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            email: email.trim().toLowerCase(),
            is_registered: true,
          },
        });

        // Claim the activation code: set status, expiry, link student
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await this.prisma.activationCode.update({
          where: { code: activationCodeId },
          data: {
            status: 'active',
            claimed_at: new Date(),
            expires_at: expiresAt,
            student_id: newStudent.id,
          },
        });

        return newStudent as unknown as Student;
      }

      // Returning user — already registered
      if (student.is_registered) {
        throw new ConflictException('STUDENT_ALREADY_REGISTERED');
      }

      // Edge case: code was active but student not yet registered
      const updatedStudent = await this.prisma.student.update({
        where: { id: student.id },
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim().toLowerCase(),
          is_registered: true,
          updated_at: new Date(),
        },
      });

      return updatedStudent as unknown as Student;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new BadRequestException('REGISTRATION_FAILED');
    }
  }

  /**
   * Login with an already-claimed activation code (for dev / returning users).
   * Code must be status 'active' with a student. Returns the student and expiry.
   */
  async loginWithActivationCode(
    activationCode: string,
  ): Promise<{ student: Student; expiresAt: string }> {
    const { student } = await this.validateActivationCode(activationCode);
    if (!student) {
      throw new BadRequestException('INVALID_ACTIVATION_CODE');
    }
    const expiresAt = await this.getActivationCodeExpiry(activationCode);
    return { student, expiresAt };
  }

  /**
   * Step 11: Create device session
   * Creates a new device session for a student
   * Stores the hashed refresh token for validation
   */
  async createDeviceSession(
    studentId: string,
    deviceId: string,
    refreshTokenHash: string,
    deviceName?: string,
  ): Promise<DeviceSession> {
    if (!studentId?.trim() || !deviceId?.trim() || !refreshTokenHash?.trim()) {
      throw new BadRequestException('MISSING_REQUIRED_FIELDS');
    }

    try {
      // 1. Revoke existing session for same device (re-login)
      const existingSessions = await this.prisma.deviceSession.findMany({
        where: { student_id: studentId, device_id: deviceId, revoked_at: null },
        select: { id: true },
      });

      if (existingSessions.length > 0) {
        await this.prisma.deviceSession.updateMany({
          where: { id: { in: existingSessions.map((s) => s.id) } },
          data: { revoked_at: new Date() },
        });
      }

      // 2. Check device limit (max 3 active sessions)
      const activeCount = await this.prisma.deviceSession.count({
        where: { student_id: studentId, revoked_at: null },
      });

      if (activeCount >= 3) {
        throw new ForbiddenException('DEVICE_LIMIT_REACHED');
      }

      // 3. Create new device session
      const session = await this.prisma.deviceSession.create({
        data: {
          student_id: studentId,
          device_id: deviceId,
          device_name: deviceName?.trim() || null,
          refresh_token_hash: refreshTokenHash,
        },
      });

      return session as unknown as DeviceSession;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new BadRequestException('DEVICE_SESSION_CREATION_FAILED');
    }
  }

  /**
   * Step 12: Validate refresh token
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
    updates: { firstName?: string; lastName?: string; email?: string },
  ): Promise<Student> {
    const data: {
      first_name?: string;
      last_name?: string;
      email?: string;
      updated_at: Date;
    } = { updated_at: new Date() };

    if (updates.firstName?.trim()) data.first_name = updates.firstName.trim();
    if (updates.lastName?.trim()) data.last_name = updates.lastName.trim();
    if (updates.email?.trim()) data.email = updates.email.trim().toLowerCase();

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
        data: { refresh_token_hash: refreshTokenHash, last_used_at: new Date() },
      });
    } catch {
      throw new BadRequestException('SESSION_UPDATE_FAILED');
    }
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
    } catch {
      throw new BadRequestException('SESSION_REVOKE_FAILED');
    }
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

  /**
   * Get activation code expiry date for a given code
   */
  async getActivationCodeExpiry(activationCode: string): Promise<string> {
    const data = await this.prisma.activationCode.findUnique({
      where: { code: activationCode.trim() },
      select: { expires_at: true },
    });

    if (!data?.expires_at) {
      throw new BadRequestException('INVALID_ACTIVATION_CODE');
    }

    return (data.expires_at as Date).toISOString();
  }

  /**
   * Check if a student's membership has expired.
   * Queries activation_codes by student_id and checks expires_at.
   */
  async checkMembershipExpiry(studentId: string): Promise<void> {
    const data = await this.prisma.activationCode.findFirst({
      where: { student_id: studentId, status: 'active' },
      select: { expires_at: true },
    });

    if (!data) {
      throw new UnauthorizedException('INVALID_SESSION');
    }

    if (data.expires_at && (data.expires_at as Date) < new Date()) {
      throw new ForbiddenException('MEMBERSHIP_EXPIRED');
    }
  }
}
