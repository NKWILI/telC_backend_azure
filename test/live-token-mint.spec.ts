import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../src/modules/speaking/services/gemini.service';
import { mintedTokenConfigs } from './__mocks__/genai';

/**
 * What gets sealed into the ephemeral token IS the security model of
 * POST /api/speaking/live-token. The browser holds this token and talks to
 * Google directly, so anything not locked here is something a modified client
 * can change at our expense. A regression would not fail any other test — the
 * endpoint would still return 201 with a working token.
 */
describe('GeminiService.mintLiveToken', () => {
  let service: GeminiService;

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        GEMINI_API_KEY: 'test-api-key',
        GEMINI_LIVE_MODEL: 'gemini-3.1-flash-live-preview',
        GEMINI_LIVE_VOICE: 'Zephyr',
      };
      return values[key];
    }),
  };

  beforeEach(async () => {
    mintedTokenConfigs.length = 0;

    const module: TestingModule = await Test.createTestingModule({
      providers: [GeminiService, { provide: ConfigService, useValue: config }],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
    await service.onModuleInit();
  });

  function lastConfig(): any {
    return mintedTokenConfigs[mintedTokenConfigs.length - 1];
  }

  it('falls back to a model the API actually serves for live sessions', async () => {
    // A model that is not live-capable still mints a token without complaint and
    // only fails when the browser opens the socket, so a wrong default here is
    // invisible to every other test and to the endpoint's own 201. Verified
    // against the real key: this one completes setup, gemini-live-2.5-flash-preview
    // is rejected with "not supported for bidiGenerateContent".
    // Key present, model unset — the deployment case this default exists for.
    const bare = new GeminiService({
      get: (key: string) =>
        key === 'GEMINI_API_KEY' ? 'test-api-key' : undefined,
    } as unknown as ConfigService);
    await bare.onModuleInit();
    await bare.mintLiveToken('INSTRUCTION', 600);

    expect(lastConfig().liveConnectConstraints.model).toBe(
      'gemini-3.1-flash-live-preview',
    );
  });

  it('returns the minted token name and the live model', async () => {
    const result = await service.mintLiveToken('INSTRUCTION', 600);

    expect(result).toEqual({
      token: 'auth_tokens/mock-token',
      model: 'gemini-3.1-flash-live-preview',
    });
  });

  it('locks the token to one use', async () => {
    await service.mintLiveToken('INSTRUCTION', 600);

    expect(lastConfig().uses).toBe(1);
  });

  it('locks the model, so a client cannot switch to a costlier one', async () => {
    await service.mintLiveToken('INSTRUCTION', 600);

    expect(lastConfig().liveConnectConstraints.model).toBe(
      'gemini-3.1-flash-live-preview',
    );
  });

  it('locks output to audio, so the token cannot be reused as a text API', async () => {
    await service.mintLiveToken('INSTRUCTION', 600);

    expect(lastConfig().liveConnectConstraints.config.responseModalities).toEqual(
      ['AUDIO'],
    );
  });

  it('seals in the server-built instruction', async () => {
    await service.mintLiveToken('DU BIST ELENA', 600);

    expect(lastConfig().liveConnectConstraints.config.systemInstruction).toBe(
      'DU BIST ELENA',
    );
  });

  it('enables transcription both ways, which is what gets graded afterwards', async () => {
    await service.mintLiveToken('INSTRUCTION', 600);

    const live = lastConfig().liveConnectConstraints.config;
    expect(live.inputAudioTranscription).toBeDefined();
    expect(live.outputAudioTranscription).toBeDefined();
  });

  it('sets expireTime to the session ceiling, so Google enforces the cap', async () => {
    const before = Date.now();
    await service.mintLiveToken('INSTRUCTION', 600);

    const expireMs = new Date(lastConfig().expireTime as string).getTime();
    // 600s out, allowing for the time the call itself took.
    expect(expireMs - before).toBeGreaterThanOrEqual(599_000);
    expect(expireMs - before).toBeLessThanOrEqual(601_000);
  });

  it('gives the token a short window to open a session', async () => {
    const before = Date.now();
    await service.mintLiveToken('INSTRUCTION', 600);

    const openMs = new Date(
      lastConfig().newSessionExpireTime as string,
    ).getTime();
    // A token that leaks in transit is worthless a minute later.
    expect(openMs - before).toBeLessThanOrEqual(61_000);
  });

  it('honours a shorter session ceiling', async () => {
    const before = Date.now();
    await service.mintLiveToken('INSTRUCTION', 120);

    const expireMs = new Date(lastConfig().expireTime as string).getTime();
    expect(expireMs - before).toBeLessThanOrEqual(121_000);
  });
});
