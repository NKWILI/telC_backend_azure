# Sprechen Room — Tasks: Phase 1 & 2 (Foundation + REST Layer)

> Load alongside `SPRECHEN_ROOM_REFERENCE.md`. This file covers Tasks 1, 2, 3, 4, 9.

---

## Phase 1 — Foundation

### Task 1: Create the Room interface

**Description:** Define the TypeScript shape of a room in memory. Single source of truth for what a room contains. All other files depend on this shape.

**Acceptance criteria:**
- [ ] `Room` interface defined with:
  - `roomId` (string)
  - `hostSocketId` (string | null)
  - `hostToken` (string)
  - `guest` (nullable: `{ displayName: string, socketId: string }`)
  - `status` (`'waiting' | 'active' | 'ended'`)
  - `createdAt` (Date)
  - `expiresAt` (Date — set at `createRoom()` as `createdAt + 2 hours`; source of truth for both DTOs; never derived from `expiryTimer`)
  - `expiryTimer` (NodeJS.Timeout)
  - `gracePeriodTimer` (NodeJS.Timeout | null)
- [ ] State machine is fully reachable (STATE-01 + STATE-02 combined fix):
  - `waiting` → room created OR only one party connected
  - `active` → **both** `hostSocketId` is set AND `room.guest` is set. No exception.
  - `ended` → host disconnected, grace period running (30s). Room stays in Map. Reverts to `active` if host reconnects with guest still present. Triggers `roomsMap.delete()` if timer fires.
- [ ] Exported from `src/modules/speaking/room/interfaces/room.interface.ts`

**Verification:**
- [ ] `npm run build` passes without errors

**Dependencies:** None

**Files touched:**
- `src/modules/speaking/room/interfaces/room.interface.ts`

**Estimated scope:** XS

---

### Task 2: Create DTOs

**Description:** Define all data transfer objects used by the REST endpoints and WebSocket gateway. The `role` field is intentionally absent from `JoinRoomDto` — role is determined server-side from `hostToken` verification (SEC-01 fix).

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

  Frontend decision table:
  - `hasGuest: true` → show "Room is full", block entry entirely
  - `hasGuest: false, hasHost: true` → show "Enter your name" screen, host is waiting
  - `hasGuest: false, hasHost: false` → show "Enter your name" screen, host not yet connected (RC-01 handled server-side)

  **Privacy note:** `guestDisplayName` intentionally omitted — anyone with the `roomId` can call this endpoint.

- [ ] `JoinRoomDto` — fields with full validation (EDGE-05 fix):
  - `roomId`: `@IsUUID()` — rejects malformed roomIds before reaching `getRoom()`
  - `displayName`: `@IsString()` + `@IsNotEmpty()` + `@MaxLength(100)`
  - `hostToken`: `@IsString()` + `@IsOptional()` — guests omit it, hosts provide it
  - No `role` field — role resolved server-side from token verification
- [ ] `ValidationPipe` applied to WebSocket gateway handlers so class-validator decorators on `JoinRoomDto` are enforced at the Socket.IO message boundary

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

## Phase 2 — Room Service (REST Layer)

### Task 3: Create RoomService

**Description:** The core in-memory manager. Holds a `Map<string, Room>` and exposes all room lifecycle methods. NestJS singleton ensures the controller and gateway share the same Map instance.

