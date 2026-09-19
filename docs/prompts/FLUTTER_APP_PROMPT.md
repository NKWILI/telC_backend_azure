# Flutter app — sync with the backend

**For:** the coding agent or developer working in the Flutter app
(`lerniqo-frontend/telC_frontend/telC_frontend`, web and mobile).
**Backend state:** branch `dev` of `telC_backend_azure`, 2026-09-19.
**Source of every rule below:** `docs/CENTER_FRONTEND_SYNC_DECISIONS.md` in the
backend repo (the D- and T-numbers refer to it).

Students get access through their school: the school buys seats, each seat is
an **activation code**, and a student redeems a code in the app. Results are
now stored on the server for every module, and the server computes progress.
Your job is to make the app use all of that, and to remove what the product
dropped.

Do the tasks in order: each one is used by the ones after it.

---

## 0. Rules that apply to every task

**Exact shapes: Swagger.** The backend serves its API reference at
`/api-docs` (JSON at `/api-docs-json`). This prompt says what each screen must
do; for the exact request and response fields, check Swagger on the backend
you are running against. If the two disagree, Swagger is right — tell the
backend team.

**Error shapes.** Student routes answer errors in two forms:

- **With a `messageKey`** (the older module errors, and the guest block):
  `{ "statusCode", "error", "message": "Human text", "messageKey":
  "listeningStaleRevision" }`. Branch on `messageKey`.
- **Without one** (everything added for the school model): the code is in
  `message` — `{ "message": "ACTIVATION_REQUIRED", "reason": …,
  "subscriptionStatus": … }`. `statusCode` and `error` may be absent. Branch on
  `message`.
- So: use `messageKey` when present, otherwise `message`. Never branch on human
  text. Validation errors carry `message` as an **array** of strings starting
  with the field name. Extra fields (`reason`, `subscriptionStatus`…) are part
  of the answer: keep them.

**Never compute business rules in the app.** Access, progress, readiness and
history come from the API. The device keeps a local copy only as a cache for
when the network is down.

---

## 1. Accounts

- **Password rule (T2)** wherever a password is **set** (register, reset): at
  least 8 characters, an uppercase letter, a digit and a special character, at
  most 72 bytes. Check it before submitting and show the backend's specific
  reason: `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`,
  `PASSWORD_NEEDS_UPPERCASE`, `PASSWORD_NEEDS_DIGIT`,
  `PASSWORD_NEEDS_SPECIAL`. Never check it at login.
- **Level (D38):** register (`POST /api/auth/register`) and profile
  (`PATCH /api/auth/profile`) accept an optional `level`: `A1 | A2 | B1 | B2`.
  Ask it at sign-up ("What is your German level today?"), let the student
  change it in the profile. Their school can also correct it. Read it back from
  `GET /api/progress/me` (task 6). The profile update, as before, answers with a
  **new token pair**: store it.
- **Tokens:** on a 401 `INVALID_ACCESS_TOKEN`, call `POST /api/auth/refresh`
  with `{ refreshToken }` **once**, store the new pair (the refresh token
  rotates: always replace it) and retry. Concurrent requests share one refresh.
  The refresh answer may carry `subscription`: the student's access state.
- **One session per student (D21):** logging in on another device signs out
  the previous one. On the old device the next request fails with 401
  `INVALID_ACCESS_TOKEN`, and the refresh then answers 401 `SESSION_REVOKED`:
  show *"You signed in on another device"* and go to login. Any other refresh
  failure (`INVALID_REFRESH_TOKEN`, `INVALID_SESSION`) goes to login without
  that message.
- **Guest mode stays** (B16) as it is.
- Remove any remaining **Google sign-in** (D8) and the **"my devices"** screen.

## 2. Redeeming an activation code (D17)

A new screen, reachable after login and from every "access required" message:
one field for the code (`LQ-XXXX-XXXX`; accept lowercase and missing dashes,
the backend normalises), and a button.

`POST /api/auth/redeem-code` with `{ code }` (a real account; a guest gets
403 `messageKey: guestNotAllowed` — offer to create an account). Success `200`: `{ planId, centerName, expiresAt }` → *"You joined
{centerName}"* and go to the home screen.

| `message` | What to say |
|---|---|
| `CODE_INVALID` | This code does not exist. Check it with your school. |
| `CODE_ALREADY_USED` | This code is already used by someone else. |
| `CODE_DEACTIVATED` | Your school deactivated this code. |
| `CODE_EXPIRED` | This code has expired. |
| `CENTER_NOT_ACTIVE` | Your school's subscription is not active. |
| `STUDENT_ALREADY_ACTIVE` | You already have access through a school. |
| 429 | Too many attempts; try again in a few minutes. |

Re-entering one's own code is answered with success, not an error.

## 3. When access is refused (D19)

Any learning route can answer 403 `ACTIVATION_REQUIRED` with `reason` and
`subscriptionStatus`. Handle it once, centrally (interceptor), not per screen:

| `reason` | Message, then |
|---|---|
| `NO_CODE` | You need an activation code from your school → redeem screen |
| `CODE_DEACTIVATED` | Your school took your code back → redeem screen |
| `CODE_EXPIRED` | Your access has ended → redeem screen |
| `CENTER_UNPAID` | Your school's subscription has lapsed. Contact your school. |

An unknown `reason` falls back to the `NO_CODE` handling.

## 4. Every result goes to the server (D26, D29)

Turn remote submit **on for every module** (today `useRemoteSubmit = false` for
Lesen and Sprachbausteine, and Hören and Sprechen keep results on the device).
Each submit now accepts optional fields:

