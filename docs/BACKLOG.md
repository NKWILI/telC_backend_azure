# Backlog

Open work, most consequential first. Started 2026-08-21 from the Modelltest 2
readiness audit; items found since have been folded in.

Status: ⬜ open · 🔵 needs a decision before it can start · ✅ done

---

## 1 — User-facing bugs

### ⬜ Registration silently discards a re-registered password
`auth.service.ts:102-107`

A student registers, never verifies, registers again later with a different
password. Only the verification token and expiry are updated — the new password
and name are dropped. She verifies, gets logged in, and the next day cannot log
in with the password she actually chose. No error, nothing in the logs, and
support has no way to see it.

Safe to fix because the account is unverified — nobody has proven ownership, so
nothing is being hijacked. Add `password_hash`, `first_name`, `last_name` to
that `update`.

**Three lines. Highest user impact on this list.**

### ⬜ `emailVerified` is hardcoded true in the auth response
`auth.service.ts:467`

`issueAuthResponse` always returns `emailVerified: true` instead of reading
`student.email_verified`. On the email/password paths that is true by
construction. On the Google path the account is created with
`email_verified: googlePayload.email_verified`, which can be `false` — so the
response tells the frontend the address is verified when it is not.

Fix alongside adding an `emailVerified` claim to the JWT (see item 4).

---

## 2 — Modelltest 2: remaining gates

### 🔵 Hören content lives in TypeScript, not the database
`listening.service.ts:30-398` — audit finding 02

No table, no `modelltest_id`, nothing for a seed to insert into. Adding a second
exam to Hören is a code change, not a content change.

**Blocked on one answer: how many Modelltests in total?**
- Two and done → duplicate the `CATALOG` object (~1 day)
- Four or five → migrate to the database now (~2–3 days), while there is a
  single dataset to move. Pays for itself at Modelltest 3.

This is the largest single cost in the whole effort and the only item that needs
a product decision rather than an engineering one.

### ⬜ Settle the seed convention before writing the Modelltest 2 seed
audit finding 06

Content currently enters through two unrelated mechanisms: numbered `.sql` files
at the repo root (`001_`–`007_`) and at least one Prisma migration
(`20260530100001_seed_writing_exercise_modelltest1`). Neither is documented.

Pick one home (`prisma/seeds/modelltest-N/`), make every insert idempotent with
`ON CONFLICT DO NOTHING`, and namespace the deterministic UUIDs by exam number
(`aaaaaaaa-0002-…`). Costs nothing extra while writing the seed anyway; saves
reinventing it for Modelltest 3.

### ⬜ `ListeningAttempt` cannot be attributed to an exam
`schema.prisma:158-173` — audit finding 05

`WritingAttempt` and `SprachbausteineAttempt` both carry `modelltest_id`.
`ListeningAttempt` has only a nullable `content_revision` string and an
`exercise_id` that is not a real foreign key.

Historical rows can be backfilled to Modelltest 1 with certainty **only while
one exam exists**. That window closes the moment Modelltest 2 is seeded. Folds
naturally into whichever Hören option is chosen.

---

## 3 — Infrastructure

### ⬜ No CI — nothing enforces that `main` is green
Deleting `.github/workflows/main_telc-speaking-api.yml` removed the build+test
gate as well as the deploy. `main` is currently green only because the suites
were run locally before each push; nothing enforces it, and there is no build
gate before a deploy either.

A test-only workflow is ~15 lines and needs no cloud credentials — restore it
separately from whatever replaced the deploy half.

### ⬜ Confirm App Platform instance count is 1
Console check, not a code change. All speaking-room state lives in an in-memory
`Map` in one Node process, so it is correct only at exactly one instance. On
Azure this was pinned by the B1 plan; on App Platform it is a slider, and
raising it fails silently:

> Host lands on instance A, guest on instance B where that `roomId` does not
> exist. Guest gets `room-not-found` for a room that demonstrably exists.
> Retrying may work, because routing is per-connection.

If scale-out is ever needed, `ValkeyService` already exists (used by
`JwtAuthGuard`), so DO Managed Caching for Valkey is the natural target.

### ⬜ `prisma migrate deploy` runs from the app start command
`package.json` — `"start": "prisma migrate deploy && node …"`

