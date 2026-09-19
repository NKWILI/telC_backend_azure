-- Tables nothing uses (checked 2026-09-19, read-only: all empty in production):
-- oauth_accounts belonged to Google sign-in, removed (D8); lesen_sessions and
-- lesen_results to an old Lesen design, replaced by lesen_attempts (phase 11).

-- DropForeignKey
ALTER TABLE "lesen_results" DROP CONSTRAINT "lesen_results_session_id_fkey";

-- DropForeignKey
ALTER TABLE "lesen_sessions" DROP CONSTRAINT "lesen_sessions_student_id_fkey";

-- DropForeignKey
ALTER TABLE "oauth_accounts" DROP CONSTRAINT "oauth_accounts_student_id_fkey";

-- DropTable
DROP TABLE "lesen_results";

-- DropTable
DROP TABLE "lesen_sessions";

-- DropTable
DROP TABLE "oauth_accounts";

