# Spec: Sprechen lobby — finding a partner

Status: **DRAFT — awaiting review.** Branch `feature/speaking-lobby`, off `main` @ `2f5ebae`.
Drafted 2026-08-28.

---

## Assumptions

Correct any of these now.

| # | Assumption | If wrong |
|---|---|---|
| 1 | **One queue, no level dimension yet.** `SpeakingLevel` is literally `'B1'` and all 60 topics are B1, so matching by level is a no-op today. The key is designed in but has one value | Adding levels later is a data change, not a code change |
| 2 | Anonymous, like the rest of the demo. Display name is self-declared, not verified | — |
| 3 | Queue state is in-memory, single instance, exactly like `RoomService` | Multi-instance needs shared state for rooms *and* lobby together |
| 4 | Matched pairs use the existing room flow untouched — same gateway, same namespace, same WebRTC | — |
| 5 | No scheduling, no profiles, no friend lists, no messaging | Those are a different, much larger product |
| 6 | The empty-lobby fallback is **Elena**, already shipped in `2f5ebae` | Without a fallback an empty lobby is a dead end |

---

## Objective

Today, meeting someone means the host copying a URL into WhatsApp and knowing
somebody who happens to be free. The lobby replaces that with one button.

**A student presses "Trouver un partenaire", and either gets matched with someone
within seconds, or is offered Elena instead.**

### Non-goals

- Browsing or searching a list of people. See *Why a queue, not a directory*.
- Choosing who you talk to.
- Scheduling, calendars, or reminders.
- Anything center-scoped — that belongs to the `dev` product.

### Why a queue, not a directory

A browsable directory needs profiles, a request/accept inbox, and moderation, and
it only feels alive when many people are online at once. Tandem has roughly ten
million users and reviewers still describe its searches returning thin results
outside major language pairs. A directory is the format that needs the most
liquidity and the demo has the least. A queue needs none of it, costs about a
fifth of the code, and removes an entire category of safety surface.

---

## Design

### The queue

One in-memory `Map<socketId, LobbyEntry>` in a new `LobbyService`, mirroring how
`RoomService` holds rooms.

```ts
interface LobbyEntry {
  socketId: string;
  displayName: string;
  level: SpeakingLevel;
  joinedAt: Date;
}
```

Matching is first-in-first-out among compatible entries. At one level that is
simply "the socket that has waited longest, that is not you".

### Matching produces nothing new

This is the point of the design: a match only has to produce a `roomId` and a
`hostToken`. Everything after that already exists and is already tested.

```
find-partner
  └─ no partner?  → emit waiting { position, count }
  └─ partner?     → roomService.createRoom(level)      ← exists, assigns the topic
                    emit partner-found to both
                    hostToken to ONE of them only
                    both clients then run join-room    ← exists, untouched
```

The first of the pair to have queued becomes the host, on the grounds that they
waited longer. Nothing else distinguishes them.

### Event contract

Added to the existing `/speaking-room` namespace. No second socket connection.

| Direction | Event | Payload |
|---|---|---|
| client → server | `find-partner` | `{ displayName: string, level?: SpeakingLevel }` |
| client → server | `cancel-search` | `{}` |
| server → client | `waiting` | `{ count: number }` — others waiting, excluding you |
| server → client | `waiting-count` | `{ count: number }` — pushed when the queue changes |
| server → client | `partner-found` | `{ roomId: string, hostToken?: string, displayName: string }` |
| server → client | `already-searching` | `{}` — second `find-partner` from the same socket |
| server → client | `search-cancelled` | `{}` |
| client → server | `report-partner` | `{ reason?: string }` — room derived server-side |
| server → client | `partner-reported` | `{}` — call ends for both |

`displayName` is validated as a first name: 1–30 characters, no digits. A name
field shown to strangers is otherwise a contact-sharing channel, and rejecting
digits removes the obvious use of it.

`hostToken` is present for exactly one of the two peers and travels only over the
socket — never in a URL, matching the existing rule.

---

## Implementation notes

Three things found by reading the current gateway. Each is a bug if missed.

**1. Dequeue must precede the room guard in `handleDisconnect`.**
`room.gateway.ts:310` opens with `if (!room) return;`. A socket waiting in the
lobby has no room, so it takes that early return and its entry is never removed.
The lobby fills with ghosts who are matched and never answer. The dequeue has to
happen before that guard, not inside the existing branches.

