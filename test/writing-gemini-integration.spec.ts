/**
 * Integration test: real Gemini API call for Schreiben (writing) correction.
 * Run with: npm run test -- test/writing-gemini-integration.spec.ts
 * Requires: GEMINI_API_KEY in environment (e.g. set in .env or export GEMINI_API_KEY=...)
 *
 * When the test runs, it prints the raw Gemini response so you can see the API result.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../src/modules/speaking/services/gemini.service';

const SAMPLE_GERMAN_TEXT = `Sehr geehrte Damen und Herren,

ich habe geschrieben Sie wegen der Wohnung. Ich möchte mehr Informationen.
Die Wohnung ist in guter Lage und ich habe Interesse.

Mit freundlichen Grüßen
Max Mustermann`;

function buildWritingPrompt(content: string): string {
  return `You are an expert German B1 writing corrector for telc Schreiben tasks.
Evaluate the following student text. Provide a single JSON object (no markdown, no extra text) with:
- "score" (number 0-100): overall writing quality at B1 level
- "feedback" (string): short feedback in German, suitable for B1 learners
- "corrections" (array, max 10 items): most important errors. Each item: "original", "corrected", "explanation" (in German), "error_type" (one of: grammar, vocabulary, spelling, style)

**STUDENT TEXT:**
${content}

**SCORING (B1):** 90-100 excellent, 75-89 good, 60-74 satisfactory, 50-59 needs improvement, 0-49 insufficient.

**OUTPUT (JSON only):**
{
  "score": 78,
  "feedback": "Ihre E-Mail hat eine klare Struktur. Achten Sie auf die Konjugation der Verben.",
  "corrections": [
    {
      "original": "Ich habe geschrieben",
      "corrected": "Ich schreibe",
      "explanation": "Für eine formelle E-Mail eignet sich das Präsens besser.",
      "error_type": "grammar"
    }
  ]
}`;
}

describe('Writing correction – real Gemini API', () => {
  const apiKey = process.env.GEMINI_API_KEY;
  let geminiService: GeminiService | null = null;

  beforeAll(async () => {
    if (!apiKey) {
      console.warn(
        'Skipping real Gemini tests: GEMINI_API_KEY not set. Set it to run this spec.',
      );
      return;
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'GEMINI_API_KEY' ? process.env.GEMINI_API_KEY : undefined,
          },
        },
      ],
    }).compile();

    geminiService = module.get<GeminiService>(GeminiService);
    await module.init();
  });

  it('calls Gemini API and returns valid correction JSON (run only when GEMINI_API_KEY is set)', async () => {
    if (!apiKey || !geminiService) {
      return; // skipped
    }

    const prompt = buildWritingPrompt(SAMPLE_GERMAN_TEXT);
    const rawResponse = await geminiService.generateTextResponse(prompt);

    // Log so you can see the real API response when the test runs
    console.log('\n--- Gemini raw response (writing correction) ---');
    console.log(rawResponse);
    console.log('--- end response ---\n');

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    expect(jsonMatch).toBeTruthy();
    const parsed = JSON.parse(jsonMatch![0]);

    expect(parsed).toHaveProperty('score');
    expect(typeof parsed.score).toBe('number');
    expect(parsed.score).toBeGreaterThanOrEqual(0);
    expect(parsed.score).toBeLessThanOrEqual(100);

    expect(parsed).toHaveProperty('feedback');
    expect(typeof parsed.feedback).toBe('string');
    expect(parsed.feedback.length).toBeGreaterThan(0);

    expect(parsed).toHaveProperty('corrections');
    expect(Array.isArray(parsed.corrections)).toBe(true);
    if (parsed.corrections.length > 0) {
      const first = parsed.corrections[0];
      expect(first).toHaveProperty('original');
      expect(first).toHaveProperty('corrected');
      expect(first).toHaveProperty('explanation');
      expect(first).toHaveProperty('error_type');
      expect(['grammar', 'vocabulary', 'spelling', 'style']).toContain(
        first.error_type,
      );
    }
  }, 35000); // 35s timeout for real API
});
