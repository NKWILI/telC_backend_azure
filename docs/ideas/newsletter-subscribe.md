# Newsletter subscribe endpoint

## Problem Statement

**How might we** collect tester contacts in a way that's GDPR-defensible, ergonomic for the Flutter sheet, and doesn't accidentally enable harassment-by-signup?

The Flutter app shows a consent sheet before revealing exercise scores and needs to record three things server-side: email, full name, and an explicit consent boolean. Broadcasting happens out-of-band (external mail tool); the backend is just a faithful, validated entry point.

## Recommended Direction

Ship one `POST /api/auth/newsletter/subscribe` endpoint backed by an independent `NewsletterSubscriber` table — **no FK to `Student`** (cleaner privacy boundary), four columns persisted (`email` lowercased + unique, `full_name`, `consent_version`, `consented_at`). Validate at the DTO with class-validator and at the service with a `consent === true` guard. Rate-limit per-IP **and** per-email via the existing `RateLimitService`. Return `201` for new rows, `200 + alreadySubscribed: true` for re-submissions; in the latter case, **update `consent_version` and `consented_at`** rather than ignore (so renewed consent supersedes the stored version).

Single opt-in for test phase — document that double opt-in is the right move before public launch. The external broadcast tool will handle unsubscribe links and verification when it's wired up; the backend stays a thin contact collector.

The endpoint is one new module (`src/modules/newsletter/`) following the same shape as `auth/`: controller → service → DTO. New Prisma migration adds the table. No changes to existing modules.

## Key Assumptions to Validate

- [ ] **Flutter app will send `consent_version`** — the spec lists three fields but we're adding a fourth. Coordinate with the Flutter team before they ship v2 of the sheet.
- [ ] **External email tool handles unsubscribes** — confirm which tool (Brevo, Mailchimp, Beehiiv, etc.) before going to prod. Their unsubscribe link must replace any need for a backend DELETE endpoint in v1.
- [ ] **Privacy page text is stable enough for the test phase** — `consent_version = "v1"` means the privacy text shown to testers stays unchanged during the test phase. Any wording change → bump to `v2` and have re-subscribers re-consent.
- [ ] **5/15min per IP is the right budget** — too tight, and a household sharing Wi-Fi can lock each other out; too loose, and spam slips through. Validate by watching 429 counts in the first week.

## MVP Scope

**In:**

1. New Prisma model `NewsletterSubscriber` (id, email unique lowercased, full_name, consent_version, consented_at, created_at, updated_at).
2. Migration file adding the `newsletter_subscribers` table with `UNIQUE INDEX` on `LOWER(email)` (or normalize before insert — simpler).
3. New module `src/modules/newsletter/` — controller, service, DTO, module.
4. `POST /api/newsletter/subscribe` — public route (no `@UseGuards(JwtAuthGuard)`).
5. DTO: `email` (`@IsEmail`, `.toLowerCase().trim()` via class-transformer), `fullName` (`@IsNotEmpty`, trimmed), `consent` (`@IsBoolean`), `consentVersion` (`@IsString`, default `"v1"` if not sent — graceful).
6. Service:
   - Reject `consent !== true` with `400 CONSENT_REQUIRED` (or messageKey `newsletterValidationConsentRequired`).
   - `upsert` by email: if exists → update `consent_version`, `consented_at`, `full_name`; return `200 { alreadySubscribed: true }`. Else create → `201 { alreadySubscribed: false }`.
7. Rate-limit: add `checkNewsletterSubscribeLimit(ipKey, emailKey)` to `RateLimitService`. Two calls per request, both must pass. Defaults: 5/15min per IP, 2/15min per email.
8. Wire `RateLimitService` into the new module's providers.
9. Register `NewsletterModule` in `app.module.ts`.
10. Tests: service-level (upsert behavior, consent rejection, rate-limit calls); rate-limit service spec for the new method.

**Out:**

- Double opt-in flow (deferred to pre-public-launch).
- DELETE endpoint / GDPR right-to-erasure (manual DB query in test phase; document in a runbook).
- GET list endpoint (export via Prisma Studio or a one-off script when you migrate to Brevo/Mailchimp).
- FK to `Student` (overridden by the product decision — clean independent table).
- Captcha / Turnstile (Flutter-side concern if/when bot signups appear).
- Email broadcast logic (entire scope of the external tool).
- Welcome email on subscription (let the broadcast tool do it).
- Localization fields (`locale`, `sourceModule`, `appVersion`) — spec explicitly rejects.

## Not Doing (and Why)

- **Student FK** — product chose independent table for the cleaner privacy boundary. Cost is orphan rows when a Student account deletes; acceptable in test phase given low volume. Revisit if the list grows past ~1000 rows.
- **Double opt-in** — adds an endpoint, a token column, and an email template for marginal trust gain in the test phase where users are known. Add before public launch.
- **Unsubscribe endpoint in the backend** — when broadcasts go through an external tool, that tool owns unsubscribe state. Building it in the backend would mean syncing two systems. Defer to the broadcast tool.
- **`alreadySubscribed` as a "no-op" (don't update on re-submit)** — would freeze the user's consent to v1 even after they re-consent to v2. Bug waiting to happen when the privacy text changes. We're choosing **update-on-resubmit** instead.
- **Storing the displayed consent text as a hash (sha256)** — strongest GDPR evidence but overkill for a test phase. Versioning suffices. Add hash storage if a real auditor asks.
- **Linking the endpoint to the existing auth module** — newsletter is fundamentally not auth (no JWT, different audience, different data model). New module is cleaner.

## Open Questions

- **`consent_version` default value** — `"v1"` is a placeholder. Confirm the actual versioning scheme with whoever owns the privacy page (engineer? legal?). Calendar date (`"2026-05-17"`) is unambiguous; semver-style (`"v1"`) is shorter.
- **External broadcast tool choice** — Resend (currently used for auth) doesn't have a marketing-list workflow. Brevo / Mailchimp / Beehiiv all do. Pick before first broadcast.
- **What goes in the "alreadySubscribed" UX** — the Flutter sheet probably wants a slightly different message ("Vous êtes déjà inscrit !" vs. "Merci, à bientôt !"). Coordinate copy.
- **Per-email rate limit semantics** — should `victim@example.com` lock out after 2 attempts in 15 min, or per (IP, email) tuple? Pure per-email is harsher and slightly safer against rotating-IP spam.

## Concrete next step

Say "ship it" and I'll TDD this in two slices:
- **Slice 1:** model + migration + endpoint + service + DTO + happy-path & validation tests (~30 min).
- **Slice 2:** rate-limit method + wire into controller + rate-limit tests (~10 min).

No schema changes outside the new table, no env vars required (rate limits use sane defaults).
