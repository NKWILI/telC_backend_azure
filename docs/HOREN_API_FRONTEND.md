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
| imagePath       | string | URL of the Teil image (Cloudflare R2) |
| progress        | number | `0` or `100` (100 = at least one completed attempt) |
| part            | number | `1`, `2`, or `3`                    |
| durationMinutes | number | `10` for all Teile                  |

**Example:**

```json
[
  {
    "id": "1",
    "title": "Teil 1",
    "subtitle": "Hörverstehen, Teil 1",
    "prompt": "Sie hören die Aussagen von fünf Personen...",
    "imagePath": "https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil1.png",
    "progress": 0,
    "part": 1,
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
| feedback        | string | Optional                                      |
| durationSeconds | number | Optional                                      |

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

| Field                | Type   | Description                                                              |
|----------------------|--------|--------------------------------------------------------------------------|
| content_revision     | string | Version string — cache-bust key; send this back unchanged in submit      |
| issued_at            | string | ISO 8601 timestamp of when the response was generated                    |
| audio_url            | string | HTTPS URL of the audio file (`""` = use bundled asset)                   |
| bundled_audio_asset  | string | Path relative to Flutter `assets/` folder                               |
| imagePath            | string | URL of the Teil image (Cloudflare R2)                                    |
| questions            | array  | List of richtig/falsch statements (see below)                            |

**`questions[]` object — richtig (+) / falsch (−) format:**

| Field   | Type   | Description                      |
|---------|--------|----------------------------------|
| id      | string | Stable question id, e.g. `"q41"` |
| prompt  | string | Statement text (German)          |

> **No `options` array.** The student answers each statement with `"+"` (richtig) or `"-"` (falsch).

**Example (type=1):**

```json
{
  "content_revision": "modelltest-1-teil-1-v1",
  "issued_at": "2026-06-04T09:00:00.000Z",
  "audio_url": "",
  "bundled_audio_asset": "",
  "imagePath": "https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil1.png",
  "questions": [
    { "id": "q41", "prompt": "Für Manfred Rienke ist das Fortbildungsangebot wichtig." },
    { "id": "q42", "prompt": "Alena Groll bildet sich regelmäßig weiter." },
    { "id": "q43", "prompt": "Weng Wang stellt vor dem Seminar viele Fragen an die Seminarleitung." },
    { "id": "q44", "prompt": "Maria Vallomäinen erklärt, wie Fortbildungsveranstaltungen entstehen." },
    { "id": "q45", "prompt": "Manus Mani lehnt Fortbildungen ab, weil dann seine eigene Arbeit liegen bleibt." }
  ]
}
```

**Errors:**

| Status | Description                               |
|--------|-------------------------------------------|
| 401    | Invalid or missing token                  |
| 404    | Unknown `type` (not `"1"`, `"2"`, `"3"`) |

---

### 2.4 POST — Submit answers

```
POST /api/listening/submit
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Body:**

| Field            | Type    | Required | Description                                                              |
|------------------|---------|----------|--------------------------------------------------------------------------|
| type             | string  | Yes      | Teil id — same as `type` used in GET exercise                            |
| timed            | boolean | Yes      | `true` = exam mode, `false` = practice mode                              |
| content_revision | string  | Yes      | Must match the `content_revision` from GET exercise                      |
| answers          | object  | Yes      | Map of `question.id → "+" or "-"`. At least one entry required.          |

**Example:**

```json
{
  "type": "1",
  "timed": false,
  "content_revision": "modelltest-1-teil-1-v1",
  "answers": {
    "q41": "-",
    "q42": "+",
    "q43": "+",
    "q44": "+",
    "q45": "-"
  }
}
```

**Response (200):**

| Field     | Type   | Description                                                               |
|-----------|--------|---------------------------------------------------------------------------|
| answerKey | object | Map of `question.id → "+" or "-"` — the correct answer for each question |

```json
{
  "answerKey": {
    "q41": "-",
    "q42": "+",
    "q43": "-",
    "q44": "+",
    "q45": "+"
  }
}
```

> **Score is computed frontend-side.** The frontend already holds the student's answers. Compare `answers[qId]` with `answerKey[qId]` to determine `isCorrect` per question, then compute `score = correct / total * 100`.

**Errors:**

| Status | messageKey                  | Meaning                                                        |
|--------|-----------------------------|----------------------------------------------------------------|
| 400    | —                           | Validation failed (missing field, wrong type)                  |
| 401    | —                           | Invalid or missing token                                       |
| 422    | `listeningUnknownType`      | `type` is not `"1"`, `"2"`, or `"3"`                          |
| 422    | `listeningStaleRevision`    | `content_revision` doesn't match — reload the exercise first  |
| 422    | `listeningEmptyAnswers`     | `answers` object is empty                                      |

---

## 3. Content revisions (current values — Modelltest 1)

| Teil | content_revision              | Questions  |
|------|-------------------------------|------------|
| 1    | `modelltest-1-teil-1-v1`      | q41–q45    |
| 2    | `modelltest-1-teil-2-v1`      | q46–q55    |
| 3    | `modelltest-1-teil-3-v1`      | q56–q60    |

---

## 4. Quick test flow (Hören only)

1. **Get token** — POST `/api/auth/activate` or `/api/auth/login-with-code`
2. **List Teile** — GET `/api/listening/teils` → note `id`, `imagePath` values
3. **Fetch exercise** — GET `/api/listening/exercise?type=1` → note `content_revision` and question ids
4. **Submit answers** — POST `/api/listening/submit` with `content_revision` and `answers` map (`"+"` or `"-"` per question)
5. **Use answerKey** — compare returned `answerKey` against submitted `answers` to compute per-question verdicts
6. **Check history** — GET `/api/listening/sessions` → new attempt appears with the stored score

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