- `attemptId` — a UUID the app generates **once per attempt**, before sending.
  Sending the same attempt again with the same id stores it once and returns
  the first result. **Never reuse an id for a different attempt.** 409
  `ATTEMPT_ID_TAKEN` means the id belongs to someone else: generate a new one.
  Accepted by every submit, and by `evaluate`.
- `durationSeconds` — time spent on the attempt. Accepted by Hören, Lesen,
  Sprachbausteine and `evaluate` — **not by Schreiben**: its submit refuses
  unknown fields, so sending it there is a 400.

Routes and what they return:

| Module | Submit | Response |
|---|---|---|
| Hören | `POST /api/listening/submit` | `{ attemptId, score, answerKey }` |
| Lesen | `POST /api/reading/submit` | `{ attemptId, score }` (a guest gets `{ score }` only: nothing is stored) |
| Sprachbausteine | `POST /api/sprachbausteine/submit` | `{ attemptId, score }` |
| Schreiben | `POST /api/writing/submit` | `{ attemptId, status, message }` — scored later |
| Sprechen | `POST /api/speaking/evaluate` | the evaluation, as today |

- `POST /api/speaking/evaluate` also takes `modelltestNumber` (default 1): send
  the Modelltest the student is on. A repeated `attemptId` returns the stored
  evaluation without spending the student's daily allowance.
- **Offline queue:** a submit with no connection is queued on the device with
  its `attemptId` and sent when the connection returns. Retrying is safe
  because of the id. Show queued attempts as "waiting to be sent".

## 5. History from the server (D29)

| Module | History | Teils |
|---|---|---|
| Hören | `GET /api/listening/sessions?teilNumber=` | `GET /api/listening/teils?modelltest=` |
| Lesen (new) | `GET /api/reading/sessions?teilNumber=` | `GET /api/reading/teils` |
| Sprachbausteine | `GET /api/sprachbausteine/sessions?teilNumber=` | `GET /api/sprachbausteine/teils` |
| Schreiben | `GET /api/writing/sessions?exerciseId=` | — |
| Sprechen | `GET /api/speaking/sessions?teilNumber=&limit=` | `GET /api/speaking/teils?modelltest=` |

All query parameters are optional.

- Every `/sessions` item keeps the fields it had and adds: `attemptId`,
  `skill`, `teil`, `score`, `maxScore` (100), `status` (`completed` or
  `pending` while a writing text is being corrected), `completedAt`,
  `durationSeconds`, `modelltestId`.
- Every `/teils` item keeps its fields and adds: `attempts`, `bestScore`,
  `lastScore`, `lastAttemptAt`, `maxScore`. For Hören and Sprechen the numbers
  are for the Modelltest requested.
- The server is the source. Keep the last server answer on the device and show
  it, marked as possibly out of date, only when the request fails. The local
  copy never adds attempts of its own, except queued ones (task 4).
- Speaking history now shows the evaluations stored by `evaluate`
  (`sessionId`, `teilNumber`, `completedAt`, `overallScore`, `strengths`,
  `areasForImprovement`).

## 6. Progress and the home screen (D38, D7)

`GET /api/progress/me` — the same numbers the school sees:

- `skills`: `{ hoeren, lesen, sprachbausteine, schreiben, sprechen }`, 0–100,
  or **`null` = "not practised yet"** (never "0 %").
- `readiness`: `{ score, written, oral, ready }` — **estimated** exam
  readiness; say "estimated", never promise a pass. **`score: null` = "Not
  enough exercises yet"** (under 5 attempts).
- The "ready for the exam" badge comes from `readiness.ready` only, **never**
  from comparing the shown numbers (an oral score shown as 60 can be 59.7).
- `weeklyChange`: readiness now minus a week ago, or null.
- `level`, `attempts`, `lastActivityAt`, `alerts`.
- The target is always **telc B1+ Beruf**: a fixed label.

Replace the on-device calculation (`averageLatestTeilProgress`,
`readinessScore: 0`) with this. It works even when access has lapsed: it is
the student's own history.

## 7. Speaking rooms: a real short code (D32)

- `POST /api/speaking/rooms` now returns `shortCode` (6 characters, e.g.
  `K7M2QX`) beside `roomId` and `hostToken`. Show it large for the partner to
  type.
- Joining by code: `GET /api/speaking/rooms/code/{code}` (case and spaces do
  not matter) returns the room info with `roomId`; then continue exactly as
  joining by id (`GET /api/speaking/rooms/{roomId}`, then the `join-room`
  socket event). 404 = no live room with this code.
- Requires a real account: a guest gets 403 `messageKey: guestNotAllowed` and
  joins **by link** instead. 429 after 20 tries in 10 minutes.
- **Remove** the short-code branch in `speaking_peer_repository_impl.dart` and
  `SpeakingPeerSessionMockStore` (`speaking_peer_session_mock_store.dart`).
  Keep `SpeakingPeerSocketClientMock` for tests. Leaving a room uses the
  `leave-room` socket event.

## 8. Remove what the product dropped

- **Newsletter** (D30): the backend route no longer exists. Remove the screen,
  its route, repository (`features/newsletter`) and translations.
- **Grammar daily goal and progress ring** (D28): remove them; there is no
  grammar content yet.
- **Speaking phrases screen** (D40, set aside): `getPhrases` returns nothing and
  no content is coming soon. Hide the entry to the phrase screen.
- **Notification switch** (D31): stays on the device; nothing to change.

---

## How to check your work

Against a local backend on `dev`: register (with the password rule and a
level) → redeem a trial code from a school → do one exercise in each module
with the network on, and one with it off (it queues, then sends) → each
module's history shows them after reinstalling the app → the home screen
shows "Not enough exercises yet", then a readiness after 5 attempts → log in
on a second device and see the first one sign out → have the school reset the
code and see the access message.
