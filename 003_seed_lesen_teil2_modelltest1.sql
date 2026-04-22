-- ============================================================
-- SEED 003 — Leseverstehen Teil 2, Modelltest 1
-- Source: Mit Erfolg zu telc Deutsch B1+ Beruf, Klett 2015, pp. 10–11
-- Answers verified from Lösungen page 81
--
-- Correct answers: 6c  7a  8a  9a  10c
-- ============================================================

BEGIN;

-- ── 1. Insert the exercise ──────────────────────────────────

INSERT INTO lesen_teil2_exercises
    (id, "contentRevision", label, instruction, "cautionNote",
     "topSender", "topReceiver", "topBody", "quotedThread")
VALUES (
    'cccccccc-0002-0002-0002-000000000001',
    'modelltest-1-lesen-teil2-v1',
    'Leseverstehen, Teil 2',
    'Lesen Sie die E-Mail und die Aufgaben 6–10. Welche Lösung (a, b oder c) ist jeweils richtig? Markieren Sie Ihre Lösungen für die Aufgaben 6–10 auf dem Antwortbogen.',
    'Achtung! Die Aufgaben stehen nicht immer in der gleichen Reihenfolge wie die Informationen im Text.',
    'k.weisshaupt@web.de',
    'j.baric@freenet.com',
    'Sehr geehrter Herr Baric,
vielen Dank für Ihr Angebot, das ich annehme.
Bitte bestellen Sie die notwendigen Zusatzgeräte.
Mit freundlichen Grüßen
Karin Weisshaupt',
    'Johannes Baric schrieb:
> Sehr geehrte Frau Weisshaupt,
> vielen Dank für Ihre freundliche Mail.
> Dass Sie mit dem Wagen zufrieden sind, freut uns sehr.
> Zu Ihren Wünschen kann ich Ihnen mitteilen, dass wir die
> gewünschten Arbeiten gerne in unserer eigenen Werkstatt
> durchführen können. Die Arbeiten werden an einem Tag
> durchgeführt. Die Lieferung der Zusatzgeräte dauert ab
> Bestellung zwei Werktage.
> Zu den Kosten teile ich Ihnen mit, dass die Freisprechanlage
> € 450,00, die Diebstahlsicherung € 525,00 und der CD-Player
> € 610,00 kosten. Der gesamte Einbau kostet dann zusätzlich
> € 500,00, alle Preise jeweils zzgl. der gesetzlichen MwSt.
> Wenn Sie mit diesem Angebot einverstanden sind, können wir
> die Arbeiten am Dienstag in der kommenden Woche ausführen.
> Selbstverständlich stellen wir Ihnen für diesen Tag kostenlos
> einen Leihwagen zur Verfügung.
> Bitte teilen Sie uns mit, ob Sie unser Angebot annehmen möchten.
> Mit freundlichen Grüßen
> Johannes Baric
> Autohandel Baric GmbH

Karin Weisshaupt schrieb:
>> Sehr geehrter Herr Baric,
>> ich habe vor einem Monat bei Ihnen einen Neuwagen,
>> VW Passat, gekauft. Ich bin mit dem Wagen sehr zufrieden.
>> Während unseres Verkaufsgespräches haben Sie mir
>> freundlicherweise Prospektmaterial zur Verfügung gestellt,
>> in dem alle zusätzlichen Ausstattungsmöglichkeiten für den
>> Wagen angeboten werden.
>> Ich habe mich nun dafür entschieden, folgende Extras
>> einbauen zu lassen:
>> eine Freisprechanlage für mein Handy, da ich beruflich viel
>> mit dem Wagen unterwegs bin und auch beruflich telefonisch
>> erreichbar sein muss, eine Diebstahlsicherung und einen
>> sehr guten CD-Player.
>> Ich möchte die Einbauarbeiten gerne in Ihrer Werkstatt
>> durchführen lassen. Alle Arbeiten sollten an einem Tag
>> durchgeführt werden. Den Zeitpunkt dafür müssten wir vorab
>> genau besprechen, weil ich meine Termine dann besser
>> planen kann.
>> Bitte teilen Sie mir mit, ob dies so möglich ist und ob Sie
>> in den nächsten Tagen einen Termin freihaben.
>> Außerdem bitte ich um Ihr Angebot mit allen Informationen,
>> welche Kosten auf mich zukommen.
>> Ich danke Ihnen und verbleibe
>> mit freundlichen Grüßen
>> Karin Weisshaupt'
);

