-- Table for Writing (Schreiben) module attempts.
-- Run this in your Supabase SQL editor to create the table.

CREATE TABLE IF NOT EXISTS writing_attempts (
  attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  score INT,
  feedback TEXT,
  duration_seconds INT,
  corrections JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  notification_sent BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_writing_attempts_student_exercise_created
  ON writing_attempts (student_id, exercise_id, created_at DESC);

COMMENT ON TABLE writing_attempts IS 'Writing module: student submissions and correction results';
