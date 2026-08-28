# Spec: Sprechen practice — topics, partner matching, and Elena

Status: **DRAFT — awaiting review.** Not yet approved, not yet branched.
Author: drafted 2026-08-28 against `main` @ `40e4db5` and `dev` @ `6a1dfb4`.

---

## Assumptions I'm making

Correct any of these now. Each one changes the work.

Decisions 1 and 2 were **confirmed on 2026-08-28** and are no longer assumptions.

| # | Assumption | If wrong |
|---|---|---|
| 1 | ✅ **CONFIRMED** — levels are **A2, B1, B2**. No A1. | — settled |
| 2 | ✅ **CONFIRMED** — branch from **`main`**, see *Branching* below | — settled |
| 3 | No `level` column on `Student`. Level is chosen in the UI per session | Adds a migration + onboarding screen |
| 4 | Topic **content already exists** — `SpeakingExercise` served by `GET /api/speaking/teils`. Elena reads topics from there; no new topic pool is needed for Phase 3 | Only matters if Phase 1 later wants a larger random pool |
| 5 | Lobby shows **first name only, after matching** — never a browsable list of people | A browsable directory is +5d and adds moderation duty |
| 6 | Elena connects **browser-direct** to Gemini with an ephemeral token; audio never crosses NestJS | A NestJS audio proxy is +2d and makes the backend stateful |
| 7 | ✅ **CONFIRMED** — the demo has **no login**. It auto-mints a guest JWT via `POST /api/auth/guest`. Elena must work for guests; `GuestBlockGuard` must **not** be applied | — settled |
| 8 | Single backend instance. All room/lobby state stays in-memory, as today | Multi-instance needs Valkey-backed state first |
| 9 | ✅ **CONFIRMED** — Google **free tier**. Every layer of the cap stack below is mandatory, not optional | — settled |

---

## Objective

The Sprechen room works — two people connect over WebRTC and see each other. It has
two holes that make it hard to demo and hard to use:

1. **Nothing to talk about.** Two students connect and sit in silence deciding on a
   topic. Thirty seconds of that and a demo has lost the room.
2. **Nobody to talk to.** Finding a partner means the host copying a URL into
   WhatsApp and knowing somebody who is free right now.

This spec covers three features that close both holes, delivered in order:

| Phase | Feature | User-visible outcome |
|---|---|---|
| 1 | Topic generation | A topic appears in the room, matched to the chosen level. Host can shuffle. |
| 2 | Partner matching | One button finds a partner and puts both people in a room. |
| 3 | Elena | If nobody is available, the student practises with the AI examiner instead. |

**Users:** telC B1+ Beruf candidates using the live demo at `app.lerniqo.tech`,
and prospects being shown the product.

**Success looks like:** a student can open the app alone, press one button, and be
speaking German within thirty seconds — to a person if one is free, to Elena if not,
about a topic neither of them had to invent.

### Non-goals

- Browsable partner profiles, friend lists, or messaging.
- Scheduling or calendars.
- Anything center-scoped, seat-scoped, or subscription-gated. That is the `dev` product.
- Persisting room or lobby state across a restart.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | NestJS 11, TypeScript, Node |
| Realtime | `@nestjs/platform-socket.io` 11 (namespace `/speaking-room`) |
| AI | `@google/genai` 1.52.0 — text (`gemini-2.0-flash`) and Live (`gemini-3.1-flash-live-preview`) |
| Data | Prisma 7 / PostgreSQL — **not used by this feature** |
| Cache | `ValkeyService` (Redis client), degrades to null on failure |
| Frontend | **Flutter Web** (Dart), compiled to `main.dart.js` |
| Voice module | Plain browser JS bundled with esbuild, called via `dart:js_interop` |
| API base | `https://api.lerniqo.tech` |

---

## Commands

```bash
npm run build              # prisma generate && nest build — must exit 0
npm test                   # jest, unit
npm run test:e2e           # jest --config ./test/jest-e2e.json
npm run test:integration   # jest --config ./test/jest-integration.json (needs .env.test)
npm run lint               # eslint --fix
npm run start:dev          # nest start --watch
```

The full gate before any merge:

```bash
npm test && npm run test:e2e && npm run build && npm run lint
```

---

## Project structure

Everything backend lives inside the existing room module. Nothing outside
`src/modules/speaking/` is touched.

