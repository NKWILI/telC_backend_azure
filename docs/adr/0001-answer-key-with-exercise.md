# ADR 0001 — Serve the answer key with the exercise

**Status:** accepted
**Date:** 2026-09-09
**Reverses:** `7678440` (2026-08-21)
**Spec:** [ANSWER_KEY_WITH_EXERCISE_SPEC.md](../ANSWER_KEY_WITH_EXERCISE_SPEC.md)

---

## Context

`GET /api/sprachbausteine/exercise` used to include `correctOptionId` and
`correctWordId`. On 21 August 2026, `7678440` removed them, because they let anyone read
the answers out of the network response before answering. The same commit moved scoring
server-side — submission had until then been `const score = dto.score`, so a client could
simply POST `score: 100`.

Both were real holes. Both were closed correctly.

What was not done was telling the client. The Flutter app still parses `correctOptionId`
and `correctWordId` — 7 and 3 occurrences in the deployed bundle — and has never called
`POST /submit`. So from 21 August the Sprachbausteine correction screen showed nothing,
and nobody connected the two events until the frontend developer reported it three weeks
later.

Reading was heading for the same wall from further back: the app reads a `correctMatches`
field the API has never sent, and `reading/submit` is likewise never called. That work was
blocked waiting on the frontend to specify a field shape.

`fa18aa8` had already made `POST /sprachbausteine/submit` return `answerKey`, mirroring
Hören. That is the more defensible design and it works — but it requires the app to start
calling an endpoint it does not call today, which is a client release away.

## Decision

Serve the correct answer with the exercise, per item, for Sprachbausteine and Lesen:

| Module | Field | On |
|---|---|---|
| Sprachbausteine | `correctOptionId` | each Teil 1 gap |
| Sprachbausteine | `correctWordId` | each Teil 2 gap |
| Lesen | `correctTitleId` | each Teil 1 text |
| Lesen | `correctOptionId` | each Teil 2 question |
| Lesen | `correctAnswer` | each Teil 3 situation |

Unconditionally — no mode parameter, no role gating. Sprachbausteine deliberately reuses
the field names the shipped app already parses, so its correction screen works with no
client release.

Everything on the submit path stays: server-side scoring, `dto.score` ignored,
`contentRevision` enforced, attempts persisted, `POST /submit` still returning `answerKey`.

## Consequences

**Accepted.** Anyone who proxies the app can read the answers before answering. They can
then submit those answers and receive a score that is computed, correctly, as 100%. The
server-side scoring from `7678440` remains intact and is no longer sufficient on its own:
it stops a forged score, not a copied answer.

Concretely, this means **`sprachbausteine_attempts.score` is no longer evidence that a
student answered unaided.** Anything built on that assumption — progress, readiness
signals, analytics — inherits the weakness.

This was weighed against a broken feature that had been dead for three weeks in a
self-paced practice product, where a student who looks up answers is the only person
harmed. Shipping beat the guarantee.

**Mitigation.** `sprachbausteine_attempts.answers_prefetched` records that an attempt was
taken under these conditions. It costs one boolean now and is the difference between being
able to introduce a trustworthy exam mode later and not being able to say anything about
the attempts recorded in between. Lesen has no equivalent because it has no attempt table
at all.

**Two producers of one key.** `getExercise()` now projects the answer key and
`getAnswerKey()` / `getSubmissionRules()` still score against it, from different queries.
Tests in both services submit the key served by `getExercise()` and assert it scores 100.
If those tests are ever deleted, the two can drift and students get marked wrong for
correct answers.

## Alternatives considered

**Leave it; make the app call `POST /submit`.** The stronger design, and where `fa18aa8`
was heading. Rejected because it keeps the feature dead until a client release, and Lesen
blocked behind a question that did not need asking.

**`?mode=practice`, server-decided.** Would preserve a real exam mode. Rejected as
premature: there is no exam-mode product requirement to hang it on, and it would itself
require the client change we were trying to avoid. `answers_prefetched` keeps the door
open at a fraction of the cost.

**A `correctMatches` map for Lesen Teil 1**, matching what the app already reads there.
Rejected: it would give Teil 1 a different shape from Teils 2 and 3 in an endpoint that
already carries three answer encodings. The client edits one reader instead.

## Notes for whoever changes this next

The guard test in `sprachbausteine.service.spec.ts` was **inverted, not deleted**. It now
asserts the fields are present. That is deliberate — it keeps a test on the surface, so the
next change has to confront this decision rather than rediscover it.

If you are re-hiding the answers, the client depends on these fields. Tell the frontend
first. That omission is the entire reason this ADR exists.
