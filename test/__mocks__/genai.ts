/**
 * Mock for @google/genai so Jest can load gateway and gemini.service specs
 * without pulling in ESM-only dependencies (p-retry, etc.).
 */
export const Modality = { AUDIO: 'AUDIO' };

export interface LiveServerMessage {
  setupComplete?: unknown;
  serverContent?: unknown;
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
  constructor(_opts?: { apiKey?: string }) {}
}

export interface Session {
  sendRealtimeInput: (opts: unknown) => void;
  sendClientContent: (opts: unknown) => void;
  close: () => void;
}