```
src/modules/speaking/
  room/
    speaking-topics.data.ts      NEW  60 topics + the SpeakingTopic type
    topic.service.ts             NEW  random selection by level + Teil
    lobby.service.ts             NEW  in-memory matchmaking queue
    dto/
      topic.dto.ts               NEW
      find-partner.dto.ts        NEW
      create-room-response.dto.ts   ~ add topic
      room-info-response.dto.ts     ~ add topic
    room.service.ts              ~ createRoom takes level/Teil, holds topic
    room.controller.ts           ~ topic params; drop JwtAuthGuard from ice-servers
    room.gateway.ts              ~ shuffle-topic, find-partner, cancel-search
    room.module.ts               ~ provide TopicService, LobbyService
  live/
    live-token.controller.ts     NEW  POST /api/speaking/live-token
    examiner-prompt.service.ts   NEW  loads teil-*-examiner.txt, injects topic
  services/
    gemini.service.ts            ~ add mintLiveToken()

test/
  topic.service.spec.ts          NEW
  lobby.service.spec.ts          NEW
  examiner-prompt.service.spec.ts NEW
  room.*.spec.ts                 ~ extend existing suites
```

Frontend (Flutter repo, separate):

```
voice/src/pipeline.js        NEW  audio + Gemini session, framework-free
voice/src/worklet.js         NEW  AudioWorkletProcessor (must stay a separate file)
web/voice_pipeline.js             esbuild output
web/index.html               ~    one script tag
lib/services/voice_bridge.dart NEW dart:js_interop bindings
lib/screens/…                NEW  topic card, lobby screen, Elena screen
```

---

## Code style

Match the surrounding module. Services carry a `Logger`, log state transitions as
structured JSON, and open with guard clauses. Comments explain **why**, not what —
the existing room code is the reference.

```ts
@Injectable()
export class LobbyService {
  private readonly logger = new Logger(LobbyService.name);
  private readonly waiting = new Map<string, LobbyEntry>();

  /**
   * Pairs the first two compatible entries and hands them a room.
   *
   * Returns null rather than throwing when nobody matches: an empty lobby is the
   * normal case at demo scale, not an error, and the caller renders a waiting
   * state either way.
   */
  tryMatch(socketId: string): MatchResult | null {
    const entry = this.waiting.get(socketId);
    if (!entry) return null;

    const partner = this.findCompatible(entry);
    if (!partner) return null;

    this.waiting.delete(socketId);
    this.waiting.delete(partner.socketId);

    this.logger.log(
      JSON.stringify({ event: 'lobby.matched', level: entry.level }),
    );

    return { host: entry, guest: partner };
  }
}
```

Conventions in force:

- `camelCase` in TypeScript, `snake_case` for anything crossing into Postgres.
- Every `getRoom()`-style lookup is followed immediately by a null guard.
- Cleanup functions are idempotent — a second call is a no-op, never an error.
- No `any`. No non-null assertions on values that can genuinely be absent.
- DTOs validate with `class-validator`; new query params get explicit validation
  (see `DECISIONS.md` on why `ParseIntPipe` alone is not enough here).

---

## Testing strategy

Jest. Unit specs in `test/`, named `<subject>.spec.ts`, mirroring the existing suites.

| Level | Covers | Example |
|---|---|---|
| Unit | Topic selection, lobby pairing, prompt assembly | `lobby.service.spec.ts` |
| Gateway | Socket events, disconnect cleanup, race conditions | extend `room.gateway.spec.ts` |
| E2E | HTTP contract of new endpoints | extend `test/*.e2e-spec.ts` |

Every phase must hold these invariants under test:

- Both peers in a room always receive the **same** topic.
- A socket that disconnects while queued is removed from the lobby.
- A socket cannot occupy two lobby entries, or a lobby entry and a room, at once.
- `tryMatch` on an empty lobby returns null and logs nothing at error level.
- A minted live token carries the Teil instruction and never the raw API key.

No coverage percentage target. Cover the state transitions and the failure paths;
the existing room suites already set the bar.

---

## Boundaries

**Always**

- Run the full gate (`test`, `test:e2e`, `build`, `lint`) before proposing a merge.
- Keep room and lobby state in-memory and idempotent, matching the existing design.
- Log every state transition as structured JSON with the existing field names.
- Treat any text injected into a prompt as untrusted, with an explicit instruction
  not to obey it.

**Ask first**

- Any Prisma schema change or migration. This spec assumes zero.
- Adding an npm dependency to the backend.
- Changing guards on an existing endpoint — except the one `ice-servers` change
  named in Phase 2, which is in scope.
- Anything that makes the backend stateful across instances.
- Raising or removing a Gemini spend cap.

**Never**

- Put `GEMINI_API_KEY` anywhere the browser can reach it.
- Send `hostToken` in a URL or to anyone but the host.
- Commit directly to `main` without the CI gate passing.
- Remove or skip a failing test to make a phase look done.
- Touch the payments, centers, or subscription code. Different product, different branch.

