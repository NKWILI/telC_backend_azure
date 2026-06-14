# Implementation Plan: Speaking Room Feature (Sprechen Video Room)

## Overview

A real-time peer-to-peer video practice room inside the existing Sprechen module. Two users connect via WebRTC to practice speaking German together. The backend acts as a signaling relay and room manager only — no audio/video passes through it. No AI evaluation, no authentication required for the demo phase. Everything lives in a single in-memory Map, safe on the single Azure B1 instance.

---

## Architecture Decisions

- **Socket.IO over native ws** — `@nestjs/platform-socket.io` is already installed. Zero new packages needed.
- **No JWT for demo** — Both host and guest connect without authentication. The `roomId` + `hostToken` together are the credentials.
- **`crypto.randomUUID()`** — Built into Node.js 14.17+, no extra package needed.
- **Single RoomModule** — Encapsulates controller, gateway, and service. Imported into the existing `SpeakingModule`.
- **In-memory Map** — Sufficient for demo on a single Azure B1 instance. `RoomService` is a NestJS singleton so the Map is shared between the controller and gateway.
- **No Teil structure** — The room is a free practice space. What users discuss is entirely up to them. No exercise control from the backend.
- **Frontend builds the share link** — The backend returns only a `roomId`. The frontend constructs the full shareable URL using its own hosted domain (e.g. `https://yourapp.vercel.app/speaking/room/abc123`). The host then shares it manually via WhatsApp, SMS, etc.
- **All WebSocket event names and payload shapes are fully specified (API-02 + API-03 fix):**

  | Direction | Event | Payload |
  |---|---|---|
  | client → server | `join-room` | `{ roomId: string, displayName: string, hostToken?: string }` |
  | client → server | `offer` | `{ roomId: string, offer: RTCSessionDescriptionInit }` |
  | client → server | `answer` | `{ roomId: string, answer: RTCSessionDescriptionInit }` |
  | client → server | `ice-candidate` | `{ roomId: string, candidate: RTCIceCandidateInit }` |
  | client → server | `leave-room` | `{}` — no payload. Room is derived server-side via `getRoomBySocketId(client.id)`. Client never declares which room to leave (EDGE-03 fix). |
  | server → client | `guest-joined` | `{ displayName: string }` |
  | server → client | `host-reconnected` | `{}` |
  | server → client | `host-disconnected` | `{}` |
  | server → client | `offer` | `{ offer: RTCSessionDescriptionInit }` |
  | server → client | `answer` | `{ answer: RTCSessionDescriptionInit }` |
  | server → client | `ice-candidate` | `{ candidate: RTCIceCandidateInit }` |
  | server → client | `partner-left` | `{}` |
  | server → client | `room-ended` | `{}` |
  | server → client | `room-not-found` | `{}` |
  | server → client | `no-guest-ready` | `{}` |
  | server → client | `room-full` | `{}` |
  | server → client | `server-shutting-down` | `{}` — emitted to all connected sockets before process exits (PROD-02) |
  | server → client | `already-in-room` | `{}` — emitted when socket sends `join-room` for a second different room (EDGE-06) |
  | server → client | `unauthorized` | `{}` — emitted when a socket sends `offer` or `answer` without matching the expected sender role for that room (SEC-03 fix) |

- **Graceful shutdown on server restart (PROD-02 fix)** — In-memory state cannot survive a restart. Instead of silently dropping connections, `RoomGateway` implements NestJS's `OnApplicationShutdown` lifecycle hook. On `SIGTERM` (Azure sends this before killing the process), the gateway iterates all active rooms via `RoomService` and emits `server-shutting-down` to every connected socket before the process exits. Users see a clear message rather than a frozen screen. This is graceful degradation — when the failure is unavoidable, minimize user confusion. Note: Always On must be enabled (Azure checklist Step 2) to prevent idle-timeout restarts on top of deploy restarts.
- **Structured logging at every state transition (PROD-01 fix)** — NestJS `Logger` (already used in existing modules, not `console.log`) with structured JSON fields at minimum: `{ event, roomId, socketId?, status?, direction?, reason? }`. Logged at every: `createRoom`, `setHost`, `setGuest`, `removeGuest`, `startGracePeriod`, `deleteRoom`, offer/answer/ice-candidate relay (with direction), `handleDisconnect` (with reason: timer/leave/unexpected). This turns "I have no idea what happened" into "grep logs for roomId, see exact sequence of events." No external observability stack needed for demo — NestJS Logger output on Azure App Service logs is sufficient.
- **WebSocket gateway path is a fixed constant, not an example (API-02 fix)** — The Socket.IO namespace is exactly `/speaking-room`. This is not "e.g." — it is the specified value. It must be defined as a string constant in the backend (`ROOM_GATEWAY_NAMESPACE = '/speaking-room'`) and the frontend must connect to this exact path. A mismatch produces a silent connection failure that can waste hours of debugging.
- **Guard clause on every `getRoom()` call (EDGE-02 fix)** — `getRoom(roomId)` can return null in multiple scenarios: room expired, room was deleted by a prior disconnect, malicious or forged `roomId`, or a typo. Every handler in the gateway that calls `getRoom()` — `join-room`, `offer`, `answer`, `ice-candidate`, `leave-room` — must apply the same guard clause: check for null immediately, emit a named error event back to the socket (`room-not-found`), and return early. This is one rule applied consistently, and it closes EDGE-01, EDGE-02, and contributes to RC-03 all at once. No handler ever assumes `getRoom()` returns a valid room.
- **Role determined server-side via hostToken (SEC-01 fix)** — The client never self-declares `role: "host"`. Instead, `POST /api/speaking/rooms` generates two UUIDs: `roomId` (public, shared) and `hostToken` (private, only the creator receives it). On WebSocket `join-room`, the backend checks whether the provided `hostToken` matches the one stored in the room. Match → host. No token or wrong token → guest. This makes host impersonation cryptographically impossible without the token.
- **Guest-before-host race condition handled (RC-01 fix)** — The host's WebSocket connection is asynchronous and may arrive after the guest's. If a guest sends `join-room` and `hostSocketId` is still null, the guest info is stored in room state (pending). When the host's `join-room` arrives, the gateway checks if a pending guest already exists and immediately emits `guest-joined` back to the host's own socket. This handles the race condition transparently with no additional state beyond what `room.guest` already tracks.
- **Host disconnect grace period (RC-03 + STATE-01 fix)** — A transient network drop must not permanently destroy an active session. On host disconnect, the room transitions to `status: 'ended'` and stays in the Map for 30 seconds (grace period). The guest receives `host-disconnected` WebSocket event and waits. The `GET /speaking/rooms/:roomId` endpoint's `"is not ended"` check now becomes meaningful — it returns 404 during the grace period, blocking new guests from joining a dying room while keeping the door open for the host to reconnect. If the host reconnects within 30 seconds, `setHost()` revives the room (`status: 'active'`), cancels the timer, and emits `host-reconnected` to the guest. If the timer fires, `room-ended` is sent to the guest and `roomsMap.delete()` is called. This design also fixes STATE-01 — `ended` is now a real, reachable state in the lifecycle, not dead code.

