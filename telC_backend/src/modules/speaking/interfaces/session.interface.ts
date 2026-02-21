/**
 * Session context object maintained in-memory for each active WebSocket connection
 * This tracks the state of a speaking session with Gemini Live API
 */
export interface SessionContext {
  clientId: string; // Socket.io client ID
  sessionId: string; // Exam session ID from database
  studentId: string; // Student ID from token
  teilNumber: number; // Which Teil (1, 2, or 3)
  conversationHistory: ConversationMessage[]; // Array of all messages in conversation
  status: 'active' | 'paused' | 'grace_period' | 'interrupted'; // Current session status
  startTime: Date; // When this session started
  elapsedSeconds: number; // Total elapsed time
  timeLimit: number | null; // Time limit in seconds (or null for no timer)
  expectedEndTime: Date | null; // Calculated end time (startTime + timeLimit)
  disconnectTimer: NodeJS.Timeout | null; // Grace period timeout
  pauseTimer: NodeJS.Timeout | null; // Idle detection timeout
  lastAudioTimestamp: Date; // Last received audio chunk timestamp
  pausePending: boolean; // Flag to pause after current Elena turn completes
  geminiConnectionAttempts: number; // Track retry attempts
  lastGeminiError: string | null; // Store error for potential recovery
  chunkTimestamps: number[]; // Track recent chunk timestamps for rate limiting
  timerHandles: NodeJS.Timeout[]; // Timer warning + auto-end handles for cleanup
  pauseGeminiCloseTimer?: NodeJS.Timeout; // 60s timer to close Gemini during pause
}

export interface ConversationMessage {
  speaker: 'elena' | 'student'; // Who spoke
  text: string; // What they said
  timestamp: string; // ISO 8601 timestamp
}

export interface GeminiLiveSessionConfig {
  model: string; // e.g., 'gemini-2.0-flash-exp'
  systemInstruction: string; // Teil-specific prompt
  voiceName: string; // e.g., 'Zephyr'
}

export interface AudioChunkPayload {
  data: string; // Base64-encoded PCM audio
  timestamp: string; // Client timestamp
}

export interface SessionErrorResponse {
  error: string;
  message: string;
  errorCode: number;
}
