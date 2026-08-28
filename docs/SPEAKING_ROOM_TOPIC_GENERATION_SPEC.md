# Spec: Synchronized B1 Speaking Topics in Rooms

## Status

- Phase: Specify
- Approval state: Approved for planning on 2026-08-28
- Target branch: `main`
- Scope: Backend and frontend behavior; this repository contains the backend implementation

## Objective

Add a shared B1 speaking topic to every speaking room. When a host creates a room, the backend selects one original telc-style B1 Teil 2 discussion topic and stores it in the in-memory room. The host and guest must always see that same stored topic.

After the participants finish discussing a topic, they can agree to continue. The host selects **Next topic**, and the backend chooses another topic that has not yet been used in that room. The backend then sends the replacement to both participants in real time.

This feature gives pairs a coherent practice session while keeping the backend as the single source of truth for the current topic.

### Users

- **Host:** creates the room, sees the selected topic, and can request the next topic.
- **Guest:** joins through the shared room ID, sees the same topic, and receives all subsequent topic changes.

### User flow

1. The host selects B1 on the create-room screen.
2. The frontend creates a room with `POST /api/speaking/rooms?level=B1`.
3. The backend selects a B1 Teil 2 topic, stores it in the room, and returns it with the room details.
4. The host shares the room ID, but never the private host token.
5. The guest loads `GET /api/speaking/rooms/:roomId` and receives the room's stored topic.
6. Both participants discuss the topic.
7. When they want to continue, the host selects **Next topic**.
8. The host frontend emits `shuffle-topic` with the room ID.
9. The backend verifies that the sending socket is the connected host, selects an unused topic, stores it, and emits `topic-changed` to both participants.
10. Both frontends replace their displayed topic with the event payload.

## Scope

### In scope

- B1 topics only.
- telc-style Teil 2 partner discussions.
- A static catalog of 60 original topics stored in backend source code.
- Two contrasting viewpoints and follow-up questions for every topic.
- Random initial topic selection.
- Room-level tracking of previously used topics.
- A host-controlled **Next topic** action.
- REST responses containing the current topic.
- Real-time synchronization through Socket.IO.
- Runtime validation of the requested level.
- Backend unit and gateway tests.
- A frontend interaction contract for the separate frontend implementation.

### Out of scope

- A1, A2, B2, C1, or C2 topics.
- User selection of a speaking Teil.
- Teil 1 introductions.
- Teil 3 collaborative planning scenarios.
- Topic creation or editing by administrators.
- Prisma models, migrations, or database persistence.
- Topic persistence after a backend restart.
- Per-user topic history across different rooms.
- Guest-controlled topic changes.
- Automated evaluation of the discussion.
- Copying complete topics or task sets from proprietary examination material.

## Functional Requirements

### FR-1: Topic catalog

The backend shall contain exactly 60 original B1 Teil 2 practice topics in:

```text
src/modules/speaking/room/speaking-topics.data.ts
```

Every topic shall have this logical shape:

```ts
export type SpeakingLevel = 'B1';

export interface SpeakingTopic {
  id: string;
  level: SpeakingLevel;
  teil: 2;
  title: string;
  positionA: string;
  positionB: string;
  followUpQuestions: string[];
}
```

Content rules:

- `id` is stable and unique, using a format such as `b1-t2-001`.
- `title` clearly identifies an everyday B1 discussion subject.
- `positionA` and `positionB` present understandable, contrasting viewpoints.
- `followUpQuestions` contains between two and four open questions.
- Language is appropriate for a B1 learner.
- Topics encourage opinions and personal experiences rather than testing specialist knowledge.
- The catalog covers varied areas such as everyday life, travel, work, learning, health, technology, shopping, housing, transport, leisure, relationships, and community life.
- Content is original practice material informed by the public telc B1 format; it must not reproduce complete proprietary examination tasks.

### FR-2: Room creation

The create-room endpoint shall accept a required `level` query parameter:

```http
POST /api/speaking/rooms?level=B1
```

The controller shall validate the query at the HTTP boundary. The only supported value in this version is `B1`. A missing or unsupported value shall produce the project's standard `400 Bad Request` response.

On a valid request, `RoomService` shall:

1. Randomly choose one topic from the B1 catalog.
2. Store `level`, `topic`, and the topic ID in `usedTopicIds` on the room.
3. Return the stored topic in the create-room response.

