# Backlog

Open work only. Every item below was re-verified against the codebase or against
production on **2026-08-21**; anything that turned out to be already fixed has
been removed rather than marked done.

🔵 = blocked on a decision, not on effort.

See `DECISIONS.md` for choices that look like bugs and are not — read it
before "fixing" anything in auth registration or the Modelltest query params.

---

## 1 — User-facing bugs

### Registration silently discards a re-registered password
`auth.service.ts:102-107` — **verified still present**

The `update` on the unverified-re-registration path writes only
`email_verification_token` and `email_verification_expires`. The password and
name from the second attempt are dropped.

A student registers, never verifies, registers again weeks later with a
different password, verifies, gets logged in — and the next day cannot log in
with the password she actually chose. No error, nothing in the logs, nothing
support can see.

Safe to fix precisely because the account is unverified: nobody has proven
ownership, so no account is being hijacked. Add `password_hash`, `first_name`,
`last_name` to that `update`.

**Three lines. Highest user impact on this list.**

### `emailVerified` is hardcoded `true` in the auth response
`auth.service.ts:468` — **verified still present**

`issueAuthResponse` returns a literal `true` rather than reading
`student.email_verified`. True by construction on the email/password paths; on
the Google path the account is created with `email_verified` taken from the
Google payload, which can be `false`. The response then tells the frontend the
address is verified when it is not.

---

## 2 — Correctness

### Sprachbausteine serves Modelltest 1 for a malformed `?modelltest=`
`sprachbausteine.controller.ts:37` — **verified in production today**

```
GET /api/sprachbausteine/exercise?modelltest=abc  →  200, Modelltest 1
GET /api/writing/exercise?modelltest=abc          →  400   ← correct
GET /api/reading/exercise?modelltest=abc          →  400   ← fixed 2026-08-21
```

Identical cause to the Lesen bug fixed earlier today: the param is declared as
`number` with `DefaultValuePipe(1)` and `ParseIntPipe`, but `main.ts` installs a
global `ValidationPipe({ transform: true })`. Global pipes run **before**
parameter pipes, so `'abc'` is coerced before `ParseIntPipe` ever sees it and
`DefaultValuePipe` substitutes 1. Malformed input silently yields a valid-looking
exam instead of an error, hiding client bugs.

Fix is the same: take the raw string and parse explicitly, as
`writing.controller.ts:69` and now `lesen.controller.ts` do. This becomes more
than cosmetic the moment a second Modelltest exists.

### Two e2e suites do not install the global pipes
`test/app.e2e-spec.ts`, `test/speaking-websocket.e2e-spec.ts` — **verified**

They build test apps without the global `ValidationPipe` from `main.ts`, so any
assertion they make about validation or transformation does not represent
production. This is not hypothetical: it is exactly how `lesen.e2e-spec.ts`
asserted `400` for `?modelltest=abc` and passed, while production returned `200`.

### JWT carries no `emailVerified` claim, and no guard checks one
`token-payload.interface.ts`, `jwt-auth.guard.ts` — **verified**

`AccessTokenPayload` is `{ type, studentId, deviceId, sessionId?, isGuest? }`.
The guard verifies signature, requires a `sessionId`, and checks revocation —
there is no verification check anywhere.

The invariant holds today only because of *where* tokens are issued, which is
correct but implicit. A future sixth call site for `issueAuthResponse()` could
hand a token to an unverified student with nothing to stop it. Adding the claim
also unblocks the `emailVerified` fix above.

### `contentRevision` describes only Teil 2
`lesen.service.ts:44` — **verified**

The response-level revision is taken from Teil 2 but serves as the client's
staleness key for the whole payload. Edit Modelltest 2's Teil 1 or Teil 3 and no
cache invalidates.

---

## 3 — Modelltest 2 gates

### 🔵 Hören content lives in TypeScript, not the database
`listening.service.ts` — **verified: 3 hardcoded `modelltest-1-*` revisions, 0 listening models in the schema**

No table, no `modelltest_id`, nothing for a seed to insert into. Adding a second
exam to Hören is a code change, not a content change.

**Blocked on one product answer: how many Modelltests in total?**
- Two and done → duplicate the `CATALOG` object (~1 day)
- Four or five → migrate to the database now (~2–3 days), while a single dataset
  exists to move. Pays for itself at Modelltest 3.

Largest single cost in the whole effort, and the only item here needing a
product decision rather than engineering.

### Settle the seed convention before writing the Modelltest 2 seed
**verified: 7 numbered `.sql` files at the repo root, plus 1 seed inside `prisma/migrations/`**

Two unrelated mechanisms, neither documented. Pick one home
(`prisma/seeds/modelltest-N/`), make inserts idempotent with
`ON CONFLICT DO NOTHING`, namespace the deterministic UUIDs by exam number.
Costs nothing extra while writing the seed anyway.

