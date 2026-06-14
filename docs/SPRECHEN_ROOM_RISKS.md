# Sprechen Room — Risks and Mitigations

> Reference only. Load this during code review sessions (`/code-review ultra`). Not needed during implementation.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **SEC-01: Client self-declares role** | Critical | ✅ Fixed — role is determined server-side via `hostToken` verification. Client sends token; backend resolves role. No self-declaration trusted. |
| **RC-01: Guest joins before host WebSocket connects** | Critical | ✅ Fixed — guest info stored in room state when host is absent. When host connects, gateway checks for pending guest and emits `guest-joined` immediately to the host. |
| **EDGE-01: Offer/answer sent before guest joins** | High | ✅ Fixed — `offer` handler guards `room.guest` before accessing socketId. If null, emits `no-guest-ready` back to host. Real fix is frontend ordering: host must only call `createOffer()` after receiving `guest-joined`. Backend guard is the safety net. |
| **API-01: GET /rooms/:roomId response shape undefined** | High | ✅ Fixed — `RoomInfoResponseDto` fully specifies every field (`roomId`, `status`, `hasHost`, `hasGuest`, `expiresAt`), its type, and what each value means for frontend decision-making. `guestDisplayName` intentionally omitted for privacy. |
| **SEC-02: No rate limiting on room creation — DoS** | Critical | ✅ Fixed — Task 9 adds `@nestjs/throttler` with max 10 rooms per IP per minute. Returns HTTP 429 on breach. Applied to `POST /speaking/rooms` only. |
| **SEC-03: `offer`/`answer` sender not verified — role impersonation on relay** | High | ✅ Fixed — `offer` handler requires `client.id === room.hostSocketId`; `answer` handler requires `client.id === room.guest?.socketId`. Mismatched sender receives `unauthorized` and is ignored. |
| **RC-02: Two guests join simultaneously — last writer wins** | High | ✅ Fixed — `join-room` handler checks `room.guest !== null` before calling `setGuest()`. If room already has a guest, emits `room-full` error event to the second joiner and returns immediately. No overwrite, no silent eviction. |
| **RC-03: Host reconnects after transient disconnect — room already deleted** | High | ✅ Fixed — `handleDisconnect` no longer deletes room immediately on host drop. Room transitions to `status: 'ended'`, stays in Map for 30s grace period. Guest receives `host-disconnected`. If host reconnects within 30s, room revives to `active`. If timer fires, `room-ended` sent, `roomsMap.delete()` called. Intentional `leave-room` still deletes immediately. |
| **STATE-01: `ended` status defined but never set — dead code** | High | ✅ Fixed — `ended` is now the grace-period state set by `startGracePeriod()`. The `GET /rooms/:roomId` check `status === 'ended'` → 404 is a real, reachable branch. |
| **STATE-02: `active` set when only guest is connected — inaccurate** | High | ✅ Fixed — `setGuest()` only sets `active` if `hostSocketId` is already present. `setHost()` only sets `active` if `room.guest` is already present. `active` strictly means both parties confirmed connected. |
| **EDGE-02: `setGuest()` called for non-existent room** | High | ✅ Fixed — universal guard clause on every handler calling `getRoom()`. If null for any reason (expired, deleted, forged, typo), handler emits `room-not-found` and returns early. |
| **API-02: WebSocket gateway path unspecified ("e.g.")** | Medium | ✅ Fixed — path is exactly `/speaking-room`, defined as `ROOM_GATEWAY_NAMESPACE` constant in `constants.ts`. No magic strings. |
| **PROD-02: Server restart destroys all active sessions silently** | Medium | ✅ Fixed — `RoomGateway` implements `OnApplicationShutdown`. On `SIGTERM`, iterates all rooms via `getAllRooms()` and emits `server-shutting-down` to every connected socket before process exits. |
| **PROD-01: No logging or observability defined** | Medium | ✅ Fixed — NestJS `Logger` with structured JSON fields at every state transition. Grep by `roomId` to reconstruct any session's exact sequence of events. |
| **EDGE-06: Multiple `join-room` events from the same socket** | Medium | ✅ Fixed — `client.data.roomId` tracks room membership per socket. Same room → no-op. Different room → emit `already-in-room`. Bonus: `handleDisconnect` uses `client.data.roomId` for O(1) lookup. |
| **EDGE-05: Empty or malformed `displayName` stored in memory** | Medium | ✅ Fixed — `JoinRoomDto` uses `@IsUUID()` on `roomId`, `@IsNotEmpty()` + `@MaxLength(100)` on `displayName`. `ValidationPipe` applied at WebSocket boundary. Does not prevent XSS — see SEC-04. |
| **SEC-04: `displayName` rendered unsanitized — stored XSS** | High | ⚠️ Frontend responsibility — backend validation constrains length and emptiness only. A `displayName` like `<script>...</script>` passes current validators and is stored + emitted via `guest-joined`. **Frontend MUST render `displayName` as text content only**: React JSX `{displayName}` is safe; vanilla JS must use `.textContent`, never `.innerHTML`. Add to frontend integration checklist. |
| **EDGE-03: `leave-room` sent for a room the socket does not belong to** | Medium | ✅ Fixed — `leave-room` accepts no `roomId` payload. Room derived server-side via `getRoomBySocketId(client.id)`. A socket can only leave the room it is actually in. |
| **API-03: ICE candidate payload structure not defined** | Medium | ✅ Fixed — inbound: `{ roomId, candidate: RTCIceCandidateInit }`, no `senderRole`. Outbound: `{ candidate: RTCIceCandidateInit }`. Event name `ice-candidate` in both directions. |
| **RC-04: `leave-room` followed by `handleDisconnect` double-processing** | Medium | ✅ Fixed — all state-mutating functions are idempotent. One-line guard clause per function. `handleDisconnect` calls cleanup unconditionally. |
| **RC-05: 2-hour timer fires while `handleDisconnect` is processing** | Medium | ✅ Mitigated — JS single-threaded. `deleteRoom()` keeps `roomsMap.delete()` synchronous and first. Idempotency from RC-04 makes any overlap a harmless no-op. Comment documents constraint: `// keep Map.delete() synchronous and first — see RC-05`. |
| **hostToken exposed in URL** | High | Frontend must store `hostToken` in memory or sessionStorage only — never in the share URL. Only `roomId` goes in the shareable link. |
| Socket.IO CORS blocks frontend | High | Set `cors: { origin: '*' }` for demo; tighten to specific domain before wider rollout |
| Memory leak if `leave-room` never fires | Low | 2-hour `setTimeout` in `createRoom()` guarantees cleanup regardless |
| Frontend not yet hosted | High | Share link only works if frontend is deployed publicly (e.g. Vercel). Localhost works for same-machine testing only. |

---

## Open Questions

- What domain will the frontend be hosted on? Needed to tighten CORS before going live with testers.
- Should a second guest be silently rejected or shown a specific error message? (Currently: `room-full` event emitted — frontend decides the UX.)
