-- ============================================================
-- SEED 004 — Leseverstehen Teil 1, Modelltest 1
-- Source: Mit Erfolg zu telc Deutsch B1+ Beruf, Klett 2015, pp. 8–9
-- Answers verified from Lösungen page 81
--
-- Correct answers: 1g  2e  3c  4a  5h
-- Title UUID → letter mapping:
--   ffffffff-0001 = a  Anfrage
--   ffffffff-0002 = b  Lieferschein       (decoy)
--   ffffffff-0003 = c  Reklamation
--   ffffffff-0004 = d  Schadensmeldung    (decoy)
--   ffffffff-0005 = e  Schließregelung
--   ffffffff-0006 = f  Sommerfest         (decoy)
--   ffffffff-0007 = g  Terminabsage
--   ffffffff-0008 = h  Terminverschiebung
--   ffffffff-0009 = i  Terminzusage       (decoy)
--   ffffffff-0010 = j  Übernachtung       (decoy)
-- ============================================================

BEGIN;

-- ── 1. Exercise ─────────────────────────────────────────────

INSERT INTO lesen_teil1_exercises (id, "contentRevision", label, instruction)
VALUES (
    'eeeeeeee-0001-0001-0001-000000000001',
    'modelltest-1-lesen-teil1-v1',
    'Leseverstehen, Teil 1',
    'Lesen Sie die folgenden fünf Texte. Es fehlt jeweils der Betreff. Entscheiden Sie, welcher Betreff (a–j) am besten zu welcher Betreffzeile (1–5) passt. Tragen Sie Ihre Lösungen für die Aufgaben 1–5 in den Antwortbogen ein.'
);

-- ── 2. Titles (must be inserted before texts — FK on correctTitleId) ──

INSERT INTO lesen_teil1_titles (id, "exerciseId", content, "sortOrder") VALUES
    ('ffffffff-0001-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Anfrage',             0),
    ('ffffffff-0002-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Lieferschein',        1),
    ('ffffffff-0003-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Reklamation',         2),
    ('ffffffff-0004-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Schadensmeldung',     3),
    ('ffffffff-0005-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Schließregelung',     4),
    ('ffffffff-0006-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Sommerfest',          5),
    ('ffffffff-0007-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Terminabsage',        6),
    ('ffffffff-0008-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Terminverschiebung',  7),
    ('ffffffff-0009-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Terminzusage',        8),
    ('ffffffff-0010-0001-0001-000000000001', 'eeeeeeee-0001-0001-0001-000000000001', 'Übernachtung',        9);

-- ── 3. Texts ────────────────────────────────────────────────

-- Email 1 — correct: g = Terminabsage (ffffffff-0007)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0001-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    1,
    'r.fazli@grb.com',
    'v.gruedle@grb.com',
    'Hallo Frau Grüdle,
leider kann ich nicht an der Dienstbesprechung am nächsten
Donnerstag teilnehmen. Wie wir bereits vor Längerem besprochen
haben, habe ich mich zur Trainingsreihe „Personalführung"
angemeldet. Als ich mich anmelden wollte, kam ich nur auf die
Warteliste. Eben hat mich der Veranstalter angerufen, dass ein
Platz krankheitsbedingt frei geworden ist. Weil die nächste Reihe
erst in einem halben Jahr beginnt, möchte ich meine Teilnahme an
der Dienstbesprechung absagen.
Vielen Dank für Ihr Verständnis!
Herzlichen Gruß
Ramik Fazli',
    0,
    'ffffffff-0007-0001-0001-000000000001'
);

-- Email 2 — correct: e = Schließregelung (ffffffff-0005) — von/an NULL (internal notice)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0002-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    2,
    NULL,
    NULL,
    'Liebe Kolleginnen und Kollegen,
der Sicherheitsdienst hat mich informiert, dass die Eingangstüre
bei der Routinekontrolle am vergangenen Samstag nicht richtig
verschlossen war. Man konnte zwar nicht ins Gebäude gelangen,
dennoch stand auf dem Display nicht „Verschlossen". Wir hoffen,
dass nichts Schlimmes passiert ist, aber im Schadensfall würde die
Versicherung nichts bezahlen. Bitte achten Sie daher beim Verlassen
des Gebäudes freitags nach 16:00 Uhr darauf, dass das digitale
Display neben der Tür „Verschlossen" anzeigt.
Vielen Dank für Ihre Unterstützung!
gez. Postmann
Verwaltungsleitung',
    1,
    'ffffffff-0005-0001-0001-000000000001'
);

-- Email 3 — correct: c = Reklamation (ffffffff-0003)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0003-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    3,
    'rene.gallack@fa-rzw.de',
    'stephan.gerke@werbeagentur.net',
    'Sehr geehrter Herr Gerke,
vielen Dank für Ihre schnelle Lieferung. Wir haben 4.000 Stück
Werbebroschüren für unser neuestes Produkt bestellt. Allerdings
haben Sie 500 Stück weniger geliefert. Aber auf dem Lieferschein
steht die bestellte Menge.
Wir hoffen, dass es sich um ein Versehen handelt und erwarten in
Kürze Ihre Nachlieferung.
Mit freundlichen Grüßen
René Gallack',
    2,
    'ffffffff-0003-0001-0001-000000000001'
);

-- Email 4 — correct: a = Anfrage (ffffffff-0001)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0004-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    4,
    'i.villa@kompsit.net',
    'aurum@gaestehaus.com',
    'Sehr geehrte Damen und Herren,
unsere Firma plant für Anfang November eine zweitägige
internationale Tagung zum Thema „Technik und Innovation". Wir
suchen einen großen Konferenzsaal mit der modernsten technischen
Ausstattung. Da wir auch in Gruppen arbeiten werden, benötigen
wir zusätzlich vier kleinere Räume. Ist dies möglich? Natürlich
möchten wir für alle Teilnehmenden das Mittag- und Abendessen
buchen.
Wir erwarten ca. 80 Kunden aus dem In- und Ausland. Daher wäre
es praktisch, wenn diese am Tagungsort auch übernachten könnten.
Hätten Sie genug Einzelzimmer?
Bitte schicken Sie mir Ihre komplette Angebotsliste mit Preisen.
Mit freundlichen Grüßen
Ines Villa',
    3,
    'ffffffff-0001-0001-0001-000000000001'
);

-- Email 5 — correct: h = Terminverschiebung (ffffffff-0008)
INSERT INTO lesen_teil1_texts
    (id, "exerciseId", "textNumber", von, an, body, "sortOrder", "correctTitleId")
VALUES (
    '44444444-0005-0001-0001-000000000001',
    'eeeeeeee-0001-0001-0001-000000000001',
    5,
    'michaela.rojka@rett-platt.de',
    'nella.weber@rett-platt.de',
    'Hallo Nella,
ich habe gerade in meinem Kalender unser Treffen morgen um 16 Uhr
entdeckt. Wir wollten doch den Aufbau des Seminars zum
interkulturellen Training „Fettnäpfchen in Russland vermeiden"
besprechen. Könnten wir uns auch direkt nach der Mittagspause um
13.30 Uhr zusammensetzen? Danach muss ich nämlich zum Elternabend
in Michas Kindergarten. Das Sommerfest steht an ...
Sag mir kurz Bescheid.
Michaela',
    4,
    'ffffffff-0008-0001-0001-000000000001'
);

COMMIT;
