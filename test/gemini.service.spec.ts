import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../src/modules/speaking/services/gemini.service';

const mockGenerateContent = jest.fn();

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'GEMINI_API_KEY') return 'test-api-key';
    if (key === 'GEMINI_TEXT_MODEL') return 'gemini-2.0-flash';
    return undefined;
  }),
};

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

describe('GeminiService', () => {
  let service: GeminiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
    await service.onModuleInit();
    jest.clearAllMocks();
  });

  describe('generateTextResponse', () => {
    it('should return text from Gemini', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Evaluation result in German.',
      });

      const result = await service.generateTextResponse(
        'Evaluate this transcript.',
      );

      expect(result).toBe('Evaluation result in German.');
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ contents: 'Evaluate this transcript.' }),
      );
    });

    it('should throw when Gemini returns empty text', async () => {
      mockGenerateContent.mockResolvedValue({ text: '' });

      await expect(service.generateTextResponse('test')).rejects.toThrow(
        'Empty response from Gemini',
      );
    });

    it('should throw when Gemini call fails', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network error'));

      await expect(service.generateTextResponse('test')).rejects.toThrow(
        'Network error',
      );
    });

    it('should use the configured text model', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'ok' });

      await service.generateTextResponse('hello');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.0-flash' }),
      );
    });
  });
});
