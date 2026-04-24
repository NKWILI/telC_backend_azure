# Plan — Sprachbausteine Teil 2 Module

**Date:** 2026-04-24
**Source:** Mit Erfolg zu telc Deutsch B1+ Beruf, Klett 2015, p. 15 (exercise), p. 81 (answers)

---

## What we are building

`GET /api/sprachbausteine/exercise` currently returns `teil1` (real data) and `teil2` (empty stub).
This plan replaces the stub with a real Teil 2 response.

Teil 2 is a **word-bank cloze exercise** — fundamentally different from Teil 1:
- One shared pool of **15 words** (letters a–o) for all 10 gaps
- Each word fits exactly once ("Jedes Wort passt nur einmal")
- 5 words are always decoys
- Gaps (31–40) have no per-gap options — only a `correctWordId`
- The word bank lives at the `teil2` root, not at gap level

Correct answers (Modelltest 1, Lösungen p. 81):
`31a  32m  33d  34c  35o  36n  37g  38e  39h  40l`

---

## Architecture decisions

| Decision | Rationale |
|---|---|
| 3 new models (`SprachbausteineTeil2Exercise`, `SprachbausteineTeil2Word`, `SprachbausteineTeil2Gap`) | Words and gaps are independent entities; combining them would make the correctWordId FK ambiguous |
| `correctWordId` FK on the gap (not on the word) | gap → word is the natural read direction: "for each gap, which word is correct?" |
| Word response `id = "w" + letter` (e.g. `"wa"`) | Distinguishable from gap ids ("31"–"40") and consistent with the contract spec |
| Letter derived from `sortOrder` in service (`String.fromCharCode(97 + sortOrder)`) | Same pattern as `LesenTeil3Announcement` letter derivation — avoids storing a derived value |
| `SprachbausteineTeil2Dto` replaces `SprachbausteineTeilDto` for teil2 | The shared `SprachbausteineTeilDto` (gaps with options) is the wrong shape for Teil 2 |
| `getTeil2Exercise()` added as a separate method on `SprachbausteineService` | Mirrors `LesenService.getTeil3Exercise()` pattern; independently testable |
| No new module or controller | Existing `SprachbausteineController` delegates to service; no structural change needed |
| camelCase field names on new models | Consistent with `LesenTeil2/3` models (newer pattern); contrast with older snake_case `SprachbausteineExercise` |

---

## Response shape (new teil2 contract)

```typescript
// GET /api/sprachbausteine/exercise — teil2
teil2: {
  label:           "",
  instruction:     "Lesen Sie den Text und schließen Sie die Lücken 31–40. ...",
  durationMinutes: 18,
  body:            "...in der WELT habe ich Ihre -31- gefunden...",
  wordBank: [
    { id: "wa", letter: "a", content: "ANZEIGE" },      // gap 31 ✓
    { id: "wb", letter: "b", content: "ARBEIT" },        // decoy
    { id: "wc", letter: "c", content: "AUSBILDUNG" },   // gap 34 ✓
    { id: "wd", letter: "d", content: "BEWERBE" },      // gap 33 ✓
    { id: "we", letter: "e", content: "BERUFLICHEN" },  // gap 38 ✓
    { id: "wf", letter: "f", content: "BESONDEREN" },   // decoy
    { id: "wg", letter: "g", content: "CHANCE" },       // gap 37 ✓
    { id: "wh", letter: "h", content: "ENTNEHMEN" },    // gap 39 ✓
    { id: "wi", letter: "i", content: "KARRIERE" },     // decoy
    { id: "wj", letter: "j", content: "LESEN" },        // decoy
    { id: "wk", letter: "k", content: "NAHM" },         // decoy
    { id: "wl", letter: "l", content: "PERSÖNLICHEN" }, // gap 40 ✓
    { id: "wm", letter: "m", content: "STELLE" },       // gap 32 ✓
    { id: "wn", letter: "n", content: "ÜBERNAHM" },     // gap 36 ✓
    { id: "wo", letter: "o", content: "VERBESSERT" },   // gap 35 ✓
  ],
  gaps: [
    { id: "31", correctWordId: "wa" },
    { id: "32", correctWordId: "wm" },
    { id: "33", correctWordId: "wd" },
    { id: "34", correctWordId: "wc" },
    { id: "35", correctWordId: "wo" },
    { id: "36", correctWordId: "wn" },
    { id: "37", correctWordId: "wg" },
    { id: "38", correctWordId: "we" },
    { id: "39", correctWordId: "wh" },
    { id: "40", correctWordId: "wl" },
  ]
}
```