---

## File Structure

```
src/modules/speaking/
  room/
    interfaces/
      room.interface.ts
    dto/
      create-room-response.dto.ts
      room-info-response.dto.ts
      join-room.dto.ts
    constants.ts           ← ROOM_GATEWAY_NAMESPACE = '/speaking-room'
    room.service.ts
    room.controller.ts
    room.gateway.ts
    room.module.ts
  speaking.module.ts     ← add RoomModule to imports array
```

---

## Task List

### Phase 1 — Foundation

#### Task 1: Create the Room interface

**Description:** Define the TypeScript shape of a room in memory. This is the single source of truth for what a room contains. All other files depend on this shape.

**Acceptance criteria:**
- [ ] `Room` interface defined with: `roomId` (string), `hostSocketId` (string | null), `hostToken` (string), `guest` (nullable: `{ displayName: string, socketId: string }`), `status` (`'waiting' | 'active' | 'ended'`), `createdAt` (Date), `expiresAt` (Date — set at `createRoom()` as `createdAt + 2 hours`; source of truth for both `CreateRoomResponseDto.expiresAt` and `RoomInfoResponseDto.expiresAt`; never derived from `expiryTimer` which does not expose its due date), `expiryTimer` (NodeJS.Timeout), `gracePeriodTimer` (NodeJS.Timeout | null)
- [ ] State machine is fully reachable, accurate, and models exactly who is connected (STATE-01 + STATE-02 combined fix):
  - `waiting` → room created OR only one party connected (host alone, or guest arrived before host — RC-01 pending case)
  - `active` → **both** `hostSocketId` is set AND `room.guest` is set. No exception. Status never says active with only one party present.
  - `ended` → host disconnected, grace period running (30s). Room stays in Map. Returns 404 on REST. Reverts to `active` if host reconnects with guest still present. Triggers `roomsMap.delete()` if timer fires.
- [ ] Exported from `src/modules/speaking/room/interfaces/room.interface.ts`

**Verification:**
- [ ] `npm run build` passes without errors

**Dependencies:** None

**Files touched:**
- `src/modules/speaking/room/interfaces/room.interface.ts`

**Estimated scope:** XS

---

#### Task 2: Create DTOs

**Description:** Define all data transfer objects used by the REST endpoints and the WebSocket gateway. The `role` field is intentionally absent from `JoinRoomDto` — role is determined server-side from `hostToken` verification, never from client self-declaration (SEC-01 fix). The `RoomInfoResponseDto` is fully specified to eliminate API-01 ambiguity.

**Acceptance criteria:**

- [ ] `CreateRoomResponseDto` — fields: `roomId` (string), `hostToken` (string), `expiresAt` (ISO string). Has `@ApiProperty` decorators. `hostToken` marked with `@ApiProperty({ description: 'Private token. Only share roomId, never hostToken.' })`.

- [ ] `RoomInfoResponseDto` — exact response shape for `GET /speaking/rooms/:roomId`:

  | Field | Type | Description |
  |---|---|---|
  | `roomId` | string | Confirms which room this is |
  | `status` | `'waiting' \| 'active'` | `waiting` = host alone or nobody yet. `active` = both parties connected |
  | `hasHost` | boolean | Whether the host's WebSocket is currently connected |
  | `hasGuest` | boolean | Whether a guest is already in the room |
  | `expiresAt` | string (ISO) | When the room auto-expires |

  **What the frontend does with each combination:**
  - `hasGuest: true` → show "Room is full" and block entry entirely — do not attempt WebSocket connection. Backend also enforces this via `room-full` error event (RC-02 double guard).
  - `hasGuest: false, hasHost: true` → show "Enter your name" screen, host is waiting
  - `hasGuest: false, hasHost: false` → show "Enter your name" screen, host not yet connected (RC-01 handled server-side)

  **Privacy note:** `guestDisplayName` is intentionally omitted — anyone with the `roomId` can call this endpoint, so the guest's name must not be exposed.

