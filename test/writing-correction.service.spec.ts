import { Test, TestingModule } from '@nestjs/testing';
import { WritingCorrectionService } from '../src/modules/writing/writing-correction.service';
import { DatabaseService } from '../src/shared/services/database.service';
import { WritingGateway } from '../src/modules/writing/writing.gateway';

describe('WritingCorrectionService', () => {
  let service: WritingCorrectionService;
  const mockDatabaseService = { getClient: jest.fn() };
  const mockGateway = { notifyCorrectionReady: jest.fn() };

  const jobData = {
    attemptId: 'attempt-uuid-1',
    studentId: 'student-1',
    exerciseId: '1',
    content: 'Sehr geehrte Damen und Herren...',
    createdAt: new Date(Date.now() - 120000).toISOString(), // 2 min ago
  };

  beforeEach(async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    mockDatabaseService.getClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ update: updateMock }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingCorrectionService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: WritingGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<WritingCorrectionService>(WritingCorrectionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runCorrection', () => {
    it('calls DB update with status completed, score, feedback, duration_seconds, completed_at', async () => {
      await service.runCorrection(jobData);

      const fromMock = mockDatabaseService.getClient().from;
      expect(fromMock).toHaveBeenCalledWith('writing_attempts');
      const updateMock = fromMock().update;
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          score: 75,
          feedback: 'Stub feedback. Echte Korrektur folgt.',
          duration_seconds: expect.any(Number),
          completed_at: expect.any(String),
        }),
      );
      const eqMock = updateMock().eq;
      expect(eqMock).toHaveBeenCalledWith('attempt_id', jobData.attemptId);
    });

    it('calls gateway.notifyCorrectionReady with studentId and payload', async () => {
      await service.runCorrection(jobData);

      expect(mockGateway.notifyCorrectionReady).toHaveBeenCalledTimes(1);
      expect(mockGateway.notifyCorrectionReady).toHaveBeenCalledWith(
        jobData.studentId,
        expect.objectContaining({
          attemptId: jobData.attemptId,
          exerciseId: jobData.exerciseId,
          status: 'completed',
          score: 75,
          feedback: 'Stub feedback. Echte Korrektur folgt.',
          durationSeconds: expect.any(Number),
          corrections: [],
        }),
      );
    });

    it('does not call notifyCorrectionReady when DB update returns error', async () => {
      const eqMock = jest.fn().mockResolvedValue({
        error: { message: 'DB error' },
      });
      const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({ update: updateMock }),
      });

      await service.runCorrection(jobData);

      expect(mockGateway.notifyCorrectionReady).not.toHaveBeenCalled();
    });
  });
});
