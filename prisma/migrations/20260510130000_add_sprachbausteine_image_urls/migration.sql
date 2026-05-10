-- Add image_url columns for Sprachbausteine exercises

ALTER TABLE "sprachbausteine_exercises"
  ADD COLUMN "image_url" TEXT NOT NULL
  DEFAULT 'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/sprachbausteine-teil-1.png';

ALTER TABLE "sprachbausteine_teil2_exercises"
  ADD COLUMN "image_url" TEXT NOT NULL
  DEFAULT 'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/sprachbausteine-teil-2.png';

ALTER TABLE "sprachbausteine_exercises"
  ALTER COLUMN "image_url" DROP DEFAULT;

ALTER TABLE "sprachbausteine_teil2_exercises"
  ALTER COLUMN "image_url" DROP DEFAULT;
