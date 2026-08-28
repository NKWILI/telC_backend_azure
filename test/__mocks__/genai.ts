/**
 * Mock for @google/genai so Jest can load gateway and gemini.service specs
 * without pulling in ESM-only dependencies (p-retry, etc.).
 */
export const Modality = { AUDIO: 'AUDIO' };

/**
 * Every config passed to authTokens.create, newest last. Specs assert against
 * this; clear it in beforeEach.
 */
export const mintedTokenConfigs: unknown[] = [];

export interface LiveServerMessage {
  setupComplete?: unknown;
  serverContent?: unknown;
}

export interface AuthToken {
  name?: string;
}

export class GoogleGenAI {
  live = {
    connect: () =>
      Promise.resolve({
        sendRealtimeInput: () => {},
        sendClientContent: () => {},
        close: () => {},
      }),
  };
  models = {
    generateContent: () => Promise.resolve({ text: 'mock' }),
  };
  /**
   * Ephemeral tokens for Elena. Each config is recorded in the module-level
   * {@link mintedTokenConfigs} so specs can assert what was sealed into the
   * token: the model, the audio-only modality and the system instruction are
   * the whole security property of this endpoint, and a regression there would
   * not surface anywhere else — the endpoint would keep returning 201.
   */
  authTokens = {
    create: (params?: { config?: unknown }) => {
      mintedTokenConfigs.push(params?.config);
      return Promise.resolve({ name: 'auth_tokens/mock-token' });
    },
  };
  constructor(_opts?: { apiKey?: string }) {}
}

export interface Session {
  sendRealtimeInput: (opts: unknown) => void;
  sendClientContent: (opts: unknown) => void;
  close: () => void;
}
