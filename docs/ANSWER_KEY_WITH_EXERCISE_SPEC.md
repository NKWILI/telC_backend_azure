# Spec: Return the answer key with the exercise (Sprachbausteine + Lesen)

**Status:** draft — awaiting review
**Modules:** `sprachbausteine`, `lesen`
**Related:** `docs/SPRACHBAUSTEINE_CORRECTION_FR.md` (the note to Herman), commit `7678440`, commit `fa18aa8`

---

## Assumptions

Stated up front so they can be corrected before any code is written.

1. The answer key ships **unconditionally** in `GET /exercise` — no `mode=practice` flag, no
   gating on subscription or role. Every authenticated caller gets it.
2. We accept the consequence: a student who proxies the app can read the answers before
   answering, and any score they then submit will be computed as legitimately correct.
   This was raised, discussed, and accepted as the right trade for a self-paced practice
   product.
3. Sprachbausteine uses the field names Herman's shipped bundle already parses —
   `correctOptionId`, `correctWordId` — so his correction screen needs **zero app changes**.
4. `POST /submit` stays exactly as it is: server-side scoring, revision check, attempt
   persistence. Shipping the key early is a separate decision from trusting client scores,
   and only the first is in scope.
5. `POST /sprachbausteine/submit` keeps returning `answerKey` as well. Redundant once it is
   in `/exercise`, but removing it would break any client that adopted `fa18aa8`.
6. Lesen keeps returning `{ score }` only from submit. The key arrives via `/exercise`.

> Correct any of these now, or implementation proceeds on them.

---

## Objective

Herman's Sprachbausteine correction screen has been broken since **21 August 2026**, when
`7678440` removed `correctOptionId` / `correctWordId` from `GET /exercise` to stop the answers
being readable before the student answered. The app was never updated. It still parses those
exact field names (7 and 3 occurrences in the deployed bundle) and never calls `/submit`
(0 occurrences).

The same wall is waiting on Reading: his code reads `correctMatches`, the API sends nothing,
and `reading/submit` is never called. Lesen has been blocked for weeks on two questions he has
not answered about the field shape.

**Goal:** restore per-item correct answers to `GET /exercise` for both modules, so the
frontend can render corrections locally, and so Lesen stops being blocked on a round trip that
no longer needs to happen — we define the shape and tell him.

### Users

- **Herman (frontend, Flutter)** — needs a field to compare student answers against.
- **Students** — need to see which gaps they got wrong after submitting.

### Success looks like

- Herman's Sprachbausteine screen renders corrections with no app release.
- Lesen Teil 1–3 expose correct answers in a documented, single, consistent shape.
- Attempt persistence and server-side scoring are unchanged.
- The reversal is recorded, so nobody re-applies the August guard by accident.

---

## Tech Stack

| | |
|---|---|
| Runtime | Node 22.x |
| Framework | NestJS 11 |
| ORM | Prisma → PostgreSQL |
| Tests | Jest 30 + ts-jest |
| Docs | Swagger via `@nestjs/swagger` decorators |

No new dependencies.

---

## Commands

```bash
npx prisma generate                          # required before build and tests
npx nest build                               # build
npx jest --ci                                # unit tests
npx jest --ci --config ./test/jest-e2e.json  # e2e tests
npm run lint                                 # eslint --fix
npx prisma migrate dev --name add_answers_prefetched   # the one migration (see Boundaries)
```

CI runs build → unit → e2e via `.github/workflows/test.yml`. All three must be green.

---

## Project Structure

Files this spec touches. Nothing outside this list should change.

```
src/modules/sprachbausteine/
  sprachbausteine.service.ts            → getExercise(): emit correct ids
  sprachbausteine.service.spec.ts       → replace the guard test
  dto/sprachbausteine-gap.dto.ts        → + correctOptionId
  dto/sprachbausteine-teil2-gap.dto.ts  → + correctWordId

src/modules/lesen/
  lesen.service.ts                      → lift key builder out of the submit path
  lesen.service.spec.ts                 → new assertions
  dto/lesen-teil1-text.dto.ts           → + correctTitleId
  dto/lesen-teil2-question.dto.ts       → + correctOptionId
  dto/lesen-teil3-situation.dto.ts      → + correctAnswer

src/modules/listening/
  dto/submit-listening.dto.ts           → fix the `timed` description only

prisma/schema.prisma                    → SprachbausteineAttempt.answers_prefetched
docs/                                   → ADR + update SPRACHBAUSTEINE_CORRECTION_FR.md
```

