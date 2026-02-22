import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleGenAI, Modality, Session } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';
import { ConversationMessage } from '../interfaces/session.interface';

/**
 * Callbacks for receiving asynchronous Live API responses
 */
export interface GeminiSessionCallbacks {
  onAudioResponse: (data: {
    text?: string;
    audioData?: string;
    audioMimeType?: string;
  }) => void;
  onInputTranscription?: (text: string) => void;
  onOutputTranscription?: (text: string) => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

/**
 * Internal structure for tracking active Gemini Live sessions
 */
interface GeminiSessionData {
  session: Session;
  callbacks: GeminiSessionCallbacks;
  createdAt: Date;
  teilNumber: number;
  status: 'connecting' | 'connected' | 'disconnected';
  setupComplete: boolean;
}

@Injectable()
export class GeminiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GeminiService.name);
  private ai: GoogleGenAI;
  private promptCache: Map<number, string> = new Map();
  private activeSessions: Map<string, GeminiSessionData> = new Map();

  // Configuration
  private readonly GEMINI_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
  private readonly GEMINI_TEXT_MODEL = 'gemini-2.0-flash';
  private readonly VOICE_NAME = 'Zephyr';

  constructor(private configService: ConfigService) {}

  /**
   * Load Teil prompts from disk on module initialization
   */
  async onModuleInit() {
    try {
      this.logger.log('Initializing Gemini Service...');

      const apiKey = this.configService.get<string>('GEMINI_API_KEY');
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured in environment');
      }
      this.ai = new GoogleGenAI({ apiKey });

      await this.loadPrompts();
      this.logger.log('Gemini Service initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Gemini Service: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Load Teil-specific prompts from disk and cache them
   */
  private loadPrompts(): void {
    const promptsDir = path.join(process.cwd(), 'src', 'config', 'prompts');

    for (let teilNumber = 1; teilNumber <= 3; teilNumber++) {
      const promptFile = path.join(
        promptsDir,
        `teil-${teilNumber}-examiner.txt`,
      );

      try {
        const prompt = fs.readFileSync(promptFile, 'utf-8');
        this.promptCache.set(teilNumber, prompt);
        this.logger.debug(`Loaded prompt for Teil ${teilNumber}`);
      } catch (error) {
        this.logger.error(
          `Failed to load prompt for Teil ${teilNumber}: ${error.message}`,
        );
        throw error;
      }
    }
  }

  /**
   * Get cached prompt for a specific Teil
   */
  getSystemInstruction(teilNumber: number): string {
    const instruction = this.promptCache.get(teilNumber);
    if (!instruction) {
      throw new Error(`System instruction not found for Teil ${teilNumber}`);
    }
    return instruction;
  }

  /**
   * Create a new Gemini Live API session using WebSocket-based bidirectional streaming
   * Responses arrive asynchronously via the callbacks parameter
   * Resolves only after Gemini sends setupComplete
   */
  async createLiveSession(
    sessionId: string,
    teilNumber: number,
    callbacks: GeminiSessionCallbacks,
    conversationHistory?: ConversationMessage[],
  ): Promise<void> {
    this.logger.log(
      `Creating Gemini Live session for exam session: ${sessionId}, Teil: ${teilNumber}`,
    );

    const systemInstruction = this.getSystemInstruction(teilNumber);

    // Enforce German-only responses: prepend so the model sees it first
    const languageRule =
      'CRITICAL: This is a German (Deutsch) B1 exam. You MUST speak and write ONLY in German. Never respond in English. All your turns must be in German.';

    // Build full system instruction with context if resuming
    let fullInstruction = languageRule + '\n\n' + systemInstruction;
    if (conversationHistory && conversationHistory.length > 0) {
      fullInstruction += `\n\n## Previous Conversation Context:\nThe following is the previous part of the exam session. Continue from where it left off:\n`;
      conversationHistory.forEach((msg) => {
        fullInstruction += `${msg.speaker.charAt(0).toUpperCase() + msg.speaker.slice(1)}: ${msg.text}\n`;
      });
    }

    return new Promise<void>((resolve, reject) => {
      const setupTimeout = setTimeout(() => {
        this.logger.error(`Gemini setup timeout for session ${sessionId}`);
        this.activeSessions.delete(sessionId);
        reject(new Error('GEMINI_SETUP_TIMEOUT'));
      }, 10000);

      const sessionData: GeminiSessionData = {
        session: null as unknown as Session,
        callbacks,
        createdAt: new Date(),
        teilNumber,
        status: 'connecting',
        setupComplete: false,
      };

      this.ai.live
        .connect({
          model: this.GEMINI_LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: this.VOICE_NAME },
              },
            },
            systemInstruction: fullInstruction,
            temperature: 0.7,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
          callbacks: {
            onopen: () => {
              this.logger.log(
                `Gemini Live WebSocket opened for session ${sessionId}`,
              );
            },
            onmessage: (message: LiveServerMessage) => {
              this.handleLiveMessage(
                sessionId,
                message,
                callbacks,
                setupTimeout,
                resolve,
              );
            },
            onerror: (e: ErrorEvent) => {
              this.logger.error(
                `Gemini Live error for session ${sessionId}: ${e.message}`,
              );
              clearTimeout(setupTimeout);
              callbacks.onError(new Error(e.message || 'GEMINI_LIVE_ERROR'));
              if (!sessionData.setupComplete) {
                reject(new Error(e.message || 'GEMINI_LIVE_ERROR'));
              }
            },
            onclose: (e: CloseEvent) => {
              this.logger.log(
                `Gemini Live WebSocket closed for session ${sessionId}: code=${e.code} reason=${e.reason}`,
              );
              clearTimeout(setupTimeout);
              const data = this.activeSessions.get(sessionId);
              if (data) {
                data.status = 'disconnected';
              }
              callbacks.onClose();
              if (!sessionData.setupComplete) {
                reject(
                  new Error(
                    `GEMINI_CLOSED_DURING_SETUP: code=${e.code} reason=${e.reason}`,
                  ),
                );
              }
            },
          },
        })
        .then((session) => {
          sessionData.session = session;
          this.activeSessions.set(sessionId, sessionData);
          this.logger.log(
            `Gemini Live session TCP connected for ${sessionId}, waiting for setupComplete...`,
          );
        })
        .catch((error) => {
          clearTimeout(setupTimeout);
          this.logger.error(
            `Failed to create Gemini Live session: ${(error as Error).message}`,
            (error as Error).stack,
          );
          reject(error);
        });
    });
  }

  /**
   * Debug: log Live API message shape to diagnose missing responses (hypothesisId A/B)
   */
  private agentDebugLog(sessionId: string, message: LiveServerMessage): void {
    const keys = message ? Object.keys(message) : [];
    const hasServerContent = !!(message as { serverContent?: unknown }).serverContent;
    const sc = (message as { serverContent?: { modelTurn?: { parts?: unknown[] } } }).serverContent;
    const hasModelTurn = !!sc?.modelTurn;
    const partsLength = sc?.modelTurn?.parts?.length ?? 0;
    const payload = {
      location: 'gemini.service.ts:handleLiveMessage',
      message: 'LiveServerMessage received',
      data: { sessionId, keys, hasServerContent, hasModelTurn, partsLength },
      timestamp: Date.now(),
      hypothesisId: 'A',
    };
    fetch('http://127.0.0.1:7247/ingest/fbe85b36-9f6d-4953-8668-ec5f10a6de17', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
    this.logger.debug(
      `[agent] Live message keys=${keys.join(',')} hasServerContent=${hasServerContent} hasModelTurn=${hasModelTurn} partsLen=${partsLength}`,
    );
  }

  /**
   * Handle incoming messages from Gemini Live API
   * Extracts audio/text responses and forwards via callbacks
   * Also handles setupComplete to resolve the createLiveSession Promise
   */
  private handleLiveMessage(
    sessionId: string,
    message: LiveServerMessage,
    callbacks: GeminiSessionCallbacks,
    setupTimeout: NodeJS.Timeout,
    setupResolve: () => void,
  ): void {
    try {
      // #region agent log
      this.agentDebugLog(sessionId, message);
      // #endregion

      // Handle setup complete — resolve the createLiveSession Promise
      if (message.setupComplete) {
        this.logger.log(`Gemini Live setup complete for session ${sessionId}`);

        const sessionData = this.activeSessions.get(sessionId);
        if (sessionData) {
          sessionData.setupComplete = true;
          sessionData.status = 'connected';
        }

        clearTimeout(setupTimeout);
        setupResolve();
        return;
      }

      // Handle model response content
      if (message.serverContent?.modelTurn?.parts) {
        const parts = message.serverContent.modelTurn.parts;

        for (const part of parts) {
          // Extract text response
          if (part.text) {
            callbacks.onAudioResponse({ text: part.text });
          }

          // Extract audio response
          if (part.inlineData?.data) {
            callbacks.onAudioResponse({
              audioData: part.inlineData.data,
              audioMimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
            });
          }
        }
      }

      // Handle input transcription (student speech)
      const serverContent = message.serverContent as
        | { inputTranscription?: { text?: string }; outputTranscription?: { text?: string } }
        | undefined;
      if (serverContent?.inputTranscription?.text) {
        callbacks.onInputTranscription?.(serverContent.inputTranscription.text);
      }
      if (serverContent?.outputTranscription?.text) {
        callbacks.onOutputTranscription?.(serverContent.outputTranscription.text);
      }

      // Handle turn complete (optional logging)
      if (message.serverContent?.turnComplete) {
        this.logger.debug(`Gemini turn complete for session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error(
        `Error handling Gemini Live message for session ${sessionId}: ${(error as Error).message}`,
      );
      callbacks.onError(error as Error);
    }
  }

  /**
   * Send audio chunk to Gemini Live session (fire-and-forget)
   * Responses arrive asynchronously via the onmessage callback
   */
  sendAudioChunk(
    sessionId: string,
    audioData: string,
    mimeType: string = 'audio/pcm;rate=16000',
  ): void {
    const sessionData = this.activeSessions.get(sessionId);
    if (!sessionData) {
      throw new Error(`Gemini session not found for sessionId: ${sessionId}`);
    }

    if (!sessionData.setupComplete) {
      throw new Error(`GEMINI_SETUP_NOT_COMPLETE: ${sessionId}`);
    }

    // Send audio via Live API realtime input
    sessionData.session.sendRealtimeInput({
      audio: {
        data: audioData,
        mimeType,
      },
    });

    this.logger.debug(`Audio chunk sent to Gemini for session ${sessionId}`);
  }

  /**
   * Signal end of user turn so Gemini can generate a response (when VAD does not trigger)
   */
  sendTurnComplete(sessionId: string): void {
    const sessionData = this.activeSessions.get(sessionId);
    if (!sessionData) {
      this.logger.warn(`sendTurnComplete: session not found ${sessionId}`);
      return;
    }
    if (!sessionData.setupComplete) {
      this.logger.warn(`sendTurnComplete: setup not complete ${sessionId}`);
      return;
    }
    try {
      sessionData.session.sendClientContent({ turnComplete: true });
      this.logger.log(`[GeminiService] Turn complete sent to Gemini for session ${sessionId} (user 2s silence)`);
    } catch (err) {
      this.logger.warn(
        `sendTurnComplete failed for ${sessionId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Trigger the examiner's initial greeting by sending a text-only client content.
   * Must be called ONCE after setupComplete, BEFORE any sendRealtimeInput calls.
   */
  triggerExaminerGreeting(sessionId: string): void {
    const sessionData = this.activeSessions.get(sessionId);
    if (!sessionData) {
      this.logger.warn(
        `triggerExaminerGreeting: session not found ${sessionId}`,
      );
      return;
    }
    if (!sessionData.setupComplete) {
      this.logger.warn(
        `triggerExaminerGreeting: setup not complete ${sessionId}`,
      );
      return;
    }

    try {
      sessionData.session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: 'Begin the exam now. Start with your greeting in German.',
              },
            ],
          },
        ],
        turnComplete: true,
      });
      this.logger.log(
        `Examiner greeting triggered for session ${sessionId}`,
      );
    } catch (err) {
      this.logger.error(
        `triggerExaminerGreeting failed for ${sessionId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Close Gemini Live session gracefully
   */
  closeLiveSession(sessionId: string): void {
    try {
      const sessionData = this.activeSessions.get(sessionId);
      if (!sessionData) {
        this.logger.warn(
          `Attempted to close non-existent Gemini session: ${sessionId}`,
        );
        return;
      }

      // Close the WebSocket connection
      try {
        sessionData.session.close();
      } catch (closeError) {
        this.logger.warn(
          `Error closing Gemini WebSocket for ${sessionId}: ${closeError.message}`,
        );
      }

      this.activeSessions.delete(sessionId);
      this.logger.log(`Gemini Live session closed for ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `Error closing Gemini Live session: ${error.message}`,
        error.stack,
      );
      // Always clean up even if close fails
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: string): boolean {
    const sessionData = this.activeSessions.get(sessionId);
    return !!sessionData && sessionData.setupComplete && sessionData.status === 'connected';
  }

  /**
   * Get all active sessions count (for monitoring)
   */
  getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Generate a text response using Gemini (non-Live API)
   * Used by EvaluationService for text-only evaluation
   */
  async generateTextResponse(prompt: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.GEMINI_TEXT_MODEL,
        contents: prompt,
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      return text;
    } catch (error) {
      this.logger.error(
        `Gemini text generation failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Utility: Decode Base64 audio data to Buffer
   */
  decodeAudioData(base64Data: string): Buffer {
    return Buffer.from(base64Data, 'base64');
  }

  /**
   * Utility: Encode Buffer audio data to Base64
   */
  encodeAudioData(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  /**
   * Clean up all sessions on module destroy
   */
  onModuleDestroy(): void {
    this.logger.log(
      `Closing ${this.activeSessions.size} active Gemini sessions`,
    );

    for (const [sessionId] of this.activeSessions) {
      this.closeLiveSession(sessionId);
    }
  }
}
