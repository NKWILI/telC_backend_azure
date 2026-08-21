import fs from 'node:fs';
import path from 'node:path';

const [sourcePath, outputPath, repairOutputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error(
    'Usage: node scripts/generate-modelltest2-seed.mjs <source.json> <migration.sql>',
  );
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const sections = source.sections;
const answerKey = source.answerKey;
const sql = [];
const q = (value) =>
  value === null || value === undefined
    ? 'NULL'
    : `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${q(JSON.stringify(value))}::jsonb`;
const values = (rows) =>
  rows.map((row) => `    (${row.join(', ')})`).join(',\n');

const assertEqual = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} mismatch\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`,
    );
  }
};
const objectFrom = (items, key, answer) =>
  Object.fromEntries(items.map((item) => [String(key(item)), answer(item)]));

assertEqual('Modelltest number', source.modelltest.number, 2);
assertEqual('Lesen Teil 1 title count', sections.lesenTeil1.titles.length, 10);
assertEqual('Lesen Teil 1 text count', sections.lesenTeil1.texts.length, 5);
assertEqual(
  'Lesen Teil 2 question count',
  sections.lesenTeil2.questions.length,
  5,
);
assertEqual(
  'Lesen Teil 2 option counts',
  sections.lesenTeil2.questions.map((question) => question.options.length),
  [3, 3, 3, 3, 3],
);
assertEqual(
  'Lesen Teil 3 situation count',
  sections.lesenTeil3.situations.length,
  10,
);
assertEqual(
  'Lesen Teil 3 announcement count',
  sections.lesenTeil3.announcements.length,
  12,
);
assertEqual(
  'Sprachbausteine Teil 1 gap count',
  sections.sprachbausteineTeil1.gaps.length,
  10,
);
assertEqual(
  'Sprachbausteine Teil 1 option counts',
  sections.sprachbausteineTeil1.gaps.map((gap) => gap.options.length),
  Array(10).fill(3),
);
assertEqual(
  'Sprachbausteine Teil 2 word count',
  sections.sprachbausteineTeil2.words.length,
  15,
);
assertEqual(
  'Sprachbausteine Teil 2 gap count',
  sections.sprachbausteineTeil2.gaps.length,
  10,
);
assertEqual(
  'Hören question counts',
  Object.values(sections.hoeren).map((part) => part.questions.length),
  [5, 10, 5],
);
assertEqual('Sprechen part count', Object.keys(sections.sprechen).length, 3);

assertEqual(
  'Lesen Teil 1 answer key',
  objectFrom(
    sections.lesenTeil1.texts,
    (item) => item.textNumber,
    (item) => item.correctTitleKey,
  ),
  answerKey.lesenTeil1,
);
assertEqual(
  'Lesen Teil 2 answer key',
  objectFrom(
    sections.lesenTeil2.questions,
    (item) => item.questionNumber,
    (item) => item.options.find((option) => option.isCorrect)?.key,
  ),
  answerKey.lesenTeil2,
);
assertEqual(
  'Lesen Teil 3 answer key',
  objectFrom(
    sections.lesenTeil3.situations,
    (item) => item.situationNumber,
    (item) => (item.noMatch ? 'X' : item.correctAnnouncementKey),
  ),
  answerKey.lesenTeil3,
);
assertEqual(
  'Sprachbausteine Teil 1 answer key',
  objectFrom(
    sections.sprachbausteineTeil1.gaps,
    (item) => item.gapNumber,
    (item) => item.options.find((option) => option.isCorrect)?.key,
  ),
  answerKey.sprachbausteineTeil1,
);
assertEqual(
  'Sprachbausteine Teil 2 answer key',
  objectFrom(
    sections.sprachbausteineTeil2.gaps,
    (item) => item.gapNumber,
    (item) => item.correctWordKey,
  ),
  answerKey.sprachbausteineTeil2,
);
for (const [partName, part] of Object.entries(sections.hoeren)) {
  const keyName = `hoeren${partName[0].toUpperCase()}${partName.slice(1)}`;
  assertEqual(
    `Hören ${partName} answer key`,
    objectFrom(
      part.questions,
      (item) => item.questionNumber,
      (item) => item.correctAnswer,
    ),
    answerKey[keyName],
  );
}

sql.push(`-- Modelltest 2 normalized from modelltest2_seed_source.json.
-- Runtime-only mapping: extraction provenance/sourceTrack are intentionally omitted.
-- Re-running replaces only Modelltest 2 child content, keeping the seed deterministic.
BEGIN;

