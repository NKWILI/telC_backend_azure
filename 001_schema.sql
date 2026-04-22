-- ============================================================
-- MIGRATION 001 — Sprachbausteine Teil 1 schema
-- ============================================================

-- The exercise itself: one row = one full Teil 1 text
CREATE TABLE IF NOT EXISTS sprachbausteine_exercises (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    teil_number      INTEGER     NOT NULL CHECK (teil_number IN (1, 2)),
    content_revision VARCHAR(100) NOT NULL,
    label            VARCHAR(255),
    instruction      TEXT        NOT NULL,
    duration_minutes INTEGER     NOT NULL,
    body             TEXT        NOT NULL,  -- full text with -21-, -22- ... markers inline
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per gap (blank) in the exercise
CREATE TABLE IF NOT EXISTS sprachbausteine_gaps (
    id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id  UUID    NOT NULL REFERENCES sprachbausteine_exercises(id) ON DELETE CASCADE,
    gap_key      VARCHAR(10) NOT NULL,   -- "21" — must match the marker in body exactly
    gap_number   INTEGER     NOT NULL,   -- same value as integer, used for ordering
    sort_order   INTEGER     NOT NULL,   -- position order (0-indexed)
    UNIQUE (exercise_id, gap_key)
);

-- Three options per gap (a, b, c)
CREATE TABLE IF NOT EXISTS sprachbausteine_gap_options (
    id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    gap_id       UUID    NOT NULL REFERENCES sprachbausteine_gaps(id) ON DELETE CASCADE,
    content      VARCHAR(100) NOT NULL,   -- the word/phrase shown to the student
    is_correct   BOOLEAN     NOT NULL DEFAULT FALSE,
    sort_order   INTEGER     NOT NULL     -- 0=a, 1=b, 2=c
);

-- ============================================================
-- CONSTRAINT: enforce exactly 1 correct option per gap
-- (enforced at application layer; partial index as safeguard)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS one_correct_per_gap
    ON sprachbausteine_gap_options (gap_id)
    WHERE is_correct = TRUE;