---

## Dependency graph

```
prisma/schema.prisma (3 new models)
        │
        ├── DB migration (npx prisma migrate dev)
        │         │
        │         └── 006_seed_sprachbausteine_teil2_modelltest1.sql
        │                         │
        │                         └── verified DB state (15 words, 10 gaps, 5 decoys)
        │
        ├── DTOs (3 new files + 2 updates)
        │         │
        │         └── SprachbausteineService.getTeil2Exercise()
        │                         │
        │                         └── SprachbausteineService.getExercise() (wire-up)
        │                                         │
        │                                         └── sprachbausteine.service.spec.ts
```

---

## Phase 1 — Database schema & migration

### Step 1: Add three Prisma models

Add to `prisma/schema.prisma` (after the existing `SprachbausteineGapOption` model):

```prisma
model SprachbausteineTeil2Exercise {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  contentRevision String
  label           String
  instruction     String
  durationMinutes Int
  body            String
  createdAt       DateTime @default(now())

  words SprachbausteineTeil2Word[]
  gaps  SprachbausteineTeil2Gap[]

  @@map("sprachbausteine_teil2_exercises")
}

model SprachbausteineTeil2Word {
  id         String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  exerciseId String @db.Uuid
  letter     String
  content    String
  sortOrder  Int

  exercise SprachbausteineTeil2Exercise @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  gaps     SprachbausteineTeil2Gap[]

  @@map("sprachbausteine_teil2_words")
}

model SprachbausteineTeil2Gap {
  id            String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  exerciseId    String @db.Uuid
  gapKey        String
  gapNumber     Int
  correctWordId String @db.Uuid
  sortOrder     Int

  exercise    SprachbausteineTeil2Exercise @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  correctWord SprachbausteineTeil2Word     @relation(fields: [correctWordId], references: [id], onDelete: Restrict)

  @@unique([exerciseId, gapKey])
  @@map("sprachbausteine_teil2_gaps")
}
```

### Step 2: Run migration

```bash
npx prisma migrate dev --name sprachbausteine_teil2_schema
npx prisma generate
```

### Acceptance criteria — Phase 1

- `npx prisma migrate dev` exits 0
- `npx prisma generate` exits 0
- Three tables exist: `sprachbausteine_teil2_exercises`, `sprachbausteine_teil2_words`, `sprachbausteine_teil2_gaps`
- `correctWordId` column on gaps is NOT NULL (non-nullable FK — every gap must have a correct word)
- `@@unique([exerciseId, gapKey])` constraint on gaps table

### Verification SQL

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE 'sprachbausteine_teil2%';

SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'sprachbausteine_teil2_gaps'
AND column_name IN ('correctWordId', 'gapKey');
```

---

## Phase 2 — Seed data

**File:** `006_seed_sprachbausteine_teil2_modelltest1.sql` (root of project, numbered after 005)
**Source:** Modelltest 1, Sprachbausteine Teil 2, p. 15 (text), p. 81 (answers)

### UUID strategy — DB-generated, no hardcoded values

UUIDs for words and gaps are **not specified in the seed** — the database generates them via
`gen_random_uuid()`. Gaps are linked to words using a subquery on `letter`, not UUID arithmetic.

This eliminates the off-by-one class of bugs entirely: the letter is the source of truth, and a
wrong letter produces an immediate FK/null error rather than a silently wrong answer.

### INSERT order

```
1. sprachbausteine_teil2_exercises  (no FK dependencies)
2. sprachbausteine_teil2_words      (FK → exercise)
3. sprachbausteine_teil2_gaps       (FK → exercise + FK → word)
```

### Seed SQL

The exercise UUID is omitted — `gen_random_uuid()` fires automatically. Words and gaps are also
inserted without UUIDs. Gaps reference words via `(SELECT id … WHERE letter = 'x')` subqueries.
A wrong letter produces `null`, which violates the NOT NULL constraint and fails immediately.

```sql
-- ── 1. Exercise (UUID generated by DB) ──────────────────────
INSERT INTO sprachbausteine_teil2_exercises
  ("contentRevision", label, instruction, "durationMinutes", body)