- [ ] `JoinRoomDto` — fields with full validation (EDGE-05 fix — validate at the boundary):
  - `roomId`: `@IsUUID()` — rejects malformed roomIds before they reach `getRoom()`. Free first line of defense against EDGE-02.
  - `displayName`: `@IsString()` + `@IsNotEmpty()` + `@MaxLength(100)` — rejects empty strings, null, and strings over 100 chars. `setGuest()` never sees an invalid displayName.
  - `hostToken`: `@IsString()` + `@IsOptional()` — guests omit it, hosts provide it.
  - No `role` field — role resolved server-side from token verification.
- [ ] `ValidationPipe` applied to the WebSocket gateway handlers so class-validator decorators on `JoinRoomDto` are enforced at the Socket.IO message boundary — not just on REST endpoints.

**Verification:**
- [ ] `npm run build` passes without errors
- [ ] `GET /speaking/rooms/:roomId` response matches `RoomInfoResponseDto` exactly in Postman

**Dependencies:** Task 1

**Files touched:**
- `src/modules/speaking/room/dto/create-room-response.dto.ts`
- `src/modules/speaking/room/dto/room-info-response.dto.ts`
- `src/modules/speaking/room/dto/join-room.dto.ts`

**Estimated scope:** S

---

### Checkpoint: Phase 1
- [ ] `npm run build` passes clean
- [ ] Interface and DTOs are correctly typed

---

### Phase 2 — Room Service (REST Layer)

#### Task 3: Create RoomService

**Description:** The core in-memory manager. Holds a `Map<string, Room>` and exposes all room lifecycle methods. NestJS singleton ensures the controller and gateway share the same Map instance.

**Acceptance criteria:**
- [ ] `createRoom()` — generates two `crypto.randomUUID()` values: one as `roomId`, one as `hostToken`. Stores both in the room. Sets `expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)` (2 hours from creation) and stores it on the `Room` object. Returns `CreateRoomResponseDto` including `hostToken` and `expiresAt.toISOString()`.
- [ ] `getRoom(roomId)` — returns the `Room` or `undefined`
- [ ] `deleteRoom(roomId)` — clears the expiry timer with `clearTimeout`, removes from Map
- [ ] `verifyHostToken(roomId, token)` — returns `true` if `token` matches the stored `hostToken` for that room, `false` otherwise. Used by the gateway to determine role server-side.
- [ ] **Idempotency rule (RC-04 fix) — applied to ALL state-mutating functions:** Every cleanup function must be a safe no-op if called a second time. This is a blanket rule — not a one-off patch — so that `handleDisconnect` can unconditionally call cleanup functions without needing to know whether `leave-room` already ran. One guard clause per function, one line each. Applied to: `deleteRoom`, `removeGuest`, `setHost`, `setGuest`, `startGracePeriod`.
- [ ] `setHost(roomId, socketId)` — guard: if room null or `hostSocketId` already equals `socketId`, return (idempotent). Then assigns `hostSocketId`. If `gracePeriodTimer` is active (RC-03 reconnect), cancels it. If `room.guest` is set → `status: 'active'`. Otherwise `status: 'waiting'`.
- [ ] `startGracePeriod(roomId, onExpire)` — guard: if room null or `status` already `ended`, return (idempotent). Clears `hostSocketId`, sets `status: 'ended'`, starts 30-second timer. The gateway calls this method passing a callback that has **already captured `guestSocketId = room.guest?.socketId ?? null` at call time** (before the timer starts) — the callback does not re-fetch room state when the timer fires. Timer fires → calls `onExpire(guestSocketId)` → if `guestSocketId` is non-null, emit `room-ended` to that socket → call `RoomService.deleteRoom(roomId)` (idempotent — safe even if the room was already removed via another path).
- [ ] `setGuest(roomId, displayName, socketId)` — guard: if room null, return. If `room.guest?.socketId` already equals `socketId`, return (idempotent). Assigns guest info. If `hostSocketId` is set → `status: 'active'`. Otherwise `status: 'waiting'`.
- [ ] `removeGuest(roomId)` — guard: if room null or `room.guest` already null, return (idempotent). Clears guest info. Sets `status: 'waiting'` **only if current `status !== 'ended'`** — i.e. `if (room.status !== 'ended') room.status = 'waiting';`. If `status === 'ended'` (host grace period active), it remains `'ended'` — overwriting it would make the REST endpoint return 200 instead of 404, allowing a third party to claim the guest slot during the host's reconnect window.
- [ ] `deleteRoom(roomId)` — guard: if room null, return (idempotent). Clears both timers with `clearTimeout`. Then **synchronously** calls `roomsMap.delete(roomId)` before any other work. Any future async side-effects (e.g. analytics logging) must be fire-and-forget AFTER the Map delete — never before. Comment in code: `// keep Map.delete() synchronous and first — see RC-05`.
- [ ] `getRoomBySocketId(socketId)` — scans Map, returns room where `room.hostSocketId === socketId` OR `room.guest?.socketId === socketId`. Uses optional chaining on `room.guest?.socketId` so cleared guests (null) never match.
- [ ] `getAllRooms()` — returns `this.rooms.values()` iterator. Used by `onApplicationShutdown` to notify all connected sockets before process exits (PROD-02).
- [ ] Decorated with `@Injectable()`
- [ ] **Logging (PROD-01):** every method logs a structured entry via NestJS `Logger`: `createRoom` → `{ event: 'room.created', roomId }`. `setHost` → `{ event: 'host.joined', roomId, socketId }`. `setGuest` → `{ event: 'guest.joined', roomId, socketId, displayName }`. `startGracePeriod` → `{ event: 'grace.started', roomId }`. `deleteRoom` → `{ event: 'room.deleted', roomId, reason }`. `removeGuest` → `{ event: 'guest.removed', roomId }`.