Two consequences. Every instance races to migrate on boot (Prisma's advisory
lock makes this mostly safe, but it couples restarts to schema changes — an idle
recycle should not be a migration event). And a failed migration short-circuits
the `&&`, so the app does not boot at all: an outage rather than a degraded
state. Move to a release/pre-deploy step.

### ⬜ Pre-existing schema drift on `writing_exercises`
`prisma migrate diff` reports the live database differs from `schema.prisma`:
`bullet_points` carries a DEFAULT the schema does not declare, and `created_at`
is `TIMESTAMP(3)`. Unrelated to any recent work, but any future
`prisma migrate dev` will try to "fix" it, possibly unexpectedly.

---

## 4 — Correctness and hardening

### ⬜ Add an `emailVerified` claim to the JWT and check it in the guard
`jwt-auth.guard.ts`, `token-payload.interface.ts`

Guards currently verify the signature, require a `sessionId`, and check
revocation — there is no `emailVerified` check anywhere, and the payload does
not carry the claim. Today the invariant holds because of *where* tokens are
issued, which is correct but implicit. A sixth call site for
`issueAuthResponse()` could issue a token to an unverified student with nothing
to stop it. Defence in depth; also unblocks item 1's second bug.

### ⬜ Two e2e suites do not install the global pipes
`test/app.e2e-spec.ts`, `test/speaking-websocket.e2e-spec.ts`

They build test apps without the global `ValidationPipe` from `main.ts`, so any
assertion they make about validation or transformation does not represent
production. This exact gap let `lesen.e2e-spec.ts` assert `400` for
`?modelltest=abc` while production returned `200` with Modelltest 1. Fixed in
the Lesen suite; these two are untouched.

### ⬜ `contentRevision` describes only Teil 2
`lesen.service.ts:44` — audit finding 03 follow-up

The response-level revision is taken from Teil 2, but it is the client's
staleness key for the whole payload. Edit Modelltest 2's Teil 1 and caches never
invalidate.

### ⬜ Select content by foreign key, never by `content_revision`
audit finding 07

Every exercise is identified twice — by `modelltest_id` and by a
`content_revision` string that also encodes the exam. They agree today because
migration 007 wired the FKs by matching those strings. Nothing keeps them
agreeing. Convention only, no migration.

### ⬜ `modelltest` param convention is inconsistent
Sprachbausteine and Lesen default to 1; Writing returns 400 without it. Pick one
and document it before more skills gain the parameter.

---

## 5 — Housekeeping

### ⬜ Confirm Sprechen intentionally has no per-exam content
audit finding 09. Three examiner prompt files, no Modelltest relation. Probably
correct — the speaking exam is a live conversation, not a fixed question set.
A question for whoever owns exam content, so the omission is on record rather
than discovered when a student asks why Modelltest 2 has no Sprechen.

### ⬜ Remaining Azure references
Base-URL examples in `HOREN_API_FRONTEND.md`, `SCHREIBEN_API_FRONTEND.md`,
`SPRECHEN_ROOM_ICE_SERVERS_API.md`, `listening_horen_rest.md`, `PLAN.md`,
`ideas/auth-system-overhaul.md`. Cosmetic — the operational ones are done.

### ⬜ Repo is still named `telC_backend_azure`
Both the GitHub repo (`NKWILI/telC_backend_azure`) and the local folder.
Renaming breaks clones and remotes for anyone else, so it needs coordinating.

### ⬜ `docs/api-contract.md` is gitignored
`.gitignore:40`. The Reading `?modelltest=` documentation was written there but
will never reach anyone else through git. Either untrack it or move the contract
somewhere shared.

### ⬜ `submitTeil2` is a stub
`lesen.service.ts:191-196` returns `{ score: 0 }` regardless of input.

---

## Done

- ✅ **Finding 01** — Lesen queries scoped to a Modelltest, `?modelltest=` param
  added, regression guard mutation-tested (`40e3f4f`)
- ✅ **Findings 03 + 04** — `NOT NULL` and `UNIQUE` on `modelltest_id` across the
  six exercise tables; applied and verified in production (`9084c84`)
- ✅ **Malformed `?modelltest=`** now returns 400 instead of silently serving
  Modelltest 1; Lesen e2e suite now mirrors `main.ts` global pipes (`2d3f5d0`)
- ✅ **DigitalOcean deployment docs** — instance-count constraint restated with
  its failure mode (`7c10a3b`)
- ✅ **Permission allowlist** repointed to `api.lerniqo.tech` (`5fab83a`)
