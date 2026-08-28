import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { LiveTokenController } from '../src/modules/speaking/live/live-token.controller';
import { ExaminerPromptService } from '../src/modules/speaking/live/examiner-prompt.service';
import { LiveSessionLimitService } from '../src/modules/speaking/live/live-session-limit.service';
import { SpeakingService } from '../src/modules/speaking/services/speaking.service';
import { GeminiService } from '../src/modules/speaking/services/gemini.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';

const TEIL_2 = {
  id: 2,
  part: 2,
  title: 'Teil 2',
  subtitle: '',
  topicTitle: 'Arbeit und Freizeit',
  topicDescription: 'Sprechen Sie über Ihre Arbeit.',
  topicPoints: ['Ihr Arbeitstag'],
  durationMinutes: 6,
  prepDurationSeconds: 60,
  imagePath: '',
  examImagePath: null,
};

const mockSpeakingService = { getTeils: jest.fn() };
const mockGeminiService = { mintLiveToken: jest.fn() };
const mockPromptService = { build: jest.fn() };
const mockLimitService = { acquire: jest.fn(), sessionSeconds: 600 };

const guestReq = { student: { studentId: 'guest-uuid', isGuest: true } };

describe('LiveTokenController', () => {
  let controller: LiveTokenController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSpeakingService.getTeils.mockResolvedValue([TEIL_2]);
    mockPromptService.build.mockReturnValue('SYSTEM INSTRUCTION');
    mockGeminiService.mintLiveToken.mockResolvedValue({
      token: 'auth_tokens/xyz',
      model: 'gemini-live-2.5-flash-preview',
    });
    mockLimitService.acquire.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LiveTokenController],
      providers: [
        { provide: SpeakingService, useValue: mockSpeakingService },
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: ExaminerPromptService, useValue: mockPromptService },
        { provide: LiveSessionLimitService, useValue: mockLimitService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LiveTokenController>(LiveTokenController);
  });

  it('returns the token, model, ceiling and topic', async () => {
    const result = await controller.createLiveToken('1.2.3.4', guestReq, {
      teilNumber: 2,
    });

    expect(result).toEqual({
      token: 'auth_tokens/xyz',
      model: 'gemini-live-2.5-flash-preview',
      expiresInSeconds: 600,
      teilNumber: 2,
      topic: {
        title: 'Arbeit und Freizeit',
        description: 'Sprechen Sie über Ihre Arbeit.',
        points: ['Ihr Arbeitstag'],
      },
    });
  });

  it('serves guest accounts', async () => {
    // The demo has no login — every real user arrives on a guest JWT. If this
    // ever starts refusing guests, the whole feature is dead in production.
    await expect(
      controller.createLiveToken('1.2.3.4', guestReq, { teilNumber: 1 }),
    ).resolves.toHaveProperty('token');
  });

  it('passes the caller identity to the limiter, flagged as guest', async () => {
    await controller.createLiveToken('5.6.7.8', guestReq, { teilNumber: 1 });

    expect(mockLimitService.acquire).toHaveBeenCalledWith(
      { ip: '5.6.7.8', studentId: 'guest-uuid', isGuest: true },
      expect.any(String),
    );
  });

  it('never lets the client choose the instruction', async () => {
    await controller.createLiveToken('1.2.3.4', guestReq, { teilNumber: 3 });

    // The instruction is built server-side from the Teil and the seeded topic.
    expect(mockPromptService.build).toHaveBeenCalledWith(3, expect.any(Object));
    expect(mockGeminiService.mintLiveToken).toHaveBeenCalledWith(
      'SYSTEM INSTRUCTION',
      600,
    );
  });

  it('still mints a token when the Modelltest has no speaking exercise', async () => {
    mockSpeakingService.getTeils.mockRejectedValue(
      new NotFoundException('Modelltest 9 not found'),
    );

    const result = await controller.createLiveToken('1.2.3.4', guestReq, {
      teilNumber: 2,
      modelltest: 9,
    });

    expect(result.token).toBe('auth_tokens/xyz');
    expect(result.topic).toBeUndefined();
    expect(mockPromptService.build).toHaveBeenCalledWith(2, null);
  });

  it('omits the topic when the Teil is not among the seeded exercises', async () => {
    mockSpeakingService.getTeils.mockResolvedValue([TEIL_2]);

    const result = await controller.createLiveToken('1.2.3.4', guestReq, {
      teilNumber: 1,
    });

    expect(result.topic).toBeUndefined();
  });

  it('does not mint anything when a cap refuses the request', async () => {
    mockLimitService.acquire.mockRejectedValue(
      new HttpException(
        { messageKey: 'elenaDailyLimit' },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    await expect(
      controller.createLiveToken('1.2.3.4', guestReq, { teilNumber: 2 }),
    ).rejects.toThrow(HttpException);

    expect(mockGeminiService.mintLiveToken).not.toHaveBeenCalled();
  });
});
