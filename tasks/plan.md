# Plan — Lesen Teil 1 Module

**Date:** 2026-04-22  
**Feature:** Extend `GET /api/lesen/exercise` to include `teil1` (matching exercise)  
**Source:** Developer roadmap + Modelltest 1 pp. 8–9, Lösungen p. 81

---

## Context

Already in place:
- `LesenService.getTeil2Exercise()` + `GET /api/lesen/exercise` returning `{ contentRevision, issuedAt, teil2 }`
- `LesenExerciseResponseDto` — needs `teil1` added alongside `teil2`
- **No new module** — everything extends `src/modules/lesen/`

Key differences from Teil 2:
- **Matching exercise** (drag-drop), not MCQ — no questions/options table
- Two lists: 5 emails (`LesenTeil1Text`) + 10 titles (`LesenTeil1Title`)
- `correctTitleId` lives on the text row as a FK → title (no separate match table)
- `von` and `an` are **nullable** — email 2 has neither
- Title IDs in the response are raw UUIDs (not derived letters) — the frontend matches `text.correctTitleId` against `title.id`
- The frontend derives a–j labels from array position (`sortOrder`), not from the API

---

## Dependency Graph

```
[A] Add 3 Prisma models (LesenTeil1Exercise, LesenTeil1Text, LesenTeil1Title)
         ↓
[B] Run prisma migrate dev --name lesen_teil1_schema
         ↓
[C] Seed Modelltest 1 Teil 1 (1 exercise, 10 titles, 5 texts)
         ↓ verify: 1 / 10 / 5, each text has non-null correctTitleId
[D] New DTOs (LesenTeil1TitleDto, LesenTeil1TextDto, LesenTeil1Dto)
   + update LesenExerciseResponseDto to add teil1
         ↓
[E] LesenService.getTeil1Exercise()
         ↓
[F] Update controller GET /api/lesen/exercise to merge teil1 + teil2
         ↓
══════ CHECKPOINT 1 ══════
         ↓
[G] Update unit tests (extend existing spec)
         ↓
══════ CHECKPOINT 2 ══════
```

---

## Task 1 — Database: schema, migration, seed

### Prisma models (append to `prisma/schema.prisma`)

```prisma
model LesenTeil1Exercise {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  contentRevision String
  label           String
  instruction     String
  createdAt       DateTime @default(now())

  texts  LesenTeil1Text[]
  titles LesenTeil1Title[]

  @@map("lesen_teil1_exercises")
}

model LesenTeil1Text {
  id             String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  exerciseId     String  @db.Uuid
  textNumber     Int
  von            String?
  an             String?
  body           String
  sortOrder      Int
  correctTitleId String  @db.Uuid

  exercise     LesenTeil1Exercise @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  correctTitle LesenTeil1Title    @relation("CorrectTitle", fields: [correctTitleId], references: [id])

  @@map("lesen_teil1_texts")
}

model LesenTeil1Title {
  id         String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  exerciseId String @db.Uuid
  content    String
  sortOrder  Int

  exercise   LesenTeil1Exercise @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  correctFor LesenTeil1Text[]   @relation("CorrectTitle")

  @@map("lesen_teil1_titles")
}
```

**Migration:**
```bash
npx prisma migrate dev --name lesen_teil1_schema
npx prisma generate
```

**Verify nullable columns** — run after migration:
```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'lesen_teil1_texts' AND column_name IN ('von', 'an');
-- Both should show is_nullable = YES
```

---

### Seed file: `004_seed_lesen_teil1_modelltest1.sql`

**Source:** Modelltest 1, Leseverstehen Teil 1, pp. 8–9  
**Correct answers:** 1g, 2e, 3c, 4a, 5h (verified Lösungen p. 81)

