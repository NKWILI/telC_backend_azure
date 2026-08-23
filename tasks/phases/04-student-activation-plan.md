# Phase 4 Plan: Center-Managed Student Activation

Companion todo: `tasks/phases/04-student-activation-todo.md`
Model it implements: `docs/ARCHITECTURE-B2B2C.md`

## Goal

A center provisions a student within its seat limit, hands that student a
one-time key, and the student redeems it at `app.lerniqo.tech` to set their own
password and start learning.

This is the phase that makes the product real. It is also where the trial clock
finally starts.

## Out of scope

Payment, pricing, and the learning-access guard. A blocked center's students are
not yet stopped from learning — that is Phase 5. Phase 4 provisions and
activates; it does not enforce.

## Decisions already taken

| Decision | Source |
|---|---|
| Activation keys live **7 days** | 2026-08-23 |
| Removing a student **frees its seat immediately** | 2026-08-23 |
| A provisioned student needs a **name and email**; phone optional | 2026-08-23 |
| The trial starts at the **first student activation**, exactly once | global assumption 6 |
| A center sees **everything** about its own students | `ARCHITECTURE-B2B2C.md` |
| Over the seat limit blocks **new provisioning only** | Phase 3 |

## The property that must survive every future change

**The center never learns the student's password.** It creates the account; the
student sets the credential when they redeem the key. A center that could sign
in as its students could read their work, take their assessments, and impersonate
them to Lerniqo. Every test in this phase should be read against that.

## Data model

Activation state lives on `Student`, matching the existing verification and
reset token columns rather than introducing a table for one value:

```prisma
model Student {
  // ...
  activation_key_hash    String?
  activation_key_expires DateTime?
  activated_at           DateTime?
}
```

`activated_at` is the fact that distinguishes *provisioned but never used* from
*a real user*, which Phase 8 reminders and any future churn analysis will need.

Keys are stored as a keyed hash through `TokenCryptoService.hashToken`, never in
plaintext — the same treatment as verification tokens. The raw key is returned
to the center once, at generation, and cannot be recovered afterwards.

### Starting the trial

```prisma
model CenterSubscription {
  trial_started_at DateTime?   // set here, exactly once
  trial_ends_at    DateTime?
}
```

The first successful activation sets both, inside the activation transaction,
with a predicate `trial_started_at IS NULL` so a second student cannot restart
the clock. `trial_ends_at = trial_started_at + 30 days`.

## API

All center routes sit behind `CenterAuthGuard` and are scoped by the signed
`centerId`. No route accepts a center id from input.

```
GET    /api/centers/me/students                      list, paginated
POST   /api/centers/me/students                      provision, seat-checked
GET    /api/centers/me/students/:id                  one student
PATCH  /api/centers/me/students/:id                  name and phone only
DELETE /api/centers/me/students/:id                  release the seat
POST   /api/centers/me/students/:id/activation-key   mint or rotate a key
DELETE /api/centers/me/students/:id/activation-key   revoke a key
POST   /api/student-activations                      public: student redeems
```

### `POST /api/centers/me/students`

```json
{ "firstName": "Awa", "lastName": "Mbarga", "email": "awa@example.com", "phone": "+237690000000" }
```

Returns the student plus its first activation key. The key is shown **once**.

### `POST /api/student-activations`

Public, rate limited, no authentication.

```json
{ "key": "...", "password": "..." }
```

Returns the normal student token pair. The student is now an ordinary Lerniqo
user who happens to belong to a center.

### `DELETE /api/centers/me/students/:id`

**Unlinks rather than deletes.** Sets `center_id = null`, which frees the seat
immediately as decided. The account, the password the student chose, and every
piece of their learning history survive.

Hard-deleting would destroy a person's work because an administrator edited a
roster, and would throw away the B2C prospect that `ARCHITECTURE-B2B2C.md` names
as the reason to keep student contact details at all. It is also consistent with
`Student.center_id` already being `ON DELETE SET NULL`.

## Boundary and security rules

- Every student query and mutation is scoped `where: { center_id: <from token> }`.
  A student belonging to another center must be indistinguishable from one that
  does not exist — `404`, never `403`.
- `PATCH` allowlists `firstName`, `lastName`, `phone`. Email, password,
  activation state, `center_id` and `activated_at` are not editable.
- Provisioning counts and inserts inside one Serializable transaction, so two
  concurrent admins cannot both take the last seat.
- Activation consumes the key with one predicated update; a replay affects zero
  rows and fails.
- An expired key fails with a distinct code so the center can tell "expired" from
  "wrong", but the student-facing message stays generic.
- Activation never reveals whether a key exists for a different center.
- A provisioned student has no password until activation. `login` must refuse an
  account whose `password_hash` is null rather than crashing or, worse, matching.

## Threat model

| Abuse | Control |
|---|---|
| Center reads or edits another center's students | Every query scoped by signed `centerId`; unknown ids return 404 |
| Center sets a student's password | No password field on any center route; only activation sets one |
| Key replayed after activation | Predicated consume; the second attempt matches zero rows |
| Key brute-forced | 32 bytes of entropy, hashed at rest, rate limited by IP |
| Two admins exceed the seat limit | Count and insert in one Serializable transaction |
| A second activation restarts the trial | `trial_started_at IS NULL` predicate |
| Center escalates a student into another center | `center_id` is never accepted from input |
| Provisioned account logged into before activation | Null `password_hash` refuses login |
| Removing a student destroys their work | Unlink, never delete |

