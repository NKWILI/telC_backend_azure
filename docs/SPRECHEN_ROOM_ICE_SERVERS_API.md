# API Contract — Sprechen Room ICE Servers (STUN/TURN)

**Status:** ✅ Live in production
**Owner:** Backend (telC NestJS / Azure)
**Audience:** Frontend (Flutter `lib/features/speaking_peer/`)

This endpoint provides the WebRTC `iceServers` list (STUN + **ephemeral** TURN
credentials) needed for the peer-to-peer speaking call to connect across NAT /
4G / corporate firewalls. It replaces the hard-coded `defaultIceServers` once
wired (frontend decision **B6**).

---

## 1. Endpoint

```
GET /api/speaking/rooms/ice-servers
```

| | |
|---|---|
| **Method** | `GET` |
| **Auth** | **Required** — `Authorization: Bearer <JWT>` |
| **Token types** | Any valid access token, **including guest / "Mode démo" tokens** (`POST /api/auth/guest`) |
| **Body** | none |
| **Content-Type (response)** | `application/json` |

**Base URL (prod):**
`https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net`

---

## 2. Success response — `200 OK`

```jsonc
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "stun:stun1.l.google.com:19302" },
    {
      "urls": "turn:64.226.72.102:3478?transport=udp",
      "username": "1781632615:6eec2a8d-6cc7-495b-952a-178dd9dcbb31",
      "credential": "qYi0mDQR84ukX5NWSaub7XLaKo8=",
      "credentialType": "password"
    },
    {
      "urls": "turn:64.226.72.102:3478?transport=tcp",
      "username": "1781632615:6eec2a8d-6cc7-495b-952a-178dd9dcbb31",
      "credential": "qYi0mDQR84ukX5NWSaub7XLaKo8=",
      "credentialType": "password"
    }
  ],
  "ttlSeconds": 3600
}
```

### Schema

| Field | Type | Notes |
|---|---|---|
| `iceServers` | `IceServer[]` | Pass **directly** into `RTCPeerConnection({ iceServers })` |
| `iceServers[].urls` | `string` | A `stun:` or `turn:` URI. Order: STUN first, then TURN. |
| `iceServers[].username` | `string?` | Present on **TURN** entries only. Ephemeral. |
| `iceServers[].credential` | `string?` | Present on **TURN** entries only. Ephemeral. |
| `iceServers[].credentialType` | `string?` | `"password"` on TURN entries. |
| `ttlSeconds` | `number` | Seconds until the TURN credentials expire (currently `3600`). |

> The `username`/`credential` are the **same** across all TURN entries in one
> response (one credential, multiple transports). Both `udp` and `tcp` TURN URIs
> are returned; the browser picks what works.

---

## 3. STUN-only fallback

If TURN is temporarily disabled server-side (maintenance / config), the response
still returns `200` but with **STUN entries only** (no `turn:` items):

```jsonc
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "stun:stun1.l.google.com:19302" }
  ],
  "ttlSeconds": 3600
}
```

The frontend should treat this as valid and just use STUN — calls will still
connect on permissive networks. **Always render/use whatever `iceServers` is
returned; never assume TURN entries are present.**

---

## 4. Error responses

| Status | When | Body |
|---|---|---|
| `401 Unauthorized` | Missing/invalid/expired `Authorization` header | `{ "statusCode": 401, "message": "INVALID_ACCESS_TOKEN" }` |

(No 403 here — unlike `POST /api/speaking/evaluate`, this route does **not**
block guests. Demo sessions can fetch ICE servers.)

---

## 5. Frontend integration (what to do)

1. **Fetch before creating the peer connection.** Call `GET /ice-servers` with
   the current JWT, then pass `response.iceServers` into the `RTCPeerConnection`
   config — replacing the hard-coded `defaultIceServers`.

   ```dart
   final res = await api.get(ApiEndpoints.speakingRoomIceServers); // already defined
   _peerConnection = await createPeerConnection({
     'iceServers': res['iceServers'],
     'sdpSemantics': 'unified-plan',
     'iceCandidatePoolSize': 4,
   });
   ```

2. **Fallback to STUN on failure.** If the request errors (network/401/timeout),
   fall back to the existing `SpeakingPeerWebRtcConfig.defaultIceServers` so the
   call can still attempt to connect.

3. **Refresh before expiry.** Credentials expire after `ttlSeconds` (3600s = 1h).
   For calls longer than that, re-fetch and apply new servers before expiry.
   (For typical exam practice calls this rarely matters, but a long-lived room
   should refresh.)

4. **Do not log `username`/`credential` in production.** They're short-lived but
   still credentials.

---

## 6. How to verify (curl)

```bash
BASE=https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net

# 1) get a demo/guest token
TOKEN=$(curl -s -X POST "$BASE/api/auth/guest" | jq -r .accessToken)

# 2) fetch ICE servers
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/speaking/rooms/ice-servers" | jq
```

Expected: `iceServers` containing `stun:` and `turn:64.226.72.102:...` entries,
plus `ttlSeconds: 3600`.

---

## 7. Where this fits in the call flow

```
Host:  POST /api/speaking/rooms                  → roomId, hostToken
Host:  GET  /api/speaking/rooms/ice-servers      → iceServers   ◄── THIS DOC
Host:  new RTCPeerConnection({ iceServers })
Host:  WS join-room (hostToken) → guest-joined → offer ...
Guest: GET /api/speaking/rooms/ice-servers       → iceServers   ◄── THIS DOC
Guest: new RTCPeerConnection({ iceServers })
Guest: WS join-room → answer + ICE ...
       → media relays via TURN (64.226.72.102) when direct/STUN fails
```

Both peers fetch their own `iceServers` before building their peer connection.

---

## 8. Notes / limits (current)

- **TURN transport:** `udp` + `tcp` on port `3478` (plain). TLS `turns:` on
  443/5349 is **not yet** offered — strict firewalls that block UDP *and* TCP
  3478 may still fail until TLS hardening is added (backend Phase G).
- **TURN server:** single coturn instance (DigitalOcean, Frankfurt).
- **Bandwidth:** only **relayed** calls use the TURN server; direct/STUN calls
  don't. Audio-only keeps relay usage minimal.