DO $$
DECLARE
  mt2 UUID;
  exercise_id UUID;
BEGIN
  INSERT INTO "modelltests" ("number", "title")
  VALUES (2, ${q(source.modelltest.title)})
  ON CONFLICT ("number") DO UPDATE SET "title" = EXCLUDED."title"
  RETURNING "id" INTO mt2;
`);

// Lesen Teil 1
const l1 = sections.lesenTeil1;
sql.push(`  INSERT INTO "lesen_teil1_exercises"
    ("contentRevision", "label", "instruction", "modelltest_id")
  VALUES (${q(l1.contentRevision)}, ${q(l1.label)}, ${q(l1.instruction)}, mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "contentRevision" = EXCLUDED."contentRevision",
    "label" = EXCLUDED."label",
    "instruction" = EXCLUDED."instruction"
  RETURNING "id" INTO exercise_id;

  DELETE FROM "lesen_teil1_texts" WHERE "exerciseId" = exercise_id;
  DELETE FROM "lesen_teil1_titles" WHERE "exerciseId" = exercise_id;
  INSERT INTO "lesen_teil1_titles" ("exerciseId", "content", "sortOrder") VALUES
${values(l1.titles.map((item) => ['exercise_id', q(item.content), item.sortOrder]))};
  INSERT INTO "lesen_teil1_texts"
    ("exerciseId", "textNumber", "von", "an", "body", "sortOrder", "correctTitleId") VALUES
${values(
  l1.texts.map((item) => {
    const title = l1.titles.find(
      (candidate) => candidate.key === item.correctTitleKey,
    );
    if (!title)
      throw new Error(`Missing Lesen Teil 1 title ${item.correctTitleKey}`);
    const body = item.gesendet
      ? `Gesendet: ${item.gesendet}\n\n${item.body}`
      : item.body;
    return [
      'exercise_id',
      item.textNumber,
      q(item.von),
      q(item.an),
      q(body),
      item.sortOrder,
      `(SELECT "id" FROM "lesen_teil1_titles" WHERE "exerciseId" = exercise_id AND "sortOrder" = ${title.sortOrder})`,
    ];
  }),
)};
`);

// Lesen Teil 2
const l2 = sections.lesenTeil2;
const l2TopBody = `Betreff: ${l2.topSubject}\nGesendet: ${l2.topSent}\n\n${l2.topBody}`;
sql.push(`  INSERT INTO "lesen_teil2_exercises"
    ("contentRevision", "label", "instruction", "cautionNote", "topSender",
     "topReceiver", "topBody", "quotedThread", "modelltest_id")
  VALUES (${q(l2.contentRevision)}, ${q(l2.label)}, ${q(l2.instruction)},
    ${q(l2.cautionNote)}, ${q(l2.topSender)}, ${q(l2.topReceiver)},
    ${q(l2TopBody)}, ${q(l2.quotedThread)}, mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "contentRevision" = EXCLUDED."contentRevision", "label" = EXCLUDED."label",
    "instruction" = EXCLUDED."instruction", "cautionNote" = EXCLUDED."cautionNote",
    "topSender" = EXCLUDED."topSender", "topReceiver" = EXCLUDED."topReceiver",
    "topBody" = EXCLUDED."topBody", "quotedThread" = EXCLUDED."quotedThread"
  RETURNING "id" INTO exercise_id;

  DELETE FROM "lesen_teil2_options" WHERE "questionId" IN
    (SELECT "id" FROM "lesen_teil2_questions" WHERE "exerciseId" = exercise_id);
  DELETE FROM "lesen_teil2_questions" WHERE "exerciseId" = exercise_id;
${l2.questions
  .map(
    (question) => `  INSERT INTO "lesen_teil2_questions"
    ("exerciseId", "questionNumber", "prompt", "sortOrder")
  VALUES (exercise_id, ${question.questionNumber}, ${q(question.prompt)}, ${question.sortOrder})
  RETURNING "id" INTO exercise_id;
  INSERT INTO "lesen_teil2_options" ("questionId", "content", "isCorrect", "sortOrder") VALUES
${values(question.options.map((option) => ['exercise_id', q(option.content), option.isCorrect, option.sortOrder]))};
  SELECT "id" INTO exercise_id FROM "lesen_teil2_exercises" WHERE "modelltest_id" = mt2;`,
  )
  .join('\n')}
`);

// Lesen Teil 3
const l3 = sections.lesenTeil3;
sql.push(`  INSERT INTO "lesen_teil3_exercises"
    ("contentRevision", "label", "instruction", "modelltest_id")
  VALUES (${q(l3.contentRevision)}, ${q(l3.label)}, ${q(l3.instruction)}, mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "contentRevision" = EXCLUDED."contentRevision", "label" = EXCLUDED."label",
    "instruction" = EXCLUDED."instruction"
  RETURNING "id" INTO exercise_id;

  DELETE FROM "lesen_teil3_situations" WHERE "exerciseId" = exercise_id;
  DELETE FROM "lesen_teil3_announcements" WHERE "exerciseId" = exercise_id;
  INSERT INTO "lesen_teil3_announcements" ("exerciseId", "title", "content", "sortOrder") VALUES
${values(l3.announcements.map((item) => ['exercise_id', q(item.title), q(item.content), item.sortOrder]))};
  INSERT INTO "lesen_teil3_situations"
    ("exerciseId", "situationNumber", "content", "noMatch", "correctAnnouncementId", "sortOrder") VALUES
${values(
  l3.situations.map((item) => {
    const announcement = l3.announcements.find(
      (candidate) => candidate.key === item.correctAnnouncementKey,
    );
    if (!item.noMatch && !announcement) {
      throw new Error(
        `Missing Lesen Teil 3 announcement ${item.correctAnnouncementKey}`,
      );
    }
    return [
      'exercise_id',
      item.situationNumber,
      q(item.content),
      item.noMatch,
      item.noMatch
        ? 'NULL'
        : `(SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = exercise_id AND "sortOrder" = ${announcement.sortOrder})`,
      item.sortOrder,
    ];
  }),
)};
`);

// Sprachbausteine Teil 1
const sb1 = sections.sprachbausteineTeil1;
sql.push(`  INSERT INTO "sprachbausteine_exercises"
    ("teil_number", "content_revision", "label", "instruction", "duration_minutes",
     "image_url", "body", "modelltest_id")
  VALUES (${sb1.teilNumber}, ${q(sb1.contentRevision)}, ${q(sb1.label)},
    ${q(sb1.instruction)}, 18, '', ${q(sb1.body)}, mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "teil_number" = EXCLUDED."teil_number", "content_revision" = EXCLUDED."content_revision",
    "label" = EXCLUDED."label", "instruction" = EXCLUDED."instruction",
    "duration_minutes" = EXCLUDED."duration_minutes", "image_url" = EXCLUDED."image_url",
    "body" = EXCLUDED."body"
  RETURNING "id" INTO exercise_id;

  DELETE FROM "sprachbausteine_gap_options" WHERE "gap_id" IN
    (SELECT "id" FROM "sprachbausteine_gaps" WHERE "exercise_id" = exercise_id);
  DELETE FROM "sprachbausteine_gaps" WHERE "exercise_id" = exercise_id;
${sb1.gaps
  .map(
    (gap) => `  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (exercise_id, ${q(gap.gapKey)}, ${gap.gapNumber}, ${gap.sortOrder})
  RETURNING "id" INTO exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
${values(gap.options.map((option) => ['exercise_id', q(option.content), option.isCorrect, option.sortOrder]))};
  SELECT "id" INTO exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;`,
  )
  .join('\n')}
`);

// Sprachbausteine Teil 2
const sb2 = sections.sprachbausteineTeil2;
sql.push(`  INSERT INTO "sprachbausteine_teil2_exercises"
    ("contentRevision", "label", "instruction", "durationMinutes", "image_url", "body", "modelltest_id")
  VALUES (${q(sb2.contentRevision)}, ${q(sb2.label)}, ${q(sb2.instruction)}, 18, '', ${q(sb2.body)}, mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "contentRevision" = EXCLUDED."contentRevision", "label" = EXCLUDED."label",
    "instruction" = EXCLUDED."instruction", "durationMinutes" = EXCLUDED."durationMinutes",
    "image_url" = EXCLUDED."image_url", "body" = EXCLUDED."body"
  RETURNING "id" INTO exercise_id;

  DELETE FROM "sprachbausteine_teil2_gaps" WHERE "exerciseId" = exercise_id;
  DELETE FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = exercise_id;
  INSERT INTO "sprachbausteine_teil2_words" ("exerciseId", "letter", "content", "sortOrder") VALUES
${values(sb2.words.map((word) => ['exercise_id', q(word.letter), q(word.content), word.sortOrder]))};
  INSERT INTO "sprachbausteine_teil2_gaps"
    ("exerciseId", "gapKey", "gapNumber", "correctWordId", "sortOrder") VALUES
${values(
  sb2.gaps.map((gap) => {
    const word = sb2.words.find(
      (candidate) => candidate.letter === gap.correctWordKey,
    );
    if (!word)
      throw new Error(`Missing Sprachbausteine word ${gap.correctWordKey}`);
    return [
      'exercise_id',
      q(gap.gapKey),
      gap.gapNumber,
      `(SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = exercise_id AND "letter" = ${q(word.letter)})`,
      gap.sortOrder,
    ];
  }),
)};
`);

// Hören
for (const part of Object.values(sections.hoeren)) {
  sql.push(`  INSERT INTO "listening_exercises"
    ("modelltest_id", "part", "title", "subtitle", "instruction", "content_revision",
     "duration_minutes", "audio_url", "bundled_audio_asset", "image_url", "transcript")
  VALUES (mt2, ${part.part}, ${q(part.title)}, ${q(part.subtitle)}, ${q(part.instruction)},
    ${q(part.contentRevision)}, 10, '', '', '', ${q(part.transcript)})
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "instruction" = EXCLUDED."instruction", "content_revision" = EXCLUDED."content_revision",
    "duration_minutes" = EXCLUDED."duration_minutes", "audio_url" = EXCLUDED."audio_url",
    "bundled_audio_asset" = EXCLUDED."bundled_audio_asset", "image_url" = EXCLUDED."image_url",
    "transcript" = EXCLUDED."transcript"
  RETURNING "id" INTO exercise_id;
  DELETE FROM "listening_questions" WHERE "exercise_id" = exercise_id;
  INSERT INTO "listening_questions"
    ("exercise_id", "question_number", "prompt", "correct_answer", "sort_order") VALUES
${values(
  part.questions.map((question) => [
    'exercise_id',
    question.questionNumber,
    q(question.prompt),
    q(question.correctAnswer),
    question.sortOrder,
  ]),
)};
`);
}

// Schreiben
const writing = sections.schreiben;
sql.push(`  INSERT INTO "writing_exercises"
    ("content_revision", "title", "subtitle", "task_type", "intro", "stimulus",
     "task_instructions", "bullet_points", "closing_reminder", "modelltest_id")
  VALUES (${q(writing.contentRevision)}, ${q(writing.title)}, ${q(writing.subtitle)},
    ${q(writing.taskType)}, ${q(writing.intro)}, ${json(writing.stimulus)},
    ${q(writing.taskInstructions)}, ARRAY[${writing.bulletPoints.map(q).join(', ')}],
    ${q(writing.closingReminder)}, mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "content_revision" = EXCLUDED."content_revision", "title" = EXCLUDED."title",
    "subtitle" = EXCLUDED."subtitle", "task_type" = EXCLUDED."task_type",
    "intro" = EXCLUDED."intro", "stimulus" = EXCLUDED."stimulus",
    "task_instructions" = EXCLUDED."task_instructions",
    "bullet_points" = EXCLUDED."bullet_points", "closing_reminder" = EXCLUDED."closing_reminder";
`);

// Sprechen: runtime structure is a flat string array, so A/B cards are labeled strings.
const speakingDurations = { 1: 10, 2: 15, 3: 5 };
for (const part of Object.values(sections.sprechen)) {
  let topicDescription = part.topicDescription ?? part.commonInstructions;
  let topicPoints = part.topicPoints ?? [];
  let instructions = part.instructions ?? part.commonInstructions;
  if (part.part === 1 && part.additionalExaminerTopics) {
    topicPoints = [
      ...topicPoints,
      ...part.additionalExaminerTopics.map(
        (item) => `Zusätzliche Prüferfrage: ${item}`,
      ),
    ];
  }
  if (part.part === 2) {
    topicPoints = Object.values(part.participants).map(
      (participant) =>
        `${participant.label} — ${participant.person}: ${participant.text}`,
    );
  }
  sql.push(`  INSERT INTO "speaking_exercises"
    ("modelltest_id", "part", "title", "subtitle", "topic_title", "topic_description",
     "topic_points", "instructions", "duration_minutes", "prep_duration_seconds",
     "image_url", "exam_image_url", "content_revision")
  VALUES (mt2, ${part.part}, ${q(part.title)}, ${q(part.subtitle ?? '')}, ${q(part.topicTitle)},
    ${q(topicDescription)}, ${json(topicPoints)}, ${q(instructions)}, ${speakingDurations[part.part]},
    300, '', NULL, ${q(`modelltest-2-sprechen-teil-${part.part}-v1`)})
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "topic_title" = EXCLUDED."topic_title", "topic_description" = EXCLUDED."topic_description",
    "topic_points" = EXCLUDED."topic_points", "instructions" = EXCLUDED."instructions",
    "duration_minutes" = EXCLUDED."duration_minutes",
    "prep_duration_seconds" = EXCLUDED."prep_duration_seconds",
    "image_url" = EXCLUDED."image_url", "exam_image_url" = EXCLUDED."exam_image_url",
    "content_revision" = EXCLUDED."content_revision";
`);
}

sql.push(`END $$;

COMMIT;
`);

const output = sql
  .join('\n')
  .replaceAll(/\bexercise_id\b/g, 'seed_exercise_id')
  .replaceAll('"seed_exercise_id"', '"exercise_id"');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, 'utf8');

if (repairOutputPath) {
  const sprachSeed = fs.readFileSync(
    path.resolve('002_seed_modelltest1.sql'),
    'utf8',
  );
  const gapsStart = sprachSeed.indexOf('INSERT INTO sprachbausteine_gaps');
  const gapsEnd = sprachSeed.lastIndexOf('COMMIT;');
  if (gapsStart < 0 || gapsEnd < 0) {
    throw new Error('Could not extract Modelltest 1 Sprachbausteine repair');
  }

  const listeningSeed = fs.readFileSync(
    path.resolve(
      'prisma/migrations/20260821171000_seed_modelltest1_listening_speaking/migration.sql',
    ),
    'utf8',
  );
  const repair = `${output}\n-- Restore Modelltest 1 Sprachbausteine Teil 1 rows deleted by the faulty seed.\n-- The scoped deletes also make this safe after a clean, corrected initial seed.\nBEGIN;\nDELETE FROM sprachbausteine_gap_options\nWHERE gap_id IN (\n  SELECT g.id\n  FROM sprachbausteine_gaps g\n  JOIN sprachbausteine_exercises e ON e.id = g.exercise_id\n  JOIN modelltests m ON m.id = e.modelltest_id\n  WHERE m.number = 1\n);\nDELETE FROM sprachbausteine_gaps\nWHERE exercise_id = (\n  SELECT e.id\n  FROM sprachbausteine_exercises e\n  JOIN modelltests m ON m.id = e.modelltest_id\n  WHERE m.number = 1\n);\n${sprachSeed.slice(gapsStart, gapsEnd)}COMMIT;\n\n-- Restore Modelltest 1 listening questions using their canonical idempotent seed.\n${listeningSeed}`;
  fs.mkdirSync(path.dirname(repairOutputPath), { recursive: true });
  fs.writeFileSync(repairOutputPath, repair, 'utf8');
}
