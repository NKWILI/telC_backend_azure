import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private ai: GoogleGenAI;
  private readonly GEMINI_TEXT_MODEL: string;

  constructor(private readonly configService: ConfigService) {
    this.GEMINI_TEXT_MODEL =
      this.configService.get<string>('GEMINI_TEXT_MODEL') ?? 'gemini-2.0-flash';
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
