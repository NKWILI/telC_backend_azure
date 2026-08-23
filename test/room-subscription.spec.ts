/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
// unbound-method is disabled deliberately: these assertions read Nest's guard
// metadata off the handler reference, which means naming the method without
// calling it. Binding it would defeat the lookup.
/* eslint-disable @typescript-eslint/unbound-method */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { RoomController } from '../src/modules/speaking/room/room.controller';
import { RoomService } from '../src/modules/speaking/room/room.service';
import { TurnCredentialsService } from '../src/modules/speaking/room/turn-credentials.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { StudentSubscriptionGuard } from '../src/shared/guards/student-subscription.guard';
import { SubscriptionPolicyService } from '../src/modules/centers/subscription-policy.service';
import { PrismaService } from '../src/shared/services/prisma.service';
import { TokenService } from '../src/modules/auth/token.service';
import { ValkeyService } from '../src/shared/services/valkey.service';

const ROOM_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

describe('speaking rooms and the subscription', () => {
  let app: INestApplication;
  let prisma: any;
  let tokenService: any;

  const entitledStudent = () =>
    prisma.student.findUnique.mockResolvedValue({
      center_id: 'center-1',
      center: {
        subscription: {
          plan: 'PAID',
          seats: 10,
          trial_started_at: null,
          trial_ends_at: null,
          paid_until: daysFromNow(30),
        },
      },
    });

  const blockedStudent = () =>
    prisma.student.findUnique.mockResolvedValue({
      center_id: 'center-1',
      center: {
        subscription: {
          plan: 'PAID',
          seats: 10,
          trial_started_at: null,
          trial_ends_at: null,
          paid_until: daysFromNow(-8), // lapsed, and past the 7-day grace
        },
      },
    });

  beforeEach(async () => {
    prisma = { student: { findUnique: jest.fn() }, deviceSession: {} };
    tokenService = {
      verifyAccessToken: jest.fn().mockReturnValue({
        type: 'access',
        studentId: 'student-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RoomController],
      providers: [
        {
          provide: RoomService,
          useValue: {
            createRoom: jest.fn().mockReturnValue({
              roomId: ROOM_ID,
              hostToken: 'host-token',
              expiresAt: daysFromNow(1).toISOString(),
            }),
            getRoom: jest.fn().mockReturnValue({
              roomId: ROOM_ID,
              status: 'waiting',
              hostSocketId: null,
              guest: null,
              expiresAt: daysFromNow(1),
            }),
          },
        },
        {
          provide: TurnCredentialsService,
          useValue: { getIceServers: jest.fn().mockReturnValue({}) },
        },
        // The real guards. Overriding them would test nothing.
        JwtAuthGuard,
        StudentSubscriptionGuard,
        SubscriptionPolicyService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokenService },
        {
          provide: ValkeyService,
          useValue: { isSessionRevoked: jest.fn().mockResolvedValue(false) },
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  describe('creating a room is where the entitlement is spent', () => {
    it('refuses an anonymous room creation', async () => {
      await request(app.getHttpServer())
        .post('/api/speaking/rooms')
        .expect(401);
    });

    it('refuses a student whose center stopped paying', async () => {
      blockedStudent();

      const response = await request(app.getHttpServer())
        .post('/api/speaking/rooms')
        .set('Authorization', 'Bearer valid-token')
        .expect(403);

      expect(response.body).toMatchObject({
        message: 'SUBSCRIPTION_INACTIVE',
        subscriptionStatus: 'BLOCKED',
      });
    });

    it('admits a student whose center is paid up', async () => {
      entitledStudent();

      const response = await request(app.getHttpServer())
        .post('/api/speaking/rooms')
        .set('Authorization', 'Bearer valid-token')
        .expect(201);

      expect(response.body.roomId).toBe(ROOM_ID);
    });
  });

  /**
   * The guest is anonymous by design, not by oversight. Someone practises with
   * a partner who joins by link and may have no Lerniqo account at all.
   * Closing this route would break the feature rather than secure it.
   */
  describe('the guest still joins by link', () => {
    it('serves room details to a caller with no token at all', async () => {
      await request(app.getHttpServer())
        .get(`/api/speaking/rooms/${ROOM_ID}`)
        .expect(200);
    });

    it('does not consult any subscription to do so', async () => {
      await request(app.getHttpServer())
        .get(`/api/speaking/rooms/${ROOM_ID}`)
        .expect(200);

      expect(prisma.student.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('guard wiring on the handlers', () => {
    const guardsOn = (handler: unknown) =>
      (Reflect.getMetadata('__guards__', handler as object) ?? []) as unknown[];

    it('checks identity before entitlement when creating', () => {
      const guards = guardsOn(RoomController.prototype.createRoom);

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(StudentSubscriptionGuard);
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(StudentSubscriptionGuard),
      );
    });

    it('keeps rate limiting on room creation', () => {
      expect(guardsOn(RoomController.prototype.createRoom)).toContain(
        ThrottlerGuard,
      );
    });

    it('leaves the public room lookup unguarded', () => {
      const guards = guardsOn(RoomController.prototype.getRoom);

      expect(guards).not.toContain(JwtAuthGuard);
      expect(guards).not.toContain(StudentSubscriptionGuard);
    });
  });
});
