/**
 * Load `.env` from project root so E2E tests see SUPABASE_URL,
 * JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, GEMINI_API_KEY, etc.
 * Copy `.env.example` to `.env` and fill values locally.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

// AppModule validates production-strength JWT secrets during startup. Unit-style
// E2E suites must not depend on a developer's local .env file to boot.
process.env.JWT_ACCESS_SECRET ??= 'e2e-access-secret-'.padEnd(64, 'a');
process.env.JWT_REFRESH_SECRET ??= 'e2e-refresh-secret-'.padEnd(64, 'b');