**Hardcoded UUIDs:**
```
Exercise:  eeeeeeee-0001-0001-0001-000000000001

Titles (sort_order → content → correct for which email):
  ffffffff-0001-0001-0001-000000000001  sortOrder 0  Anfrage            ← email 4 (answer a)
  ffffffff-0002-0001-0001-000000000001  sortOrder 1  Lieferschein       ← decoy
  ffffffff-0003-0001-0001-000000000001  sortOrder 2  Reklamation        ← email 3 (answer c)
  ffffffff-0004-0001-0001-000000000001  sortOrder 3  Schadensmeldung    ← decoy
  ffffffff-0005-0001-0001-000000000001  sortOrder 4  Schließregelung    ← email 2 (answer e)
  ffffffff-0006-0001-0001-000000000001  sortOrder 5  Sommerfest         ← decoy
  ffffffff-0007-0001-0001-000000000001  sortOrder 6  Terminabsage       ← email 1 (answer g)
  ffffffff-0008-0001-0001-000000000001  sortOrder 7  Terminverschiebung ← email 5 (answer h)
  ffffffff-0009-0001-0001-000000000001  sortOrder 8  Terminzusage       ← decoy
  ffffffff-0010-0001-0001-000000000001  sortOrder 9  Übernachtung       ← decoy

Texts:
  44444444-0001-0001-0001-000000000001  textNumber 1  correctTitleId → ffffffff-0007 (Terminabsage)
  44444444-0002-0001-0001-000000000001  textNumber 2  correctTitleId → ffffffff-0005 (Schließregelung)
  44444444-0003-0001-0001-000000000001  textNumber 3  correctTitleId → ffffffff-0003 (Reklamation)
  44444444-0004-0001-0001-000000000001  textNumber 4  correctTitleId → ffffffff-0001 (Anfrage)
  44444444-0005-0001-0001-000000000001  textNumber 5  correctTitleId → ffffffff-0008 (Terminverschiebung)
```

**Complete seed SQL** (camelCase column names quoted, matching what Prisma generated):

```sql
BEGIN;

-- 1. Exercise
INSERT INTO lesen_teil1_exercises (id, "contentRevision", label, instruction)
VALUES (
    'eeeeeeee-0001-0001-0001-000000000001',
    'modelltest-1-lesen-teil1-v1',
    'Leseverstehen, Teil 1',
    'Lesen Sie die folgenden fünf Texte. Es fehlt jeweils der Betreff. Entscheiden Sie, welcher Betreff (a–j) am besten zu welcher Betreffzeile (1–5) passt. Tragen Sie Ihre Lösungen für die Aufgaben 1–5 in den Antwortbogen ein.'
);

-- 2. Titles (must come before texts due to FK)
INSERT INTO lesen_teil1_titles (id, "exerciseId", content, "sortOrder") VALUES
    ('ffffffff-0001-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Anfrage',             0),
    ('ffffffff-0002-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Lieferschein',        1),
    ('ffffffff-0003-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Reklamation',         2),
    ('ffffffff-0004-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Schadensmeldung',     3),
    ('ffffffff-0005-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Schließregelung',     4),
    ('ffffffff-0006-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Sommerfest',          5),
    ('ffffffff-0007-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Terminabsage',        6),
    ('ffffffff-0008-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Terminverschiebung',  7),
    ('ffffffff-0009-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Terminzusage',        8),
    ('ffffffff-0010-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Übernachtung',        9);

-- 3. Texts (titles must already exist for FK on correctTitleId)

-- Email 1 — correct: Terminabsage (ffffffff-0007)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0001-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    1,
    'r.fazli@grb.com',
    'v.gruedle@grb.com',
    'Hallo Frau Grüdle,
leider kann ich nicht an der Dienstbesprechung am nächsten
Donnerstag teilnehmen. Wie wir bereits vor Längerem besprochen
haben, habe ich mich zur Trainingsreihe „Personalführung"
angemeldet. Als ich mich anmelden wollte, kam ich nur auf die
Warteliste. Eben hat mich der Veranstalter angerufen, dass ein
Platz krankheitsbedingt frei geworden ist. Weil die nächste Reihe
erst in einem halben Jahr beginnt, möchte ich meine Teilnahme an
der Dienstbesprechung absagen.
Vielen Dank für Ihr Verständnis!
Herzlichen Gruß
Ramik Fazli',
    0,
    'ffffffff-0007-0001-0001-000000000001'
);

-- Email 2 — correct: Schließregelung (ffffffff-0005) — von/an are NULL
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0002-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    2,
    NULL,
    NULL,
    'Liebe Kolleginnen und Kollegen,
der Sicherheitsdienst hat mich informiert, dass die Eingangstüre
bei der Routinekontrolle am vergangenen Samstag nicht richtig
verschlossen war. Man konnte zwar nicht ins Gebäude gelangen,
dennoch stand auf dem Display nicht „Verschlossen". Wir hoffen,
dass nichts Schlimmes passiert ist, aber im Schadensfall würde die
Versicherung nichts bezahlen. Bitte achten Sie daher beim Verlassen
des Gebäudes freitags nach 16:00 Uhr darauf, dass das digitale
Display neben der Tür „Verschlossen" anzeigt.
Vielen Dank für Ihre Unterstützung!
gez. Postmann
Verwaltungsleitung',
    1,
    'ffffffff-0005-0001-0001-000000000001'
);

-- Email 3 — correct: Reklamation (ffffffff-0003)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0003-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    3,
    'rene.gallack@fa-rzw.de',
    'stephan.gerke@werbeagentur.net',
    'Sehr geehrter Herr Gerke,
vielen Dank für Ihre schnelle Lieferung. Wir haben 4.000 Stück
Werbebroschüren für unser neuestes Produkt bestellt. Allerdings
haben Sie 500 Stück weniger geliefert. Aber auf dem Lieferschein
steht die bestellte Menge.
Wir hoffen, dass es sich um ein Versehen handelt und erwarten in
Kürze Ihre Nachlieferung.
Mit freundlichen Grüßen
René Gallack',
    2,
    'ffffffff-0003-0001-0001-000000000001'
);

-- Email 4 — correct: Anfrage (ffffffff-0001)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0004-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    4,
    'i.villa@kompsit.net',
    'aurum@gaestehaus.com',
    'Sehr geehrte Damen und Herren,
unsere Firma plant für Anfang November eine zweitägige
internationale Tagung zum Thema „Technik und Innovation". Wir
suchen einen großen Konferenzsaal mit der modernsten technischen
Ausstattung. Da wir auch in Gruppen arbeiten werden, benötigen
wir zusätzlich vier kleinere Räume. Ist dies möglich? Natürlich
möchten wir für alle Teilnehmenden das Mittag- und Abendessen
buchen.
Wir erwarten ca. 80 Kunden aus dem In- und Ausland. Daher wäre
es praktisch, wenn diese am Tagungsort auch übernachten könnten.
Hätten Sie genug Einzelzimmer?
Bitte schicken Sie mir Ihre komplette Angebotsliste mit Preisen.
Mit freundlichen Grüßen
Ines Villa',
    3,
    'ffffffff-0001-0001-0001-000000000001'
);

-- Email 5 — correct: Terminverschiebung (ffffffff-0008)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0005-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    5,
    'michaela.rojka@rett-platt.de',
    'nella.weber@rett-platt.de',
    'Hallo Nella,
ich habe gerade in meinem Kalender unser Treffen morgen um 16 Uhr
entdeckt. Wir wollten doch den Aufbau des Seminars zum
interkulturellen Training „Fettnäpfchen in Russland vermeiden"
besprechen. Könnten wir uns auch direkt nach der Mittagspause um
13.30 Uhr zusammensetzen? Danach muss ich nämlich zum Elternabend
in Michas Kindergarten. Das Sommerfest steht an ...
Sag mir kurz Bescheid.
Michaela',
    4,
    'ffffffff-0008-0001-0001-000000000001'
);

COMMIT;
```