**Verification:**
- [ ] `npm run build` passes
- [ ] Unit test: `createRoom()` returns a valid `roomId` and `expiresAt`
- [ ] Unit test: `getRoom()` returns the created room
- [ ] Unit test: `deleteRoom()` removes the room from the Map

**Dependencies:** Task 1, Task 2

**Files touched:**
- `src/modules/speaking/room/room.service.ts`

**Estimated scope:** S

---

#### Task 4: Create RoomController

**Description:** Exposes two REST endpoints for room lifecycle. No JWT guard — open for demo phase. Follows existing conventions (Swagger decorators, Logger, `@ApiTags`).

**Acceptance criteria:**
- [ ] `POST /api/speaking/rooms` — calls `RoomService.createRoom()`, returns `CreateRoomResponseDto` with HTTP 201
- [ ] `GET /api/speaking/rooms/:roomId` — calls `RoomService.getRoom()`. If not found OR `status === 'ended'`, throws `NotFoundException` (HTTP 404). This check is now meaningful (STATE-01 fix) — a room in grace period has `status: 'ended'` and correctly blocks new guests from joining while the host may still reconnect. Otherwise maps room state to `RoomInfoResponseDto`: derives `hasHost` from `room.hostSocketId !== null`, derives `hasGuest` from `room.guest !== null`.
- [ ] Both endpoints have `@ApiTags('Speaking Rooms')` and `@ApiOperation` descriptions
- [ ] Controller uses `Logger` following existing conventions

**Verification:**
- [ ] `npm run build` passes
- [ ] Postman: `POST /api/speaking/rooms` returns `{ roomId, expiresAt }`
- [ ] Postman: `GET /api/speaking/rooms/:roomId` with valid ID returns 200
- [ ] Postman: `GET /api/speaking/rooms/invalid-id` returns 404

**Dependencies:** Task 3

**Files touched:**
- `src/modules/speaking/room/room.controller.ts`

**Estimated scope:** S

---

---

#### Task 9: Add Rate Limiting to Room Creation (SEC-02 fix)

**Description:** Install and configure `@nestjs/throttler` to prevent memory exhaustion DoS on the unauthenticated `POST /speaking/rooms` endpoint. Without this, any script can create thousands of rooms per second, exhausting the Node.js heap and crashing the server. This task must be completed before any external tester gets access to the backend URL.

**Acceptance criteria:**
- [ ] `@nestjs/throttler` installed: `npm install @nestjs/throttler`
- [ ] `ThrottlerModule` registered in `RoomModule` with: `ttl: 60000` (1 minute window), `limit: 10` (max 10 room creations per IP per minute)
- [ ] `ThrottlerGuard` applied to `POST /api/speaking/rooms` handler only — not to `GET /speaking/rooms/:roomId` (guests need to check room validity freely)
- [ ] If limit exceeded, Azure returns HTTP 429 Too Many Requests automatically
- [ ] No other existing endpoints are affected

**Verification:**
- [ ] `npm run build` passes
- [ ] Send 11 rapid `POST /api/speaking/rooms` requests from the same IP → 11th returns HTTP 429
- [ ] `GET /api/speaking/rooms/:roomId` is unaffected by the throttle

**Dependencies:** Task 4

**Files touched:**
- `package.json` (new dependency)
- `src/modules/speaking/room/room.module.ts` (register ThrottlerModule)
- `src/modules/speaking/room/room.controller.ts` (apply ThrottlerGuard)

**Estimated scope:** XS

---

### Checkpoint: Phase 2
- [ ] `npm run build` passes
- [ ] `POST /api/speaking/rooms` works in Postman
- [ ] `GET /api/speaking/rooms/:roomId` returns correct responses
- [ ] Rate limiting verified — 11th request from same IP returns 429

---

### Phase 3 — WebSocket Gateway (Signaling)

#### Task 5: Create RoomGateway — join and relay

**Description:** NestJS WebSocket gateway using Socket.IO. Listens on the `/speaking-room` namespace. Handles `join-room` and the three WebRTC relay events. The gateway only relays — it never reads or modifies WebRTC payloads.