---

## Design

### Sprachbausteine — `GET /api/sprachbausteine/exercise`

The data is already loaded. `getExercise` queries `gaps.options` (rows carrying `is_correct`)
and drops the flag while projecting. Re-attach it as a composed id.

```jsonc
{
  "contentRevision": "…",
  "teil1": {
    "gaps": [
      {
        "id": "21",
        "correctOptionId": "21b",          // ← new
        "options": [ { "id": "21a", "content": "…" }, … ]
      }
    ]
  },
  "teil2": {
    "wordBank": [ { "id": "wa", "letter": "a", "content": "…" } ],
    "gaps": [ { "id": "31", "correctWordId": "wa" } ]   // ← new
  }
}
```

Encoding is unchanged from what `/submit` already accepts and returns, so nothing needs
converting in any direction.

### Lesen — `GET /api/reading/exercise`

The key builder exists but lives inside `getSubmissionRules`, reachable only from `submit`.
Extract it to a private method both paths call, then attach per item.

| Teil | new field | on | value |
|---|---|---|---|
| 1 | `correctTitleId` | each `texts[]` | the `titles[].id` that matches |
| 2 | `correctOptionId` | each `questions[]` | `"6a"` — questionNumber + letter |
| 3 | `correctAnswer` | each `situations[]` | `"a"`…`"z"`, or `"X"` when `noMatch` |

**Per-item, not a `correctMatches` map.** Herman's bundle references `correctMatches`, so
Teil 1 will need a small change on his side. Chosen anyway because per-item matches
Sprachbausteine exactly, keeps the correct answer next to the thing it belongs to, and avoids
introducing a fourth answer encoding into an endpoint that already has three. This is the one
place in the spec where he does work; it is named here so it is not a surprise.

### Attempt flag

`SprachbausteineAttempt.answers_prefetched Boolean @default(true)`

Set `true` for every attempt recorded after this ships. Costs one column now; without it,
every historical attempt becomes permanently ambiguous the day an exam mode is wanted.

**Lesen gets no flag** — it has no attempt table. `LesenSession` and `LesenResult` exist in
`schema.prisma` but are referenced nowhere in `src/`; `LesenService.submit` persists nothing
and never receives a `studentId`. Adding Lesen persistence is real work and is **out of scope**
here (see Out of Scope).

### Listening

Description-only fix. `submit-listening.dto.ts` documents `timed: true` as
"exam mode (no answer reveal)", but `ListeningService.submit` returns `answerKey`
unconditionally — the flag is only written to the attempt row. The text was already wrong;
this spec makes it definitively wrong. Correct the string. **No behavior change.**

---

## Code Style

Match the surrounding service. Compose ids the same way the existing projection does, and
comment the *why* — not the *what* — when a line encodes a decision.

```ts
const letters = ['a', 'b', 'c'];
const gaps: SprachbausteineGapDto[] = exercise.gaps.map((gap) => {
  const options = gap.options.map((o) => ({
    id: `${gap.gap_key}${letters[o.sort_order]}`,
    content: o.content,
  }));

  // Same encoding /submit accepts and returns, so the client compares directly.
  // Shipped with the exercise by decision — see docs/adr/0001-answer-key-with-exercise.md.
  const correct = gap.options.find((o) => o.is_correct);

  return {
    id: gap.gap_key,
    correctOptionId: correct ? `${gap.gap_key}${letters[correct.sort_order]}` : '',
    options,
  };
});
```

Conventions already in force: `camelCase` in DTOs, `snake_case` for Prisma columns,
`@ApiProperty` on every response field, explicit return types on public service methods.

---

## Testing Strategy

Jest + ts-jest. Unit specs live beside the service (`*.service.spec.ts`) or in `test/`;
e2e in `test/*.e2e-spec.ts` under `test/jest-e2e.json`.

**The guard test is inverted, not deleted.**
[`sprachbausteine.service.spec.ts:53`](../src/modules/sprachbausteine/sprachbausteine.service.spec.ts)
currently asserts the fields are absent. Replace it with one asserting they are present and
correct — keeping a test on that line means the next person to change this surface has to
confront the decision rather than discover it.