**Acceptance criteria:**
- `SELECT COUNT(*) FROM lesen_teil1_exercises` → 1
- `SELECT COUNT(*) FROM lesen_teil1_titles` → 10
- `SELECT COUNT(*) FROM lesen_teil1_texts` → 5
- `SELECT von, an FROM lesen_teil1_texts WHERE "textNumber" = 2` → both NULL
- `SELECT "correctTitleId" FROM lesen_teil1_texts ORDER BY "sortOrder"` → 5 non-null UUIDs

---

## Task 2 — DTOs + service + controller (full vertical slice)

### New DTO files

`src/modules/lesen/dto/lesen-teil1-title.dto.ts`
```typescript
export interface LesenTeil1TitleDto {
  id: string;
  content: string;
}
```

`src/modules/lesen/dto/lesen-teil1-text.dto.ts`
```typescript
export interface LesenTeil1TextDto {
  id: string;
  textNumber: number;
  von: string | null;
  an: string | null;
  body: string;
}
```

`src/modules/lesen/dto/lesen-teil1.dto.ts`
```typescript
export interface LesenTeil1Dto {
  label: string;
  instruction: string;
  texts: LesenTeil1TextDto[];
  titles: LesenTeil1TitleDto[];
  correctMatches: Record<string, string>; // key: textNumber as string, value: title UUID
}
```

### Update existing DTO

`src/modules/lesen/dto/lesen-exercise-response.dto.ts` — add `teil1`:
```typescript
export interface LesenExerciseResponseDto {
  contentRevision: string;
  issuedAt: string;
  teil1: LesenTeil1Dto;
  teil2: LesenTeil2Dto;
}
```

### Service — `getTeil1Exercise()`