-- ── 2. Insert the 5 questions ───────────────────────────────

INSERT INTO lesen_teil2_questions (id, "exerciseId", "questionNumber", prompt, "sortOrder")
VALUES
    ('dddddddd-0006-0002-0002-000000000001', 'cccccccc-0002-0002-0002-000000000001', 6,  'Die Arbeiten können in der Werkstatt durchgeführt werden, wenn', 0),
    ('dddddddd-0007-0002-0002-000000000001', 'cccccccc-0002-0002-0002-000000000001', 7,  'Frau Weisshaupt benötigt eine Freisprechanlage, weil sie', 1),
    ('dddddddd-0008-0002-0002-000000000001', 'cccccccc-0002-0002-0002-000000000001', 8,  'Die genannten zusätzlichen Kosten sind für', 2),
    ('dddddddd-0009-0002-0002-000000000001', 'cccccccc-0002-0002-0002-000000000001', 9,  'Die Werkstatt braucht für die Einbauarbeiten', 3),
    ('dddddddd-0010-0002-0002-000000000001', 'cccccccc-0002-0002-0002-000000000001', 10, 'Der Leihwagen kostet für Frau Weisshaupt', 4);

-- ── 3. Insert the 3 options per question ────────────────────
-- "sortOrder": 0=a  1=b  2=c
-- "isCorrect": TRUE for the verified answer

-- Question 6 → correct: c
INSERT INTO lesen_teil2_options ("questionId", content, "isCorrect", "sortOrder")
VALUES
    ('dddddddd-0006-0002-0002-000000000001', 'der Termin nicht abgesprochen werden muss',              FALSE, 0),
    ('dddddddd-0006-0002-0002-000000000001', 'der Termin von der Werkstatt festgelegt werden kann',    FALSE, 1),
    ('dddddddd-0006-0002-0002-000000000001', 'der Termin vorher mit Frau Weisshaupt abgesprochen wird', TRUE, 2);

-- Question 7 → correct: a
INSERT INTO lesen_teil2_options ("questionId", content, "isCorrect", "sortOrder")
VALUES
    ('dddddddd-0007-0002-0002-000000000001', 'den Wagen beruflich nutzt',                              TRUE,  0),
    ('dddddddd-0007-0002-0002-000000000001', 'gerne mit ihren Freundinnen telefonisch Kontakt hat',    FALSE, 1),
    ('dddddddd-0007-0002-0002-000000000001', 'jederzeit für ihre Familie erreichbar sein möchte',      FALSE, 2);

-- Question 8 → correct: a
INSERT INTO lesen_teil2_options ("questionId", content, "isCorrect", "sortOrder")
VALUES
    ('dddddddd-0008-0002-0002-000000000001', 'alle Einbauarbeiten',    TRUE,  0),
    ('dddddddd-0008-0002-0002-000000000001', 'den CD-Player',          FALSE, 1),
    ('dddddddd-0008-0002-0002-000000000001', 'die Diebstahlsicherung', FALSE, 2);

-- Question 9 → correct: a
INSERT INTO lesen_teil2_options ("questionId", content, "isCorrect", "sortOrder")
VALUES
    ('dddddddd-0009-0002-0002-000000000001', 'einen Tag',    TRUE,  0),
    ('dddddddd-0009-0002-0002-000000000001', 'fünf Stunden', FALSE, 1),
    ('dddddddd-0009-0002-0002-000000000001', 'zwei Tage',    FALSE, 2);

-- Question 10 → correct: c
INSERT INTO lesen_teil2_options ("questionId", content, "isCorrect", "sortOrder")
VALUES
    ('dddddddd-0010-0002-0002-000000000001', '€ 450,00',   FALSE, 0),
    ('dddddddd-0010-0002-0002-000000000001', '€ 525,00',   FALSE, 1),
    ('dddddddd-0010-0002-0002-000000000001', 'gar nichts', TRUE,  2);

COMMIT;
