import { Test, TestingModule } from '@nestjs/testing';
import { WritingCorrectionService } from '../src/modules/writing/writing-correction.service';
import { PrismaService } from '../src/shared/services/prisma.service';
import { WritingGateway } from '../src/modules/writing/writing.gateway';
import { MODEL_SERVICE_TOKEN } from '../src/modules/writing/services/model-service.interface';

describe('WritingCorrectionService', () => {
  let service: WritingCorrectionService;

  const mockPrismaService = {
    writingAttempt: {
      update: jest.fn(),
    },
  };
  const mockGateway = { notifyCorrectionReady: jest.fn() };
  const mockModelService = { generateTextResponse: jest.fn() };

  const jobData = {
    attemptId: 'attempt-uuid-1',
    studentId: 'student-1',
    exerciseId: '1',
    content: 'Ich habe geschrieben einen Brief.',
    createdAt: new Date(Date.now() - 120000).toISOString(),
  };

  const validModelJson = `{
    "score": 82,
    "feedback": "Gute Struktur. Achten Sie auf die Konjugation.",
    "corrected_text": "Ich schreibe einen Brief.",
    "corrections": [
      {
        "original": "Ich habe geschrieben",
        "corrected": "Ich schreibe",
        "explanation": "Präsens ist hier passender.",
        "error_type": "grammar"
      }
    ]
  }`;

  beforeEach(async () => {
    mockPrismaService.writingAttempt.update.mockResolvedValue({});
    mockModelService.generateTextResponse.mockRejectedValue(
      new Error('Model unavailable'),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingCorrectionService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: WritingGateway, useValue: mockGateway },
        { provide: MODEL_SERVICE_TOKEN, useValue: mockModelService },
      ],
    }).compile();

    service = module.get<WritingCorrectionService>(WritingCorrectionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runCorrection', () => {
    it('calls DB update with stub fields when the model fails', async () => {
      await service.runCorrection(jobData);

      expect(mockPrismaService.writingAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { attempt_id: jobData.attemptId },
          data: expect.objectContaining({
            status: 'completed',
            score: 75,
            feedback: 'Stub feedback. Echte Korrektur folgt.',
            corrected_text: '',
            diff: [],
            duration_seconds: expect.any(Number),
            completed_at: expect.any(Date),
          }),
        }),
      );
    });

    it('emits stub payload (with empty correctedText, diff) when the model fails', async () => {
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
          originalText: jobData.content,
          correctedText: '',
          diff: [],
          durationSeconds: expect.any(Number),
          corrections: [],
        }),
      );
    });

    it('does not call notifyCorrectionReady when DB update throws', async () => {
      mockPrismaService.writingAttempt.update.mockRejectedValue(
        new Error('DB error'),
      );

      await service.runCorrection(jobData);

      expect(mockGateway.notifyCorrectionReady).not.toHaveBeenCalled();
    });

    it('persists corrected_text and diff when model returns valid JSON', async () => {
      mockModelService.generateTextResponse.mockResolvedValue(validModelJson);

      await service.runCorrection(jobData);

      expect(mockModelService.generateTextResponse).toHaveBeenCalledTimes(1);

      const updateCall =
        mockPrismaService.writingAttempt.update.mock.calls[0][0];
      expect(updateCall.where).toEqual({ attempt_id: jobData.attemptId });
      expect(updateCall.data).toMatchObject({
        status: 'completed',
        score: 82,
        feedback: 'Gute Struktur. Achten Sie auf die Konjugation.',
        corrected_text: 'Ich schreibe einen Brief.',
      });
      expect(Array.isArray(updateCall.data.diff)).toBe(true);
      expect(updateCall.data.diff.length).toBeGreaterThan(0);

      const ops = (
        updateCall.data.diff as Array<{ op: string; text: string }>
      ).map((d) => d.op);
      expect(ops).toContain('delete');
      expect(ops).toContain('insert');
    });

    it('emits payload with originalText, correctedText, and diff on a valid response', async () => {
      mockModelService.generateTextResponse.mockResolvedValue(validModelJson);

      await service.runCorrection(jobData);

      expect(mockGateway.notifyCorrectionReady).toHaveBeenCalledWith(
        jobData.studentId,
        expect.objectContaining({
          attemptId: jobData.attemptId,
          exerciseId: jobData.exerciseId,
          status: 'completed',
          score: 82,
          feedback: 'Gute Struktur. Achten Sie auf die Konjugation.',
          originalText: jobData.content,
          correctedText: 'Ich schreibe einen Brief.',
          corrections: [
            {
              original: 'Ich habe geschrieben',
              corrected: 'Ich schreibe',
              explanation: 'Präsens ist hier passender.',
              errorType: 'grammar',
            },
          ],
        }),
      );

      const payload = mockGateway.notifyCorrectionReady.mock.calls[0][1];
      expect(Array.isArray(payload.diff)).toBe(true);
      const ops = (payload.diff as Array<{ op: string }>).map((d) => d.op);
      expect(ops).toContain('delete');
      expect(ops).toContain('insert');
    });

    it('falls back to stub when model returns invalid JSON', async () => {
      mockModelService.generateTextResponse.mockResolvedValue(
        'No JSON here at all',
      );

      await service.runCorrection(jobData);

      expect(mockPrismaService.writingAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            score: 75,
            feedback: 'Stub feedback. Echte Korrektur folgt.',
            corrected_text: '',
            diff: [],
          }),
        }),
      );
      expect(mockGateway.notifyCorrectionReady).toHaveBeenCalledWith(
        jobData.studentId,
        expect.objectContaining({
          score: 75,
          feedback: 'Stub feedback. Echte Korrektur folgt.',
          correctedText: '',
          diff: [],
          corrections: [],
        }),
      );
    });

    it('falls back to stub when model rejects', async () => {
      mockModelService.generateTextResponse.mockRejectedValue(
        new Error('Network error'),
      );

      await service.runCorrection(jobData);

      expect(mockGateway.notifyCorrectionReady).toHaveBeenCalledWith(
        jobData.studentId,
        expect.objectContaining({
          score: 75,
          feedback: 'Stub feedback. Echte Korrektur folgt.',
          correctedText: '',
          diff: [],
        }),
      );
    });

    it('falls back to stub when corrected_text is missing from the AI response', async () => {
      mockModelService.generateTextResponse.mockResolvedValue(`{
        "score": 70,
        "feedback": "ok",
        "corrections": []
      }`);

      await service.runCorrection(jobData);

      expect(mockGateway.notifyCorrectionReady).toHaveBeenCalledWith(
        jobData.studentId,
        expect.objectContaining({
          score: 75,
          feedback: 'Stub feedback. Echte Korrektur folgt.',
          correctedText: '',
          diff: [],
        }),
      );
    });
  });
});
