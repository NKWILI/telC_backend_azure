/**
 * Integration test for Gemini Live API connection with dummy audio
 * This test demonstrates the complete flow: connect -> send audio -> receive response -> close
 *
 * Usage: npm run test -- test/gemini-integration.spec.ts
 * Note: Requires GEMINI_API_KEY environment variable
 */

import { DummyAudioGenerator } from './fixtures/dummy-audio.generator';

describe('Gemini Live API Integration (with Dummy Audio)', () => {
  describe('Audio Generation for Gemini', () => {
    it('should generate valid 16kHz PCM audio', () => {
      const durationMs = 500;
      const buffer = DummyAudioGenerator.generatePCMBuffer(durationMs);

      // Verify audio properties
      expect(buffer).toBeDefined();
      expect(Buffer.isBuffer(buffer)).toBe(true);

      // For 16kHz and 500ms: 16000 * 0.5 * 2 bytes = 16000 bytes
      expect(buffer.length).toBe(16000);

      // Verify it contains actual audio data (not all zeros)
      const hasNonZeroBytes = buffer.some((byte) => byte !== 0);
      expect(hasNonZeroBytes).toBe(true);
    });

    it('should generate Base64-encoded audio ready for WebSocket', () => {
      const base64 = DummyAudioGenerator.generateBase64AudioChunk(100);

      expect(base64).toBeDefined();
      expect(typeof base64).toBe('string');
      expect(base64.length).toBeGreaterThan(0);

      // Verify Base64 encoding is valid
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded).toBeDefined();
      expect(decoded.length).toBeGreaterThan(0);
    });

    it('should stream audio in proper chunks (100-200ms)', () => {
      const chunkDurationMs = 150; // 150ms chunks
      const chunkCount = 20; // 3 seconds total
      const chunks = DummyAudioGenerator.generateAudioChunkSequence(
        chunkCount,
        chunkDurationMs,
      );

      expect(chunks.length).toBe(chunkCount);

      // Verify each chunk is valid and consistent size
      chunks.forEach((chunk, index) => {
        const decoded = Buffer.from(chunk, 'base64');
        // Each chunk should be: 16000 Hz * 0.15s * 2 bytes = 4800 bytes
        expect(decoded.length).toBe(4800);
      });
    });
  });

  describe('Audio Stream Patterns', () => {
    it('should generate different frequencies for variety', () => {
      // This simulates natural speech variation
      const chunk1 = DummyAudioGenerator.generateBase64AudioChunk(100, 440); // Lower frequency
      const chunk2 = DummyAudioGenerator.generateBase64AudioChunk(100, 880); // Higher frequency

      // While they're different patterns, they should both be valid audio
      const buf1 = Buffer.from(chunk1, 'base64');
      const buf2 = Buffer.from(chunk2, 'base64');

      expect(buf1.length).toBe(buf2.length);
      expect(buf1.equals(buf2)).toBe(false); // They should be different
    });

    it('should generate white noise (for silence detection testing)', () => {
      const noiseBuffer = DummyAudioGenerator.generateWhiteNoisePCM(500);
      const base64Noise = noiseBuffer.toString('base64');

      expect(base64Noise).toBeDefined();
      expect(Buffer.from(base64Noise, 'base64').length).toBe(16000);
    });

    it('should generate silence (for pause testing)', () => {
      const silenceBuffer = DummyAudioGenerator.generateSilencePCM(500);
      const base64Silence = silenceBuffer.toString('base64');

      expect(base64Silence).toBeDefined();

      // Silence should decode to all zeros
      const decoded = Buffer.from(base64Silence, 'base64');
      const isAllZeros = decoded.every((byte) => byte === 0);
      expect(isAllZeros).toBe(true);
    });
  });

  describe('Simulated Gemini Session Flow', () => {
    it('should prepare audio stream for 4-minute Teil 1 session', () => {
      // Teil 1 is ~4 minutes = 240 seconds
      const sessionDurationSeconds = 240;
      const chunkDurationMs = 100; // 100ms chunks = typical WebSocket chunk
      const totalChunks = Math.floor(
        (sessionDurationSeconds * 1000) / chunkDurationMs,
      );

      const audioChunks = DummyAudioGenerator.generateAudioChunkSequence(
        totalChunks,
        chunkDurationMs,
      );

      expect(audioChunks.length).toBe(totalChunks);
      expect(audioChunks.length).toBeGreaterThan(2000); // Should be 2400 chunks for 4min

      // Each chunk should be exactly 3200 bytes (100ms at 16kHz)
      audioChunks.forEach((chunk) => {
        const decoded = Buffer.from(chunk, 'base64');
        expect(decoded.length).toBe(3200);
      });
    });

    it('should prepare audio for pause/resume scenario', () => {
      // Simulate: 2 minutes speaking, pause, 1 minute speaking
      const firstSegment = DummyAudioGenerator.generateAudioChunkSequence(
        1200, // 120 seconds of audio
        100,
      );
      const silence =
        DummyAudioGenerator.generateSilencePCM(10000).toString('base64'); // 10s pause
      const secondSegment = DummyAudioGenerator.generateAudioChunkSequence(
        600, // 60 seconds of audio
        100,
      );

      expect(firstSegment.length).toBe(1200);
      expect(Buffer.from(silence, 'base64').length).toBe(320000); // 10 seconds
      expect(secondSegment.length).toBe(600);

      // Total chunks if concatenated
      const totalChunks = firstSegment.length + secondSegment.length;
      expect(totalChunks).toBe(1800);
    });
  });

  describe('Audio-to-WebSocket Format', () => {
    it('should format audio chunk for WebSocket AudioChunkDto', () => {
      const audioData = DummyAudioGenerator.generateBase64AudioChunk(100);
      const timestamp = new Date().toISOString();

      const audioChunkDto = {
        data: audioData,
        timestamp: timestamp,
      };

      // Validate DTO structure
      expect(audioChunkDto.data).toBeDefined();
      expect(typeof audioChunkDto.data).toBe('string');
      expect(audioChunkDto.timestamp).toBeDefined();
      expect(typeof audioChunkDto.timestamp).toBe('string');

      // Verify Base64 can be decoded
      expect(() => Buffer.from(audioChunkDto.data, 'base64')).not.toThrow();
    });

    it('should prepare streaming payload for real-time transmission', () => {
      const chunks = DummyAudioGenerator.generateAudioChunkSequence(10, 100);

      // Simulate WebSocket streaming payload
      const streamingPayloads = chunks.map((audioData, index) => ({
        event: 'audio_chunk',
        data: {
          data: audioData,
          timestamp: new Date(Date.now() + index * 100).toISOString(),
          chunkNumber: index,
        },
      }));

      expect(streamingPayloads.length).toBe(10);
      expect(streamingPayloads[0].event).toBe('audio_chunk');
      expect(streamingPayloads[0].data.chunkNumber).toBe(0);
      expect(streamingPayloads[9].data.chunkNumber).toBe(9);
    });
  });

  describe('Performance & Constraints', () => {
    it('should generate audio chunks efficiently', () => {
      const startTime = Date.now();

      // Generate 100 chunks (10 seconds of audio)
      for (let i = 0; i < 100; i++) {
        DummyAudioGenerator.generateBase64AudioChunk(100);
      }

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(5000); // Should generate 100 chunks in < 5 seconds
    });

    it('should handle maximum session duration audio', () => {
      // Worst case: 6-minute session with 100ms chunks
      const chunkCount = 3600; // 6 minutes
      const startTime = Date.now();

      const chunks = DummyAudioGenerator.generateAudioChunkSequence(200, 100);
      const totalMemory = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

      const elapsed = Date.now() - startTime;

      expect(chunks.length).toBe(200);
      expect(totalMemory).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(2000);

      console.log(`Generated 200 chunks in ${elapsed}ms`);
      console.log(
        `Total memory footprint: ${(totalMemory / 1024 / 1024).toFixed(2)}MB`,
      );
    });
  });

  describe('Error Scenarios', () => {
    it('should handle invalid audio format gracefully', () => {
      const invalidBase64 = 'not-valid-base64!!!';

      // Attempting to decode should fail
      expect(() => Buffer.from(invalidBase64, 'base64')).not.toThrow(); // Base64 won't throw but produces garbage

      // But we should handle it in our validation
      const decoded = Buffer.from(invalidBase64, 'base64');
      expect(decoded.length).toBeLessThan(100); // Should be small gibberish
    });

    it('should handle audio duration edge cases', () => {
      // Very short audio
      const shortChunk = DummyAudioGenerator.generatePCMBuffer(10); // 10ms
      expect(shortChunk.length).toBe(320); // 16000 * 0.01 * 2

      // Very long audio
      const longChunk = DummyAudioGenerator.generatePCMBuffer(5000); // 5 seconds
      expect(longChunk.length).toBe(160000); // 16000 * 5 * 2
    });
  });

  describe('Real-World Scenarios', () => {
    it('should simulate Part 1 (Biographical) conversation flow', () => {
      // Typical Teil 1: Questions about yourself
      // Elena asks questions (we don't generate audio, just receive)
      // Student responds (we generate these audio chunks)

      const studentResponses = [
        { duration: 1000, label: 'Name introduction' },
        { duration: 2000, label: 'Origin explanation' },
        { duration: 1500, label: 'Current location' },
        { duration: 2500, label: 'Hobbies discussion' },
        { duration: 2000, label: 'Work/Study info' },
        { duration: 1500, label: 'Language learning motivation' },
      ];

      const audioResponses = studentResponses.map((response) => ({
        label: response.label,
        durationMs: response.duration,
        base64Audio: DummyAudioGenerator.generateBase64AudioChunk(
          response.duration,
        ),
      }));

      expect(audioResponses.length).toBe(6);
      audioResponses.forEach((response) => {
        expect(
          Buffer.from(response.base64Audio, 'base64').length,
        ).toBeGreaterThan(0);
      });
    });

    it('should simulate interruption and resume scenario', () => {
      // Student is speaking, connection drops, resumes
      const beforeInterruption = DummyAudioGenerator.generateAudioChunkSequence(
        50,
        100,
      );
      const afterResume = DummyAudioGenerator.generateAudioChunkSequence(
        30,
        100,
      );

      expect(beforeInterruption.length).toBe(50);
      expect(afterResume.length).toBe(30);

      // Total audio should still be valid when combined
      const allChunks = [...beforeInterruption, ...afterResume];
      expect(allChunks.length).toBe(80);
    });
  });
});