### FR-3: Room state

The in-memory `Room` interface shall gain:

```ts
level: SpeakingLevel;
topic: SpeakingTopic;
usedTopicIds: string[];
```

`topic` is the only authoritative current topic for that room. Clients must not independently choose or randomize topics.

Topic state has the same lifetime as its room. It may disappear when the room expires, is deleted, or the backend process restarts.

### FR-4: REST response contracts

Both room endpoints shall return the current stored topic.

Create response:

```json
{
  "roomId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "hostToken": "private-host-token",
  "expiresAt": "2026-08-28T18:00:00.000Z",
  "topic": {
    "id": "b1-t2-001",
    "level": "B1",
    "teil": 2,
    "title": "Reisen mit einer Gruppe",
    "positionA": "Gruppenreisen sind praktisch, weil alles organisiert ist.",
    "positionB": "Allein zu reisen gibt mehr Freiheit.",
    "followUpQuestions": [
      "Wie reisen Sie am liebsten?",
      "Welche Erfahrungen haben Sie mit Gruppenreisen?",
      "Was sind die Vor- und Nachteile?"
    ]
  }
}
```

`GET /api/speaking/rooms/:roomId` shall return the same `topic` shape alongside the existing room information. This allows a guest or reconnecting client to recover the authoritative topic without relying on a previous WebSocket event.

The topic response contract shall be represented by `TopicDto` and referenced by both existing response DTOs.

### FR-5: Selecting the next topic

The host client shall request another topic using:

```text
Event: shuffle-topic
Payload: { roomId: string }
```

The public event name remains `shuffle-topic` for compatibility with the feature contract. The user-facing control shall be labelled **Next topic**.

The gateway shall accept the request only when all of the following are true:

- The room exists and has not ended.
- The sending socket is currently associated with that room.
- The sending socket ID equals the room's current `hostSocketId`.

The gateway shall not trust a client-provided role or host flag.

For a valid request, `RoomService` shall:

1. Filter out every ID in the room's `usedTopicIds`.
2. Select randomly from the remaining topics.
3. If every catalog topic has been used, clear the history before selecting, while still avoiding the immediately current topic when more than one topic exists.
4. Replace `room.topic` with the selected topic.
5. Add the selected ID to `usedTopicIds`.
6. Return the new stored topic to the gateway.

### FR-6: Real-time synchronization

After a successful topic change, the backend shall emit:

```text
Event: topic-changed
Payload: { topic: SpeakingTopic }
```

The event shall be sent to:

- The connected host socket.
- The connected guest socket, when present.

The frontend shall replace its current topic with the payload received from `topic-changed`. It shall not perform additional random selection.

### FR-7: Errors and invalid actions

- Missing room: emit the existing `room-not-found` event with `{}`.
- Non-host or socket from another room: emit the existing `unauthorized` event with `{}`.
- Missing or unsupported HTTP level: return `400 Bad Request` through existing NestJS validation behavior.
- Empty B1 catalog: fail with a controlled server error and log a diagnostic event; never return `undefined` as a topic.
- A failed topic-change request must not mutate `room.topic` or `usedTopicIds`.

### FR-8: Frontend behavior contract

The separate frontend shall implement approximately three UI pieces:

1. **Level selector**
   - Shows B1 as the only supported option in this version.
   - Sends `level=B1` during room creation.

2. **Topic card**
   - Displays the title, both viewpoints, and follow-up questions.
   - Is visible to host and guest.
   - Uses the topic returned by REST for initial rendering and recovery.

3. **Next topic control**
   - Is visible or enabled only for the host.
   - Emits `shuffle-topic` with the current room ID.
   - Becomes temporarily disabled after selection until `topic-changed` or an error arrives, preventing accidental rapid requests.

Both host and guest shall register and clean up a `topic-changed` listener. A newly joined or refreshed guest shall obtain the current topic through the room-info endpoint even if the guest missed earlier events.

## Non-Functional Requirements

### Consistency

- The backend is the single source of truth.
- REST and WebSocket payloads use the same topic field names and types.
- A topic mutation occurs before `topic-changed` is emitted.

### Performance

- Selecting from 60 in-memory topics shall not require external I/O.
- Selection may use simple array filtering; no index or cache is required at this scale.

### Security

