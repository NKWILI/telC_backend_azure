# Decisions

**This is not a changelog.** `git log` records what changed, and the commit
messages from 2026-08-21 are detailed. This file records the decisions someone
is likely to reverse without knowing why they were made.

Every entry answers the same question: *if you delete this, what breaks?*

---

## Registration never writes credentials on an unverified address

**Where:** `auth.service.ts`, the `existingStudent` branch of `register()`
**Enforced by:** a test asserting the update writes exactly two columns

Registering an address that already has an unverified account refreshes only
`email_verification_token` and `email_verification_expires`. The submitted
password and name are discarded.

**This looks like a bug and reads like one.** A student who registers, never
verifies, then registers again with a different password will not get the new
password. That is a real cost and it was accepted deliberately.

**If you "fix" it by adding `password_hash` to that update**, you create an
account takeover. Nobody has proven ownership of the address at that point, so
anyone who knows it reaches this branch. An attacker re-registers a victim's
unverified address; the victim clicks the verification link that lands in their
own inbox; the attacker's password is now the account password. This is account
pre-hijacking — Sudhodanan & Paverd, USENIX Security '22, and shipped in the
wild as MantisBT CVE-2024-34077.

The published mitigation is to permit no action on an unverified identifier.
The returning user is handled by `sendExistingAccountVerificationEmail`, which
explains the account exists, states the password was not changed, and points at
reset. The HTTP response stays generic because it must remain useless for
account enumeration; the email is the private channel that can say more.

The guarding test passes against the old code too, on purpose. It is a tripwire
for the future, not a check on the past.

## Modelltest query params are parsed from raw strings, not typed `number`

**Where:** `lesen.controller.ts`, `sprachbausteine.controller.ts`,
`writing.controller.ts`
**Enforced by:** e2e cases for `abc`, `-1`, `1.5`

These read `@Query('modelltest') modelltest?: string` and parse by hand, which
looks needlessly verbose next to `DefaultValuePipe(1), ParseIntPipe`.

**If you "simplify" it back to pipes**, malformed input silently returns exam 1
instead of a 400. `main.ts` installs a global `ValidationPipe({ transform: true })`,
and **global pipes run before parameter-level pipes** — so `'abc'` is coerced to
NaN before `ParseIntPipe` ever sees it, and `DefaultValuePipe` substitutes 1.

This was live in production on both Lesen and Sprachbausteine. It is harmless
while one exam exists and wrong the moment a second does.

## The global validation pipe has exactly one definition

**Where:** `src/shared/pipes/global-validation.pipe.ts`

It was defined in `main.ts` and copy-pasted into three e2e suites, while three
others had no global pipes at all. Suites without it are not testing this
application: `lesen.e2e-spec.ts` asserted 400 for `?modelltest=abc` and passed
while production returned 200.

**Any new e2e suite must call `createGlobalValidationPipe()`.** A suite that
skips it will happily confirm behaviour that does not exist.

The gateway-scoped pipe in `room.gateway.ts` is separate on purpose — different
options, not drift.

## Lesen queries carry `orderBy` as well as `where`

**Where:** `lesen.service.ts`, all three `findFirst` calls

The `orderBy: { createdAt: 'asc' }` looks redundant now that
`@@unique([modelltest_id])` guarantees one row per exam per table.

It is a second line of defence, and the comment at each call site says so. The
uniqueness constraint arrived in a later migration than the filter; the ordering
is what makes the pick deterministic if that constraint is ever dropped or if a
seed inserts a duplicate before it applies. Removing it fails the regression
guard, which was mutation-tested.

## `modelltest_id` is NOT NULL on exercise tables and nullable on attempt tables

**Where:** `schema.prisma`

The asymmetry is intentional. An exercise row that belongs to no exam is content
nobody can ever be served — invisible to every filtered query. An *attempt* row
that belongs to no exam is a real historical fact: production holds four
`mock-horen-teil-1-v1` attempts that predate any Modelltest.

## The listening backfill is prefix-driven, and four rows stay unattributed

**Where:** migration `20260821160000`, mirrored by
`ListeningService.resolveModelltestId`