---

## Phase 3 design — Elena

### Request flow

```
Flutter ──1──▶ POST /api/speaking/live-token  (guest JWT)
                 ├─ JwtAuthGuard (guests ALLOWED)
                 ├─ cap stack (below)
                 ├─ topic looked up server-side from SpeakingExercise
                 ├─ teil-N-examiner.txt + topic → systemInstruction
                 └─ ai.authTokens.create(...)
Flutter ◀─2── { token, model, expiresInSeconds, topic }
Flutter ══3══ audio, both directions ══════▶ Google   (backend not involved)
Flutter ──4──▶ POST /api/speaking/evaluate   (existing endpoint)
```

The client sends a **Teil number only**. It never sends prompt text, topic text, or
a model name, so nothing user-controlled reaches Elena's system instruction.

### The cap stack

Free tier is the binding constraint, and its limits are on **concurrency** as well as
volume. All five layers ship together in Phase 3.

| # | Cap | Value | Enforced by | Key |
|---|---|---|---|---|
| 1 | Sessions per IP per day | **2** | `RateLimitService` | `ratelimit:elena:ip:<ip>` |
| 2 | Global sessions per day | 50 | Valkey counter | `ratelimit:elena:global:<date>` |
| 3 | **Concurrent sessions** | 2 | Valkey sorted set, TTL-evicted | `elena:active` |
| 4 | Session length | 10 min | **Google**, via `expireTime` | — |
| 5 | Token reuse / connect window | `uses: 1`, 60 s | **Google** | — |

Layers 4 and 5 are enforced by Google, so a modified client cannot bypass them.
Layer 4 is the real spend ceiling: a session physically cannot outlive it.

Layer 3 is counted, never decremented. The backend does not learn when a
browser-to-Google session ends, so an explicit release would leak slots forever.
Instead entries carry a mint timestamp, anything older than the session cap is
evicted on read, and the count is the surviving set size. Self-healing by design.

Every layer degrades the same way the existing rate limiter does: if Valkey is
unavailable, fall back to the in-process `NodeCache` and keep serving.

### Rate-limit identity

Guest `studentId` is `crypto.randomUUID()` minted per guest session with no database
row (`auth.controller.ts:253`), so a per-student cap is defeated by calling
`/api/auth/guest` again. **Guests are therefore limited by IP.** Registered students
are limited by `studentId`.

### Student-visible behaviour when capped

Each refusal returns 429 with a `messageKey`, and each routes the student to the
human room rather than a dead end.

| Cap hit | messageKey | Student sees |
|---|---|---|
| 1 — per IP | `elenaDailyLimit` | "Vous avez utilisé vos 2 sessions avec Elena aujourd'hui." |
| 2 — global | `elenaBusyToday` | "Elena est très demandée aujourd'hui. Réessayez demain." |
| 3 — concurrency | `elenaBusyNow` | "Elena parle avec quelqu'un d'autre. Réessayez dans quelques minutes." |

If the connection drops mid-session, the transcript accumulated so far is still sent
to `/api/speaking/evaluate`. The student gets feedback on what they said rather than
losing the session. There is no reconnect in Phase 3.

## Success criteria

Each is independently verifiable. Phase N is not done until its criteria pass.

### Phase 1 — Topics

- `GET /api/speaking/topics/random?level=B1&teil=2` returns a topic with title,
  description, and at least three talking points, in German.
- An invalid `level` or `teil` returns **400**, not a silent default.
- Creating a room returns a topic; `GET /api/speaking/rooms/:roomId` returns the
  **identical** topic to the guest.
- `shuffle-topic` from the host emits `topic-changed` to both sockets with the same
  new topic. From a non-host it is ignored.
- 60 topics exist, spread across A2/B1/B2 × Teil 1/2/3, reviewed by a German speaker.

### Phase 2 — Partner matching

- Two sockets emitting `find-partner` at the same level are paired within 1 second,
  both receive `partner-found` with the same `roomId`, and the WebRTC call connects.
- Only the first of the pair receives a `hostToken`.
- A socket that disconnects while waiting leaves no entry behind — asserted in test.
- A waiting socket receives `waiting-count` updates and can `cancel-search`.
- A guest with no JWT can fetch ICE servers and connect from a mobile network.

### Phase 3 — Elena

- `POST /api/speaking/live-token` returns a token constrained to the live model,
  audio modality, and the Teil instruction — verified by decoding the response.
- The raw `GEMINI_API_KEY` never appears in any response or in the Flutter bundle.
- A student speaks German and Elena answers by voice, in the same Teil structure
  the prompt files define.