**Acceptance criteria:**
- [ ] Decorated with `@WebSocketGateway({ namespace: '/speaking-room', cors: { origin: '*' } })` — `/speaking-room` is the fixed, specified namespace (API-02 fix). Defined as a constant `ROOM_GATEWAY_NAMESPACE = '/speaking-room'` in a shared constants file so it is never a magic string in either backend or frontend.
- [ ] **Guard clause rule (EDGE-02):** Every handler below that calls `getRoom(roomId)` must apply this pattern first: `const room = getRoom(roomId); if (!room) { client.emit('room-not-found'); return; }`. No exceptions. This handles: expired rooms, deleted rooms, forged roomIds, typos. Applied to: `join-room`, `offer`, `answer`, `ice-candidate`.
- [ ] **One-socket-one-room invariant (EDGE-06 fix):** Socket.IO's `client.data` object is per-connection storage. After a successful `join-room`, store `client.data.roomId = roomId`. On every subsequent `join-room` from the same socket: if `client.data.roomId === payload.roomId` → idempotent no-op, return silently. If `client.data.roomId` is a different roomId → emit `already-in-room` error and return. This prevents a socket from registering in two rooms simultaneously and corrupting `getRoomBySocketId` lookups on disconnect. **Bonus:** `handleDisconnect` can use `client.data.roomId` for O(1) room lookup instead of O(n) Map scan via `getRoomBySocketId`.
- [ ] `join-room` handler — receives `JoinRoomDto`. First checks `client.data.roomId` (EDGE-06 guard). Then applies room-not-found guard clause. Then calls `RoomService.verifyHostToken(roomId, hostToken)` to determine role. Two paths:
  - **Token matches → host:** calls `RoomService.setHost()`. Then checks if `room.guest` already exists (RC-01: guest arrived first). If yes, emits `guest-joined` immediately back to the host's own socket so the WebRTC handshake can begin without waiting.
  - **No token or wrong token → guest:** First checks if `room.guest` is already set (RC-02). If yes, emits `room-full` error event back to the second joiner and returns immediately — no overwrite, no silent eviction. If `room.guest` is null, calls `RoomService.setGuest()`. Then checks if `room.hostSocketId` is set. If yes (normal case), emits `guest-joined` to the host socket. If no (RC-01: host not yet connected), guest info is stored silently — the host will pick it up when they connect.
  - Rejects with an error event if room does not exist.
- [ ] `offer` handler — receives `{ roomId, offer }`. Applies guard clause (room-not-found if null). **Sender verification (SEC-03 fix):** if `client.id !== room.hostSocketId`, emit `unauthorized` and return early — only the registered host may send `offer`. Then guards against EDGE-01: if `room.guest` is null, emits `no-guest-ready` back to host and returns early. If guest exists, forwards offer via `server.to(guestSocketId).emit('offer', offer)`. **Frontend contract:** host must only call `createOffer()` after receiving `guest-joined`.
- [ ] `answer` handler — receives `{ roomId, answer }`. Applies guard clause (room-not-found if null). **Sender verification (SEC-03 fix):** if `client.id !== room.guest?.socketId`, emit `unauthorized` and return early — only the registered guest may send `answer`. Then guards: if `room.hostSocketId` is null, emits error back to guest and returns early. Otherwise forwards answer to host socket.
- [ ] `ice-candidate` handler (API-03 fix — fully specified contract):
  - **Inbound event name:** `ice-candidate` (client → server)
  - **Inbound payload:** `{ roomId: string, candidate: RTCIceCandidateInit }` — no `senderRole` field. The gateway derives sender identity from `client.id`: if `client.id === room.hostSocketId` → forward to guest. If `client.id === room.guest?.socketId` → forward to host. If neither matches → discard silently. This avoids trusting any client-declared role in the payload (consistent with SEC-01 principle).
  - **Outbound event name:** `ice-candidate` (server → client, same name both directions)
  - **Outbound payload:** `{ candidate: RTCIceCandidateInit }` — the raw candidate object, unchanged. No `from` field, no `roomId`. The receiving party is already in room context and knows the candidate is from their partner.
  - Applies guard clause (room-not-found if null). If target party's socketId is null, discards silently and returns early.
- [ ] All handlers use `@SubscribeMessage` decorator
- [ ] **Logging (PROD-01):** relay handlers log `{ event: 'signal.relayed', type: 'offer'|'answer'|'ice-candidate', roomId, direction: 'host→guest'|'guest→host' }`. Dropped signals (null target) log `{ event: 'signal.dropped', type, roomId, reason }`. `join-room` logs `{ event: 'socket.joined', roomId, role: 'host'|'guest' }`.

**Verification:**
- [ ] `npm run build` passes
- [ ] Two WebSocket clients (using `socket.io-client`): host joins, guest joins, host receives `guest-joined`
- [ ] Host sends mock `offer` → guest receives it

**Dependencies:** Task 3

**Files touched:**
- `src/modules/speaking/room/constants.ts` (new — defines `ROOM_GATEWAY_NAMESPACE`)
- `src/modules/speaking/room/room.gateway.ts`

**Estimated scope:** M

---

#### Task 6: Handle disconnect and leave-room

**Description:** Clean teardown logic for both intentional (`leave-room` event) and unexpected (browser close / network drop) disconnections.

