/**
 * Test utility to generate dummy PCM audio data for Gemini testing
 * Creates valid 16-bit signed PCM audio at 16kHz sample rate
 */
export class DummyAudioGenerator {
  /**
   * Generate a dummy PCM audio buffer
   * @param durationMs Duration in milliseconds
   * @param frequency Frequency of sine wave (Hz)
   * @returns Buffer containing PCM audio data
   */
  static generatePCMBuffer(
    durationMs: number = 500,
    frequency: number = 440,
  ): Buffer {
    const sampleRate = 16000; // Required for Gemini
    const bytesPerSample = 2; // 16-bit = 2 bytes
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    const bufferSize = numSamples * bytesPerSample;

    const buffer = Buffer.alloc(bufferSize);
    const amplitude = 32767 * 0.3; // 30% of max amplitude to avoid clipping

    for (let i = 0; i < numSamples; i++) {
      // Generate sine wave
      const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
      const sample = Math.floor(value * amplitude);

      // Write 16-bit signed integer (little-endian)
      buffer.writeInt16LE(sample, i * bytesPerSample);
    }

    return buffer;
  }

  /**
   * Generate Base64-encoded PCM audio chunk
   * @param durationMs Duration in milliseconds
   * @param frequency Frequency of sine wave (Hz)
   * @returns Base64-encoded string
   */
  static generateBase64AudioChunk(
    durationMs: number = 500,
    frequency: number = 440,
  ): string {
    const buffer = this.generatePCMBuffer(durationMs, frequency);
    return buffer.toString('base64');
  }

  /**
   * Generate multiple audio chunks (simulating continuous streaming)
   * @param chunkCount Number of chunks to generate
   * @param chunkDurationMs Duration of each chunk in milliseconds
   * @returns Array of Base64-encoded audio chunks
   */
  static generateAudioChunkSequence(
    chunkCount: number = 10,
    chunkDurationMs: number = 100,
  ): string[] {
    const chunks: string[] = [];
    const frequencies = [440, 494, 523, 587, 659, 698, 784, 880]; // Musical notes

    for (let i = 0; i < chunkCount; i++) {
      const frequency = frequencies[i % frequencies.length];
      chunks.push(this.generateBase64AudioChunk(chunkDurationMs, frequency));
    }

    return chunks;
  }

  /**
   * Generate white noise (for testing audio detection)
   * @param durationMs Duration in milliseconds
   * @returns Buffer containing PCM white noise
   */
  static generateWhiteNoisePCM(durationMs: number = 500): Buffer {
    const sampleRate = 16000;
    const bytesPerSample = 2;
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    const bufferSize = numSamples * bytesPerSample;

    const buffer = Buffer.alloc(bufferSize);
    const amplitude = 32767 * 0.1; // 10% amplitude to avoid clipping

    for (let i = 0; i < numSamples; i++) {
      // Random noise
      const sample = Math.floor((Math.random() - 0.5) * 2 * amplitude);
      buffer.writeInt16LE(sample, i * bytesPerSample);
    }

    return buffer;
  }

  /**
   * Generate silence (for testing pause/resume)
   * @param durationMs Duration in milliseconds
   * @returns Buffer containing PCM silence
   */
  static generateSilencePCM(durationMs: number = 500): Buffer {
    const sampleRate = 16000;
    const bytesPerSample = 2;
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    const bufferSize = numSamples * bytesPerSample;

    return Buffer.alloc(bufferSize, 0); // All zeros = silence
  }
}
