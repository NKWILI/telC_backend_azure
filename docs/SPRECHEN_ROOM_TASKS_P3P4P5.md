# Sprechen Room — Tasks: Phase 3, 4 & 5 (Gateway + Wiring + Verification)

> Load alongside `SPRECHEN_ROOM_REFERENCE.md`. This file covers Tasks 5, 6, 7, 8.

---

## Phase 3 — WebSocket Gateway (Signaling)

### Task 5: Create RoomGateway — join and relay

**Description:** NestJS WebSocket gateway using Socket.IO. Listens on the `/speaking-room` namespace. Handles `join-room` and the three WebRTC relay events. The gateway only relays — it never reads or modifies WebRTC payloads.

**Acceptance criteria:**
- [ ] Decorated with `@WebSocketGateway({ namespace: ROOM_GATEWAY_NAMESPACE, cors: { origin: '*' } })` where `ROOM_GATEWAY_NAMESPACE = '/speaking-room'` from `constants.ts` (API-02 fix — no magic strings)
- [ ] **Guard clause rule (EDGE-02):** Every handler that calls `getRoom(roomId)` applies this pattern first:
  ```
  const room = getRoom(roomId);
  if (!room) { client.emit('room-not-found'); return; }
  ```
  Applied to: `join-room`, `offer`, `answer`, `ice-candidate`.
- [ ] **One-socket-one-room invariant (EDGE-06 fix):** After successful `join-room`, store `client.data.roomId = roomId`. On subsequent `join-room` from same socket: same roomId → idempotent no-op. Different roomId → emit `already-in-room`, return. `handleDisconnect` uses `client.data.roomId` for O(1) lookup.
- [ ] `join-room` handler — receives `JoinRoomDto`. Checks `client.data.roomId` (EDGE-06 guard). Applies room-not-found guard. Calls `RoomService.verifyHostToken(roomId, hostToken)` to determine role:
  - **Token matches → host:** calls `RoomService.setHost()`. Checks if `room.guest` exists (RC-01). If yes, emits `guest-joined` back to host's own socket immediately.
  - **No token or wrong token → guest:** checks if `room.guest` is already set (RC-02). If yes, emits `room-full` and returns. Otherwise calls `RoomService.setGuest()`. If `room.hostSocketId` is set, emits `guest-joined` to host socket. If not set (RC-01: host not yet connected), stores silently.
- [ ] `offer` handler — receives `{ roomId, offer }`. Guard clause (room-not-found). **Sender verification (SEC-03 fix):** if `client.id !== room.hostSocketId`, emit `unauthorized` and return. Guards against EDGE-01: if `room.guest` is null, emits `no-guest-ready` back to host and returns. Otherwise forwards offer to guest socket.
- [ ] `answer` handler — receives `{ roomId, answer }`. Guard clause (room-not-found). **Sender verification (SEC-03 fix):** if `client.id !== room.guest?.socketId`, emit `unauthorized` and return. Guards: if `room.hostSocketId` is null, emits error and returns. Otherwise forwards answer to host socket.
- [ ] `ice-candidate` handler (API-03 fix — fully specified):
  - **Inbound:** `{ roomId: string, candidate: RTCIceCandidateInit }` — no `senderRole` field
  - Direction derived from `client.id`: `client.id === room.hostSocketId` → forward to guest. `client.id === room.guest?.socketId` → forward to host. Neither → discard silently.
  - **Outbound:** `{ candidate: RTCIceCandidateInit }` — raw candidate object, unchanged. No `from` field, no `roomId`.
  - Applies guard clause (room-not-found if null). If target socketId is null, discards silently.
- [ ] All handlers use `@SubscribeMessage` decorator
- [ ] **Logging (PROD-01):** relay handlers log `{ event: 'signal.relayed', type: 'offer'|'answer'|'ice-candidate', roomId, direction: 'host→guest'|'guest→host' }`. Dropped signals log `{ event: 'signal.dropped', type, roomId, reason }`. `join-room` logs `{ event: 'socket.joined', roomId, role: 'host'|'guest' }`.

**Verification:**
- [ ] `npm run build` passes
- [ ] Two `socket.io-client` instances: host joins, guest joins, host receives `guest-joined`
- [ ] Host sends mock `offer` → guest receives it

