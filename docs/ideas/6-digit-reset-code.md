# Password reset: switch to a 6-digit numeric code

## Problem Statement

**How might we** deliver a password-reset secret short enough to read off an email and type into a single field, without weakening security vs. the current 64-character opaque token?

The Flutter `/reset-password` page already promises "Code de réinitialisation" — a single short input. Today's backend generates a 32-byte hex token (64 characters), forcing users to copy-paste from email instead of typing. The UI has been telling the truth about what users want; the backend is the lie.

## Recommended Direction

Replace the long token with a **6-digit zero-padded numeric code** (industry default: Google, Apple, Microsoft, Slack). Reduce the TTL from 60 min → **10 min**. Add a **per-account attempt counter that burns the code after 5 wrong tries**, plus a soft per-IP cap on `/reset-password` to defend against random-spray attacks across the user base. Email becomes a clean "Ihr Code: **123 456**" — nothing else.

Mechanically minor work: the existing `password_reset_token` column on `students` already stores a hash; we just hash a different (smaller) input. New column needed: `password_reset_attempts INT DEFAULT 0`. Constants change: `PASSWORD_RESET_TOKEN_TTL_MS` from 60 min → 10 min. Generator changes: instead of `crypto.randomBytes(32).toString('hex')`, use a 6-digit random integer (cryptographically random, **not** `Math.random`).

The deploy migration invalidates all in-flight 64-char tokens — anyone mid-reset at deploy time will need to request a new code. Acceptable for the test phase.

## Key Assumptions to Validate

- [ ] **10 min is enough lifetime** — measure Resend delivery latency in your environment; flag if p95 > 60s. Test with a Gmail and an Outlook recipient (the worst spam filters).
- [ ] **Flutter sends `code` as a string, preserving leading zeros** — test end-to-end with the code `000001`. If the field parses to int and back, leading zeros vanish and the hash won't match.
- [ ] **Reset-password screen does not collect the email** — confirm with the Flutter side that the request body stays `{ token, newPassword, deviceId, deviceName? }`. If email is added, switch to per-account lookup (more secure).
- [ ] **Per-IP cap on `/reset-password` is acceptable UX** — 20 attempts / 15 min is generous for legitimate users but bounds attacker throughput. Validate in test phase by checking 429 occurrence in logs.

## MVP Scope

**In:**

1. Code generator: `crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')` ([generator lives in `tokenCrypto.generateToken` — add a parallel `generateNumericCode(length)`]).
2. Hash the 6-digit code with the existing HMAC-SHA256 (`tokenCrypto.hashToken`), store in `students.password_reset_token` — same column, same column type, no migration there.
3. New column `students.password_reset_attempts` (INT, default 0). Migration file.
4. `forgotPassword` resets `password_reset_attempts = 0` whenever a new code is issued.
5. `resetPassword` increments `password_reset_attempts` on wrong code; clears `password_reset_token` after 5 wrong tries.
6. Change `PASSWORD_RESET_TOKEN_TTL_MS` from `60 * 60 * 1000` → `10 * 60 * 1000`.
7. Update `sendPasswordResetEmail` template: prominent display of the 6-digit code, drop the URL link.
8. New `RateLimitService.checkResetPasswordLimit(ip)` — 20 per 15 min per IP. Wire into `auth.controller.resetPassword`.
9. Deploy migration also runs `UPDATE students SET password_reset_token = NULL, password_reset_expires = NULL WHERE password_reset_token IS NOT NULL;` to invalidate in-flight tokens at switchover.
10. Update `test/auth.service.spec.ts` for resetPassword: happy path, wrong code 5×, expired code, token-reuse-after-success.

**Out:**

- Localized email templates (separate workstream — see "Not Doing").
- Updating the Flutter `/reset-password` screen — UI already accepts a short code, no changes needed.
- Audit log of reset attempts.
- SMS / Authenticator-app fallbacks.

## Not Doing (and Why)

- **Per-account-only attempt counter (no per-IP)** — picked initially, but the realistic implementation needs per-IP too because lookup is by code-hash, not by email. A random-spray attacker can hit codes belonging to other accounts. Per-IP cap closes that. We're doing **both**, despite the form answer.
- **Localized email templates (FR/DE/EN)** — important but separable. Ship the German default for now (testers are German-speaking), localize in a follow-up. The current English template stays for now; a one-line copy change is fine.
- **8-digit codes** — overkill for this audience. 6-digit + lockout already makes brute-force statistically zero. If we ever onboard high-value accounts (e.g. teachers managing many students), reconsider.
- **A "click here to reset" link in the email** — adds attack surface (referrer leakage, forwarded email reuse) without saving UX time. Code-only is cleaner.
- **Notify user via email when a reset is requested for their account** — nice-to-have, defer. Today's generic 200 response already prevents enumeration; an email saying "someone tried to reset your account" is the same signal, just delivered differently. Add later if support sees friction.
- **Migrating in-flight tokens to the new format** — impossible (the old 64-char tokens can't shrink). Just invalidate them and let those users request a new code. Maximum two affected users in the test phase.

## Open Questions

- **Does the Flutter `/reset-password` field have `keyboardType: TextInputType.number`?** If not, mobile users get a full QWERTY keyboard for a numeric input. One-line Flutter fix, but worth checking now.
- **Should the email also include `{firstName}` for personalization?** Trivial to add; reduces "is this email legit?" doubt.
- **Email language**: stay English for now, or translate to German (Resend supports any language)? German is the testers' actual language.
- **Reset-password rate-limit budget**: 20/15min per IP — is that too tight if a tester is helping a friend on the same Wi-Fi reset their account?

## Concrete next step

Say "ship it" and I'll TDD the four changes (generator + attempt counter + TTL + per-IP cap) plus the migration in the same rhythm as the previous workstreams. Estimate: 45-60 min, 5-6 commits.
