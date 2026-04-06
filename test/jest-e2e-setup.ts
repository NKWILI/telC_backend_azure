/**
 * Load `.env` from project root so E2E tests see SUPABASE_URL, JWT_SECRET, GEMINI_API_KEY, etc.
 * Copy `.env.example` to `.env` and fill values locally.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