**Acceptance criteria:**
- [ ] `leave-room` handler (intentional disconnect — EDGE-03 fix): accepts **no payload**. Room is derived entirely server-side via `getRoomBySocketId(client.id)` — the client never declares which room to leave. If `getRoomBySocketId` returns null (socket wasn't in any room, or room already expired), return silently — no-op.
  - If socket is host → emits `room-ended` to guest socket → calls `RoomService.deleteRoom()` immediately (no grace period — intentional leave)
  - If socket is guest → emits `partner-left` to host socket → calls `RoomService.removeGuest()` (room stays alive for rejoin)
- [ ] `handleDisconnect(client)` lifecycle hook (unexpected disconnect — RC-03 fix):
  - Uses `client.data.roomId` for O(1) room lookup (EDGE-06 bonus — no Map scan needed). Falls back to `RoomService.getRoomBySocketId(client.id)` only if `client.data.roomId` is unset.
  - If socket was **host**: does NOT delete room immediately. Calls `RoomService.startGracePeriod()` which clears `hostSocketId`, sets `status: 'ended'`, and starts a 30-second timer. Emits `host-disconnected` to guest socket so guest sees a "waiting for host to reconnect" state (not "room ended"). Note: `host-disconnected` is the *WebSocket event name* sent to the guest — it is distinct from the internal `status` value `'ended'` stored on the room.
  - If grace period fires without reconnect: emit `room-ended` to guest, call `deleteRoom()`
  - If socket was **guest**: emits `partner-left` to host, calls `RoomService.removeGuest()`
  - Does nothing if socket belonged to no room
- [ ] `join-room` host path (RC-03 reconnect path): if room exists but `hostSocketId` is null and `room.status === 'ended'`, cancel grace period via `RoomService.setHost()`, emit `host-reconnected` to guest. Guest triggers new WebRTC offer to re-establish P2P connection.
- [ ] **`startGracePeriod` closure (GAP-2 fix):** When calling `startGracePeriod()`, capture `guestSocketId = room.guest?.socketId ?? null` **before** calling the method and pass it into the `onExpire` callback's closure. Do not re-fetch the room inside the callback — the room may be deleted by the time the timer fires.
- [ ] **Logging (PROD-01):** `handleDisconnect` logs `{ event: 'socket.disconnected', roomId, role, reason: 'unexpected' }`. `leave-room` logs `{ event: 'socket.left', roomId, role, reason: 'intentional' }`. Grace period expiry logs `{ event: 'grace.expired', roomId }`. Host reconnect logs `{ event: 'host.reconnected', roomId }`.
- [ ] **Graceful shutdown (PROD-02):** `RoomGateway` implements `OnApplicationShutdown`. In `onApplicationShutdown(signal)`: iterate `RoomService.getAllRooms()`, emit `server-shutting-down` to every `hostSocketId` and `guest.socketId` that is non-null. Log `{ event: 'server.shutdown', signal, activeRooms: count }`. This requires `RoomService` to expose a `getAllRooms()` method returning `Map.values()`.

**Verification:**
- [ ] `npm run build` passes
- [ ] Close host tab → guest receives `room-ended`
- [ ] Close guest tab → host receives `partner-left`
- [ ] Guest reconnects with same link → successfully rejoins

**Dependencies:** Task 5

**Files touched:**
- `src/modules/speaking/room/room.gateway.ts`

**Estimated scope:** S

---

### Checkpoint: Phase 3
- [ ] `npm run build` passes
- [ ] Full signaling flow works between two clients
- [ ] Disconnect handling verified in both directions

---

### Phase 4 — Wiring

#### Task 7: Create RoomModule and wire into SpeakingModule

**Description:** Creates the NestJS module that binds controller, gateway, and service. Imports it into the existing `SpeakingModule`.

**Acceptance criteria:**
- [ ] `RoomModule` declares `RoomController`, `RoomGateway` and provides `RoomService`
- [ ] `RoomModule` added to `imports` array of `SpeakingModule`
- [ ] No circular dependency issues
- [ ] Existing Sprechen endpoints (`/api/speaking/evaluate`, `/api/speaking/teils`, `/api/speaking/sessions`) still respond correctly

**Verification:**
- [ ] `npm run build` passes
- [ ] `npm run start:dev` starts without errors
- [ ] Existing endpoints still return correct responses after the change

**Dependencies:** Task 4, Task 6

**Files touched:**
- `src/modules/speaking/room/room.module.ts`
- `src/modules/speaking/speaking.module.ts`

**Estimated scope:** XS

---

### Phase 5 — Verification

#### Task 8: End-to-end signaling test

**Description:** Full manual walkthrough of the complete flow from room creation to WebRTC handshake and room teardown.

**Acceptance criteria:**
- [ ] Host calls `POST /api/speaking/rooms` → receives `{ roomId, hostToken, expiresAt }`
- [ ] Host connects to `/speaking-room`, sends `join-room` with `{ roomId, displayName, hostToken }` (no `role` field — role is resolved server-side via `hostToken`)
- [ ] Guest connects with same `roomId`, sends `join-room` with `{ roomId, displayName }` (no `role` field, no `hostToken`)
- [ ] Host receives `guest-joined` with guest's display name
- [ ] Host sends mock `offer` → guest receives it
- [ ] Guest sends mock `answer` → host receives it
- [ ] Both sides exchange `ice-candidate` events correctly
- [ ] Host sends `leave-room` → guest receives `room-ended`
- [ ] `GET /api/speaking/rooms/:roomId` after session ends returns 404

**Verification:**
- [ ] All steps above pass manually
- [ ] `npm run build` passes clean
- [ ] `npm test` — existing tests still pass

**Dependencies:** Task 7

**Files touched:** None (verification only)

**Estimated scope:** XS

---

### Final Checkpoint
- [ ] `npm run build` passes
- [ ] `npm run start:dev` starts clean
- [ ] `npm test` — all existing tests pass
- [ ] Full end-to-end signaling flow verified manually
- [ ] WebSockets enabled in Azure App Service (see Azure Deployment Checklist below)
- [ ] Ready for frontend integration

---

## Azure Deployment Checklist

These are manual Azure Portal steps required before the feature works in production. They are not code changes.

### Step 1 — WebSockets (ALREADY ENABLED — NO ACTION NEEDED)
Confirmed: `webSocketsEnabled: null` in Azure config means the Linux App Service platform default applies, which is enabled. The existing speaking WebSocket feature already works in production on this same instance, proving WebSockets are active. No configuration change required.

### Step 2 — Confirm Scale-Out Is Pinned to 1 Instance (REQUIRED)
Already confirmed: Basic B1 plan, manual scaling, instance count = 1. In-memory Map is safe on a single instance. Do not enable scale-out without migrating room state to Azure Cache for Redis first.

### Step 3 — Accept Restart Behaviour (PROD-02 — Demo Acceptable)
Any app restart (deployment, platform maintenance, idle timeout) will destroy all in-memory rooms and active WebSocket connections instantly. Users mid-session will be disconnected with no recovery path.

**For demo phase:** acceptable. Users can create a new room and rejoin.
**Before production:** migrate room state to a persistent store (Redis or database).

### Step 4 — Rate Limiting (REQUIRED — implemented in Task 9)
Azure App Service provides no per-IP rate limiting. Without it, a single script can exhaust server memory in seconds. Implemented in code via `@nestjs/throttler` — max 10 room creations per IP per minute on `POST /speaking/rooms`. Must be deployed before any external tester accesses the backend URL.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **SEC-01: Client self-declares role** | Critical | ✅ Fixed — role is determined server-side via `hostToken` verification. Client sends token; backend resolves role. No self-declaration trusted. |
| **RC-01: Guest joins before host WebSocket connects** | Critical | ✅ Fixed — guest info stored in room state when host is absent. When host connects, gateway checks for pending guest and emits `guest-joined` immediately to the host. |
| **EDGE-01: Offer/answer sent before guest joins** | High | ✅ Fixed — `offer` handler guards `room.guest` before accessing socketId. If null, emits `no-guest-ready` back to host instead of crashing. Real fix is frontend ordering: host must only call `createOffer()` after receiving `guest-joined`. Backend guard is the safety net. |
| **API-01: GET /rooms/:roomId response shape undefined** | High | ✅ Fixed — `RoomInfoResponseDto` fully specifies every field (`roomId`, `status`, `hasHost`, `hasGuest`, `expiresAt`), its type, and what each value means for frontend decision-making. `guestDisplayName` intentionally omitted for privacy. |
| **SEC-02: No rate limiting on room creation — DoS** | Critical | ✅ Fixed — Task 9 adds `@nestjs/throttler` with max 10 rooms per IP per minute. Returns HTTP 429 on breach. Applied to `POST /speaking/rooms` only. |
| **SEC-03: `offer`/`answer` sender not verified — role impersonation on relay** | High | ✅ Fixed — `offer` handler requires `client.id === room.hostSocketId`; `answer` handler requires `client.id === room.guest?.socketId`. Same `client.id`-based derivation already used for `ice-candidate`, applied consistently across all three relay events. Mismatched sender receives `unauthorized` and is ignored. |
| **RC-02: Two guests join simultaneously — last writer wins** | High | ✅ Fixed — `join-room` handler checks `room.guest !== null` before calling `setGuest()`. If room already has a guest, emits `room-full` error event to the second joiner and returns immediately. No overwrite, no silent eviction, no orphaned socket. |
| **RC-03: Host reconnects after transient disconnect — room already deleted** | High | ✅ Fixed — `handleDisconnect` no longer deletes room immediately on host drop. Room transitions to `status: 'ended'`, stays in Map for 30s grace period. Guest receives `host-disconnected` and waits. If host reconnects within 30s, room revives to `active`, `host-reconnected` emitted to guest. If timer fires, `room-ended` sent, `roomsMap.delete()` called. Intentional `leave-room` still deletes immediately. |
| **STATE-01: `ended` status defined but never set — dead code** | High | ✅ Fixed — `ended` is now the grace-period state set by `startGracePeriod()`. The `GET /rooms/:roomId` check `status === 'ended'` → 404 is now a real, reachable branch. State machine has no dead states: `waiting → active → ended → deleted`. |
| **STATE-02: `active` set when only guest is connected — inaccurate** | High | ✅ Fixed — folded into RC-01 + STATE-01 redesign. `setGuest()` only sets `active` if `hostSocketId` is already present. `setHost()` only sets `active` if `room.guest` is already present. `active` now strictly means both parties confirmed connected. One-party-present cases stay `waiting`. |
| **EDGE-02: `setGuest()` called for non-existent room** | High | ✅ Fixed — universal guard clause applied to every handler that calls `getRoom()`: `join-room`, `offer`, `answer`, `ice-candidate`, `leave-room`. If `getRoom()` returns null for any reason (expired, deleted, forged, typo), handler emits `room-not-found` to the socket and returns early. No handler ever assumes the room exists. |
| **API-02: WebSocket gateway path unspecified ("e.g.")** | Medium | ✅ Fixed — path is exactly `/speaking-room`, defined as `ROOM_GATEWAY_NAMESPACE` constant in `constants.ts`. Frontend must connect to this exact string. No magic strings in code. |
| **PROD-02: Server restart destroys all active sessions silently** | Medium | ✅ Fixed — `RoomGateway` implements `OnApplicationShutdown`. On `SIGTERM`, iterates all rooms via `getAllRooms()` and emits `server-shutting-down` to every connected socket before process exits. Users see a clear message. In-memory state still lost (accepted for demo) but no frozen screens. Always On enabled to prevent idle-timeout restarts. |
| **PROD-01: No logging or observability defined** | Medium | ✅ Fixed — NestJS `Logger` with structured JSON fields at every state transition: `createRoom`, `setHost`, `setGuest`, `startGracePeriod`, `deleteRoom`, relay (with direction), disconnect (with reason). Grep by `roomId` to reconstruct any session's exact sequence of events. Azure App Service log stream available for live debugging. |
| **EDGE-06: Multiple `join-room` events from the same socket** | Medium | ✅ Fixed — `client.data.roomId` tracks room membership per socket. Same room → idempotent no-op. Different room → emit `already-in-room`, return. One socket maps to at most one room. Bonus: `handleDisconnect` uses `client.data.roomId` for O(1) room lookup instead of O(n) Map scan. |
| **EDGE-05: Empty or malformed `displayName` stored in memory** | Medium | ✅ Fixed (shape only) — `JoinRoomDto` uses `@IsUUID()` on `roomId`, `@IsNotEmpty()` + `@MaxLength(100)` on `displayName`. This prevents empty, null, and overlong names. `ValidationPipe` applied at WebSocket boundary. `@IsUUID()` on `roomId` also provides a free first filter for EDGE-02. **Does not prevent XSS** — see SEC-04 row below. |
| **SEC-04: `displayName` rendered unsanitized — stored XSS** | High | ⚠️ Frontend responsibility — backend validation (EDGE-05) constrains length and emptiness only, not content. A `displayName` like `<script>...</script>` is 22 characters, non-empty, and passes all current validators — it is stored in `room.guest.displayName` and emitted via `guest-joined`. **Frontend MUST render `displayName` as text content only**: React's default JSX interpolation (`{displayName}`) is safe; vanilla JS must use `.textContent`, never `.innerHTML` or `dangerouslySetInnerHTML`. Add to frontend integration checklist. |
| **EDGE-03: `leave-room` sent for a room the socket does not belong to** | Medium | ✅ Fixed — `leave-room` accepts no `roomId` payload. Room is derived server-side via `getRoomBySocketId(client.id)`. A socket can only leave the room it is actually in. No client-provided scope to forge. Reuses the same lookup already needed by `handleDisconnect`. |
| **API-03: ICE candidate payload structure not defined** | Medium | ✅ Fixed — inbound: `{ roomId, candidate: RTCIceCandidateInit }`, no `senderRole` (direction derived from `client.id`). Outbound: `{ candidate: RTCIceCandidateInit }` unchanged. Event name `ice-candidate` in both directions. Full event contract table documented in Architecture Decisions. |
| **RC-04: `leave-room` followed by `handleDisconnect` double-processing** | Medium | ✅ Fixed — all state-mutating functions (`deleteRoom`, `removeGuest`, `setHost`, `setGuest`, `startGracePeriod`) are idempotent by design. Each has a one-line guard clause that makes a second call a safe no-op. `handleDisconnect` can call cleanup unconditionally — idempotency guarantees correctness regardless of what already ran. One rule, eliminates an entire class of double-processing bugs. |
| **RC-05: 2-hour timer fires while `handleDisconnect` is processing** | Medium | ✅ Mitigated — JS single-threaded so no true race now. `deleteRoom()` keeps `roomsMap.delete()` synchronous and first, before any future async side-effects. Idempotency from RC-04 makes any overlap a harmless no-op. Comment in `deleteRoom()` documents the constraint for future engineers: `// keep Map.delete() synchronous and first — see RC-05`. |
| **hostToken exposed in URL** | High | Frontend must store `hostToken` in memory or sessionStorage only — never in the share URL. Only `roomId` goes in the shareable link. |
| Socket.IO CORS blocks frontend | High | Set `cors: { origin: '*' }` for demo; tighten to specific domain before wider rollout |
| Host transient disconnect | Low | `startGracePeriod()` keeps room alive for 30s with `status: 'ended'`. Guest receives `host-disconnected` event and waits. Room is only deleted (`roomsMap.delete()`) if host does not reconnect within 30s. See RC-03 row above for full detail. |
| Two guests try to join the same room | Low | `join-room` handler checks if `room.guest` is already set; rejects second joiner with an error event |
| Memory leak if `leave-room` never fires | Low | 2-hour `setTimeout` in `createRoom()` guarantees cleanup regardless |
| Frontend not yet hosted | High | Share link only works if frontend is deployed publicly (e.g. Vercel). Localhost works for same-machine testing only. |

---

## Open Questions

- What domain will the frontend be hosted on? Needed to tighten CORS before going live with testers.
- Should a second guest be silently rejected or shown a specific error message?
