-- ============================================================
-- SEED 001 — Sprachbausteine Teil 1, Modelltest 1
-- Source: Mit Erfolg zu telc Deutsch B1+ Beruf, Klett 2015
-- Answers verified from Lösungen page 81
--
-- Correct answers (from book):
--   21c  22c  23c  24a  25a  26b  27b  28b  29b  30b
-- ============================================================

BEGIN;

-- ── 1. Insert the exercise ──────────────────────────────────

INSERT INTO sprachbausteine_exercises
    (id, teil_number, content_revision, label, instruction, duration_minutes, body)
VALUES (
    'aaaaaaaa-0001-0001-0001-000000000001',
    1,
    'modelltest-1-v1',
    'Sprachbausteine, Teil 1',
    'Lesen Sie den Text und schließen Sie die Lücken 21–30. Welche Lösung (a, b oder c) ist jeweils richtig? Markieren Sie Ihre Lösungen für die Aufgaben 21–30 auf dem Antwortbogen.',
    18,
    -- The full text from Modelltest 1, Sprachbausteine Teil 1 (page 14)
    -- Gaps are encoded as -21- through -30- exactly where the blanks appear
    'Schroeder & Söhne, Aufzüge und Industrielifts

Mitteilung an alle Mitarbeiterinnen und Mitarbeiter mit Kundenkontakten

Sehr geehrte Damen und Herren,

-21- Sie wissen, wird die Konkurrenz in unserer Branche immer größer.
Mehrfach haben wir -22- darauf hingewiesen, dass es sehr wichtig ist, auf die guten Kontakte zu unseren Kunden zu achten. Diese garantieren -23- Existenz der Firma und Ihre Arbeitsplätze.

Leider mussten wir feststellen, -24- ein aufmerksamer Umgang mit Kunden oft nicht beachtet wird. Daher wiederholen wir heute noch einmal unsere Bitten:

• Lassen Sie Anrufer am Telefon nicht länger warten -25- unbedingt nötig.
• Beantworten Sie E-Mails und Briefe sofort – bestätigen Sie wenigstens -26- Empfang.
• Schicken Sie bitte das angeforderte Prospektmaterial sofort heraus.
• Versenden Sie E-Mails nie ohne eine höfliche Anrede und -27- Grußformel.

Noch einmal: Seien Sie zu unseren Geschäftspartnern bitte immer höflich. Wir können uns keinen verärgerten Kunden leisten. Nicht nur unsere Produkte müssen erstklassig sein – auch unser Umgang mit den Kunden -28- erstklassig sein.

Mit freundlichen -29-

-30- Geschäftsleitung'
);

-- ── 2. Insert the 10 gaps ───────────────────────────────────

INSERT INTO sprachbausteine_gaps (id, exercise_id, gap_key, gap_number, sort_order)
VALUES
    ('bbbbbbbb-0021-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '21', 21, 0),
    ('bbbbbbbb-0022-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '22', 22, 1),
    ('bbbbbbbb-0023-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '23', 23, 2),
    ('bbbbbbbb-0024-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '24', 24, 3),
    ('bbbbbbbb-0025-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '25', 25, 4),
    ('bbbbbbbb-0026-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '26', 26, 5),
    ('bbbbbbbb-0027-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '27', 27, 6),
    ('bbbbbbbb-0028-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '28', 28, 7),
    ('bbbbbbbb-0029-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '29', 29, 8),
    ('bbbbbbbb-0030-0001-0001-000000000001', 'aaaaaaaa-0001-0001-0001-000000000001', '30', 30, 9);

-- ── 3. Insert the 3 options for each gap ───────────────────
-- sort_order: 0 = option a, 1 = option b, 2 = option c
-- is_correct: TRUE for the verified correct answer

-- Gap 21 → correct: c (wie)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0021-0001-0001-000000000001', 'ob',   FALSE, 0),
    ('bbbbbbbb-0021-0001-0001-000000000001', 'wenn', FALSE, 1),
    ('bbbbbbbb-0021-0001-0001-000000000001', 'wie',  TRUE,  2);

-- Gap 22 → correct: c (Sie)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0022-0001-0001-000000000001', 'ihr', FALSE, 0),
    ('bbbbbbbb-0022-0001-0001-000000000001', 'sie', FALSE, 1),
    ('bbbbbbbb-0022-0001-0001-000000000001', 'Sie', TRUE,  2);

-- Gap 23 → correct: c (die)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0023-0001-0001-000000000001', 'dem',    FALSE, 0),
    ('bbbbbbbb-0023-0001-0001-000000000001', 'dessen', FALSE, 1),
    ('bbbbbbbb-0023-0001-0001-000000000001', 'die',    TRUE,  2);

-- Gap 24 → correct: a (dass)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0024-0001-0001-000000000001', 'dass', TRUE,  0),
    ('bbbbbbbb-0024-0001-0001-000000000001', 'weil', FALSE, 1),
    ('bbbbbbbb-0024-0001-0001-000000000001', 'wenn', FALSE, 2);

-- Gap 25 → correct: a (als)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0025-0001-0001-000000000001', 'als',  TRUE,  0),
    ('bbbbbbbb-0025-0001-0001-000000000001', 'durch',FALSE, 1),
    ('bbbbbbbb-0025-0001-0001-000000000001', 'wenn', FALSE, 2);

-- Gap 26 → correct: b (den)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0026-0001-0001-000000000001', 'das', FALSE, 0),
    ('bbbbbbbb-0026-0001-0001-000000000001', 'den', TRUE,  1),
    ('bbbbbbbb-0026-0001-0001-000000000001', 'der', FALSE, 2);

-- Gap 27 → correct: b (eine)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0027-0001-0001-000000000001', 'ein',   FALSE, 0),
    ('bbbbbbbb-0027-0001-0001-000000000001', 'eine',  TRUE,  1),
    ('bbbbbbbb-0027-0001-0001-000000000001', 'einer', FALSE, 2);

-- Gap 28 → correct: b (muss)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0028-0001-0001-000000000001', 'müssen', FALSE, 0),
    ('bbbbbbbb-0028-0001-0001-000000000001', 'muss',   TRUE,  1),
    ('bbbbbbbb-0028-0001-0001-000000000001', 'musste', FALSE, 2);

-- Gap 29 → correct: b (Grüßen)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0029-0001-0001-000000000001', 'Grüße',  FALSE, 0),
    ('bbbbbbbb-0029-0001-0001-000000000001', 'Grüßen', TRUE,  1),
    ('bbbbbbbb-0029-0001-0001-000000000001', 'Gruß',   FALSE, 2);

-- Gap 30 → correct: b (Ihre)
INSERT INTO sprachbausteine_gap_options (gap_id, content, is_correct, sort_order)
VALUES
    ('bbbbbbbb-0030-0001-0001-000000000001', 'Eure',   FALSE, 0),
    ('bbbbbbbb-0030-0001-0001-000000000001', 'Ihre',   TRUE,  1),
    ('bbbbbbbb-0030-0001-0001-000000000001', 'Unsere', FALSE, 2);

COMMIT;
