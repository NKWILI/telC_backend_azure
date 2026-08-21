# Sprechen Room — Reference (Architecture & Contracts)

> Load this file in every implementation session. It contains the architectural decisions, event contract, file structure, and DigitalOcean deployment checklist that all tasks depend on.

---

## Overview

A real-time peer-to-peer video practice room inside the existing Sprechen module. Two users connect via WebRTC to practice speaking German together. The backend acts as a signaling relay and room manager only — no audio/video passes through it. No AI evaluation, no authentication required for the demo phase. Everything lives in a single in-memory Map, safe only while the app runs on a single instance.

---

## Architecture Decisions

- **Socket.IO over native ws** — `@nestjs/platform-socket.io` is already installed. Zero new packages needed.
- **No JWT for demo** — Both host and guest connect without authentication. The `roomId` + `hostToken` together are the credentials.
- **`crypto.randomUUID()`** — Built into Node.js 14.17+, no extra package needed.
- **Single RoomModule** — Encapsulates controller, gateway, and service. Imported into the existing `SpeakingModule`.
- **In-memory Map** — Sufficient for demo on a single instance (DigitalOcean App Platform, instance count 1). `RoomService` is a NestJS singleton so the Map is shared between the controller and gateway.
- **No Teil structure** — The room is a free practice space. What users discuss is entirely up to them. No exercise control from the backend.
- **Frontend builds the share link** — The backend returns only a `roomId`. The frontend constructs the full shareable URL using its own hosted domain (e.g. `https://yourapp.vercel.app/speaking/room/abc123`). The host then shares it manually via WhatsApp, SMS, etc.
- **All WebSocket event names and payload shapes are fully specified (API-02 + API-03 fix):**

  | Direction | Event | Payload |
  |---|---|---|
  | client → server | `join-room` | `{ roomId: string, displayName: string, hostToken?: string }` |
  | client → server | `offer` | `{ roomId: string, offer: RTCSessionDescriptionInit }` |
  | client → server | `answer` | `{ roomId: string, answer: RTCSessionDescriptionInit }` |
  | client → server | `ice-candidate` | `{ roomId: string, candidate: RTCIceCandidateInit }` |
  | client → server | `leave-room` | `{}` — no payload. Room derived server-side via `getRoomBySocketId(client.id)`. Client never declares which room to leave (EDGE-03 fix). |
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
  | server → client | `unauthorized` | `{}` — emitted when a socket sends `offer` or `answer` without matching the expected sender role (SEC-03 fix) |

- **Graceful shutdown on server restart (PROD-02 fix)** — `RoomGateway` implements NestJS's `OnApplicationShutdown` lifecycle hook. On `SIGTERM`, the gateway iterates all active rooms via `RoomService.getAllRooms()` and emits `server-shutting-down` to every connected socket before the process exits.
- **Structured logging at every state transition (PROD-01 fix)** — NestJS `Logger` with structured JSON fields: `{ event, roomId, socketId?, status?, direction?, reason? }`. Logged at every state transition. Grep by `roomId` to reconstruct any session's exact sequence of events.
- **WebSocket gateway path is a fixed constant (API-02 fix)** — The Socket.IO namespace is exactly `/speaking-room`. Defined as `ROOM_GATEWAY_NAMESPACE = '/speaking-room'` in `constants.ts`. Frontend must connect to this exact string. A mismatch produces a silent connection failure.
- **Guard clause on every `getRoom()` call (EDGE-02 fix)** — Every handler (`join-room`, `offer`, `answer`, `ice-candidate`, `leave-room`) checks for null immediately, emits `room-not-found`, and returns early. No handler ever assumes `getRoom()` returns a valid room.
- **Role determined server-side via hostToken (SEC-01 fix)** — `POST /api/speaking/rooms` generates two UUIDs: `roomId` (public) and `hostToken` (private, only the creator receives it). On `join-room`, backend checks if provided `hostToken` matches stored value. Match → host. No token or wrong token → guest.
- **Guest-before-host race condition handled (RC-01 fix)** — If guest sends `join-room` and `hostSocketId` is still null, guest info is stored in room state. When host connects, gateway checks for pending guest and immediately emits `guest-joined` back to the host.
- **Host disconnect grace period (RC-03 + STATE-01 fix)** — On host disconnect, room transitions to `status: 'ended'` for 30 seconds. Guest receives `host-disconnected`. Host can reconnect: `setHost()` revives room (`status: 'active'`), cancels timer, emits `host-reconnected` to guest. If timer fires, `room-ended` sent and `roomsMap.delete()` called.
- **Idempotency rule (RC-04 fix)** — All cleanup functions (`deleteRoom`, `removeGuest`, `setHost`, `setGuest`, `startGracePeriod`) have a one-line guard clause making second calls safe no-ops. `handleDisconnect` can call cleanup unconditionally.
- **One-socket-one-room invariant (EDGE-06 fix)** — `client.data.roomId` tracks room membership per socket. Same room → idempotent no-op. Different room → emit `already-in-room`. Enables O(1) lookup in `handleDisconnect`.
- **Sender verification on relay events (SEC-03 fix)** — `offer` requires `client.id === room.hostSocketId`; `answer` requires `client.id === room.guest?.socketId`. Mismatched sender receives `unauthorized` and is ignored. `ice-candidate` direction also derived from `client.id`.

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

