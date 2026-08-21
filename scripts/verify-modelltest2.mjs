import 'dotenv/config';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error('Usage: node scripts/verify-modelltest2.mjs <source.json>');
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const letters = ['a', 'b', 'c'];
const assertEqual = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} mismatch\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`,
    );
  }
};

try {
  const [mt1, mt2] = await Promise.all([
    db.modelltest.findUnique({ where: { number: 1 }, select: { id: true } }),
    db.modelltest.findUnique({ where: { number: 2 }, select: { id: true, title: true } }),
  ]);
  if (!mt1 || !mt2) throw new Error('Modelltest 1 or 2 is missing');
  if (mt1.id === mt2.id) throw new Error('Modelltest 1 and 2 share an id');

  const [lesen1, lesen2, lesen3, sprach1, sprach2, listening, writing, speaking] =
    await Promise.all([
      db.lesenTeil1Exercise.findUnique({
        where: { modelltest_id: mt2.id },
        include: {
          titles: { orderBy: { sortOrder: 'asc' } },
          texts: {
            orderBy: { sortOrder: 'asc' },
            include: { correctTitle: { select: { sortOrder: true } } },
          },
        },
      }),
      db.lesenTeil2Exercise.findUnique({
        where: { modelltest_id: mt2.id },
        include: {
          questions: {
            orderBy: { sortOrder: 'asc' },
            include: { options: { orderBy: { sortOrder: 'asc' } } },
          },
        },
      }),
      db.lesenTeil3Exercise.findUnique({
        where: { modelltest_id: mt2.id },
        include: {
          announcements: { orderBy: { sortOrder: 'asc' } },
          situations: {
            orderBy: { sortOrder: 'asc' },
            include: { correctAnnouncement: { select: { sortOrder: true } } },
          },
        },
      }),
      db.sprachbausteineExercise.findUnique({
        where: { modelltest_id: mt2.id },
        include: {
          gaps: {
            orderBy: { sort_order: 'asc' },
            include: { options: { orderBy: { sort_order: 'asc' } } },
          },
        },
      }),
      db.sprachbausteineTeil2Exercise.findUnique({
        where: { modelltest_id: mt2.id },
        include: {
          words: true,
          gaps: {
            orderBy: { sortOrder: 'asc' },
            include: { correctWord: { select: { letter: true } } },
          },
        },
      }),
      db.listeningExercise.findMany({
        where: { modelltest_id: mt2.id },
        orderBy: { part: 'asc' },
        include: { questions: { orderBy: { sort_order: 'asc' } } },
      }),
      db.writingExercise.findUnique({ where: { modelltest_id: mt2.id } }),
      db.speakingExercise.findMany({
        where: { modelltest_id: mt2.id },
        orderBy: { part: 'asc' },
      }),
    ]);

  if (!lesen1 || !lesen2 || !lesen3 || !sprach1 || !sprach2 || !writing) {
    throw new Error('One or more Modelltest 2 sections are missing');
  }

  const actualAnswers = {
    lesenTeil1: Object.fromEntries(
      lesen1.texts.map((item) => [
        String(item.textNumber),
        source.sections.lesenTeil1.titles[item.correctTitle.sortOrder].key,
      ]),
    ),
    lesenTeil2: Object.fromEntries(
      lesen2.questions.map((item) => [
        String(item.questionNumber),
        letters[item.options.find((option) => option.isCorrect)?.sortOrder],
      ]),
    ),
    lesenTeil3: Object.fromEntries(
      lesen3.situations.map((item) => [
        String(item.situationNumber),
        item.noMatch
          ? 'X'
          : source.sections.lesenTeil3.announcements[
              item.correctAnnouncement.sortOrder
            ].key,
      ]),
    ),
    sprachbausteineTeil1: Object.fromEntries(
      sprach1.gaps.map((item) => [
        item.gap_key,
        letters[item.options.find((option) => option.is_correct)?.sort_order],
      ]),
    ),
    sprachbausteineTeil2: Object.fromEntries(
      sprach2.gaps.map((item) => [item.gapKey, item.correctWord.letter]),
    ),
    hoerenTeil1: Object.fromEntries(
      listening[0].questions.map((item) => [String(item.question_number), item.correct_answer]),
    ),
    hoerenTeil2: Object.fromEntries(
      listening[1].questions.map((item) => [String(item.question_number), item.correct_answer]),
    ),
    hoerenTeil3: Object.fromEntries(
      listening[2].questions.map((item) => [String(item.question_number), item.correct_answer]),
    ),
  };
  assertEqual('Official answer keys', actualAnswers, source.answerKey);

  const counts = {
    lesenTeil1: lesen1.texts.length,
    lesenTeil1Titles: lesen1.titles.length,
    lesenTeil2: lesen2.questions.length,
    lesenTeil3: lesen3.situations.length,
    lesenTeil3Announcements: lesen3.announcements.length,
    sprachbausteineTeil1: sprach1.gaps.length,
    sprachbausteineTeil2: sprach2.gaps.length,
    sprachbausteineTeil2Words: sprach2.words.length,
    hoeren: listening.map((part) => part.questions.length),
    schreiben: 1,
    sprechen: speaking.map((part) => part.part),
  };
  assertEqual('Counts', counts, {
    lesenTeil1: 5,
    lesenTeil1Titles: 10,
    lesenTeil2: 5,
    lesenTeil3: 10,
    lesenTeil3Announcements: 12,
    sprachbausteineTeil1: 10,
    sprachbausteineTeil2: 10,
    sprachbausteineTeil2Words: 15,
    hoeren: [5, 10, 5],
    schreiben: 1,
    sprechen: [1, 2, 3],
  });

  const [mt1Sprach1, mt1Listening, mt1SpeakingCount, mt1WritingCount] =
    await Promise.all([
      db.sprachbausteineExercise.findUnique({
        where: { modelltest_id: mt1.id },
        include: {
          gaps: {
            orderBy: { sort_order: 'asc' },
            include: { options: { orderBy: { sort_order: 'asc' } } },
          },
        },
      }),
      db.listeningExercise.findMany({
        where: { modelltest_id: mt1.id },
        orderBy: { part: 'asc' },
        include: { questions: { orderBy: { sort_order: 'asc' } } },
      }),
      db.speakingExercise.count({ where: { modelltest_id: mt1.id } }),
      db.writingExercise.count({ where: { modelltest_id: mt1.id } }),
    ]);
  if (!mt1Sprach1) throw new Error('Modelltest 1 Sprachbausteine is missing');

  const modelltest1Counts = {
    sprachbausteineTeil1: mt1Sprach1.gaps.length,
    sprachbausteineTeil1Options: mt1Sprach1.gaps.map(
      (gap) => gap.options.length,
    ),
    listeningQuestions: mt1Listening.map((part) => part.questions.length),
    speaking: mt1SpeakingCount,
    writing: mt1WritingCount,
  };
  assertEqual('Modelltest 1 core counts', modelltest1Counts, {
    sprachbausteineTeil1: 10,
    sprachbausteineTeil1Options: Array(10).fill(3),
    listeningQuestions: [5, 10, 5],
    speaking: 3,
    writing: 1,
  });
  assertEqual(
    'Modelltest 1 Sprachbausteine answer key',
    mt1Sprach1.gaps.map(
      (gap) => gap.options.find((option) => option.is_correct)?.sort_order,
    ),
    [2, 2, 2, 0, 0, 1, 1, 1, 1, 1],
  );

  const speakingPart2 = speaking.find((part) => part.part === 2);
  if (
    !speakingPart2 ||
    !JSON.stringify(speakingPart2.topic_points).includes('Teilnehmer/in A') ||
    !JSON.stringify(speakingPart2.topic_points).includes('Teilnehmer/in B')
  ) {
    throw new Error('Sprechen Teil 2 participant A/B mapping is incomplete');
  }
  if (listening.some((part) => !part.transcript)) {
    throw new Error('One or more Hören transcripts are missing');
  }

  console.log(
    JSON.stringify(
      {
        modelltest: { number: 2, title: mt2.title, independentFromModelltest1: true },
        counts,
        answerKeysVerified: true,
        transcriptsPresent: listening.map((part) => Boolean(part.transcript)),
        speakingPart2ParticipantsPreserved: true,
        modelltest1Counts,
        media: {
          listeningAudioUrls: listening.map((part) => part.audio_url),
          listeningImageUrls: listening.map((part) => part.image_url),
          speakingImageUrls: speaking.map((part) => part.image_url),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
  await pool.end();
}
