-- The live Gemini speaking flow's tables. Nothing has written to them since
-- 2026-03-24 and no code reads them: speaking history comes from
-- speaking_attempts (phase 11). They held student transcripts the D39 erase
-- does not cover, so they go. Irreversible: 70 sessions and 45 transcripts in
-- production at the time of writing, none scored.

-- DropForeignKey
ALTER TABLE "exam_sessions" DROP CONSTRAINT "exam_sessions_student_id_fkey";

-- DropForeignKey
ALTER TABLE "gemini_sessions" DROP CONSTRAINT "gemini_sessions_exam_session_id_fkey";

-- DropForeignKey
ALTER TABLE "teil_evaluations" DROP CONSTRAINT "teil_evaluations_session_id_fkey";

-- DropForeignKey
ALTER TABLE "teil_transcripts" DROP CONSTRAINT "teil_transcripts_session_id_fkey";

-- DropTable
DROP TABLE "exam_sessions";

-- DropTable
DROP TABLE "gemini_sessions";

-- DropTable
DROP TABLE "teil_evaluations";

-- DropTable
DROP TABLE "teil_transcripts";