## Tasks

### Task 1: Schema for activation

Add the three `Student` columns and a migration. No behaviour.

**Acceptance:** additive; existing students unaffected; `prisma validate` and build pass.
**Scope:** S · **Dependencies:** none

### Task 2: Provisioning with seat enforcement

`StudentProvisioningService.create` — count and insert inside a Serializable
transaction, mint the first key.

**Acceptance:**
- Refuses when `seatsUsed >= seatsLimit`, with a distinct error code.
- Two concurrent provisions at the last seat: exactly one succeeds.
- The created student has `center_id` from the token and no password.
- The raw key is returned once; only its hash is stored.

**Verification:** `npm test -- student-provisioning.service.spec`
**Scope:** M · **Dependencies:** 1

### Task 3: Activation and the trial trigger

`StudentActivationService.activate` — consume the key, set the password, start
the trial if it has not started.

**Acceptance:**
- The key is single-use; a replay fails.
- An expired key fails distinctly from an unknown one.
- The student sets their own password; bcrypt cost matches student registration.
- First activation sets `trial_started_at` and `trial_ends_at = +30 days`.
- A second activation leaves both untouched.
- Returns the normal student token pair.

**Verification:** `npm test -- student-activation.service.spec`
**Scope:** M · **Dependencies:** 1, 2

### Checkpoint A — the two hard parts before any endpoint

- [ ] Seat concurrency and the trial trigger both proven
- [ ] Full suite green, build exit 0
- [ ] Human review

### Task 4: Center student endpoints

List, get, patch, delete, and the two key routes.

**Acceptance:**
- All scoped by the signed center; another center's student is a 404.
- `PATCH` rejects email, password, `center_id`, `activated_at`.
- `DELETE` unlinks and frees the seat; the student row survives.
- List is paginated.

**Scope:** M · **Dependencies:** 2

### Task 5: Public activation endpoint

**Acceptance:** rate limited by IP; strict DTO; generic failure messages.
**Scope:** S · **Dependencies:** 3

### Task 6: Integration tests against real Postgres

**Acceptance:**
- Concurrent provisioning at the last seat: one wins, seat count never exceeded.
- Concurrent activation of one key: one wins.
- Two students activating: the trial starts once, and the clock does not move.
- Unlinking frees a seat and preserves the student and their sessions.

**Verification:** `npm run test:integration`
**Scope:** M · **Dependencies:** 1-5

### Task 7: Bruno collection

A new `Center Students` folder covering the whole flow, plus `Student
Activation`. Each request documents the manual checks the automated suites
cannot make — that a key works exactly once, that another center's student is a
404 rather than a 403, that the trial timestamp does not move on the second
activation, and that a removed student keeps their account.

**Scope:** S · **Dependencies:** 4, 5

### Task 8: Gates and review

Unit, e2e, integration, build and lint by exit code; code-quality and security
review; report changes, non-changes, concerns and evidence.

**Scope:** S · **Dependencies:** 1-7

### Checkpoint B — Phase 4 complete

- [ ] All gates by exit code
- [ ] Manual pass through Bruno
- [ ] Human approves merge to `dev`

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Seat limit bypassed under concurrency | High | Serializable count-and-insert, proven against real Postgres |
| Trial clock restarted by a later activation | High | `trial_started_at IS NULL` predicate, plus an integration test |
| A center reaches another center's students | High | Every query scoped by the signed token; 404 for unknown |
| Removing a student destroys their history | High | Unlink rather than delete |
| Provisioned account is logged into before activation | Medium | Null `password_hash` refuses login; needs an explicit test |
| Email collides with an existing independent student | Medium | See open question 3 |

## Open questions

1. **Is a provisioned student's email verified?** The center vouched for it,
   which argues for `email_verified: true` and no verification email. But then
   nobody has proven the address works, and password reset depends on it.
   *Recommendation: mark verified, and let the first reset prove the address.*

2. **Is the activation key emailed to the student, or only shown to the center?**
   The plan assumes the center hands it over in person. Emailing it as well
   costs little and covers a student who loses the paper.
   *Recommendation: return it to the center only, in this phase.*

3. **What if the email already belongs to an independent student?** Attach that
   existing account to the center, or refuse?
   *Recommendation: refuse with a distinct code. Silently attaching someone
   else's account to a center would be a takeover.*

4. **May a center see a student's actual submissions**, or only scores and
   progress? `ARCHITECTURE-B2B2C.md` records "everything", so this phase assumes
   full visibility — worth confirming before the list endpoint decides what to
   return.

## Verification

```powershell
npm test
npm run test:e2e
npm run test:integration
npm run build; "exit: $LASTEXITCODE"
npm run lint
```

## Completion gate

Phase 4 is done when a center can provision a student within its seat limit,
that student can redeem a key exactly once and set their own password, the trial
starts exactly once, a center cannot reach another center's students, removing a
student frees a seat without destroying their account, and a human has approved
the merge to `dev`.
