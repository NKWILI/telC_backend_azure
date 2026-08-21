# Modelltest content architecture

## Selection

- Hören exercise: `GET /api/listening/exercise?modelltest=1&teil=1`
- Hören catalog: `GET /api/listening/teils?modelltest=1`
- Sprechen catalog: `GET /api/speaking/teils?modelltest=1`
- Lesen and Sprachbausteine keep their existing optional `modelltest` query.

Omitting `modelltest` defaults to Modelltest 1. For Hören, `type=1` remains a
deprecated alias for `teil=1`; when both are sent they must match.

## Answer security

Exercise GET responses never contain correct answers. Hören, Lesen, and
Sprachbausteine submissions are scored from database answer records. Legacy
client score fields for Lesen and Sprachbausteine are accepted for transition
but ignored.

Hören submission accepts the existing `type`, `timed`, `content_revision`, and
`answers` fields plus optional `modelltestNumber` (default 1). It returns the
server-computed percentage `score` and the post-submission `answerKey`.

Sprachbausteine submission now requires `answers` and `contentRevision`. Its
legacy `score` field is optional and ignored. Lesen submission uses its existing
`answers` and `teil_id`; `score_percent` is optional and ignored.

## Storage

`listening_exercises`, `listening_questions`, and `speaking_exercises` are
related to `modelltests`. Each exercise table has a unique
`(modelltest_id, part)` constraint. Media is represented by URL/path columns;
PostgreSQL contains no media blobs.

Examiner behavior remains in `src/config/prompts/teil-*-examiner.txt`. Speaking
database rows describe candidate tasks only.

## Deployment order

1. Back up and verify the target database.
2. Run `npx prisma migrate deploy`. The schema migration runs before the
   deterministic Modelltest 1 content migration.
3. Verify Modelltest 1 has three listening exercises, 20 listening questions,
   and three speaking exercises.
4. Deploy application code.

The content migration is transactional and uses unique keys plus upserts, so a
rerun does not create duplicate exercises. It fails rather than inventing data
if Modelltest 1 does not exist.

## Adding Modelltest 2

Create the Modelltest row and seed each section's rows with
`modelltest_id` pointing to it. No new application catalog or conditional logic
is required. Modelltest 2 content is intentionally not included in this change.