The backlog said existing rows could be backfilled to Modelltest 1 "with
certainty". The data disagreed: of 31 rows, 27 matched `modelltest-1-*` and four
were `mock-horen-teil-1-v1`.

**Do not "complete" the backfill.** Attributing those four to Modelltest 1
invents data. New attempts use the identical prefix rule so old and new rows
agree, and the lookup never throws — attribution is metadata, and losing a
student's result because a lookup errored is the worse failure.

## Foreign keys are `ON DELETE RESTRICT`

**Where:** migration `20260821160000`

All six were `ON DELETE SET NULL`, correct while `modelltest_id` was nullable.
Migration `20260821120000` made those columns NOT NULL and did not revisit the
actions, leaving the database holding a contradiction: *set this to NULL* on a
column that cannot be NULL. Deleting a Modelltest failed with a not-null
violation rather than a foreign key violation — still prevented, but by
accident, with a misleading error.

## Two `created_at` columns are declared `@db.Timestamptz(6)`

**Where:** `Modelltest`, `WritingExercise` in `schema.prisma`

They are inconsistent with the other 39 DateTime columns, which are
`timestamp(3)`. Both tables were created by hand-written SQL migrations that
used `TIMESTAMPTZ`.

The schema was changed to describe the database, rather than migrating the
database to match the schema. **Prisma's own diff proposed converting the column
types and truncating precision on production** to resolve a difference that was
purely cosmetic. Declaring reality resolved the drift with no DDL.
`writing_exercises.bullet_points @default([])` is the same call.

## CI cannot block a deploy, and that is known

**Where:** `.github/workflows/test.yml`

DigitalOcean App Platform deploys on push to `main`; the workflow reacts to the
same push independently. **A red run is a signal to revert, not a barrier.**
Making it a real gate means moving deploys behind the workflow, which is a
larger decision that has not been taken.

The dummy env vars exist because several providers call `getOrThrow` in their
constructors and `GeminiService` throws from `onModuleInit`, and
`app.e2e-spec.ts` imports the whole `AppModule`. Verified by running both suites
with `.env` removed. None reach a real service.

## Registration rate limits are deliberately asymmetric

**Where:** `rate-limit.service.ts` — 5/hour per address, 20/hour per IP

The per-address cap does the security work: re-registering rotates the
verification token, so without a ceiling anyone who knows an address can loop on
it until the owner's link is dead and they can never finish signing up. The
2-minute cooldown throttled the rate but capped nothing.

Per-IP is loose on purpose. A class of students signing up together shares one
NAT address, and locking out a real classroom to slow an attacker who can rotate
IPs anyway is a bad trade.

---

## Verified in production, not just in tests

Everything below was checked against the live database or the live API on
2026-08-21 after deploying, because tests had already proven insufficient once.

- Six exercise tables `NOT NULL`; both attempt tables still nullable
- Six unique indexes on `modelltest_id` present
- Six foreign keys `ON DELETE RESTRICT`
- `24/24` and `3/3` modelltest-1 attempts attributed; `0/4` mock rows attributed
- `GET /api/reading/exercise` — no param and `?modelltest=1` identical; `2` and
  `99` return 404; `abc`, `-1`, `1.5` return 400
- `/api/auth/register` documents a 429 response

Registration limits were **not** exercised against production on purpose. Every
attempt writes a `students` row and sends real mail from the sending domain; the
deployed OpenAPI spec was used as evidence instead.

## Three assumptions that turned out wrong

Recorded because the next person will be tempted by the same ones.

1. **"Pushing won't deploy — the GitHub Action is gone."** App Platform deploys
   independently of GitHub Actions. A migration went out unwatched.
2. **"`?modelltest=abc` returns 400 — the test proves it."** The test never
   installed the global pipes. It confirmed an expectation, not a behaviour.
   Production returned 200.
3. **"Safe to overwrite the password — the account is unverified."** Backwards.
   Nobody having proven ownership is precisely what makes the write dangerous.

All three came from asserting instead of checking. Verify against production,
and mutation-test the guards.