**Acceptance criteria:**
- [ ] `createRoom()` — generates two `crypto.randomUUID()` values: `roomId` and `hostToken`. Sets `expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000)`. Stores it on the `Room` object. Returns `CreateRoomResponseDto` including `hostToken` and `expiresAt.toISOString()`.
- [ ] `getRoom(roomId)` — returns the `Room` or `undefined`
- [ ] `verifyHostToken(roomId, token)` — returns `true` if `token` matches the stored `hostToken`, `false` otherwise
- [ ] **Idempotency rule (RC-04 fix) — applied to ALL state-mutating functions:** Every cleanup function has a one-line guard clause making a second call a safe no-op. Applied to: `deleteRoom`, `removeGuest`, `setHost`, `setGuest`, `startGracePeriod`.
- [ ] `setHost(roomId, socketId)` — guard: if room null or `hostSocketId` already equals `socketId`, return. Assigns `hostSocketId`. If `gracePeriodTimer` is active (RC-03 reconnect), cancels it. If `room.guest` is set → `status: 'active'`. Otherwise `status: 'waiting'`.
- [ ] `startGracePeriod(roomId, onExpire)` — guard: if room null or `status` already `ended`, return. Clears `hostSocketId`, sets `status: 'ended'`, starts 30-second timer. The gateway passes a callback that has **already captured `guestSocketId = room.guest?.socketId ?? null` at call time** — the callback does not re-fetch room state when the timer fires. Timer fires → calls `onExpire(guestSocketId)` → if non-null, emit `room-ended` to that socket → call `RoomService.deleteRoom(roomId)`.
- [ ] `setGuest(roomId, displayName, socketId)` — guard: if room null, return. If `room.guest?.socketId` already equals `socketId`, return. Assigns guest info. If `hostSocketId` is set → `status: 'active'`. Otherwise `status: 'waiting'`.
- [ ] `removeGuest(roomId)` — guard: if room null or `room.guest` already null, return. Clears guest info. Sets `status: 'waiting'` **only if current `status !== 'ended'`**. If `status === 'ended'` (grace period active), it remains `'ended'` — overwriting it would allow a third party to claim the guest slot during the host's reconnect window.
- [ ] `deleteRoom(roomId)` — guard: if room null, return. Clears both timers with `clearTimeout`. **Synchronously** calls `roomsMap.delete(roomId)` before any other work. Comment: `// keep Map.delete() synchronous and first — see RC-05`.
- [ ] `getRoomBySocketId(socketId)` — scans Map, returns room where `room.hostSocketId === socketId` OR `room.guest?.socketId === socketId`
- [ ] `getAllRooms()` — returns `this.rooms.values()` iterator. Used by `onApplicationShutdown` (PROD-02)
- [ ] Decorated with `@Injectable()`
- [ ] **Logging (PROD-01):** `createRoom` → `{ event: 'room.created', roomId }`. `setHost` → `{ event: 'host.joined', roomId, socketId }`. `setGuest` → `{ event: 'guest.joined', roomId, socketId, displayName }`. `startGracePeriod` → `{ event: 'grace.started', roomId }`. `deleteRoom` → `{ event: 'room.deleted', roomId, reason }`. `removeGuest` → `{ event: 'guest.removed', roomId }`.

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

### Task 4: Create RoomController

**Description:** Exposes two REST endpoints for room lifecycle. No JWT guard — open for demo phase. Follows existing conventions (Swagger decorators, Logger, `@ApiTags`).

**Acceptance criteria:**
- [ ] `POST /api/speaking/rooms` — calls `RoomService.createRoom()`, returns `CreateRoomResponseDto` with HTTP 201
- [ ] `GET /api/speaking/rooms/:roomId` — calls `RoomService.getRoom()`. If not found OR `status === 'ended'`, throws `NotFoundException` (HTTP 404). Otherwise maps room state to `RoomInfoResponseDto`: derives `hasHost` from `room.hostSocketId !== null`, derives `hasGuest` from `room.guest !== null`.
- [ ] Both endpoints have `@ApiTags('Speaking Rooms')` and `@ApiOperation` descriptions
- [ ] Controller uses `Logger` following existing conventions

**Verification:**
- [ ] `npm run build` passes
- [ ] Postman: `POST /api/speaking/rooms` returns `{ roomId, hostToken, expiresAt }`
- [ ] Postman: `GET /api/speaking/rooms/:roomId` with valid ID returns 200
- [ ] Postman: `GET /api/speaking/rooms/invalid-id` returns 404

**Dependencies:** Task 3

**Files touched:**
- `src/modules/speaking/room/room.controller.ts`

**Estimated scope:** S

---

### Task 9: Add Rate Limiting to Room Creation (SEC-02 fix)

**Description:** Install and configure `@nestjs/throttler` to prevent memory exhaustion DoS on the unauthenticated `POST /speaking/rooms` endpoint. Must be completed before any external tester gets access to the backend URL.

**Acceptance criteria:**
- [ ] `@nestjs/throttler` installed: `npm install @nestjs/throttler`
- [ ] `ThrottlerModule` registered in `RoomModule` with: `ttl: 60000` (1 minute window), `limit: 10` (max 10 room creations per IP per minute)
- [ ] `ThrottlerGuard` applied to `POST /api/speaking/rooms` handler only — not to `GET /speaking/rooms/:roomId`
- [ ] If limit exceeded, returns HTTP 429 Too Many Requests automatically
- [ ] No other existing endpoints are affected

**Verification:**
- [ ] `npm run build` passes
- [ ] Send 11 rapid `POST /api/speaking/rooms` requests from same IP → 11th returns HTTP 429
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
