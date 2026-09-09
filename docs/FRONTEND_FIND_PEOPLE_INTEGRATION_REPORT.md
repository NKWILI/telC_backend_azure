# Frontend Integration Report: Find People / Speaking Partner Matchmaking

Date: 2026-09-09

## Executive summary

The backend matchmaking handler is deployed and registered, and production
clients are successfully connecting to the speaking-room Socket.IO namespace.
However, the supplied production log contains 34 `socket.connected` events and
zero `lobby.queued`, `lobby.matched`, or `lobby.room.created` events. This means
the connected frontend clients did not successfully send the `find-partner`
Socket.IO event.

`find-partner` is not a REST endpoint. The frontend must connect to the
`/speaking-room` Socket.IO namespace, register its response listeners, and emit
the exact kebab-case event name after the socket reports that it is connected.

## Backend addresses

Use the deployed backend origin as `BACKEND_ORIGIN`, without `/api` appended.

```text
REST origin:      BACKEND_ORIGIN
Socket.IO origin: BACKEND_ORIGIN
Namespace:        /speaking-room
Socket.IO path:   /socket.io (library default; do not replace it with the namespace)
```

Correct JavaScript connection:

```ts
import { io } from 'socket.io-client';

const socket = io(`${BACKEND_ORIGIN}/speaking-room`, {
  transports: ['websocket'],
});
```

Do not connect to `/speaking`, `/api/speaking-room`, or
`/api/speaking/rooms/find-partner`. Do not configure
`path: '/speaking-room'`; `path` and namespace are different Socket.IO concepts.

## Matchmaking event contract

### Client to server

#### `find-partner`

Starts a matchmaking search.

```ts
socket.emit('find-partner', {
  displayName: 'Anna',
  level: 'B1',
});
```

Payload rules:

- `displayName` is required and must be a string.
- It must contain 1-30 characters.
- It must not contain digits.
- `level` is optional; the backend defaults it to `B1`.
- If supplied, `level` must currently be exactly `B1`.

Emit this only after the Socket.IO `connect` event. One socket must not emit it
again while already searching or while it is in a room.

#### `cancel-search`

Stops the current search. The payload is an empty object.

```ts
socket.emit('cancel-search', {});
```

#### `join-room`

Both matched clients must emit this after receiving `partner-found`.

```ts
socket.emit('join-room', {
  roomId,
  displayName: 'Anna',
  ...(hostToken ? { hostToken } : {}),
});
```

The client that receives `hostToken` is the host and must send it unchanged.
The other client is the guest and must omit `hostToken`.

#### `shuffle-topic`

Only the connected host may request another topic.

```ts
socket.emit('shuffle-topic', { roomId });
```

#### `offer`, `answer`, and `ice-candidate`

These are the WebRTC signaling events.

```ts
socket.emit('offer', { roomId, offer });
socket.emit('answer', { roomId, answer });
socket.emit('ice-candidate', { roomId, candidate });
```

The host sends the offer. The guest sends the answer. Both clients send ICE
candidates.

#### `leave-room`

Leaves the current room. No payload is required.

```ts
socket.emit('leave-room');
```

#### `report-partner`

Reports the current partner and ends the room for both clients.

```ts
socket.emit('report-partner', { reason: 'Optional text, maximum 500 characters' });
```

### Server to client

The frontend must register all relevant listeners before emitting
`find-partner`.

| Event | Payload | Frontend action |
|---|---|---|
| `waiting` | `{ count: number }` | Show the searching state. `count` excludes the current user. |
| `waiting-count` | `{ count: number }` | Update the displayed compatible-user count. |
| `partner-found` | `{ roomId, hostToken?, displayName }` | Save the data and immediately emit `join-room`. |
| `already-searching` | `{}` | Keep one search UI active; do not emit again. |
| `lobby-full` | `{}` | Stop loading and show that matchmaking is temporarily full. |
| `search-cancelled` | `{}` | Return the UI to idle. |
| `already-in-room` | `{}` | Navigate to or restore the existing call state. |
| `guest-joined` | `{ displayName }` | Host creates and sends the WebRTC offer. |
| `room-full` | `{}` | Stop joining and show that the room is occupied. |
| `room-not-found` | `{}` | Clear stored room data and return to idle/search. |
| `host-reconnected` | `{}` | Guest keeps the call open and updates connection status. |
| `host-disconnected` | `{}` | Guest shows a temporary reconnecting state. |
| `partner-left` | `{}` | End the local call and return to the post-call screen. |
| `room-ended` | `{}` | End the local call and clear room state. |
| `partner-reported` | `{}` | End the local call and show confirmation. |
| `topic-changed` | `{ topic }` | Replace the displayed topic with the server payload. |
| `offer` | `{ offer }` | Guest applies remote description, creates answer, emits `answer`. |
| `answer` | `{ answer }` | Host applies remote description. |
| `ice-candidate` | `{ candidate }` | Add the remote ICE candidate. |
| `no-guest-ready` | `{}` | Host waits for `guest-joined` before creating an offer. |
| `unauthorized` | `{}` | Stop the attempted operation and restore valid room state. |
| `server-shutting-down` | `{}` | End the call/search and reconnect after a delay. |