Query:
```typescript
prisma.lesenTeil1Exercise.findFirst({
  include: {
    texts:  { orderBy: { sortOrder: 'asc' } },
    titles: { orderBy: { sortOrder: 'asc' } },
  },
})
```

Mapping:
- `texts` → `LesenTeil1TextDto[]`: map `id`, `textNumber`, `von` (may be null), `an` (may be null), `body` (no `correctTitleId` in output)
- `titles` → `LesenTeil1TitleDto[]`: map `id`, `content` only (no `sortOrder` in output)
- `correctMatches` → `Record<string, string>`: built from texts — `{ [text.textNumber]: text.correctTitleId }` for each text
- Throw `NotFoundException` if no exercise

### Controller update

`GET /api/lesen/exercise` calls **both** `getTeil1Exercise()` and `getTeil2Exercise()` in parallel, merges into one response:

```typescript
@Get('exercise')
async getExercise(): Promise<LesenExerciseResponseDto> {
  const [teil1Result, teil2Result] = await Promise.all([
    this.lesenService.getTeil1Exercise(),
    this.lesenService.getTeil2Exercise(),
  ]);
  return {
    contentRevision: teil2Result.contentRevision,
    issuedAt: teil2Result.issuedAt,
    teil1: teil1Result,
    teil2: teil2Result.teil2,
  };
}
```

**Acceptance criteria:**
- `jq '.teil1.texts | length'` → 5
- `jq '.teil1.titles | length'` → 10
- `jq '.teil1.texts[1].von'` → null
- `jq '.teil1.texts[1].an'` → null
- `jq '.teil1.texts[0] | has("correctTitleId")'` → false (field must NOT appear on text objects)
- `jq '.teil1.correctMatches["1"]'` equals `jq '.teil1.titles[] | select(.content == "Terminabsage") | .id'`
- `jq '.teil1.correctMatches | keys | length'` → 5
- `jq '.teil1.titles[0].content'` → "Anfrage"
- `jq '.teil1.titles[9].content'` → "Übernachtung"
- `jq '.teil2.questions | length'` → 5 (Teil 2 still works)
- No `sortOrder` field in titles response

---

## CHECKPOINT 1 — All curl checks pass, `npm run build` exits 0

---

## Task 3 — Extend unit tests

Extend `src/modules/lesen/lesen.service.spec.ts` with:

1. `getTeil1Exercise` — mocked exercise with 10 titles + 5 texts:
   - `teil1.texts` has length 5
   - `teil1.titles` has length 10
   - Text 2 `von` and `an` are null
   - `texts[0]` does NOT have a `correctTitleId` field
   - `correctMatches["1"]` equals the UUID of the title with `content === 'Terminabsage'`
   - `correctMatches` has 5 keys
2. `getTeil1Exercise` — Prisma returns null → throws `NotFoundException`
3. Existing Teil 2 tests must still pass (no regressions)

**Acceptance criteria:**
- `npm test` → all suites green

---

## CHECKPOINT 2 — `npm test` green, `npm run build` clean, commit

---

## File changes summary

```
prisma/schema.prisma                         ← add 3 LesenTeil1* models
prisma/migrations/<ts>_lesen_teil1_schema/   ← auto-generated
004_seed_lesen_teil1_modelltest1.sql         ← new seed file (written below)

src/modules/lesen/dto/
  lesen-teil1-title.dto.ts                   ← new
  lesen-teil1-text.dto.ts                    ← new
  lesen-teil1.dto.ts                         ← new
  lesen-exercise-response.dto.ts             ← add teil1 field
  index.ts                                   ← export new DTOs

src/modules/lesen/lesen.service.ts           ← add getTeil1Exercise()
src/modules/lesen/lesen.controller.ts        ← update GET to merge both Teile
src/modules/lesen/lesen.service.spec.ts      ← extend with Teil 1 tests
```

---

## Assumptions

1. `correctMatches` at the `teil1` level is a map `{ textNumber: titleId }`. The frontend matches each key (text number as string) to the corresponding title UUID from the `titles` array. `correctTitleId` does NOT appear on individual text objects.
2. `von` and `an` serialize as JSON `null`, not empty string — TypeScript `string | null`.
3. `sortOrder` is NOT in the titles response — the frontend derives a–j from array position.
4. The merged GET endpoint uses `teil2Result.contentRevision` as the top-level `contentRevision` (backward compatible with existing clients).
5. Seed INSERT order matters: exercise → titles → texts (FK constraint on `correctTitleId`).