| # | Test | Level |
|---|---|---|
| 1 | SB Teil 1 gaps expose the right `correctOptionId` | unit |
| 2 | SB Teil 2 gaps expose the right `correctWordId` | unit |
| 3 | `is_correct` never leaks as a raw column name | unit |
| 4 | Submit still ignores a client-supplied `score` (regression on `7678440`) | unit |
| 5 | Submit still rejects a mismatched `contentRevision` | unit |
| 6 | Lesen Teil 1/2/3 expose correct answers in the documented encoding | unit |
| 7 | Lesen `/exercise` key agrees with the key `/submit` scores against | unit |
| 8 | New attempts record `answers_prefetched = true` | unit |

Test 7 is the one that matters most: the key now has two producers, and they must not drift.

No coverage threshold is configured; do not add one in this change.

---

## Boundaries

**Always**
- Run `npx nest build && npx jest --ci && npx jest --ci --config ./test/jest-e2e.json` before committing.
- Keep server-side scoring. `dto.score` and `dto.score_percent` stay deprecated and ignored.
- Keep the `contentRevision` check on Sprachbausteine submit.
- Reference the ADR in any comment that encodes this decision.

**Ask first**
- The Prisma migration for `answers_prefetched` — schema change, needs explicit approval.
- Any change to `LesenSubmitRequestDto`'s accepted fields, even the ones the service ignores
  (`id`, `exercise_type_id`, `tested_at`, `remark`) — the app still sends them.
- Renaming any existing response field.

**Never**
- Restore `const score = dto.score`.
- Return the key from `/submit` before the attempt row is written.
- Delete the guard test without replacing it (invert it).
- Touch `src/modules/speaking/**` or `src/modules/writing/**`.

---

## Out of Scope

- **Lesen attempt persistence** (`@CurrentStudent`, an attempt table, `/sessions`, `/teils`).
  Reading still records nothing and still has no progress tracking after this change. Real
  work, separate spec.
- **Lesen `contentRevision` check on submit.** Absent today; stays absent here. Worth its own
  ticket — a stale client is currently mis-scored silently.
- `mode=practice` / exam mode. Deliberately deferred; `answers_prefetched` preserves the option.
- Removing the ignored fields from `LesenSubmitRequestDto`.
- Listening behavior. Description string only.

---

## Success Criteria

1. `GET /api/sprachbausteine/exercise?modelltest=1` returns `correctOptionId` on every Teil 1
   gap and `correctWordId` on every Teil 2 gap, in the same encoding `/submit` accepts.
2. `GET /api/reading/exercise?modelltest=1` returns `correctTitleId`, `correctOptionId` and
   `correctAnswer` on Teil 1, 2 and 3 respectively.
3. For every Teil in both modules, the key from `/exercise` is identical to the key `/submit`
   scores against (test 7).
4. `POST` behavior is byte-identical to today apart from the new attempt column: same scores,
   same 404 on revision mismatch, same 422 on invalid answers, same persistence.
5. New Sprachbausteine attempts carry `answers_prefetched = true`.
6. Build, unit and e2e all green in CI.
7. An ADR exists at `docs/adr/0001-answer-key-with-exercise.md` recording that `7678440` is
   being deliberately reversed, and why.
8. `docs/SPRACHBAUSTEINE_CORRECTION_FR.md` is updated: Herman's Sprachbausteine screen needs
   no change, and section 7's two open questions are answered rather than asked.

---

## Implementation Order

One branch, one PR, commits kept separate so Sprachbausteine can be reverted alone if the
field shape turns out wrong.

| # | Commit | Effort |
|---|---|---|
| 1 | Sprachbausteine: `correctOptionId` / `correctWordId` + inverted guard test | ~30 min |
| 2 | Lesen: lift the key builder, attach per-Teil fields, tests 6–7 | ~1–2 h |
| 3 | `answers_prefetched` migration + test 8 | ~15 min |
| 4 | ADR + update the FR doc for Herman | ~20 min |
| 5 | Listening `timed` description fix | ~2 min |

Roughly half a day.

---

## Open Questions

1. **Migration approval.** Item 3 changes `schema.prisma` and needs a Prisma migration against
   the production database. Confirm before it runs — this is the one "ask first" in the plan.
2. **Lesen Teil 1 shape.** Spec'd as per-item `correctTitleId`. Herman's bundle reads
   `correctMatches`, so he does a small edit for Teil 1. Confirm that is acceptable, or say the
   word and Teil 1 emits a `correctMatches: { textId: titleId }` map instead for zero app
   change — at the cost of Teil 1 differing in shape from Teils 2 and 3.
3. **Deploy coupling.** DigitalOcean deploys on `main` push, independently of CI. Should this
   wait for Herman to be ready, or ship as soon as it is green? The change is additive, so
   shipping early breaks nothing.