**Dependencies:** Task 3

**Files touched:**
- `src/modules/speaking/room/constants.ts` (new — defines `ROOM_GATEWAY_NAMESPACE`)
- `src/modules/speaking/room/room.gateway.ts`

**Estimated scope:** M

---

### Task 6: Handle disconnect and leave-room

**Description:** Clean teardown logic for both intentional (`leave-room` event) and unexpected (browser close / network drop) disconnections.

**Acceptance criteria:**
- [ ] `leave-room` handler (intentional disconnect — EDGE-03 fix): accepts **no payload**. Room derived server-side via `getRoomBySocketId(client.id)`. If socket wasn't in any room, return silently.
  - Socket is host → emit `room-ended` to guest socket → call `RoomService.deleteRoom()` immediately (no grace period on intentional leave)
  - Socket is guest → emit `partner-left` to host socket → call `RoomService.removeGuest()` (room stays alive)
- [ ] `handleDisconnect(client)` lifecycle hook (unexpected disconnect — RC-03 fix):
  - Uses `client.data.roomId` for O(1) room lookup (EDGE-06 bonus). Falls back to `RoomService.getRoomBySocketId(client.id)` only if unset.
  - Socket was **host**: calls `RoomService.startGracePeriod()` — clears `hostSocketId`, sets `status: 'ended'`, starts 30-second timer. Emits `host-disconnected` to guest socket. **Note:** `host-disconnected` is the WebSocket event name sent to the guest — distinct from the internal `status` value `'ended'`.
  - Grace period fires without reconnect → emit `room-ended` to guest → call `deleteRoom()`
  - Socket was **guest**: emit `partner-left` to host, call `RoomService.removeGuest()`
  - Does nothing if socket belonged to no room
- [ ] `join-room` host path (RC-03 reconnect path): if room exists, `hostSocketId` is null, and `room.status === 'ended'`, cancel grace period via `RoomService.setHost()`, emit `host-reconnected` to guest. Guest then triggers new WebRTC offer.
- [ ] **`startGracePeriod` closure (GAP-2 fix):** Capture `guestSocketId = room.guest?.socketId ?? null` **before** calling `startGracePeriod()` and pass it into the `onExpire` callback closure. Do not re-fetch room inside the callback — the room may be deleted by the time the timer fires.
- [ ] **Logging (PROD-01):** `handleDisconnect` logs `{ event: 'socket.disconnected', roomId, role, reason: 'unexpected' }`. `leave-room` logs `{ event: 'socket.left', roomId, role, reason: 'intentional' }`. Grace period expiry logs `{ event: 'grace.expired', roomId }`. Host reconnect logs `{ event: 'host.reconnected', roomId }`.
- [ ] **Graceful shutdown (PROD-02):** `RoomGateway` implements `OnApplicationShutdown`. In `onApplicationShutdown(signal)`: iterate `RoomService.getAllRooms()`, emit `server-shutting-down` to every non-null `hostSocketId` and `guest.socketId`. Log `{ event: 'server.shutdown', signal, activeRooms: count }`.

**Verification:**
- [ ] `npm run build` passes
- [ ] Close host tab → guest receives `host-disconnected`, then `room-ended` after 30s
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

## Phase 4 — Wiring

### Task 7: Create RoomModule and wire into SpeakingModule

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

## Phase 5 — Verification

### Task 8: End-to-end signaling test

**Description:** Full manual walkthrough of the complete flow from room creation to WebRTC handshake and room teardown.

**Acceptance criteria:**
- [ ] Host calls `POST /api/speaking/rooms` → receives `{ roomId, hostToken, expiresAt }`
- [ ] Host connects to `/speaking-room`, sends `join-room` with `{ roomId, displayName, hostToken }` (no `role` field)
- [ ] Guest connects with same `roomId`, sends `join-room` with `{ roomId, displayName }` (no `role`, no `hostToken`)
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

## Final Checkpoint
- [ ] `npm run build` passes
- [ ] `npm run start:dev` starts clean
- [ ] `npm test` — all existing tests pass
- [ ] Full end-to-end signaling flow verified manually
- [ ] WebSockets enabled in Azure App Service (see SPRECHEN_ROOM_REFERENCE.md — already enabled, no action needed)
- [ ] Ready for frontend integration
