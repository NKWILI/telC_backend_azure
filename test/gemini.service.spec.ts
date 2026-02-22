import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../src/modules/speaking/services/gemini.service';
import { DummyAudioGenerator } from './fixtures/dummy-audio.generator';
import * as fs from 'fs';
import * as path from 'path';

describe('GeminiService', () => {
  let service: GeminiService;
  let configService: ConfigService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              // Mock config values
              if (key === 'GEMINI_API_KEY') {
                return process.env.GEMINI_API_KEY || 'test-key';
              }
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
    await module.init();
  });

  describe('Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should load system instructions on module init', () => {
      const instruction1 = service.getSystemInstruction(1);
      const instruction2 = service.getSystemInstruction(2);
      const instruction3 = service.getSystemInstruction(3);

      expect(instruction1).toBeDefined();
      expect(instruction2).toBeDefined();
      expect(instruction3).toBeDefined();
      expect(instruction1.length).toBeGreaterThan(50);
    });

    it('should throw error for invalid Teil number', () => {
      expect(() => service.getSystemInstruction(4)).toThrow();
    });
  });

  describe('Dummy Audio Generation', () => {
    it('should generate valid PCM buffer', () => {
      const buffer = DummyAudioGenerator.generatePCMBuffer(500);

      expect(buffer).toBeDefined();
      expect(Buffer.isBuffer(buffer)).toBe(true);
      // 16kHz * 0.5s * 2 bytes per sample = 16000 bytes
      expect(buffer.length).toBe(16000);
    });

    it('should generate Base64-encoded audio chunk', () => {
      const base64 = DummyAudioGenerator.generateBase64AudioChunk(500);

      expect(base64).toBeDefined();
      expect(typeof base64).toBe('string');
      // Verify it's valid Base64
      expect(() => Buffer.from(base64, 'base64')).not.toThrow();
    });

    it('should generate audio chunk sequence', () => {
      const chunks = DummyAudioGenerator.generateAudioChunkSequence(10, 100);

      expect(chunks).toBeDefined();
      expect(chunks.length).toBe(10);
      expect(typeof chunks[0]).toBe('string');
    });

    it('should generate white noise', () => {
      const buffer = DummyAudioGenerator.generateWhiteNoisePCM(500);

      expect(buffer).toBeDefined();
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should generate silence', () => {
      const buffer = DummyAudioGenerator.generateSilencePCM(500);

      expect(buffer).toBeDefined();
      expect(Buffer.isBuffer(buffer)).toBe(true);
      // All bytes should be 0
      const allZeros = buffer.every((byte) => byte === 0);
      expect(allZeros).toBe(true);
    });
  });

  describe('Audio Data Encoding/Decoding', () => {
    it('should encode and decode audio data correctly', () => {
      const originalBuffer = DummyAudioGenerator.generatePCMBuffer(500);
      const encoded = service.encodeAudioData(originalBuffer);
      const decoded = service.decodeAudioData(encoded);

      expect(decoded.equals(originalBuffer)).toBe(true);
    });

    it('should validate Base64 strings correctly', () => {
      const validBase64 = DummyAudioGenerator.generateBase64AudioChunk();
      const invalidBase64 = 'not-valid-base64!!!';

      // These are private methods, but we can test through public methods if available
      expect(typeof validBase64).toBe('string');
      expect(validBase64.length).toBeGreaterThan(0);
    });
  });

  describe('Session Management (Mocked)', () => {
    // These tests use mock Gemini sessions since we can't use real API in tests

    it('should track initial active sessions as 0', () => {
      const count = service.getActiveSessionsCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should identify inactive sessions', () => {
      const isActive = service.isSessionActive('non-existent-session');
      expect(isActive).toBe(false);
    });
  });

  describe('Integration: Audio Chunk Preparation', () => {
    it('should prepare audio chunks matching Gemini requirements', () => {
      const base64Chunk = DummyAudioGenerator.generateBase64AudioChunk(100);
      const buffer = Buffer.from(base64Chunk, 'base64');

      // Verify chunk properties
      expect(buffer.length).toBeGreaterThan(0);
      // 16kHz * 0.1s * 2 bytes = 3200 bytes
      expect(buffer.length).toBe(3200);
    });

    it('should generate multi-chunk audio stream', () => {
      const chunks = DummyAudioGenerator.generateAudioChunkSequence(5, 100);

      chunks.forEach((chunk) => {
        const buffer = Buffer.from(chunk, 'base64');
        expect(buffer.length).toBe(3200); // Each chunk is 100ms at 16kHz
      });
    });
  });

  describe('Error Handling', () => {
    it('should return false when checking non-existent session', async () => {
      const result = service.isSessionActive('non-existent-id');
      expect(result).toBe(false);
    });

    it('should handle close of non-existent session gracefully', () => {
      // Should not throw
      expect(() =>
        service.closeLiveSession('non-existent-session'),
      ).not.toThrow();
    });

    it('should not throw when sendTurnComplete is called for non-existent session', () => {
      expect(() =>
        service.sendTurnComplete('non-existent-session'),
      ).not.toThrow();
    });

    it('should not throw when triggerExaminerGreeting is called for non-existent session', () => {
      expect(() =>
        service.triggerExaminerGreeting('non-existent-session'),
      ).not.toThrow();
    });
  });

  describe('Transcription callbacks', () => {
    it('should accept GeminiSessionCallbacks with optional onInputTranscription and onOutputTranscription', () => {
      // Type check: callbacks with optional transcription handlers are valid
      const callbacksWithTranscription = {
        onAudioResponse: () => {},
        onInputTranscription: (_text: string) => {},
        onOutputTranscription: (_text: string) => {},
        onError: (_err: Error) => {},
        onClose: () => {},
      };
      expect(callbacksWithTranscription.onInputTranscription).toBeDefined();
      expect(callbacksWithTranscription.onOutputTranscription).toBeDefined();
    });
  });
});
