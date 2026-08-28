# Frontend Contract: Synchronized B1 Speaking Topics

The backend owns the current topic. The frontend must render topics returned by REST or Socket.IO and must never select a topic locally.

## Shared Type

```ts
export interface SpeakingTopic {
  id: string;
  level: 'B1';
  teil: 2;
  title: string;
  positionA: string;
  positionB: string;
  followUpQuestions: string[];
}
```

## Create a Room

```http
POST /api/speaking/rooms?level=B1
```

`level` is required. This version accepts only `B1`; missing or unsupported values return `400 Bad Request`.

Successful response:

```ts
interface CreateRoomResponse {
  roomId: string;
  hostToken: string;
  expiresAt: string;
  topic: SpeakingTopic;
}
```

Keep `hostToken` private to the host session. Share only `roomId` in invitations and URLs.

## Load or Recover a Room

```http
GET /api/speaking/rooms/:roomId
```

Successful response:

```ts
interface RoomInfoResponse {
  roomId: string;
  status: 'waiting' | 'active';
  hasHost: boolean;
  hasGuest: boolean;
  expiresAt: string;
  topic: SpeakingTopic;
}
```

Use `topic` from this response for a guest's initial render and after a page refresh or reconnect. It is the latest backend-stored topic even if the client missed an earlier event.

## Topic Card

Show the same card to host and guest:

- `title` as the discussion heading.
- `positionA` and `positionB` as the two viewpoints.
- `followUpQuestions` as conversation prompts.

The topic strings are plain text. Render them with the frontend framework's normal text interpolation, not raw HTML.

## Next Topic

Only the host displays or enables the **Next topic** control.

Request:

```ts
socket.emit('shuffle-topic', { roomId });
```

The payload must contain a UUID room ID. The backend verifies both that the socket belongs to the requested room and that its socket ID is the room's current host.

Disable the control after emitting. Re-enable it when `topic-changed` or an error event arrives so rapid clicks do not unintentionally advance through several topics.

Success event sent to both connected participants:

```ts
socket.on('topic-changed', ({ topic }: { topic: SpeakingTopic }) => {
  setTopic(topic);
});
```

Replace the current topic with the event payload. Do not merge fields or generate another topic.

Clean up the exact listener when the room component unmounts:

```ts
useEffect(() => {
  const handleTopicChanged = ({ topic }: { topic: SpeakingTopic }) => {
    setTopic(topic);
    setIsChangingTopic(false);
  };

  socket.on('topic-changed', handleTopicChanged);
  return () => {
    socket.off('topic-changed', handleTopicChanged);
  };
}, [socket]);
```

## Error Events

The topic-change flow uses existing room gateway errors:

- `room-not-found` with `{}`: the room is missing or ended.
- `unauthorized` with `{}`: the sender is not the connected host of that room.

On either event, clear the pending state. Follow the existing application behavior for leaving a missing room or displaying authorization errors.

## Required UI Pieces

1. A create-screen level selector that supplies `B1`.
2. A reusable topic card visible to both roles.
3. A host-only **Next topic** control with a pending state.

## Two-Client Verification

1. Host creates a B1 room and renders the returned topic.
2. Guest loads room info and renders the same topic ID.
3. Host and guest connect to the speaking-room namespace.
4. Host selects **Next topic**.
5. Both clients receive the same `topic-changed.topic.id` and update once.
6. Guest refreshes and room info returns that new ID.
7. Guest attempts `shuffle-topic`; backend emits `unauthorized` and neither topic changes.