VALUES (
  'modelltest-1-sprachbausteine-teil2-v1',
  '',
  'Lesen Sie den Text und schließen Sie die Lücken 31–40. Benutzen Sie die Wörter a–o. Jedes Wort passt nur einmal. Markieren Sie Ihre Lösungen für die Aufgaben 31–40 auf dem Antwortbogen.',
  18,
  E'Olga Fedorow\nSichelstr. 11 b\n40625 Düsseldorf\n\nStädtisches Klinikum Solingen gemeinnützige GmbH\nPersonalmanagement\nGotenstraße 1\n42653 Solingen\n\nDüsseldorf, 26. 07. 2015\n\nBewerbung\n\nSehr geehrte Damen und Herren,\n\nin der WELT habe ich Ihre -31- gefunden, die mich sofort interessierte.\nUm die ausgeschriebene -32- der stellvertretenden Pflegedienstleitung -33- ich mich.\n\nIn Russland habe ich meine schulische und berufliche -34- erhalten und drei Jahre praktische\nErfahrungen im Krankenhaus sammeln können. Nach unserer Übersiedlung nach Österreich\nhabe ich meine Sprachkenntnisse -35- und fand im Allgemeinen Krankenhaus der Stadt Wien\neine Anstellung als Stationsschwester. Nach einem Jahr -36- ich die Pflegedienstleitung in der\nGynäkologischen Abteilung.\n\nJetzt hat mein Mann in Düsseldorf eine attraktive Stelle als IT-Systemkoordinator angeboten\nbekommen, und so sind wir kurzentschlossen hierher umgezogen.\nIch möchte diese Veränderung als -37- nutzen, um neue Erfahrungen in leitender Position eines\ngroßen Klinikums zu sammeln.\n\nEinzelheiten meiner Ausbildung und meines -38- Werdegangs können Sie meinem\nLebenslauf und den beigefügten Zeugnissen/Bescheinigungen -39- . Über die Möglichkeit eines\n-40- Gespräches würde ich mich freuen.\n\nMit freundlichen Grüßen\nOlga Fedorow\nAnlagen'
);

-- Capture the generated exercise id for use in words/gaps
-- (wrap in a DO block or use a CTE — see full seed file)

-- ── 2. Words (UUIDs generated by DB) ────────────────────────
-- Insert all 15 words; letter is the stable identifier used by gap subqueries
INSERT INTO sprachbausteine_teil2_words
  ("exerciseId", letter, content, "sortOrder")
SELECT id, unnest(ARRAY['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o']),
           unnest(ARRAY['ANZEIGE','ARBEIT','AUSBILDUNG','BEWERBE','BERUFLICHEN',
                        'BESONDEREN','CHANCE','ENTNEHMEN','KARRIERE','LESEN',
                        'NAHM','PERSÖNLICHEN','STELLE','ÜBERNAHM','VERBESSERT']),
           generate_series(0, 14)
FROM sprachbausteine_teil2_exercises
WHERE "contentRevision" = 'modelltest-1-sprachbausteine-teil2-v1';

-- ── 3. Gaps — linked by letter subquery, not UUID arithmetic ─
-- Correct answers: 31a 32m 33d 34c 35o 36n 37g 38e 39h 40l
INSERT INTO sprachbausteine_teil2_gaps
  ("exerciseId", "gapKey", "gapNumber", "correctWordId", "sortOrder")
SELECT
  e.id,
  g.gap_key,
  g.gap_number,
  (SELECT w.id FROM sprachbausteine_teil2_words w
   WHERE w."exerciseId" = e.id AND w.letter = g.correct_letter),
  g.sort_order
