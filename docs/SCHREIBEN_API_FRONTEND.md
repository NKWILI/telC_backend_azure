# Schreiben (Writing) Module — API for Frontend Testing

**Backend base URL (Azure):**  
`https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net`

**Content-Type:** `application/json`  
**All Schreiben endpoints require:** `Authorization: Bearer <accessToken>`

---

## 1. Getting an access token (for testing)

To call the Schreiben API you need a valid JWT. Use one of these:

### Option A — First-time activation

**POST** `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/auth/activate`

Body (use an **available** activation code from your DB):

```json
{
  "activationCode": "TELC-TEST-001",
  "deviceId": "test-device-flutter",
  "firstName": "Test",
  "lastName": "User",
  "email": "test@example.com"
}
```

Response (201): `accessToken`, `refreshToken`, `student`, `bootstrap`. Use **accessToken** in the header below.

### Option B — Returning user (already claimed code)

**POST** `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/auth/login-with-code`

Body (use an **active** activation code):

```json
{
  "activationCode": "J9R5-K3PZ-N4TG",
  "deviceId": "test-device-flutter"
}
```

Response (201): same as activate. Use **accessToken** for Schreiben requests.

---

## 2. Schreiben (Writing) endpoints

Base path: `/api/writing`  
Full base: `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/writing`

**Header for all requests:**  
`Authorization: Bearer <accessToken>`

---

### 2.1 GET — List exercise types (Teile)

**Request:**

```
GET https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/writing/teils
Authorization: Bearer <accessToken>
```

**Response (200):** JSON array of exercise types (camelCase).

| Field             | Type   | Description                    |
|-------------------|--------|--------------------------------|
| id                | string | e.g. `"1"`, `"2"`              |
| title             | string | e.g. `"E-Mail"`, `"Beitrag"`   |
| subtitle          | string | Optional                       |
| prompt            | string | Optional                       |
| imagePath         | string | Optional                       |
| progress          | number | 0–100 (0 or 100 currently)     |
| part              | number | 1 or 2                         |
| durationMinutes   | number | e.g. 15, 20                    |

**Example:**

```json
[
  {
    "id": "1",
    "title": "E-Mail",
    "subtitle": "Formelle E-Mail schreiben",
    "prompt": "Schreiben Sie eine E-Mail an...",
    "imagePath": "",
    "progress": 0,
    "part": 1,
    "durationMinutes": 15
  },
  {
    "id": "2",
    "title": "Beitrag",
    "subtitle": "Forumsbeitrag",
    "prompt": "Schreiben Sie einen Beitrag...",
    "imagePath": "",
    "progress": 0,
    "part": 2,
    "durationMinutes": 20
  }
]
```

---

### 2.2 GET — List past attempts (sessions)

**Request:**

```
GET https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/writing/sessions
Authorization: Bearer <accessToken>
```

Optional query: `teilNumber` (integer) to filter by exercise type.

```
GET .../api/writing/sessions?teilNumber=1
```

**Response (200):** JSON array of attempts (camelCase).

| Field           | Type   | Description              |
|-----------------|--------|--------------------------|
| id              | string | Attempt UUID             |
| date            | string | ISO 8601 (optional)      |
| dateLabel       | string | e.g. "Heute", "Gestern"  |
| score           | number | 0–100 (optional)         |
| feedback        | string | Optional                 |
| durationSeconds | number | Optional                 |

**Example:**

```json
[
  {
    "id": "attempt-uuid-1",
    "date": "2026-03-04T10:00:00.000Z",
    "dateLabel": "Heute",
    "score": 78,
    "feedback": "Gute Struktur.",
    "durationSeconds": 420
  }
]
```

---

### 2.3 POST — Submit writing

**Request:**

```
POST https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/writing/submit
Authorization: Bearer <accessToken>
Content-Type: application/json
```

**Body:**

```json
{
  "exerciseId": "1",
  "content": "Sehr geehrte Damen und Herren,\n\nich schreibe Ihnen bezüglich..."
}
```

| Field       | Type   | Required | Description                          |
|------------|--------|----------|--------------------------------------|
| exerciseId | string | Yes      | Same as teils `id`, e.g. `"1"` or `"2"` |
| content    | string | Yes      | Non-empty text                       |

**Response (201):**

```json
{
  "attemptId": "uuid-of-new-attempt",
  "status": "pending",
  "message": "Submission received. Correction in progress."
}
```

**Errors:**

| Status | Meaning / messageKey                    |
|--------|----------------------------------------|
| 400    | Validation (missing exerciseId/content) |
| 401    | Invalid or missing token                |
| 404    | Exercise not found (`writingExerciseNotFound`) |
| 422    | Content empty or invalid (`writingContentTooShort`, `writingSubmitFailed`) |
| 429    | Rate limit (too many submissions)      |

---

## 3. Quick test flow (Schreiben only)

1. Get token: **POST** `/api/auth/activate` or `/api/auth/login-with-code` with a valid activation code and deviceId.
2. List teils: **GET** `/api/writing/teils` with `Authorization: Bearer <accessToken>`.
3. List history: **GET** `/api/writing/sessions` (optional: `?teilNumber=1`).
4. Submit: **POST** `/api/writing/submit` with `exerciseId: "1"` and `content: "..."`.

---

## 4. Activation code (reminder)

- **First-time:** Use an **available** code → `/api/auth/activate` (with firstName, lastName, email, deviceId). Code must match DB exactly (case-sensitive, e.g. `TELC-TEST-001`).
- **Returning:** Use an **active** code → `/api/auth/login-with-code` (activationCode, deviceId). If 403 `MEMBERSHIP_EXPIRED`, the code has expired.

---

## 5. Full URLs summary

| Method | URL |
|--------|-----|
| POST (auth) | `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/auth/activate` |
| POST (auth) | `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/auth/login-with-code` |
| GET (Schreiben) | `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/writing/teils` |
| GET (Schreiben) | `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/writing/sessions` |
| POST (Schreiben) | `https://telc-speaking-api-bvftfmarf9e8cwfb.germanywestcentral-01.azurewebsites.net/api/writing/submit` |