Also listen to Socket.IO's built-in `connect`, `connect_error`, and `disconnect`
events. These are transport events, not backend application events.

## Required frontend flow

1. Create one Socket.IO connection to `BACKEND_ORIGIN/speaking-room`.
2. Register all server-event and transport-event listeners.
3. Wait for `connect` and verify `socket.connected === true`.
4. When the user presses Find People, emit `find-partner` once.
5. On `waiting`, show the searching state.
6. On `partner-found`, store `roomId`, optional `hostToken`, and partner name.
7. Immediately emit `join-room` on the same socket.
8. If this client has `hostToken`, wait for `guest-joined`, then create the
   WebRTC offer.
9. If this client does not have `hostToken`, wait for `offer`, create the
   WebRTC answer, and emit `answer`.
10. Exchange `ice-candidate` events in both directions.
11. On cancel, unmount, logout, or navigation away, emit `cancel-search` if
    searching or `leave-room` if already in a room.

## Reference frontend implementation

```ts
const socket = io(`${BACKEND_ORIGIN}/speaking-room`, {
  transports: ['websocket'],
  reconnection: true,
});

socket.on('connect', () => {
  console.info('[people] socket connected', { socketId: socket.id });
});

socket.on('connect_error', (error) => {
  console.error('[people] connection failed', error);
});

socket.on('waiting', ({ count }) => {
  console.info('[people] queued', { count });
  setSearchState({ status: 'waiting', count });
});

socket.on('waiting-count', ({ count }) => {
  setSearchState((state) => ({ ...state, count }));
});

socket.on('partner-found', ({ roomId, hostToken, displayName }) => {
  console.info('[people] partner found', {
    roomId,
    role: hostToken ? 'host' : 'guest',
  });

  socket.emit('join-room', {
    roomId,
    displayName: ownDisplayName,
    ...(hostToken ? { hostToken } : {}),
  });

  setCallState({ roomId, hostToken, partnerName: displayName });
});

function findPeople(displayName: string) {
  if (!socket.connected) {
    throw new Error('Cannot search before the speaking-room socket connects');
  }

  console.info('[people] emitting find-partner', {
    socketId: socket.id,
    displayName,
    level: 'B1',
  });

  socket.emit('find-partner', { displayName, level: 'B1' });
}
```

Do not log `hostToken`, JWTs, TURN credentials, SDP bodies, or ICE credential
values.

## Corresponding REST endpoints

Matchmaking itself uses Socket.IO. These REST endpoints support manual rooms,
room recovery, and WebRTC configuration.

### `POST /api/speaking/rooms?level=B1`

Creates a manual speaking room. It does not search for a person.

Authentication: none. Rate limited by the backend.

Example response:

```json
{
  "roomId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "hostToken": "private-host-token",
  "expiresAt": "2026-09-09T12:00:00.000Z",
  "topic": {
    "id": "b1-t2-001",
    "level": "B1",
    "teil": 2,
    "title": "Reisen mit einer Gruppe",
    "positionA": "Gruppenreisen sind praktisch, weil alles organisiert ist.",
    "positionB": "Allein zu reisen gibt mehr Freiheit und Ruhe.",
    "followUpQuestions": ["Warum?", "Welche Erfahrungen haben Sie?"]
  }
}
```

Keep `hostToken` private. Share only `roomId` with an invited guest.

### `GET /api/speaking/rooms/:roomId`

Returns recoverable room state.

Authentication: none.

Example response:

```json
{
  "roomId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "status": "waiting",
  "hasHost": true,
  "hasGuest": false,
  "expiresAt": "2026-09-09T12:00:00.000Z",
  "topic": {
    "id": "b1-t2-001",
    "level": "B1",
    "teil": 2,
    "title": "Reisen mit einer Gruppe",
    "positionA": "Gruppenreisen sind praktisch, weil alles organisiert ist.",
    "positionB": "Allein zu reisen gibt mehr Freiheit und Ruhe.",
    "followUpQuestions": ["Warum?", "Welche Erfahrungen haben Sie?"]
  }
}
```

Returns HTTP 404 when the room does not exist or has ended.

### `GET /api/speaking/rooms/ice-servers`

Returns STUN/TURN configuration for `RTCPeerConnection`.

Authentication: required.