FROM sprachbausteine_teil2_exercises e,
(VALUES
  ('31', 31, 'a', 0),
  ('32', 32, 'm', 1),
  ('33', 33, 'd', 2),
  ('34', 34, 'c', 3),
  ('35', 35, 'o', 4),
  ('36', 36, 'n', 5),
  ('37', 37, 'g', 6),
  ('38', 38, 'e', 7),
  ('39', 39, 'h', 8),
  ('40', 40, 'l', 9)
) AS g(gap_key, gap_number, correct_letter, sort_order)
WHERE e."contentRevision" = 'modelltest-1-sprachbausteine-teil2-v1';
```

### 15 words (sortOrder 0–14, letters a–o)

| sortOrder | letter | content | Used in gap |
|---|---|---|---|
| 0 | a | ANZEIGE | gap 31 ✓ |
| 1 | b | ARBEIT | decoy |
| 2 | c | AUSBILDUNG | gap 34 ✓ |
| 3 | d | BEWERBE | gap 33 ✓ |
| 4 | e | BERUFLICHEN | gap 38 ✓ |
| 5 | f | BESONDEREN | decoy |
| 6 | g | CHANCE | gap 37 ✓ |
| 7 | h | ENTNEHMEN | gap 39 ✓ |
| 8 | i | KARRIERE | decoy |
| 9 | j | LESEN | decoy |
| 10 | k | NAHM | decoy |
| 11 | l | PERSÖNLICHEN | gap 40 ✓ |
| 12 | m | STELLE | gap 32 ✓ |
| 13 | n | ÜBERNAHM | gap 36 ✓ |
| 14 | o | VERBESSERT | gap 35 ✓ |

### Acceptance criteria — Phase 2

- `SELECT COUNT(*) FROM sprachbausteine_teil2_exercises` → 1
- `SELECT COUNT(*) FROM sprachbausteine_teil2_words` → 15
- `SELECT COUNT(*) FROM sprachbausteine_teil2_gaps` → 10
- `SELECT COUNT(*) FROM sprachbausteine_teil2_words w LEFT JOIN sprachbausteine_teil2_gaps g ON g."correctWordId" = w.id WHERE g.id IS NULL` → 5 (the 5 decoys: b, f, i, j, k)
- Verify gap 31 → word ANZEIGE:
  ```sql
  SELECT w.content FROM sprachbausteine_teil2_gaps g
  JOIN sprachbausteine_teil2_words w ON w.id = g."correctWordId"
  WHERE g."gapKey" = '31';
  -- → ANZEIGE
  ```

---

## Phase 3 — DTOs

### New files

**`src/modules/sprachbausteine/dto/sprachbausteine-word-bank-item.dto.ts`**
```typescript
export interface SprachbausteineWordBankItemDto {
  id: string;
  letter: string;
  content: string;
}
```

**`src/modules/sprachbausteine/dto/sprachbausteine-teil2-gap.dto.ts`**
```typescript
export interface SprachbausteineTeil2GapDto {
  id: string;
  correctWordId: string;
}
```

**`src/modules/sprachbausteine/dto/sprachbausteine-teil2.dto.ts`**
```typescript
import type { SprachbausteineWordBankItemDto } from './sprachbausteine-word-bank-item.dto';
import type { SprachbausteineTeil2GapDto } from './sprachbausteine-teil2-gap.dto';

export interface SprachbausteineTeil2Dto {
  label: string;
  instruction: string;
  durationMinutes: number;
  body: string;
  wordBank: SprachbausteineWordBankItemDto[];
  gaps: SprachbausteineTeil2GapDto[];
}
```

### Updates to existing files

**`src/modules/sprachbausteine/dto/sprachbausteine-exercise-response.dto.ts`**

Replace the `teil2: SprachbausteineTeilDto` field with `teil2: SprachbausteineTeil2Dto`:

```typescript
import type { SprachbausteineGapDto } from './sprachbausteine-gap.dto';
import type { SprachbausteineTeil2Dto } from './sprachbausteine-teil2.dto';

export interface SprachbausteineExerciseResponseDto {
  contentRevision: string;
  issuedAt: string;
  teil1: SprachbausteineTeilDto;
  teil2: SprachbausteineTeil2Dto;
}