## DigitalOcean Deployment Checklist

Platform settings this feature depends on. The backend runs on **DigitalOcean App Platform**, which auto-deploys on push to `main`.

> Migrated from Azure App Service (2026-08). Anything below that reads like an Azure Portal step has been restated for App Platform — if you find a stray Azure reference elsewhere in `docs/`, it is historical.

### Step 1 — WebSockets (NO ACTION NEEDED)
App Platform proxies WebSocket upgrades natively; there is no toggle to enable, unlike Azure's `webSocketsEnabled` setting. The Socket.IO namespace `/speaking-room` works without configuration.

### Step 2 — Instance count MUST stay at 1 (REQUIRED)
**This is the constraint most likely to be broken silently.** All room state lives in an in-memory `Map` inside one Node process (`RoomService`). App Platform's instance count is a slider in the app spec — raising it to 2 does not fail loudly, it breaks Sprechen intermittently:

> Host connects and lands on instance A. Guest opens the same link and lands on instance B, where that `roomId` does not exist, so the guest receives `room-not-found` for a room that demonstrably exists. Retrying may succeed, because routing is per-connection. It looks random and is very hard to diagnose from logs.

Do not scale out without first moving room state to a shared store. Note the codebase already has `ValkeyService` (used by `JwtAuthGuard` for session revocation), so DigitalOcean Managed Caching for Valkey is the natural target — the client is already wired.

### Step 3 — Accept restart behaviour (PROD-02 — demo acceptable)
Any restart — deploy, platform maintenance, scaling event — destroys all in-memory rooms and open WebSocket connections. App Platform sends `SIGTERM` before stopping a container, which `RoomGateway.onApplicationShutdown` uses to emit `server-shutting-down` to every connected socket first.

Note this differs from Azure: there is no "Always On" setting to worry about, because App Platform does not idle-stop a running app. Deploy restarts remain the main cause, and **every push to `main` is a deploy**.

### Step 4 — Rate limiting (REQUIRED — implemented in Task 9)
App Platform provides no per-IP rate limiting, same as Azure App Service. Handled in code via `@nestjs/throttler` — max 10 room creations per IP per minute on `POST /speaking/rooms`. This depends on `app.set('trust proxy', 1)` in `main.ts`: App Platform terminates TLS at its own proxy, so without it every client resolves to the proxy address and all per-IP limits collapse into one shared bucket.

### Step 5 — Watch a deploy when it carries a migration
`npm start` is `prisma migrate deploy && node -r newrelic dist/main.js`. Because App Platform auto-deploys on push, **any push to `main` containing a new migration applies it to production automatically**. If the migration fails, the `&&` short-circuits and the app does not boot — a failed migration is an outage, not a degraded state. Check runtime logs (`doctl apps logs <app-id> --type run --follow`, or the console's Runtime Logs tab) on any deploy that includes a schema change.
