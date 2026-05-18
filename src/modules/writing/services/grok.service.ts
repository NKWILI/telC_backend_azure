import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelService } from './model-service.interface';

@Injectable()
export class GrokService implements ModelService {
  private readonly logger = new Logger(GrokService.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiUrl = 'https://api.x.ai/v1/chat/completions';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GROK_API_KEY') ?? '';
    this.model =
      this.configService.get<string>('GROK_MODEL') ?? 'grok-2-latest';

    if (!this.apiKey) {
      this.logger.warn(
        'GROK_API_KEY not configured; Grok requests will fail at runtime',
      );
    }
  }

  async generateTextResponse(prompt: string): Promise<string> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Grok API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';

    if (!content) {
      throw new Error('Empty response from Grok API');
    }

    this.logger.debug(`Grok response received (${content.length} chars)`);
    return content;
  }
}
