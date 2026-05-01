import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
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
}
