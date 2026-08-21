-- Deterministic content seed. The unique (modelltest_id, part) constraints and
-- ON CONFLICT updates make this safe to rerun without creating duplicates.
BEGIN;

DO $$
DECLARE
  mt1 UUID;
  listening_id UUID;
BEGIN
  SELECT "id" INTO mt1 FROM "modelltests" WHERE "number" = 1;
  IF mt1 IS NULL THEN
    RAISE EXCEPTION 'Modelltest 1 must exist before seeding listening/speaking content';
  END IF;

  INSERT INTO "listening_exercises" (
    "modelltest_id", "part", "title", "subtitle", "instruction",
    "content_revision", "duration_minutes", "audio_url",
    "bundled_audio_asset", "image_url", "transcript"
  ) VALUES (
    mt1, 1, 'Teil 1', 'Hörverstehen, Teil 1',
    'Sie hören die Aussagen von fünf Personen. Sie hören die Aussagen nur einmal. Entscheiden Sie beim Hören, ob die Aussagen 41–45 richtig (+) oder falsch (–) sind.',
    'modelltest-1-teil-1-v1', 10, '', '',
    'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil1.png', NULL
  ) ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "instruction" = EXCLUDED."instruction",
    "content_revision" = EXCLUDED."content_revision",
    "duration_minutes" = EXCLUDED."duration_minutes",
    "audio_url" = EXCLUDED."audio_url",
    "bundled_audio_asset" = EXCLUDED."bundled_audio_asset",
    "image_url" = EXCLUDED."image_url", "transcript" = EXCLUDED."transcript"
  RETURNING "id" INTO listening_id;

  INSERT INTO "listening_questions"
    ("exercise_id", "question_number", "prompt", "correct_answer", "sort_order")
  VALUES
    (listening_id, 41, 'Für Manfred Rienke ist das Fortbildungsangebot wichtig.', '-', 0),
    (listening_id, 42, 'Alena Groll bildet sich regelmäßig weiter.', '+', 1),
    (listening_id, 43, 'Weng Wang stellt vor dem Seminar viele Fragen an die Seminarleitung.', '-', 2),
    (listening_id, 44, 'Maria Vallomäinen erklärt, wie Fortbildungsveranstaltungen entstehen.', '+', 3),
    (listening_id, 45, 'Manus Mani lehnt Fortbildungen ab, weil dann seine eigene Arbeit liegen bleibt.', '+', 4)
  ON CONFLICT ("exercise_id", "question_number") DO UPDATE SET
    "prompt" = EXCLUDED."prompt", "correct_answer" = EXCLUDED."correct_answer",
    "sort_order" = EXCLUDED."sort_order";

  INSERT INTO "listening_exercises" (
    "modelltest_id", "part", "title", "subtitle", "instruction",
    "content_revision", "duration_minutes", "audio_url",
    "bundled_audio_asset", "image_url", "transcript"
  ) VALUES (
    mt1, 2, 'Teil 2', 'Hörverstehen, Teil 2',
    'Sie hören ein Gespräch. Sie hören das Gespräch zweimal. Entscheiden Sie beim Hören, ob die Aussagen 46–55 richtig (+) oder falsch (–) sind.',
    'modelltest-1-teil-2-v1', 10, '', '',
    'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil2.png', NULL
  ) ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "instruction" = EXCLUDED."instruction",
    "content_revision" = EXCLUDED."content_revision",
    "duration_minutes" = EXCLUDED."duration_minutes",
    "audio_url" = EXCLUDED."audio_url",
    "bundled_audio_asset" = EXCLUDED."bundled_audio_asset",
    "image_url" = EXCLUDED."image_url", "transcript" = EXCLUDED."transcript"
  RETURNING "id" INTO listening_id;

  INSERT INTO "listening_questions"
    ("exercise_id", "question_number", "prompt", "correct_answer", "sort_order")
  VALUES
    (listening_id, 46, 'Frau Pauß möchte Herrn Lissitsky kurz sprechen.', '+', 0),
    (listening_id, 47, 'Herr Lissitsky hat nicht so viel zu tun.', '-', 1),
    (listening_id, 48, 'Herr Lissitsky meint, die Quartalszahlen zeigen eine positive Entwicklung.', '-', 2),
    (listening_id, 49, 'Frau Pauß spricht über die Lieferung an die ausländische Firma Novis.', '+', 3),
    (listening_id, 50, 'Der Auftrag war leicht auszuführen.', '-', 4),
    (listening_id, 51, 'Die Firma Novis beklagt sich nun.', '+', 5),
    (listening_id, 52, 'Die Firma versteht die Mahnungen nicht.', '+', 6),
    (listening_id, 53, 'Herr Lissitsky hat sich um die bezahlten Rechnungen gekümmert.', '-', 7),
    (listening_id, 54, 'Frau Pauß bittet Herrn Lissitsky um seine Hilfe bei der Suche nach möglichen Ursachen.', '+', 8),
    (listening_id, 55, 'Frau Pauß erwartet keine Antwort von Herrn Lissitsky.', '-', 9)
  ON CONFLICT ("exercise_id", "question_number") DO UPDATE SET
    "prompt" = EXCLUDED."prompt", "correct_answer" = EXCLUDED."correct_answer",
    "sort_order" = EXCLUDED."sort_order";

  INSERT INTO "listening_exercises" (
    "modelltest_id", "part", "title", "subtitle", "instruction",
    "content_revision", "duration_minutes", "audio_url",
    "bundled_audio_asset", "image_url", "transcript"
  ) VALUES (
    mt1, 3, 'Teil 3', 'Hörverstehen, Teil 3',
    'Sie hören fünf kurze Texte. Sie hören die Texte zweimal. Entscheiden Sie beim Hören, ob die Aussagen 56–60 richtig (+) oder falsch (–) sind.',
    'modelltest-1-teil-3-v1', 10, '', '',
    'https://pub-9c97adaccfb94d4bb515056232bed4f8.r2.dev/hoerverstehen_teil3.png', NULL
  ) ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "instruction" = EXCLUDED."instruction",
    "content_revision" = EXCLUDED."content_revision",
    "duration_minutes" = EXCLUDED."duration_minutes",
    "audio_url" = EXCLUDED."audio_url",
    "bundled_audio_asset" = EXCLUDED."bundled_audio_asset",
    "image_url" = EXCLUDED."image_url", "transcript" = EXCLUDED."transcript"
  RETURNING "id" INTO listening_id;

  INSERT INTO "listening_questions"
    ("exercise_id", "question_number", "prompt", "correct_answer", "sort_order")
  VALUES
    (listening_id, 56, 'Herr Lehmann würde gern später kommen.', '+', 0),
    (listening_id, 57, 'Der Chef berücksichtigt die Änderung in der Tagesordnung.', '+', 1),
    (listening_id, 58, 'Im Falle einer Notsituation kann Ihnen die Firma Sabel nicht helfen.', '+', 2),
    (listening_id, 59, 'Frau Arnold kann Ihnen zu Ihrer Fortbildung Auskunft geben.', '-', 3),
    (listening_id, 60, 'Sie kommen nicht pünktlich am Zielort an.', '+', 4)
  ON CONFLICT ("exercise_id", "question_number") DO UPDATE SET
    "prompt" = EXCLUDED."prompt", "correct_answer" = EXCLUDED."correct_answer",
    "sort_order" = EXCLUDED."sort_order";

  INSERT INTO "speaking_exercises" (
    "modelltest_id", "part", "title", "subtitle", "topic_title",
    "topic_description", "topic_points", "instructions", "duration_minutes",
    "prep_duration_seconds", "image_url", "exam_image_url", "content_revision"
  ) VALUES
    (mt1, 1, 'Lire à voix haute', 'Lisez la phrase affichée à voix haute.',
     'Aufgabe: Stellen Sie sich vor',
     'Sprechen Sie über sich. Gehen Sie auf die folgenden Punkte ein. Bilden Sie vollständige Sätze.',
     '["Name", "Alter", "Land & Wohnort", "Sprachen", "Beruf", "Hobby"]'::jsonb,
     'In this Teil, you will introduce yourself. Talk about your name, where you are from, your hobbies, and your work or studies. Speak naturally and clearly.',
     10, 300, 'assets/images/modules/sprechen.jpg', NULL,
     'modelltest-1-sprechen-teil-1-v1'),
    (mt1, 2, 'Dialogue', 'Pratiquez des échanges courts en situation.',
     'Aufgabe: Bildbeschreibung',
     'Beschreiben Sie das Bild genau. Was sehen Sie? Wie ist die Situation?',
     '["Was sehen Sie auf dem Foto?", "Was machen die Personen?", "Wie ist die Umgebung/Wetter?", "Ihre persönliche Meinung zum Thema."]'::jsonb,
     'In this Teil, you will describe a picture and express your opinion on the topic shown. Give concrete examples and elaborate your thoughts.',
     15, 300, 'assets/images/modules/sprechen.jpg', 'assets/images/modules/sprechen.jpg',
     'modelltest-1-sprechen-teil-2-v1'),
    (mt1, 3, 'Répétition', 'Répétez la phrase après l''écoute.',
     'Aufgabe: Ein Abschiedsfest planen',
     'Ihr Kollege Patrick verlässt die Firma. Sie möchten mit Ihrer Partnerin eine Überraschungsparty organisieren.',
     '["Wann feiern?", "Wo feiern?", "Essen und Trinken?", "Geschenk für Patrick?", "Wer wird eingeladen?"]'::jsonb,
     'In this Teil, you will discuss a task with a partner. Take a position, suggest ideas, and reach an agreement together.',
     5, 300, 'assets/images/modules/sprechen.jpg', NULL,
     'modelltest-1-sprechen-teil-3-v1')
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "topic_title" = EXCLUDED."topic_title",
    "topic_description" = EXCLUDED."topic_description",
    "topic_points" = EXCLUDED."topic_points",
    "instructions" = EXCLUDED."instructions",
    "duration_minutes" = EXCLUDED."duration_minutes",
    "prep_duration_seconds" = EXCLUDED."prep_duration_seconds",
    "image_url" = EXCLUDED."image_url",
    "exam_image_url" = EXCLUDED."exam_image_url",
    "content_revision" = EXCLUDED."content_revision";
END $$;

COMMIT;
