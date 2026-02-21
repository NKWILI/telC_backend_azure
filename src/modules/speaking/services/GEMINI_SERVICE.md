# Gemini Service - SPRECHEN Module

## Overview

The `GeminiService` manages real-time connections to Google's Gemini Live API for conducting German speaking exams with the AI examiner "Elena". It handles session lifecycle, audio streaming, and connection management.

## Key Features

### 1. **Prompt Caching**
- Loads Teil-specific system instructions from disk on startup
- Caches prompts in memory with automatic TTL refresh
- Enables context-aware conversation continuation on resume

### 2. **Live Session Management**
- Creates persistent Gemini Live API connections per exam session
- Maintains session state in-memory for low-latency operations
- Supports graceful connection closure with cleanup

### 3. **Audio Streaming**
- Accepts Base64-encoded 16-bit PCM audio @ 16kHz
- Forwards audio chunks to Gemini in real-time
- Validates audio format before transmission

## Usage

### Initialization

The service loads prompts on module startup:

```typescript
// In your Speaking module's `onModuleInit`
constructor(private geminiService: GeminiService) {}

async onModuleInit() {
  // Prompts are automatically loaded
}
```

### Creating a Live Session

```typescript
const sessionId = 'abc-123-def';
const teilNumber = 1; // 1, 2, or 3

const geminiSession = await this.geminiService.createLiveSession(
  sessionId,
  teilNumber
);
```

**With Context (Resuming a Session):**

```typescript
const conversationHistory = [
  { speaker: 'elena', text: 'Guten Tag!', timestamp: '2026-02-10T10:00:00Z' },
  { speaker: 'student', text: 'Hallo!', timestamp: '2026-02-10T10:00:02Z' },
];

const geminiSession = await this.geminiService.createLiveSession(
  sessionId,
  teilNumber,
  conversationHistory // Optional: provides context for continuation
);
```

### Sending Audio

```typescript
const audioData = 'SGVsbG8gV29ybGQh...'; // Base64-encoded PCM

await this.geminiService.sendAudioChunk(
  sessionId,
  audioData,
  'audio/pcm;rate=16000' // MIME type (default shown)
);
```

### Closing a Session

```typescript
await this.geminiService.closeLiveSession(sessionId);
```

## Audio Format Requirements

- **Encoding**: 16-bit signed PCM
- **Sample Rate**: 16,000 Hz (16kHz)
- **Channel**: Mono
- **Chunk Duration**: 100-200ms recommended
- **Transmission**: Base64-encoded (for WebSocket compatibility)

### Generating Test Audio

The `DummyAudioGenerator` utility creates valid test audio:

```typescript
import { DummyAudioGenerator } from 'test/fixtures/dummy-audio.generator';

// Single chunk
const base64Chunk = DummyAudioGenerator.generateBase64AudioChunk(100); // 100ms

// Sequence of chunks (simulating continuous stream)
const chunks = DummyAudioGenerator.generateAudioChunkSequence(50, 100); // 50 chunks of 100ms

// White noise (for testing)
const noiseBuffer = DummyAudioGenerator.generateWhiteNoisePCM(500);

// Silence (for pause testing)
const silenceBuffer = DummyAudioGenerator.generateSilencePCM(500);
```

## API Methods

### `createLiveSession(sessionId, teilNumber, conversationHistory?)`

Creates a new Gemini Live API connection.

**Parameters:**
- `sessionId` (string): Unique exam session identifier
- `teilNumber` (number): Which Teil (1, 2, or 3)
- `conversationHistory?` (array): Optional previous conversation for context

**Returns:** Gemini session object

**Throws:** Error if API key not configured or Teil invalid

---

### `sendAudioChunk(sessionId, audioData, mimeType?)`

Sends audio data to an active Gemini session.

**Parameters:**
- `sessionId` (string): Session identifier
- `audioData` (string): Base64-encoded PCM audio
- `mimeType?` (string): Default `'audio/pcm;rate=16000'`

**Returns:** Promise<void>

**Throws:** Error if session not found or audio invalid

---

### `closeLiveSession(sessionId)`

Gracefully closes a Gemini Live session.

**Parameters:**
- `sessionId` (string): Session identifier

**Returns:** Promise<void>

**Note:** Does not throw if session not found (idempotent)

---

### `getSystemInstruction(teilNumber)`

Retrieves the cached system instruction for a Teil.

**Parameters:**
- `teilNumber` (number): Which Teil (1, 2, or 3)

**Returns:** String containing system instruction

**Throws:** Error if Teil not found

---

### `getActiveSession(sessionId)`

Retrieves an active Gemini session object.

**Parameters:**
- `sessionId` (string): Session identifier

**Returns:** Gemini session object or undefined

---

### `isSessionActive(sessionId)`

Checks if a session is currently active and connected.

**Parameters:**
- `sessionId` (string): Session identifier

**Returns:** Boolean

---

## Configuration

### Environment Variables

```env
GEMINI_API_KEY=your-api-key-here
GEMINI_IDLE_TIMEOUT_SECONDS=60
```

### Model & Voice Configuration

```typescript
// Defined in service
private readonly GEMINI_MODEL = 'gemini-2.0-flash-exp';
private readonly VOICE_NAME = 'Zephyr'; // Professional female voice
private readonly RESPONSE_MODALITIES = ['AUDIO'];
```

## Testing

### Run All Tests

```bash
npm test
```

### Run Gemini Service Tests

```bash
npm test -- test/gemini.service.spec.ts
```

### Run Integration Tests

```bash
npm test -- test/gemini-integration.spec.ts
```

### Test Coverage

- ✅ Prompt loading and caching
- ✅ Audio generation and encoding
- ✅ Base64 validation
- ✅ Session lifecycle
- ✅ Error handling
- ✅ Multi-chunk streaming

## Error Handling

### Rate Limit (429)

```typescript
try {
  await geminiService.sendAudioChunk(sessionId, audioData);
} catch (error) {
  if (error.message.includes('429')) {
    // Save session state and notify user
    await saveInterruptedSession(sessionId);
  }
}
```

### Network Timeout

```typescript
try {
  const session = await geminiService.createLiveSession(sessionId, teilNumber);
} catch (error) {
  if (error.message.includes('timeout')) {
    // Retry with exponential backoff
    await retryWithBackoff(() => 
      geminiService.createLiveSession(sessionId, teilNumber)
    );
  }
}
```

### Invalid Session

```typescript
const isActive = geminiService.isSessionActive(sessionId);
if (!isActive) {
  // Session is inactive or not found
  throw new Error('SESSION_NOT_FOUND');
}
```

## Performance Considerations

1. **Prompt Loading**: Done once at startup (cached in memory)
2. **Audio Processing**: Base64 encoding/decoding is CPU-bound but fast
3. **Memory**: Each active session holds ~1MB of metadata
4. **Connections**: Limited by Gemini API quotas (check documentation)

## Future Enhancements

- [ ] Automatic retry logic with exponential backoff
- [ ] Connection pooling for multiple simultaneous sessions
- [ ] Metrics collection (success rate, latency, error types)
- [ ] Batch audio processing for offline scenarios
- [ ] Support for additional voice options (Aoede, etc.)

## References

- [Google Generative AI SDK](https://github.com/google/generative-ai-js)
- [Gemini Live API Documentation](https://ai.google.dev/)
- [PCM Audio Format](https://en.wikipedia.org/wiki/Pulse-code_modulation)
- [WebSocket Audio Streaming Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
