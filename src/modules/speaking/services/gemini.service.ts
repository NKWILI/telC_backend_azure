import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Modality } from '@google/genai';

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private ai: GoogleGenAI;
  private readonly GEMINI_TEXT_MODEL: string;
  private readonly GEMINI_LIVE_MODEL: string;
  private readonly GEMINI_LIVE_VOICE: string;

  constructor(private readonly configService: ConfigService) {
    this.GEMINI_TEXT_MODEL =
      this.configService.get<string>('GEMINI_TEXT_MODEL') ?? 'gemini-2.0-flash';
    // Separate from the text model on purpose: the two move independently, and
    // availability differs between them. This default was verified against the
    // project's own key — `gemini-live-2.5-flash-preview` mints a token happily
    // and then fails at connect time with "not supported for
    // bidiGenerateContent", so the model must be one the key actually lists as
    // live-capable. Check with:
    //   GET https://generativelanguage.googleapis.com/v1beta/models?key=...
    //   → filter supportedGenerationMethods for 'bidiGenerateContent'
    this.GEMINI_LIVE_MODEL =
      this.configService.get<string>('GEMINI_LIVE_MODEL') ??
      'gemini-3.1-flash-live-preview';
    this.GEMINI_LIVE_VOICE =
      this.configService.get<string>('GEMINI_LIVE_VOICE') ?? 'Zephyr';
  }

  async onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured in environment');
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.logger.log(
      `Gemini Service initialized (model: ${this.GEMINI_TEXT_MODEL})`,
    );
  }

  /**
   * Mints a single-use ephemeral token so the browser can open a Gemini Live
   * session directly, without ever seeing GEMINI_API_KEY.
   *
   * Everything that costs money or defines behaviour is sealed in at mint time
   * via liveConnectConstraints — model, audio-only modality, voice and the
   * system instruction. A modified client can connect with this token but
   * cannot change what it connects to, cannot reuse it, and cannot keep the
   * session alive past `sessionSeconds`: Google enforces all three.
   */
  async mintLiveToken(
    systemInstruction: string,
    sessionSeconds: number,
  ): Promise<{ token: string; model: string }> {
    try {
      const authToken = await this.ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: new Date(
            Date.now() + sessionSeconds * 1000,
          ).toISOString(),
          // The token is useless unless it is used almost immediately, so one
          // that leaks in transit has a 60-second window and no second use.
          newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
          liveConnectConstraints: {
            model: this.GEMINI_LIVE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: this.GEMINI_LIVE_VOICE },
                },
              },
              systemInstruction,
              // Both directions: the input transcript is what gets graded by
              // POST /api/speaking/evaluate, replacing the browser speech
              // recognition the frontend uses today.
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          },
        },
      });

      if (!authToken.name) {
        throw new Error('Gemini returned an empty live token');
      }

      return { token: authToken.name, model: this.GEMINI_LIVE_MODEL };
    } catch (error) {
      this.logger.error(
        `Gemini live token minting failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Generate a text response using Gemini text API.
   * Used by EvaluationService (speaking) and WritingCorrectionService.
   */
  async generateTextResponse(prompt: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.GEMINI_TEXT_MODEL,
        contents: prompt,
      });

      const text = response.text;
      if (!text) throw new Error('Empty response from Gemini');

      return text;
    } catch (error) {
      this.logger.error(
        `Gemini text generation failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}
