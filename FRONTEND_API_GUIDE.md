# SPRECHEN Module — Frontend Integration Guide

**Base URL:** `http://localhost:3000`  
**All REST endpoints require:** `Authorization: Bearer <accessToken>`  
**WebSocket namespace:** `/speaking`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Complete Flow Overview](#2-complete-flow-overview)
3. [REST Endpoints](#3-rest-endpoints)
4. [WebSocket Events](#4-websocket-events)
5. [Audio Format](#5-audio-format)
6. [Error Codes](#6-error-codes)
7. [Data Types](#7-data-types)
8. [Flutter Integration Examples](#8-flutter-integration-examples)

---

## 1. Authentication

### POST `/api/auth/activate`

Activate a student account and receive JWT tokens.

**Request:**
```json
{
  "activationCode": "T1X2-A3B4-C5D6",
  "firstName": "Max",
  "lastName": "Mustermann",
  "email": "max@example.com",
  "deviceId": "flutter-device-abc123"
}
```

**Response (201):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "student": {
    "id": "uuid-here",
    "firstName": "Max",
    "lastName": "Mustermann",
    "email": "max@example.com",
    "isRegistered": true,
    "createdAt": "2026-02-11T10:00:00.000Z",
    "updatedAt": "2026-02-11T10:00:00.000Z"
  },
  "bootstrap": {
    "availableModules": ["SPRECHEN", "LESEN", "HOEREN", "SCHREIBEN"],
    "enabledModules": ["SPRECHEN"],
    "progressSummary": {},
    "lastActivityAt": null,
    "expiresAt": "2026-03-13T10:00:00.000Z"
  }
}
```

Use `accessToken` for all subsequent requests. If expired, use `POST /api/auth/refresh` with the `refreshToken`.

---

## 2. Complete Flow Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    SPRECHEN EXAM FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. POST /api/speaking/session/start                        │
│     → Returns sessionId, timeLimit                          │
│                                                              │
│  2. Connect WebSocket to /speaking?sessionId=xxx            │
│     → Auth via { auth: { token: accessToken } }             │
│     → Receives 'session_ready' event                        │
│                                                              │
│  3. Send audio chunks via 'audio_chunk' event               │
│     → Receive 'audio_response' events (Elena's replies)     │
│     → Receive 'time_warning' events (120s/60s/30s)          │
│                                                              │
│  4. (Optional) Pause/Resume via WebSocket events            │
│     → 'pause_session' / 'resume_session'                    │
│                                                              │
│  5. Disconnect WebSocket                                    │
│                                                              │
│  6. POST /api/speaking/session/:sessionId/end               │
│     → Returns duration, wordCount, isEvaluable              │
│                                                              │
│  7. POST /api/speaking/session/:sessionId/evaluate          │
│     → Returns scores, corrections, feedback                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. REST Endpoints

All endpoints require header: `Authorization: Bearer <accessToken>`

### 3.1 Start Session

**`POST /api/speaking/session/start`**

Creates a new speaking exam session. Only one active session per student is allowed.

**Request Body:**
```json
{
  "teilNumber": 1,
  "useTimer": true
}
```

| Field | Type | Required | Values | Description |
|-------|------|----------|--------|-------------|
| `teilNumber` | number | Yes | 1, 2, 3 | Teil 1 = intro, Teil 2 = opinion, Teil 3 = debate |
| `useTimer` | boolean | Yes | true/false | Enable countdown timer |

**Response (201):**
```json
{
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "teilNumber": 1,
  "useTimer": true,
  "serverStartTime": "2026-02-11T14:30:00.000Z",
  "timeLimit": 240,
  "teilInstructions": "In Teil 1 stellen Sie sich vor..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string (UUID) | Use this to connect WebSocket and end/evaluate |
| `teilNumber` | number | 1, 2, or 3 |
| `useTimer` | boolean | Whether timer is active |
| `serverStartTime` | string (ISO 8601) | Server-authoritative start time |
| `timeLimit` | number \| null | Seconds (240 for Teil 1, 360 for Teil 2/3, null if no timer) |
| `teilInstructions` | string | Human-readable instructions for the student |

**Errors:**
- `400 EXISTING_ACTIVE_SESSION` — Student already has an active/paused session
- `400 FAILED_TO_CREATE_SESSION` — Database error
- `401` — Invalid/missing JWT

---

### 3.2 End Session

**`POST /api/speaking/session/:sessionId/end`**

End the speaking exam. Call this AFTER disconnecting WebSocket.

**Request Body (optional):**
```json
{
  "reason": "completed"
}
```

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `reason` | string | No | `"completed"` or `"cancelled"` |

**Response (200):**
```json
{
  "duration": 185,
  "wordCount": 127,
  "messageCount": 14,
  "isEvaluable": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `duration` | number | Total elapsed seconds |
| `wordCount` | number | Words spoken by student |
| `messageCount` | number | Total conversation messages |
| `isEvaluable` | boolean | True if enough data to evaluate (duration >= 30s) |

**Errors:**
- `404 SESSION_NOT_FOUND` — Session doesn't exist or doesn't belong to student
- `400 SESSION_ALREADY_ENDED` — Session is already completed/interrupted

---

### 3.3 Evaluate Session

**`POST /api/speaking/session/:sessionId/evaluate`**

Request AI evaluation of a completed session. Takes 5-30 seconds.

**Request Body:** Empty `{}`

**Response (200):**
```json
{
  "pronunciation_score": 78,
  "fluency_score": 82,
  "grammar_score": 75,
  "vocabulary_score": 72,
  "overall_score": 78,
  "strengths": "Der Schüler spricht fließend und kann seine Meinungen klar ausdrücken. Die Aussprache ist gut verständlich.",
  "areas_for_improvement": "Die Verbkonjugation in der dritten Person sollte verbessert werden. Mehr Konjunktionen würden die Sätze natürlicher machen.",
  "corrections": [
    {
      "original": "Ich gehen oft ins Kino",
      "corrected": "Ich gehe oft ins Kino",
      "explanation": "Das Verb 'gehen' muss konjugiert werden: 'ich gehe'.",
      "error_type": "grammar"
    },
    {
      "original": "Das ist sehr gut für mich",
      "corrected": "Das gefällt mir sehr",
      "explanation": "Im Deutschen sagt man 'es gefällt mir' statt 'es ist gut für mich'.",
      "error_type": "vocabulary"
    }
  ]
}
```

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `pronunciation_score` | number | 0-100 | Clarity and accent |
| `fluency_score` | number | 0-100 | Natural flow, hesitations |
| `grammar_score` | number | 0-100 | Sentence structure |
| `vocabulary_score` | number | 0-100 | Range and appropriateness |
| `overall_score` | number | 0-100 | Weighted average |
| `strengths` | string | — | Positive feedback (German) |
| `areas_for_improvement` | string | — | Areas to work on (German) |
| `corrections` | array | max 10 | Top corrections with explanations |

**Each correction:**
| Field | Type | Values |
|-------|------|--------|
| `original` | string | What student said |
| `corrected` | string | Correct version |
| `explanation` | string | Explanation in German |
| `error_type` | string | `"grammar"`, `"pronunciation"`, or `"vocabulary"` |

**Score Ranges (B1 Level):**
- 90-100: Excellent — exceeds B1
- 75-89: Good — solid B1
- 60-74: Satisfactory — meets B1 minimum
- 50-59: Needs improvement
- 0-49: Insufficient

**Errors:**
- `404 SESSION_NOT_FOUND` — Session doesn't exist or doesn't belong to student
- `400 SESSION_NOT_COMPLETED` — Session must be `completed` or `interrupted`
- `404 TRANSCRIPT_NOT_FOUND` — No transcript saved (no audio was exchanged)
- `400 EVALUATION_TIMEOUT` — Gemini took longer than 30 seconds
- `400 EVALUATION_PARSE_FAILED` — AI returned invalid format (retry)

---

### 3.4 Pause Session (DEPRECATED)

**`PATCH /api/speaking/session/:sessionId/pause`**

> **DEPRECATED** — Use WebSocket `pause_session` event instead. This endpoint only updates DB status and does NOT manage Gemini audio connection.

---

### 3.5 Resume Session (DEPRECATED)

**`PATCH /api/speaking/session/:sessionId/resume`**

> **DEPRECATED** — Use WebSocket `resume_session` event instead. This endpoint only updates DB status and does NOT re-initialize Gemini.

---

## 4. WebSocket Events

### 4.1 Connection

**Namespace:** `/speaking`  
**URL:** `http://localhost:3000/speaking`  
**Transport:** WebSocket only (recommended) or polling fallback

**Connection parameters:**
```
Query:   { sessionId: "uuid-from-start-session" }
Auth:    { token: "your-jwt-access-token" }
```

**Socket.io client example:**
```javascript
const socket = io('http://localhost:3000/speaking', {
  query: { sessionId: 'a1b2c3d4-...' },
  auth: { token: 'eyJhbGciOiJIUzI1NiIs...' },
  transports: ['websocket'],
});
```

### 4.2 Server → Client Events

#### `session_ready`
Emitted once after successful connection and Gemini initialization.

```json
{
  "sessionId": "a1b2c3d4-...",
  "teilNumber": 1,
  "serverStartTime": "2026-02-11T14:30:00.000Z",
  "timeLimit": 240,
  "status": "ready",
  "message": "WebSocket connection established and Gemini session initialized"
}
```

#### `audio_response`
Emitted when Elena (AI examiner) responds. May contain text, audio, or both.

```json
{
  "text": "Hallo! Ich bin Elena...",
  "audioData": "SGVsbG8gd29ybGQ...",
  "audioMimeType": "audio/pcm;rate=24000",
  "timestamp": "2026-02-11T14:30:05.000Z"
}
```

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Transcribed text (may be null for audio-only responses) |
| `audioData` | string | Yes | Base64-encoded PCM audio |
| `audioMimeType` | string | Yes | Always `"audio/pcm;rate=24000"` when present |
| `timestamp` | string | No | Server timestamp |

**Audio playback:** Decode Base64 → raw PCM bytes → play at 24kHz, 16-bit, mono.

#### `time_warning`
Emitted at 120s, 60s, and 30s remaining.

```json
{
  "remainingSeconds": 120,
  "sessionId": "a1b2c3d4-..."
}
```

#### `session_ended`
Emitted when the timer expires (auto-end).

```json
{
  "reason": "timer_expired",
  "sessionId": "a1b2c3d4-...",
  "message": "Session time limit reached"
}
```

#### `session_paused`
Emitted after successful pause.

```json
{
  "sessionId": "a1b2c3d4-...",
  "elapsedSeconds": 65,
  "message": "Session paused, you have 60 seconds to resume"
}
```

#### `session_resumed`
Emitted after successful resume.

```json
{
  "sessionId": "a1b2c3d4-...",
  "message": "Session resumed, you can continue speaking"
}
```

#### `pause_timeout`
Emitted when pause exceeds 60 seconds (Gemini connection closed).

```json
{
  "message": "Pause exceeded 60 seconds, Gemini connection closed"
}
```

After receiving this, the student can still `resume_session` — the server will re-initialize Gemini with conversation history.

#### `gemini_error`
Emitted when Gemini Live API encounters an error.

```json
{
  "code": "GEMINI_LIVE_ERROR",
  "message": "Error description"
}
```

#### `connection_error`
Emitted when WebSocket connection fails during handshake.

```json
{
  "code": 4001,
  "message": "Session not found"
}
```

See [Error Codes](#6-error-codes) for all codes.

#### `error`
Emitted for runtime errors (invalid audio, session state issues).

```json
{
  "code": "INVALID_AUDIO_FORMAT",
  "message": "Audio data must be a non-empty Base64 string"
}
```

---

### 4.3 Client → Server Events

#### `audio_chunk`
Send audio data to the AI examiner.

```json
{
  "data": "SGVsbG8gd29ybGQ...",
  "timestamp": "2026-02-11T14:30:02.000Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | string | Yes | Base64-encoded PCM audio (max 100KB) |
| `timestamp` | string | Yes | Client timestamp (ISO 8601) |

Send one chunk every 100-200ms for real-time streaming.

#### `pause_session`
Pause the exam. No payload needed.

```javascript
socket.emit('pause_session');
// Server responds with 'session_paused' event
```

- Gemini stays alive for 60 seconds
- Timer warnings stop during pause
- If not resumed within 60s, Gemini closes (but session remains pauseable)

#### `resume_session`
Resume a paused exam. No payload needed.

```javascript
socket.emit('resume_session');
// Server responds with 'session_resumed' event
```

- If Gemini was closed (pause > 60s), it re-initializes with conversation history
- Timer warnings and auto-end are recalculated

---

## 5. Audio Format

### Client → Server (Student's Voice)
| Property | Value |
|----------|-------|
| Format | PCM (raw, no header) |
| Sample Rate | 16,000 Hz |
| Bit Depth | 16-bit signed integer |
| Channels | 1 (mono) |
| Encoding | Base64 |
| Chunk Duration | ~100ms recommended |
| Max Chunk Size | 100 KB (Base64) |

### Server → Client (Elena's Voice)
| Property | Value |
|----------|-------|
| Format | PCM (raw, no header) |
| Sample Rate | 24,000 Hz |
| Bit Depth | 16-bit signed integer |
| Channels | 1 (mono) |
| Encoding | Base64 |

### Recording Audio (Flutter)
```dart
// Use flutter_sound or record package
// Configure recorder:
//   sampleRate: 16000
//   numChannels: 1
//   bitRate: 256000
//   codec: pcm16bit (raw PCM, no headers)
//
// Convert each chunk to Base64 before sending
```

### Playing Audio (Flutter)
```dart
// Decode Base64 to Uint8List
// Play using flutter_sound or audioplayers
// Configure player:
//   sampleRate: 24000
//   numChannels: 1
//   codec: pcm16bit
```

---

## 6. Error Codes

### WebSocket Connection Errors (4000-4999)

| Code | Meaning | Action |
|------|---------|--------|
| 4001 | Session not found | Check sessionId from start response |
| 4002 | Invalid session status | Session must be `active` |
| 4003 | Student validation failed | Student account issue |
| 4004 | No active activation code | Activation code expired or inactive |
| 4005 | Activation code expired | Get new code |
| 4006 | Session already connected | Another device is connected |
| 4007 | Gemini initialization failed | Server-side AI error, retry |
| 4008 | No JWT token provided | Pass token in auth object |
| 4009 | Invalid or expired token | Refresh token and reconnect |
| 4010 | Session ownership mismatch | Session belongs to different student |
| 5000 | Unexpected server error | Retry |

### WebSocket Runtime Errors (string codes)

| Code | Meaning |
|------|---------|
| `SESSION_NOT_FOUND` | No session context for this client |
| `INVALID_SESSION_STATE` | Cannot perform action in current state |
| `INVALID_AUDIO_FORMAT` | Audio data is not a valid string |
| `INVALID_BASE64` | Audio data is not valid Base64 |
| `AUDIO_CHUNK_TOO_LARGE` | Exceeds 100KB limit |
| `RATE_LIMIT_EXCEEDED` | Too many chunks per second |
| `GEMINI_SESSION_NOT_FOUND` | AI session was closed |
| `GEMINI_LIVE_ERROR` | AI processing error |
| `PAUSE_FAILED` | Unexpected error during pause |
| `RESUME_FAILED` | Unexpected error during resume |
| `GEMINI_REINIT_FAILED` | Failed to restart AI after long pause |

### REST API Errors

| Error | HTTP Status | Meaning |
|-------|-------------|---------|
| `EXISTING_ACTIVE_SESSION` | 400 | Already have an active session |
| `FAILED_TO_CREATE_SESSION` | 400 | Database error creating session |
| `SESSION_NOT_FOUND` | 404 | Session doesn't exist or not owned |
| `SESSION_ALREADY_ENDED` | 400 | Session already completed |
| `SESSION_NOT_COMPLETED` | 400 | Must end session before evaluating |
| `TRANSCRIPT_NOT_FOUND` | 404 | No conversation data saved |
| `EMPTY_TRANSCRIPT` | 400 | Transcript has no messages |
| `EVALUATION_TIMEOUT` | 400 | AI eval took > 30s |
| `EVALUATION_PARSE_FAILED` | 400 | AI returned invalid format, retry |
| `EVALUATION_SAVE_FAILED` | 400 | Database error saving evaluation |

---

## 7. Data Types

### Session States

```
active → paused → active (resumed)
active → completed (manual end or timer expiry)
active → interrupted (disconnect timeout)
paused → grace_period (pause > 60s, Gemini closed)
grace_period → active (resumed, Gemini re-initialized)
```

### Time Limits

| Teil | Duration | Warnings At |
|------|----------|------------|
| Teil 1 | 240s (4 min) | 120s, 60s, 30s remaining |
| Teil 2 | 360s (6 min) | 120s, 60s, 30s remaining |
| Teil 3 | 360s (6 min) | 120s, 60s, 30s remaining |

If `useTimer: false`, no time limit or warnings.

---

## 8. Flutter Integration Examples

### Complete Flow

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:http/http.dart' as http;
import 'dart:convert';

class SprechenService {
  static const baseUrl = 'http://localhost:3000';
  String? accessToken;
  String? sessionId;
  IO.Socket? socket;

  // Step 1: Authenticate
  Future<void> authenticate(String activationCode) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/auth/activate'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'activationCode': activationCode,
        'firstName': 'Max',
        'lastName': 'Mustermann',
        'email': 'max@example.com',
        'deviceId': 'flutter-${DateTime.now().millisecondsSinceEpoch}',
      }),
    );

    final data = jsonDecode(response.body);
    accessToken = data['accessToken'];
  }

  // Step 2: Start Session
  Future<Map<String, dynamic>> startSession(int teilNumber) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/speaking/session/start'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $accessToken',
      },
      body: jsonEncode({
        'teilNumber': teilNumber,
        'useTimer': true,
      }),
    );

    final data = jsonDecode(response.body);
    sessionId = data['sessionId'];
    return data;
  }

  // Step 3: Connect WebSocket
  void connectWebSocket({
    required Function(Map<String, dynamic>) onAudioResponse,
    required Function(int) onTimeWarning,
    required Function(String) onSessionEnd,
    required Function(String) onError,
  }) {
    socket = IO.io(
      '$baseUrl/speaking',
      IO.OptionBuilder()
          .setTransports(['websocket'])
          .setQuery({'sessionId': sessionId})
          .setAuth({'token': accessToken})
          .build(),
    );

    socket!.on('session_ready', (data) {
      print('Session ready: ${data['message']}');
    });

    socket!.on('audio_response', (data) {
      onAudioResponse(Map<String, dynamic>.from(data));
    });

    socket!.on('time_warning', (data) {
      onTimeWarning(data['remainingSeconds']);
    });

    socket!.on('session_ended', (data) {
      onSessionEnd(data['reason']);
    });

    socket!.on('error', (data) {
      onError(data['message'] ?? 'Unknown error');
    });

    socket!.on('gemini_error', (data) {
      onError('AI Error: ${data['message']}');
    });
  }

  // Step 4: Send Audio
  void sendAudioChunk(String base64Audio) {
    socket?.emit('audio_chunk', {
      'data': base64Audio,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
    });
  }

  // Step 5: Pause/Resume
  void pauseSession() => socket?.emit('pause_session');
  void resumeSession() => socket?.emit('resume_session');

  // Step 6: End Session
  Future<Map<String, dynamic>> endSession() async {
    socket?.disconnect();

    await Future.delayed(Duration(milliseconds: 500));

    final response = await http.post(
      Uri.parse('$baseUrl/api/speaking/session/$sessionId/end'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $accessToken',
      },
      body: jsonEncode({'reason': 'completed'}),
    );

    return jsonDecode(response.body);
  }

  // Step 7: Evaluate
  Future<Map<String, dynamic>> evaluateSession() async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/speaking/session/$sessionId/evaluate'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $accessToken',
      },
      body: '{}',
    );

    return jsonDecode(response.body);
  }

  void dispose() {
    socket?.disconnect();
    socket?.dispose();
  }
}
```

### Audio Recording with flutter_sound

```dart
import 'package:flutter_sound/flutter_sound.dart';
import 'dart:typed_data';
import 'dart:convert';

class AudioRecorder {
  final FlutterSoundRecorder _recorder = FlutterSoundRecorder();
  final Function(String) onAudioChunk;

  AudioRecorder({required this.onAudioChunk});

  Future<void> startRecording() async {
    await _recorder.openRecorder();

    // Record raw PCM at 16kHz mono
    await _recorder.startRecorder(
      toStream: _audioStreamController.sink,
      codec: Codec.pcm16,
      numChannels: 1,
      sampleRate: 16000,
    );
  }

  // Called when audio data is available
  void _onAudioData(Uint8List data) {
    // Convert to Base64 and send
    final base64 = base64Encode(data);
    onAudioChunk(base64);
  }

  Future<void> stopRecording() async {
    await _recorder.stopRecorder();
    await _recorder.closeRecorder();
  }
}
```

### Audio Playback (Elena's Response)

```dart
import 'dart:convert';
import 'dart:typed_data';

class AudioPlayer {
  // When receiving audio_response event:
  void playResponse(Map<String, dynamic> response) {
    if (response['audioData'] != null) {
      // Decode Base64 to bytes
      final Uint8List audioBytes = base64Decode(response['audioData']);

      // Play as raw PCM at 24kHz, 16-bit mono
      // Use flutter_sound or just_audio with raw PCM support
      _playPcmAudio(audioBytes, sampleRate: 24000);
    }

    if (response['text'] != null) {
      // Display subtitle text
      print('Elena: ${response['text']}');
    }
  }
}
```

---

## Quick Reference Card

```
AUTH:     POST /api/auth/activate         → { accessToken, student }
START:    POST /api/speaking/session/start → { sessionId, timeLimit }
CONNECT:  WS   /speaking?sessionId=xxx    → 'session_ready'
AUDIO:    emit  'audio_chunk' { data, timestamp }
RECEIVE:  on    'audio_response' { text, audioData, audioMimeType }
TIMER:    on    'time_warning' { remainingSeconds }
PAUSE:    emit  'pause_session'           → 'session_paused'
RESUME:   emit  'resume_session'          → 'session_resumed'
END:      POST /api/speaking/session/:id/end → { duration, wordCount }
EVAL:     POST /api/speaking/session/:id/evaluate → { scores, corrections }
```
