import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { ListeningController } from '../src/modules/listening/listening.controller';
import { ListeningService } from '../src/modules/listening/listening.service';

const MOCK_STUDENT = { studentId: 'student-abc', deviceId: 'dev-1' };

const mockListeningService = {
  getTeils: jest.fn(),
  getSessions: jest.fn(),
  getExercise: jest.fn(),
  submit: jest.fn(),
};

describe('ListeningController', () => {
  let controller: ListeningController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListeningController],
      providers: [
        { provide: ListeningService, useValue: mockListeningService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ListeningController>(ListeningController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // GET teils
  // ---------------------------------------------------------------------------
  describe('getTeils', () => {
    it('delegates to service.getTeils with studentId and returns result', async () => {
      const teils = [{ id: '1', title: 'Teil 1', progress: 0 }];
      mockListeningService.getTeils.mockResolvedValue(teils);

      const result = await controller.getTeils(MOCK_STUDENT as any);

      expect(mockListeningService.getTeils).toHaveBeenCalledWith('student-abc');
      expect(result).toBe(teils);
    });

    it('returns [] when student is null', async () => {
      const result = await controller.getTeils(null as any);

      expect(mockListeningService.getTeils).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // GET sessions
  // ---------------------------------------------------------------------------
  describe('getSessions', () => {
    it('delegates to service.getSessions with studentId and parsed teilNumber', async () => {
      const sessions = [{ id: 'att-1', score: 80 }];
      mockListeningService.getSessions.mockResolvedValue(sessions);

      const result = await controller.getSessions(MOCK_STUDENT as any, '2');

      expect(mockListeningService.getSessions).toHaveBeenCalledWith('student-abc', 2);
      expect(result).toBe(sessions);
    });

    it('passes undefined teilNumber when query param is absent', async () => {
      mockListeningService.getSessions.mockResolvedValue([]);

      await controller.getSessions(MOCK_STUDENT as any, undefined);

      expect(mockListeningService.getSessions).toHaveBeenCalledWith(
        'student-abc',
        undefined,
      );
    });

    it('returns [] when student is null', async () => {
      const result = await controller.getSessions(null as any, undefined);

      expect(mockListeningService.getSessions).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // GET exercise
  // ---------------------------------------------------------------------------
  describe('getExercise', () => {
    it('delegates to service.getExercise with type param and returns result', async () => {
      const payload = { content_revision: 'v1', questions: [], issued_at: '' };
      mockListeningService.getExercise.mockResolvedValue(payload);

      const result = await controller.getExercise('1');

      expect(mockListeningService.getExercise).toHaveBeenCalledWith('1');
      expect(result).toBe(payload);
    });
  });

  // ---------------------------------------------------------------------------
  // POST submit
  // ---------------------------------------------------------------------------
  describe('submit', () => {
    const dto = {
      type: '1',
      timed: true,
      content_revision: 'mock-horen-teil-1-v1',
      answers: { q11: 'b' },
    };

    it('delegates to service.submit with studentId and dto, returns result', async () => {
      const response = { score: 100 };
      mockListeningService.submit.mockResolvedValue(response);

      const result = await controller.submit(MOCK_STUDENT as any, dto as any);

      expect(mockListeningService.submit).toHaveBeenCalledWith('student-abc', dto);
      expect(result).toBe(response);
    });

    it('throws UnauthorizedException when student is null', async () => {
      await expect(
        controller.submit(null as any, dto as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockListeningService.submit).not.toHaveBeenCalled();
    });
  });
});