- Only the connected host socket can change the topic.
- The host token remains private and is never included in guest-facing room information.
- Topic strings are static trusted backend content, not client-provided HTML.

### Reliability

- A guest can recover the latest topic using the room-info endpoint after refresh or reconnect.
- Rapid or duplicated topic-change events must execute synchronously against the room's current history so a selected topic is recorded before the next request is processed.

### Observability

Successful changes should produce a structured log containing the event name, room ID, previous topic ID, and new topic ID. Logs must not contain the host token.

Example logical event:

```json
{
  "event": "topic.changed",
  "roomId": "room-id",
  "previousTopicId": "b1-t2-001",
  "topicId": "b1-t2-014"
}
```

## Tech Stack

- Node.js with TypeScript 5.7
- NestJS 11
- Socket.IO 4 through `@nestjs/platform-socket.io`
- `class-validator` and `class-transformer` for boundary validation
- Swagger decorators through `@nestjs/swagger`
- Jest 30 with `ts-jest`
- Existing in-memory `Map<string, Room>` room storage

No new runtime or development dependency is required.

## Commands

Run from the repository root:

```powershell
# Run topic-specific and affected room tests
npm test -- --runInBand test/topic-selection.spec.ts test/room.service.spec.ts test/room.controller.spec.ts test/room.gateway.spec.ts test/room.dto.spec.ts

# Run the complete test suite
npm test -- --runInBand

# Check and fix lint findings using the existing project script
npm run lint

# Compile the application
npm run build

# Run the backend locally
npm run start:dev
```

The final test filename may be `test/topic-selection.spec.ts` because topic selection remains in `RoomService`. A separate `topic.service.spec.ts` is not required unless a separate `TopicService` is introduced later.

## Project Structure

```text
src/modules/speaking/room/
├── speaking-topics.data.ts           # SpeakingTopic type and 60 static B1 topics
├── room.service.ts                   # Initial and next-topic selection; room mutation
├── room.controller.ts                # Validated level query and REST responses
├── room.gateway.ts                   # shuffle-topic authorization and topic-changed emission
├── room.module.ts                    # Existing module; no new provider required
├── interfaces/
│   └── room.interface.ts             # level, topic, and usedTopicIds room state
└── dto/
    ├── topic.dto.ts                  # Public topic response shape
    ├── create-room-query.dto.ts      # Validated create-room query
    ├── create-room-response.dto.ts   # Adds topic
    └── room-info-response.dto.ts     # Adds topic

test/
├── topic-selection.spec.ts           # Catalog and selection behavior
├── room.service.spec.ts              # Room storage and topic lifecycle
├── room.controller.spec.ts           # HTTP query and response behavior
├── room.gateway.spec.ts              # Host authorization and synchronization
└── room.dto.spec.ts                  # DTO and Swagger metadata

docs/
└── SPEAKING_ROOM_TOPIC_GENERATION_SPEC.md
```

## Code Style

Follow the existing NestJS structure, dependency direction, and formatting. Keep room-state mutations in `RoomService`; controllers and gateways translate external contracts and delegate behavior.

```ts
selectNextTopic(roomId: string): SpeakingTopic | undefined {
  const room = this.rooms.get(roomId);
  if (!room || room.status === 'ended') return undefined;

  const previousTopicId = room.topic.id;
  const topic = this.pickUnusedTopic(room.usedTopicIds, previousTopicId);

  room.topic = topic;
  room.usedTopicIds.push(topic.id);

  this.logger.log(JSON.stringify({
    event: 'topic.changed',
    roomId,
    previousTopicId,
    topicId: topic.id,
  }));

  return topic;
}
```

Conventions:

- Classes and DTOs use `PascalCase`.
- Variables, methods, response fields, and query parameters use `camelCase`.
- WebSocket event names use the existing kebab-case convention.
- Topic IDs use lowercase stable identifiers such as `b1-t2-001`.
- Public input is validated at HTTP and WebSocket boundaries.
- Avoid `any` in production topic code.
- Use existing Prettier and ESLint configuration.

## Testing Strategy

### Framework and location

- Use Jest and the existing Nest testing utilities.
- Place cross-module room tests under `test/`, consistent with current room tests.
- Do not require network access, Prisma, Redis, or real Socket.IO connections for unit tests.

### Catalog tests

Verify that:

- The catalog contains exactly 60 entries.
- Every ID is unique and follows the agreed format.
- Every entry has `level: 'B1'` and `teil: 2`.
- Every entry has non-empty title and viewpoints.
- Every entry has between two and four non-empty follow-up questions.

### Selection tests

Control randomness by mocking `Math.random` or by extracting a deterministic candidate-selection helper. Verify that:

- Initial selection returns a catalog topic.
- A used topic is excluded while unused topics remain.
- No topic repeats within the same room before catalog exhaustion.
- Different rooms maintain independent histories.
- Exhausting the catalog resets history safely.
- The immediately current topic is avoided after reset when alternatives exist.
- The selector behaves safely with a one-topic test fixture.

### Controller tests

Verify that:

- `level=B1` reaches `RoomService.createRoom()`.
- Missing and unsupported levels are rejected.
- The create response contains the selected topic.
- Room info contains exactly the room's stored topic.
- Existing 404 behavior for missing or ended rooms remains unchanged.

### Gateway tests

Verify that:

- The connected host can request the next topic.
- The host and connected guest receive the same `topic-changed` payload.
- The host still receives the event when no guest is connected.
- A guest cannot change the topic.
- An unrelated socket cannot change the topic.
- A missing room produces `room-not-found`.
- Invalid requests do not mutate the room topic.

### Regression verification

- Update every existing `Room` test fixture with `level`, `topic`, and `usedTopicIds`.
- Run the complete test suite because the required `Room` fields affect controller, gateway, disconnect, and service tests.
- Run the production build after tests.

No numeric coverage threshold is introduced by this feature. Every success criterion below must have direct automated coverage where it concerns backend behavior.

## Boundaries

### Always do

- Keep the authoritative topic in backend room state.
- Validate the requested level at the HTTP boundary.
- Authorize topic changes using the connected host socket ID.
- Return the topic from both create-room and room-info responses.
- Update stored state before broadcasting the new topic.
- Keep topic histories isolated per room.
- Add or update tests for every changed contract.
- Run affected tests, the full test suite, lint, and build before considering implementation complete.
- Keep the specification current if an approved requirement changes.

### Ask first

- Add support for another language level.
- Add Teil 1 or Teil 3 behavior.
- Allow the guest to request or approve topic changes.
- Change the established WebSocket event names.
- Add a database model or migration.
- Add a new dependency.
- Change room expiry or reconnection behavior.
- Alter the topic data shape after frontend integration begins.

### Never do

- Send different current topics to host and guest.
- Let the frontend randomly choose the authoritative topic.
- Trust a client-provided host role.
- Include the host token in guest-facing responses or logs.
- Copy complete proprietary examination topic sets.
- Store secrets in source code or topic data.
- remove or weaken existing room tests to make the change pass.
- Edit generated output or dependency directories.

## Success Criteria

The feature is complete when all of the following are true:

1. The static catalog contains exactly 60 valid, unique, original B1 Teil 2 topics.
2. `POST /api/speaking/rooms?level=B1` returns a room with a topic and stores that exact topic in the room.
3. Missing or unsupported level values receive `400 Bad Request`.
4. `GET /api/speaking/rooms/:roomId` returns the room's current stored topic.
5. The host and guest receive identical topic data for the same room.
6. Only the currently connected host can successfully emit `shuffle-topic`.
7. A successful request changes the room's stored topic and emits one `topic-changed` payload containing that topic to both connected participants.
8. No topic repeats within one room until all 60 topics have been used.
9. Topic histories in different rooms do not affect each other.
10. After all topics are used, selection continues safely without immediately repeating the current topic when another topic exists.
11. A guest that refreshes or reconnects recovers the latest topic through the room-info endpoint.
12. The frontend labels the action **Next topic**, disables it while a change is pending, and replaces topic state only from backend responses or events.
13. No Prisma schema or migration is changed.
14. No new package dependency is added.
15. All affected tests, the complete test suite, lint, and build pass.

## Open Questions

No blocking product questions remain for the Specify phase.

The following implementation-detail decision may be made during planning without changing the product contract:

- Whether the 60 topic objects remain in one array or are grouped into category-specific arrays and exported as one catalog.

## Approval Gate

This specification was approved by the user on 2026-08-28. Planning artifacts may be created; production implementation still requires approval of the plan.
