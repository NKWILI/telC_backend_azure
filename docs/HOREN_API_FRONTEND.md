# Hören (Listening) Module — API for Frontend Testing

**Backend base URL (Azure):**  
`https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net`

**Content-Type:** `application/json`  
**All Hören endpoints require:** `Authorization: Bearer <accessToken>`

---

## 1. Getting an access token (for testing)

Same flow as Schreiben — see `SCHREIBEN_API_FRONTEND.md §1`.

### Option A — First-time activation

**POST** `.../api/auth/activate`

```json
{
  "activationCode": "TELC-TEST-001",
  "deviceId": "test-device-flutter",
  "firstName": "Test",
  "lastName": "User",
  "email": "test@example.com"
}
```

### Option B — Returning user

**POST** `.../api/auth/login-with-code`

```json
{
  "activationCode": "J9R5-K3PZ-N4TG",
  "deviceId": "test-device-flutter"
}
```

Response (201): use the **accessToken** field for all Hören requests.

---

## 2. Hören endpoints

Base path: `/api/listening`  
Full base: `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/listening`

**Header for all requests:**  
`Authorization: Bearer <accessToken>`

---

### 2.1 GET — List exercise types (Teile)

```
GET /api/listening/teils
Authorization: Bearer <accessToken>
```

**Response (200):** JSON array — 3 items, one per Hören Teil.

| Field           | Type   | Description                         |
|-----------------|--------|-------------------------------------|
| id              | string | `"1"`, `"2"`, or `"3"`              |
| title           | string | `"Teil 1"`, `"Teil 2"`, `"Teil 3"`  |
| subtitle        | string | Exercise type label                 |
| prompt          | string | Short instruction                   |
| imagePath       | string | Always `""` (no image currently)    |
| progress        | number | `0` or `100` (100 = at least one completed attempt) |
| part            | number | `1`, `2`, or `3`                    |
| durationMinutes | number | `10` for all Teile                  |

**Example:**

```json
[
  {
    "id": "1",
    "title": "Teil 1",
    "subtitle": "Globales Hören",
    "prompt": "Sie hören einen kurzen Text. Wählen Sie die richtige Antwort.",
    "imagePath": "",
    "progress": 0,
    "part": 1,
    "durationMinutes": 10
  },
  {
    "id": "2",
    "title": "Teil 2",
    "subtitle": "Detailliertes Hören",
    "prompt": "Sie hören ein Gespräch. Beantworten Sie die Fragen.",
    "imagePath": "",
    "progress": 100,
    "part": 2,
    "durationMinutes": 10
  },
  {
    "id": "3",
    "title": "Teil 3",
    "subtitle": "Selektives Hören",
    "prompt": "Sie hören Durchsagen. Notieren Sie die wichtigsten Informationen.",
    "imagePath": "",
    "progress": 0,
    "part": 3,
    "durationMinutes": 10
  }
]
```

---

### 2.2 GET — List past attempts (sessions)

```
GET /api/listening/sessions
Authorization: Bearer <accessToken>
```

Optional query param `teilNumber` (integer) to filter by Teil:

```
GET /api/listening/sessions?teilNumber=1
```

**Response (200):** JSON array of attempts (camelCase). Empty array `[]` if no attempts yet.

| Field           | Type   | Description                                   |
|-----------------|--------|-----------------------------------------------|
| id              | string | Attempt UUID                                  |
| date            | string | ISO 8601 timestamp (optional)                 |
| dateLabel       | string | `"Heute"`, `"Gestern"`, or `"dd.mm.yyyy"`     |
| score           | number | 0–100 (optional)                              |
| feedback        | string | Optional (null for auto-scored attempts)      |
| durationSeconds | number | Optional                                      |

**Example:**

```json
[
  {
    "id": "3f1a2b4c-0000-0000-0000-000000000001",
    "date": "2026-04-06T09:15:00.000Z",
    "dateLabel": "Heute",
    "score": 80,
    "durationSeconds": null
  }
]
```

---

### 2.3 GET — Fetch exercise (audio + questions)

```
GET /api/listening/exercise?type=1
Authorization: Bearer <accessToken>
```

**Query param:**

| Param | Type   | Required | Description                        |
|-------|--------|----------|------------------------------------|
| type  | string | Yes      | Teil id — `"1"`, `"2"`, or `"3"`  |

**Response (200):**

| Field                | Type   | Description                                                                 |
|----------------------|--------|-----------------------------------------------------------------------------|
| content_revision     | string | Version string — cache-bust key for the Flutter client                      |
| issued_at            | string | ISO 8601 timestamp of when the response was generated                       |
| audio_url            | string | HTTPS URL of the audio file. Currently `""` (audio is bundled in the app)   |
| bundled_audio_asset  | string | Path relative to Flutter `assets/` folder. Used when `audio_url` is empty   |
| questions            | array  | List of multiple-choice questions (see below)                               |