```http
Authorization: Bearer ACCESS_TOKEN
```

Example response:

```json
{
  "iceServers": [
    { "urls": "stun:stun.example.com:3478" },
    {
      "urls": "turn:turn.example.com:3478?transport=udp",
      "username": "ephemeral-username",
      "credential": "ephemeral-credential",
      "credentialType": "password"
    }
  ],
  "ttlSeconds": 3600
}
```

Pass `iceServers` directly to `RTCPeerConnection`:

```ts
const response = await fetch(`${BACKEND_ORIGIN}/api/speaking/rooms/ice-servers`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const { iceServers } = await response.json();
const peerConnection = new RTCPeerConnection({ iceServers });
```

## How the frontend team should test

### Test 1: Confirm the browser emits the event

1. Open browser developer tools and select the Console and Network tabs.
2. Open the Find People page.
3. Confirm the console prints `[people] socket connected` with a socket ID.
4. In Network, locate the `/socket.io/` WebSocket request and confirm status
   `101 Switching Protocols`.
5. Press Find People once.
6. Confirm the console prints `[people] emitting find-partner`.
7. Confirm `waiting` arrives and the UI enters the waiting state.

Expected backend log:

```text
{"event":"socket.connected","socketId":"..."}
{"event":"lobby.queued","level":"B1","waiting":1}
```

If `socket.connected` appears without `lobby.queued`, the frontend did not send
a valid `find-partner` event to this backend instance.

### Test 2: Match two independent users

Use two different browsers, devices, or one normal and one private window. Do
not use two tabs that accidentally share one frontend singleton incorrectly.

1. In browser A, connect and press Find People using `Anna`.
2. Confirm browser A receives `waiting`.
3. Within 120 seconds, in browser B, connect and press Find People using `Ben`.
4. Confirm both browsers receive exactly one `partner-found` event with the
   same `roomId`.
5. Confirm exactly one payload contains `hostToken`.
6. Confirm both browsers emit `join-room`.
7. Confirm the host receives `guest-joined`.
8. Confirm offer, answer, and ICE candidate exchange occurs.
9. Confirm audio/video connects, including on separate networks if possible.

Expected backend log:

```text
{"event":"lobby.queued","level":"B1","waiting":1}
{"event":"lobby.queued","level":"B1","waiting":2}
{"event":"lobby.matched","level":"B1",...}
{"event":"lobby.room.created","roomId":"...","level":"B1"}
{"event":"socket.joined","roomId":"...","role":"host"}
{"event":"socket.joined","roomId":"...","role":"guest"}
```

### Test 3: Validate error handling

Verify that the UI does not remain in an infinite loading state for:

- Empty display name.
- Display name longer than 30 characters.
- Display name containing digits, such as `Anna123`.
- A level other than `B1`.
- Pressing Find People twice.
- Pressing cancel while waiting.
- Losing the network while waiting.
- Receiving `room-not-found`, `room-full`, or `server-shutting-down`.

The frontend should also log incoming Socket.IO errors during testing. NestJS
validation failures may otherwise be invisible while the UI keeps spinning.

### Test 4: Verify REST support routes

```bash
curl -X POST "BACKEND_ORIGIN/api/speaking/rooms?level=B1"
curl "BACKEND_ORIGIN/api/speaking/rooms/ROOM_ID"
curl -H "Authorization: Bearer ACCESS_TOKEN" \
  "BACKEND_ORIGIN/api/speaking/rooms/ice-servers"
```

Replace `BACKEND_ORIGIN`, `ROOM_ID`, and `ACCESS_TOKEN` with real values. Never
paste production access tokens or TURN credentials into tickets or shared logs.

## Known backend constraints

- A waiting entry expires after 120 seconds by default. The current backend
  does not notify the expired client, so the frontend must not show an endless
  spinner. Until a heartbeat/renewal protocol is added, cancel and restart the
  search before or at that boundary.
- Lobby and room state are held in memory. Production must run exactly one
  backend instance unless this state is migrated to a shared store such as
  Valkey/Redis.
- Matchmaking currently supports only level `B1`.
- The supplied production log shows a single hostname, but a log excerpt alone
  does not prove that the deployment is configured for exactly one replica.

## Acceptance criteria

The frontend integration is correct when all of the following are true:

- Pressing Find People produces `lobby.queued` in backend logs.
- Two users searching within 120 seconds produce one `lobby.matched` and one
  `lobby.room.created` log entry.
- Both clients receive the same `roomId` and only one receives `hostToken`.
- Both clients emit `join-room` on the same Socket.IO connection.
- The host and guest exchange offer, answer, and ICE candidates.
- Cancel, disconnect, validation failure, and room errors leave the UI in a
  recoverable state rather than an endless spinner.
