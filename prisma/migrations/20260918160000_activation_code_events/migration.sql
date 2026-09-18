-- An append-only log of what centers do to their activation codes.
--
-- It answers "who cut this student off, and when" after the fact, and it is
-- the count behind any future limit on how often one seat may move between
-- students. Additive only.

-- CreateTable
CREATE TABLE "activation_code_events" (
    "id" TEXT NOT NULL,
    "code_id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "center_user_id" TEXT,
    "from_status" "ActivationCodeStatus" NOT NULL,
    "to_status" "ActivationCodeStatus" NOT NULL,
    "student_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_code_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activation_code_events_code_id_created_at_idx" ON "activation_code_events"("code_id", "created_at");

-- AddForeignKey
ALTER TABLE "activation_code_events" ADD CONSTRAINT "activation_code_events_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "activation_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