**2. One socket is either queued or in a room, never both.**
The gateway already enforces one-socket-one-room through `client.data.roomId`
(EDGE-06). The lobby needs the same invariant extended: refuse `find-partner`
from a socket that already has `client.data.roomId`, and clear the queue entry at
the moment of matching, not when `join-room` arrives — otherwise a slow client is
matched twice.

**3. Stale entries must be swept.**
A socket can vanish without a clean disconnect. Entries older than
`LOBBY_ENTRY_TTL_SECONDS` are evicted on read, the same self-healing pattern the
Elena concurrency pool uses. No timer, no background job.

---

## Caps

Reuses the existing `ThrottlerGuard` on the HTTP side; the socket side needs its
own, because `find-partner` creates rooms.

| Cap | Value | Why |
|---|---|---|
| `find-partner` per socket | 10 / minute | A loop would create rooms without limit |
| Queue size | 200 | Bounded memory; beyond this the demo has other problems |
| Entry TTL | 120 s | A person who queued and walked away is not a partner |

---

## Safety

The lobby introduces something the product does not currently have: **live video
between strangers who did not choose each other.** Until now every call came from
a link one person deliberately sent another.

**Decided: these ship in this branch, not a follow-up.**

Minimum before this is reachable by the public:

- **Report.** A button in the room that ends the call and logs `roomId`,
  timestamp and reason. Even without moderator tooling, the log is the record.
- **Block for the session.** A reported partner is not re-matched to the reporter.
- **First name only.** `displayName` is already free text; cap it and strip
  contact-looking strings so the lobby is not used to broadcast phone numbers.
- **A visible reminder** before the first match that this is a real video call
  with a stranger.

These are roughly 200 lines on top of the estimate below and I would not ship the
feature without them. Some users are likely to be minors.

---

## Success criteria

- Two sockets emitting `find-partner` are matched within 1 second, both receive
  `partner-found` with the **same** `roomId`, and the WebRTC call connects.
- Exactly one of the pair receives a `hostToken`.
- Both peers see the same topic, because the room was created by `createRoom`.
- A socket that disconnects while waiting leaves **no** entry behind — asserted
  directly against `LobbyService`, since this is the failure that fills the queue
  with ghosts.
- A socket that has been matched cannot be matched again.
- `cancel-search` removes the entry and emits `search-cancelled`.
- Waiting clients receive `waiting-count` when someone else joins or leaves.
- With one person waiting, that person is never matched to themselves.
- An entry older than the TTL is not offered as a partner.

---

## Estimate

| File | Lines |
|---|---|
| `room/lobby.service.ts` | ~130 |
| `room/dto/find-partner.dto.ts` | ~28 |
| `room/room.gateway.ts` (additions) | ~110 |
| `room/room.module.ts` | ~2 |
| **Source** | **~270** |
| `room/report.service.ts` + `dto/report-partner.dto.ts` | ~150 |
| `test/lobby.service.spec.ts` | ~180 |
| `test/lobby.safety.spec.ts` | ~90 |
| `test/room.gateway.spec.ts` (additions) | ~120 |
| **Tests** | **~390** |
| **Backend total** | **~810** |

Roughly **3 days backend**, safety included. Flutter is a search screen, a
waiting state, the Elena offer at 45 s, a report control and navigation on
`partner-found` — about 420 lines, 3 days, estimated by analogy since this repo
does not contain the Flutter code.

**Zero migrations. Zero new dependencies. Zero changes to WebRTC signalling.**

---

## Decisions

All four settled on 2026-08-28. None remain open.

| Question | Decision |
|---|---|
| Waiting screen | **Show the live count.** An empty lobby reads as information, not breakage |
| Elena fallback | **45 seconds.** A real attempt at a human, without losing the student |
| Safety items | **This branch.** Not a follow-up — see *Safety* above |
| Display name | **First name, ≤30 chars, no digits.** Blocks the obvious abuse: broadcasting a phone number to strangers |

The 45-second timer is **client-side**. The backend has no reason to know about
it: the student stays queued while Elena is offered, and only leaves the queue if
they accept. Someone who declines Elena keeps waiting, and a human match can
still arrive while the offer is on screen.