### `ListeningAttempt` cannot be attributed to an exam
`schema.prisma` — **verified: 0 `modelltest_id` on the model**

`WritingAttempt` and `SprachbausteineAttempt` both carry it. `ListeningAttempt`
has only a nullable `content_revision` and an `exercise_id` that is not a real
foreign key.

Existing rows can be backfilled to Modelltest 1 with certainty **only while one
exam exists**. That window closes when Modelltest 2 is seeded.

---

## 4 — Infrastructure

### No CI — nothing enforces that `main` is green
**verified: no `.github/workflows` directory at all**

Deleting the deploy workflow removed the build+test gate with it. `main` is
currently green only because the suites were run locally before each push;
nothing enforces it, and there is no build gate before a deploy either. Since
DigitalOcean auto-deploys on push, a broken commit reaches production directly.

A test-only workflow is ~15 lines and needs no cloud credentials — restore it
separately from whatever replaced the deploy half.

### Confirm App Platform instance count is 1
Console check, not code. All speaking-room state lives in an in-memory `Map` in
one Node process, so it is correct only at exactly one instance. On Azure this
was pinned by the B1 plan; on App Platform it is a slider, and raising it fails
silently — host and guest land on different processes and the guest gets
`room-not-found` for a room that demonstrably exists.

`ValkeyService` already exists (used by `JwtAuthGuard`), so DO Managed Caching
for Valkey is the natural target if scale-out is ever needed.

### `prisma migrate deploy` runs from the app start command
`package.json:11` — **verified**

Every instance races to migrate on boot (Prisma's advisory lock makes this mostly
safe, but an idle recycle should not be a migration event). Worse, a failed
migration short-circuits the `&&` and the app never boots — an outage rather than
a degraded state. Move to a release/pre-deploy step.

### Schema drift between the live database and `schema.prisma`
**re-verified against production today — larger than first recorded**

`prisma migrate diff` still reports:
- `writing_exercises.bullet_points` — a DEFAULT the schema does not declare
- `writing_exercises.created_at` — `TIMESTAMP(3)`
- `modelltests.created_at` — `TIMESTAMP(3)` *(not in the original note)*

Because Prisma plans these alterations by dropping and recreating the six
`modelltest_id` foreign keys, any future `prisma migrate dev` will churn far more
than the drift itself suggests.

---

## 5 — Consistency and housekeeping

### `modelltest` param convention differs across three modules
**verified**

| Module | Declaration | Missing param | Malformed param |
|---|---|---|---|
| Lesen | raw string, explicit parse | defaults to 1 | 400 |
| Writing | raw string, explicit parse | 400 | 400 |
| Sprachbausteine | `DefaultValuePipe` + `ParseIntPipe` | defaults to 1 | **200, exam 1** |

Pick one and document it before more skills gain the parameter. Fixing the
Sprachbausteine bug above resolves the malformed column; the missing-param
column is a genuine product choice.

### Select content by foreign key, never by `content_revision`
Every exercise is identified twice — by `modelltest_id` and by a
`content_revision` string that also encodes the exam. They agree today only
because migration 007 wired the FKs by matching those strings. Convention, no
migration.

### Confirm Sprechen intentionally has no per-exam content
Three examiner prompt files, no Modelltest relation. Probably correct — the
speaking exam is a live conversation, not a fixed question set. Worth putting on
record so it is a decision rather than something discovered when a student asks
why Modelltest 2 has no Sprechen.

### `docs/api-contract.md` is gitignored
`.gitignore:40` — **verified**. The Reading `?modelltest=` documentation written
there will never reach anyone else through git. Either untrack it or move the
contract somewhere shared.

### `submitTeil2` is a stub
`lesen.service.ts:195` returns `{ score: 0 }` regardless of input.

### Stale Azure paths in `.claude/settings.json`
The old `azurewebsites.net` URLs are gone, but ~10 permission entries still carry
absolute paths from a previous folder location
(`…\SPRACHPRÜFUNG\SPRACHPRÜFUNG_AZURE\telC_backend_azure`). Dead entries that
never match. Cosmetic.

### Azure references in historical docs
Base-URL examples in `HOREN_API_FRONTEND.md`, `SCHREIBEN_API_FRONTEND.md`,
`SPRECHEN_ROOM_ICE_SERVERS_API.md`, `listening_horen_rest.md`, `PLAN.md`,
`ideas/auth-system-overhaul.md`. The operational ones are done;
`SPRECHEN_ROOM_REFERENCE.md`'s remaining mentions are deliberate
Azure-vs-App-Platform comparisons.

### Repo is still named `telC_backend_azure`
GitHub (`NKWILI/telC_backend_azure`) and the local folder. Renaming breaks clones
and remotes for anyone else, so it needs coordinating.