**`questions[]` object:**

| Field   | Type   | Description                   |
|---------|--------|-------------------------------|
| id      | string | Stable question id, e.g. `"q11"` |
| prompt  | string | Question text (German)        |
| options | array  | 3 answer options (see below)  |

**`options[]` object:**

| Field | Type   | Description                         |
|-------|--------|-------------------------------------|
| id    | string | Option id: `"a"`, `"b"`, or `"c"`  |
| label | string | Answer text (German)                |

**Example (type=1):**

```json
{
  "content_revision": "mock-horen-teil-1-v1",
  "issued_at": "2026-04-06T09:00:00.000Z",
  "audio_url": "",
  "bundled_audio_asset": "images/modules/Telc - A1.mp3",
  "questions": [
    {
      "id": "q11",
      "prompt": "Wo findet das Gespräch statt?",
      "options": [
        { "id": "a", "label": "Im Supermarkt" },
        { "id": "b", "label": "Im Bahnhof" },
        { "id": "c", "label": "In der Schule" }
      ]
    },
    {
      "id": "q12",
      "prompt": "Was möchte die Frau kaufen?",
      "options": [
        { "id": "a", "label": "Einen Fahrschein" },
        { "id": "b", "label": "Ein Buch" },
        { "id": "c", "label": "Lebensmittel" }
      ]
    }
  ]
}
```

**Errors:**

| Status | Description                              |
|--------|------------------------------------------|
| 401    | Invalid or missing token                 |
| 404    | Unknown `type` (not `"1"`, `"2"`, `"3"`) |

> **Important for caching:** The Flutter client must compare `content_revision` with the locally cached value. If it differs, re-download the audio and re-render the questions. Always send the same `content_revision` back in the submit call.

---

### 2.4 POST — Submit answers

```
POST /api/listening/submit
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Body:**

| Field            | Type    | Required | Description                                                             |
|------------------|---------|----------|-------------------------------------------------------------------------|
| type             | string  | Yes      | Teil id — same as `type` used in GET exercise                           |
| timed            | boolean | Yes      | `true` = exam mode, `false` = practice mode                             |
| content_revision | string  | Yes      | Must match the `content_revision` from GET exercise                     |
| answers          | object  | Yes      | Map of `question.id → option.id`. At least one entry required.          |

**Example:**

```json
{
  "type": "1",
  "timed": true,
  "content_revision": "mock-horen-teil-1-v1",
  "answers": {
    "q11": "b",
    "q12": "a",
    "q13": "c",
    "q14": "b",
    "q15": "a"
  }
}
```

**Response (200):**

```json
{
  "score": 100
}
```

| Field | Type   | Description                        |
|-------|--------|------------------------------------|
| score | number | 0–100. Percentage of correct answers, rounded to nearest integer. |

**Errors:**

| Status | messageKey                  | Meaning                                                        |
|--------|-----------------------------|----------------------------------------------------------------|
| 400    | —                           | Validation failed (missing field, wrong type)                  |
| 401    | —                           | Invalid or missing token                                       |
| 422    | `listeningUnknownType`      | `type` is not `"1"`, `"2"`, or `"3"`                          |
| 422    | `listeningStaleRevision`    | `content_revision` doesn't match — reload the exercise first  |
| 422    | `listeningEmptyAnswers`     | `answers` object is empty                                      |

> **Note:** Even if the DB insert fails (e.g. network error), the score is still returned. The attempt may not appear in sessions history in that case, but the user sees their result.

---

## 3. Content revisions (current values)

| Teil | content_revision          |
|------|---------------------------|
| 1    | `mock-horen-teil-1-v1`    |
| 2    | `mock-horen-teil-2-v1`    |
| 3    | `mock-horen-teil-3-v1`    |

These values are fixed until the exercise catalog is updated. When they change, update your local cache.

---

## 4. Quick test flow (Hören only)

1. **Get token** — POST `/api/auth/activate` or `/api/auth/login-with-code`
2. **List Teile** — GET `/api/listening/teils` → note the `id` values (`"1"`, `"2"`, `"3"`)
3. **Fetch exercise** — GET `/api/listening/exercise?type=1` → note `content_revision` and question ids
4. **Submit answers** — POST `/api/listening/submit` with the `content_revision` and an `answers` map
5. **Check history** — GET `/api/listening/sessions` → new attempt appears with the returned score

---

## 5. Full URLs summary

| Method | URL                                                                                                           |
|--------|---------------------------------------------------------------------------------------------------------------|
| GET    | `.../api/listening/teils`                                                                                     |
| GET    | `.../api/listening/sessions`                                                                                  |
| GET    | `.../api/listening/sessions?teilNumber=1`                                                                     |
| GET    | `.../api/listening/exercise?type=1`                                                                           |
| POST   | `.../api/listening/submit`                                                                                    |

Full base: `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net`
