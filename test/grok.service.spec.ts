import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { GrokService } from '../src/modules/writing/services/grok.service';

describe('GrokService', () => {
  let service: GrokService;
  let fetchSpy: jest.SpyInstance;

  const buildService = async (
    configValues: Record<string, string | undefined> = {
      GROK_API_KEY: 'test-key',
      GROK_MODEL: 'grok-2-latest',
    },
  ): Promise<GrokService> => {
    const mockConfig = {
      get: jest.fn((key: string) => configValues[key]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrokService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    return module.get<GrokService>(GrokService);
  };

  beforeEach(async () => {
    service = await buildService();
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateTextResponse', () => {
    it('returns the content string on a 200 response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"score":80}' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const result = await service.generateTextResponse('hello');

      expect(result).toBe('{"score":80}');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.x.ai/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('grok-2-latest');
      expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('throws "Grok API error <status>: <body>" on a non-2xx response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      await expect(service.generateTextResponse('hi')).rejects.toThrow(
        'Grok API error 401: Unauthorized',
      );
    });

    it('throws "Empty response from Grok API" when content is empty', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await expect(service.generateTextResponse('hi')).rejects.toThrow(
        'Empty response from Grok API',
      );
    });

    it('propagates network errors', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(service.generateTextResponse('hi')).rejects.toThrow(
        'ECONNRESET',
      );
    });
  });

  describe('configuration', () => {
    it('does not throw when GROK_API_KEY is missing; logs a warning', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      await expect(
        buildService({ GROK_API_KEY: undefined, GROK_MODEL: undefined }),
      ).resolves.toBeDefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('GROK_API_KEY'),
      );
    });

    it('uses default model "grok-2-latest" when GROK_MODEL is not set', async () => {
      const svc = await buildService({
        GROK_API_KEY: 'k',
        GROK_MODEL: undefined,
      });
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'x' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      await svc.generateTextResponse('hi');

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(body.model).toBe('grok-2-latest');
    });
  });
});