export interface SprachbausteineTeilDto {
  label: string;
  instruction: string;
  durationMinutes: number;
  body: string;
  gaps: SprachbausteineGapDto[];
}
```

**`src/modules/sprachbausteine/dto/index.ts`** — add at the end:
```typescript
export * from './sprachbausteine-word-bank-item.dto';
export * from './sprachbausteine-teil2-gap.dto';
export * from './sprachbausteine-teil2.dto';
```

### Acceptance criteria — Phase 3

- `npm run build` exits 0

---

## Phase 4 — Service (TDD: write failing tests first)

### Step 1: Update mock infrastructure in spec

Add to `mockPrisma`:
```typescript
sprachbausteineTeil2Exercise: {
  findFirst: jest.fn(),
},
```

Add `mockTeil2Exercise` constant (1 exercise, 15 words, 10 gaps):
```typescript
const mockTeil2Exercise = {
  id: 'cccccccc-0001-0001-0002-000000000001',
  contentRevision: 'modelltest-1-sprachbausteine-teil2-v1',
  label: '',
  instruction: 'Lesen Sie den Text...',
  durationMinutes: 18,
  body: 'Text with -31- through -40-',
  createdAt: new Date(),
  words: Array.from({ length: 15 }, (_, i) => ({
    id: `dddddddd-${String(i + 1).padStart(4, '0')}-0001-0002-000000000001`,
    exerciseId: 'cccccccc-0001-0001-0002-000000000001',
    letter: String.fromCharCode(97 + i),
    content: ['ANZEIGE','ARBEIT','AUSBILDUNG','BEWERBE','BERUFLICHEN','BESONDEREN',
              'CHANCE','ENTNEHMEN','KARRIERE','LESEN','NAHM','PERSÖNLICHEN',
              'STELLE','ÜBERNAHM','VERBESSERT'][i],
    sortOrder: i,
  })),
  gaps: [
    // 31 → a (ANZEIGE, sortOrder 0)
    { id: 'eeeeeeee-0031-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '31', gapNumber: 31, correctWordId: 'dddddddd-0001-0001-0002-000000000001', sortOrder: 0 },
    // 32 → m (STELLE, sortOrder 12)
    { id: 'eeeeeeee-0032-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '32', gapNumber: 32, correctWordId: 'dddddddd-0013-0001-0002-000000000001', sortOrder: 1 },
    // 33 → d (BEWERBE, sortOrder 3)
    { id: 'eeeeeeee-0033-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '33', gapNumber: 33, correctWordId: 'dddddddd-0004-0001-0002-000000000001', sortOrder: 2 },
    // 34 → c (AUSBILDUNG, sortOrder 2)
    { id: 'eeeeeeee-0034-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '34', gapNumber: 34, correctWordId: 'dddddddd-0003-0001-0002-000000000001', sortOrder: 3 },
    // 35 → o (VERBESSERT, sortOrder 14)
    { id: 'eeeeeeee-0035-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '35', gapNumber: 35, correctWordId: 'dddddddd-0015-0001-0002-000000000001', sortOrder: 4 },
    // 36 → n (ÜBERNAHM, sortOrder 13)
    { id: 'eeeeeeee-0036-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '36', gapNumber: 36, correctWordId: 'dddddddd-0014-0001-0002-000000000001', sortOrder: 5 },
    // 37 → g (CHANCE, sortOrder 6)
    { id: 'eeeeeeee-0037-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '37', gapNumber: 37, correctWordId: 'dddddddd-0007-0001-0002-000000000001', sortOrder: 6 },
    // 38 → e (BERUFLICHEN, sortOrder 4)
    { id: 'eeeeeeee-0038-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '38', gapNumber: 38, correctWordId: 'dddddddd-0005-0001-0002-000000000001', sortOrder: 7 },
    // 39 → h (ENTNEHMEN, sortOrder 7)
    { id: 'eeeeeeee-0039-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '39', gapNumber: 39, correctWordId: 'dddddddd-0008-0001-0002-000000000001', sortOrder: 8 },
    // 40 → l (PERSÖNLICHEN, sortOrder 11)
    { id: 'eeeeeeee-0040-0001-0002-000000000001', exerciseId: 'cccccccc-0001-0001-0002-000000000001', gapKey: '40', gapNumber: 40, correctWordId: 'dddddddd-0012-0001-0002-000000000001', sortOrder: 9 },
  ],
};
```

### Step 2: Write 3 failing tests for `getTeil2Exercise`

**Test 1 — shape (15 words, 10 gaps, no UUIDs in id fields):**
```typescript
it('returns correct shape — 15 words in wordBank, 10 gaps, no UUIDs in ids', async () => {
  mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(mockTeil2Exercise);
  const result = await (service as any).getTeil2Exercise();

  expect(result.wordBank).toHaveLength(15);
  expect(result.gaps).toHaveLength(10);
  expect(result.wordBank[0].id).toBe('wa');
  expect(result.wordBank[0].letter).toBe('a');
  expect(result.wordBank[14].id).toBe('wo');
  expect(result.wordBank[14].letter).toBe('o');
  expect(result.gaps[0].id).toBe('31');
  expect(result.gaps[9].id).toBe('40');

  const json = JSON.stringify(result);
  expect(json).not.toMatch(/"id":"[0-9a-f]{8}-/);
});
```

**Test 2 — full answer key (correctWordId values match letter-based word ids):**
```typescript
it('derives correctWordId from word sortOrder and maps all 10 gaps correctly', async () => {
  mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(mockTeil2Exercise);
  const result = await (service as any).getTeil2Exercise();

  const answers: Record<string, string> = {};
  result.gaps.forEach((g: any) => { answers[g.id] = g.correctWordId; });

  expect(answers['31']).toBe('wa');   // ANZEIGE
  expect(answers['32']).toBe('wm');   // STELLE
  expect(answers['33']).toBe('wd');   // BEWERBE
  expect(answers['34']).toBe('wc');   // AUSBILDUNG
  expect(answers['35']).toBe('wo');   // VERBESSERT
  expect(answers['36']).toBe('wn');   // ÜBERNAHM
  expect(answers['37']).toBe('wg');   // CHANCE
  expect(answers['38']).toBe('we');   // BERUFLICHEN
  expect(answers['39']).toBe('wh');   // ENTNEHMEN
  expect(answers['40']).toBe('wl');   // PERSÖNLICHEN
});
```

**Test 3 — NotFoundException:**
```typescript
it('throws NotFoundException when no Teil 2 exercise exists', async () => {
  mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(null);
  await expect((service as any).getTeil2Exercise()).rejects.toThrow(NotFoundException);
});
```

### Step 3: Update existing `getExercise` test

The existing assertion at line 49:
```typescript
expect(result.teil2).toEqual({ label: '', instruction: '', durationMinutes: 18, body: '', gaps: [] });
```
must be replaced. After the refactor, `getExercise()` calls `getTeil2Exercise()` internally which reads from `sprachbausteineTeil2Exercise`. The test must also mock that call:
```typescript
mockPrisma.sprachbausteineTeil2Exercise.findFirst.mockResolvedValue(mockTeil2Exercise);
// Then assert the new shape:
expect(result.teil2.wordBank).toHaveLength(15);
expect(result.teil2.gaps).toHaveLength(10);
```

### Step 4: Implement `getTeil2Exercise()`

Add to `SprachbausteineService`:

```typescript
async getTeil2Exercise(): Promise<SprachbausteineTeil2Dto> {
  const exercise = await this.prisma.sprachbausteineTeil2Exercise.findFirst({
    include: {
      words: { orderBy: { sortOrder: 'asc' } },
      gaps:  { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!exercise) throw new NotFoundException('No Sprachbausteine Teil 2 exercise found');

  const wordIdMap = new Map<string, string>();
  const wordBank = exercise.words.map((w) => {
    const wordId = 'w' + String.fromCharCode(97 + w.sortOrder);
    wordIdMap.set(w.id, wordId);
    return { id: wordId, letter: String.fromCharCode(97 + w.sortOrder), content: w.content };
  });

  const gaps = exercise.gaps.map((g) => ({
    id: g.gapKey,
    correctWordId: wordIdMap.get(g.correctWordId) ?? '',
  }));

  return {
    label: exercise.label,
    instruction: exercise.instruction,
    durationMinutes: exercise.durationMinutes,
    body: exercise.body,
    wordBank,
    gaps,
  };
}
```

### Step 5: Wire `getTeil2Exercise` into `getExercise`

Replace the stub teil2 in `getExercise()`:

```typescript
// Before (line 55 in service):
teil2: { label: '', instruction: '', durationMinutes: 18, body: '', gaps: [] },

// After — call getTeil2Exercise() via Promise.all alongside the Teil 1 query:
async getExercise(): Promise<SprachbausteineExerciseResponseDto> {
  const [exercise, teil2] = await Promise.all([
    this.prisma.sprachbausteineExercise.findFirst({
      include: {
        gaps: {
          orderBy: { sort_order: 'asc' },
          include: { options: { orderBy: { sort_order: 'asc' } } },
        },
      },
    }),
    this.getTeil2Exercise(),
  ]);

  if (!exercise) throw new NotFoundException('No Sprachbausteine exercise found');

  // ... existing Teil 1 mapping ...

  return {
    contentRevision: exercise.content_revision,
    issuedAt: new Date().toISOString(),
    teil1: { label: exercise.label ?? '', instruction: exercise.instruction,
             durationMinutes: exercise.duration_minutes, body: exercise.body, gaps },
    teil2,
  };
}
```

### Acceptance criteria — Phase 4

- `npm test` — all existing suites still pass, new 3 `getTeil2Exercise` tests pass
- The existing `getExercise` test updated and passing with new teil2 shape assertions

---

## Phase 5 — End-to-end verification (curl checks)

```bash
# wordBank must have 15 items
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil2.wordBank | length'
# → 15

# gaps must have 10 items
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil2.gaps | length'
# → 10

# First word is ANZEIGE, letter "a", id "wa"
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil2.wordBank[0]'
# → { "id": "wa", "letter": "a", "content": "ANZEIGE" }

# Last word is VERBESSERT, letter "o", id "wo"
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil2.wordBank[14]'
# → { "id": "wo", "letter": "o", "content": "VERBESSERT" }

# Gap 31 → correctWordId "wa" (ANZEIGE)
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil2.gaps[0]'
# → { "id": "31", "correctWordId": "wa" }

# Gap 40 → correctWordId "wl" (PERSÖNLICHEN)
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil2.gaps[9]'
# → { "id": "40", "correctWordId": "wl" }

# Word IDs are all "w" + letter (no raw UUIDs)
curl http://localhost:3000/api/sprachbausteine/exercise | jq '[.teil2.wordBank[].id]'
# → ["wa","wb","wc","wd","we","wf","wg","wh","wi","wj","wk","wl","wm","wn","wo"]

# Teil 1 must still be intact (no regression)
curl http://localhost:3000/api/sprachbausteine/exercise | jq '.teil1.gaps | length'
# → 10

# Both sections present
curl http://localhost:3000/api/sprachbausteine/exercise | jq 'keys'
# → ["contentRevision", "issuedAt", "teil1", "teil2"]
```

---

## Execution order

```
Phase 1  (schema + migration)
    ↓
Phase 2  (seed)            ← can start writing seed SQL in parallel with Phase 1
    ↓
CHECKPOINT 1  (DB verified: 1 exercise, 15 words, 10 gaps, 5 decoys)
    ↓
Phase 3  (DTOs)            ← no DB dependency, can follow immediately after Phase 1 build passes
    ↓
Phase 4 step 1+2  (write failing tests — RED)
    ↓
Phase 4 step 4+5  (implement — GREEN)
    ↓
CHECKPOINT 2  (npm test → all green, npm run build → clean)
    ↓
Phase 5  (curl checks with live server)
    ↓
commit
```

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| UUID offset confusion in seed (e.g. sortOrder 12 → NNNN 0013) | **Eliminated** | Seed uses DB-generated UUIDs + letter subqueries — letter is the source of truth, no arithmetic needed |
| Wrong letter in gap subquery | Subquery returns `null` → NOT NULL constraint fires immediately | Immediate insert failure with clear error; no silent wrong answer possible |
| `wordIdMap` lookup returns `undefined` for a gap's `correctWordId` | `correctWordId: ""` in response — wrong answer | The `?? ''` fallback makes it visible; unit test verifies all 10 gaps map correctly |
| Existing `getExercise` test checks the old stub `teil2` | Test fails after refactor | Must update the assertion in Phase 4 Step 3 before implementing |
| `prisma.sprachbausteineTeil2Exercise` uses camelCase accessor | `getTeil2Exercise` uses the wrong accessor name | After `npx prisma generate`, verify the generated client property name in `@prisma/client` |