- Interrupting Elena mid-sentence stops her audio within ~200 ms.
- The session ends, the transcript reaches `POST /api/speaking/evaluate`, and scores
  and corrections display — reusing the endpoint that already works.
- **Guests are not blocked.** A guest JWT from `POST /api/auth/guest` can obtain a
  live token — asserted in test, because breaking this breaks the whole demo.
- The minted token carries `uses: 1`, a 60-second connect window, and an `expireTime`
  no further out than `GEMINI_LIVE_SESSION_MAX_MINUTES`.
- A third request from the same IP on the same day returns **429** with
  `messageKey: elenaDailyLimit`.
- With the concurrency cap at 2, a third simultaneous request returns 429 with
  `messageKey: elenaBusyNow`, and a slot frees itself after the session cap elapses
  with no explicit release call.
- With `VALKEY_URL` unset the endpoint still works, limited per-instance — no crash,
  no 500.
- Prompt files resolve from `dist/` in a production build, verified by
  `npm run build && ls dist/config/prompts`.

---

## Branching

`docs/BRANCHING.md` says to branch from `dev`. **This spec proposes branching from
`main` instead**, and the reason is measurable:

```
git diff --stat main dev -- src/modules/speaking/
  room.gateway.ts            147 +++++---
  room.controller.ts          39 ++++-
  turn-credentials.service.ts 28 +++-
  room.service.ts             18 ++-
  … 15 files, 242 insertions
```

The room module has already diverged. Building on `dev` and cherry-picking to `main`
would conflict in exactly the files this feature edits most. And the feature targets
the **demo**, which production serves from `main` — confirmed by probing
`api.lerniqo.tech`, where the center routes 404 and shared routes 401.

Proposed:

```
feature/sprechen-practice   ← branched from main
   ├─ phase 1 → PR → main   (CI gates the push)
   ├─ phase 2 → PR → main
   └─ phase 3 → PR → main

then, separately: merge main → dev to carry the feature forward.
```

This inverts the documented flow, so it is an explicit decision to make, not a detail
to slip past. If you would rather hold the rule, the alternative is building on `dev`
and hand-porting to `main` — roughly a day of extra work per phase, and the demo waits.

---

## Open questions

Blocking Phase 1: **none — both resolved 2026-08-28.**

- ~~Levels?~~ → **A2, B1, B2.** No A1.
- ~~Branch?~~ → **`main`.** `main → dev` merge to follow after each phase.

Blocking Phase 2:

3. **Does the lobby show names before matching, or only after?** Anonymous-until-matched
   is safer and simpler; names make it feel human.
4. **Match on level only, or level + Teil?** Level-only doubles the chance of a match
   at low traffic. Level + Teil gives a better-focused session.

Blocking Phase 3: **all resolved 2026-08-28.**

- ~~Can guests use Elena?~~ → **Yes.** The demo has no login; blocking guests would
  block everyone. Limited by IP instead.
- ~~Session cap?~~ → **10 minutes**, set as the token's `expireTime` so Google enforces it.
- ~~Per-visitor quota?~~ → **2 sessions per IP per day.**

Still open, not blocking the backend:

5. **Which voice?** Rose uses `Zephyr`. Elena reads as warm and encouraging in the
   prompts. Ships as `GEMINI_LIVE_VOICE`, so it is a config change — but pick one
   deliberately and then freeze it, because a changed voice reads as a different person.
6. **Which live model is on your free tier?** Must be confirmed in AI Studio for the
   project behind `GEMINI_API_KEY`. Ships as `GEMINI_LIVE_MODEL`.
7. **Free-tier data use.** Free tier generally permits Google to use submitted data to
   improve its products, and Elena sessions are recordings of students' voices.
   Acceptable for a demo; revisit before a paying center's students are on it.

Not blocking, worth deciding before Phase 3 ships:

8. Restore fluency and pronunciation scores? Gemini Live returns transcripts of both
   sides, so the audio path that was lost in June exists again.
9. Start writing `ExamSession` / `TeilTranscript` / `TeilEvaluation` again? Those four
   tables are currently orphaned — nothing writes them, yet
   `GET /api/speaking/sessions` still reads `ExamSession`.

---

## Estimates

Backend, one developer, excluding review cycles.

| Phase | Backend | Frontend (Flutter) |
|---|---|---|
| 1 — Topics | 2.25 d (1.25 code + 1.0 content) | 1 d |
| 2 — Partner matching | 2.75 d | 2–3 d |
| 3 — Elena | 0.75 d | 3.5 d |
| **Total** | **5.75 d** | **6.5–7.5 d** |

Zero database migrations in every phase.
