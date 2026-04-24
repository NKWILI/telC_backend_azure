-- ============================================================
-- SEED 005 — Leseverstehen Teil 3, Modelltest 1
-- Source: Mit Erfolg zu telc Deutsch B1+ Beruf, Klett 2015, pp. 12–15
-- Answers verified from Lösungen page 81
--
-- Correct answers: 11j  12g  13d  14h  15X  16e  17k  18l  19b  20c
--
-- Announcement UUID → letter mapping:
--   dddddddd-0001 = a  Rechtsanwalt Mark Lutz
--   dddddddd-0002 = b  Grober Schmutz muss weg!
--   dddddddd-0003 = c  Anwälte Hilge, Neumann
--   dddddddd-0004 = d  Firma für Schutz
--   dddddddd-0005 = e  Wirtschaftsprüfungs- u. Steuerberatungsgesellschaft
--   dddddddd-0006 = f  Unsere Dienste zu Ihrer Verfügung!       (decoy)
--   dddddddd-0007 = g  Wegmeier — Beratungsgesellschaft mbH
--   dddddddd-0008 = h  Objektsicherheit
--   dddddddd-0009 = i  Zuverlässige Lohnbuchhalterin            (decoy)
--   dddddddd-0010 = j  Jana Potok & Partner GbR
--   dddddddd-0011 = k  Klarsicht Gebäudereinigung GmbH
--   dddddddd-0012 = l  Frische Raumpflege GmbH & Co KG
-- ============================================================

BEGIN;

-- ── 1. Exercise ─────────────────────────────────────────────

INSERT INTO lesen_teil3_exercises (id, "contentRevision", label, instruction)
VALUES (
    'bbbbbbbb-0001-0003-0003-000000000001',
    'modelltest-1-lesen-teil3-v1',
    'Leseverstehen, Teil 3',
    'Lesen Sie die Situationen 11–20 und die Anzeigen a–l.
Finden Sie für jede Situation die passende Anzeige.
Sie können jede Anzeige nur einmal benutzen.
Markieren Sie Ihre Lösungen für die Aufgaben 11–20
auf dem Antwortbogen.
Wenn Sie zu einer Situation keine Anzeige finden,
markieren Sie ein X.'
);

-- ── 2. Announcements (must be inserted before situations — FK on correctAnnouncementId) ──

INSERT INTO lesen_teil3_announcements (id, "exerciseId", title, content, "sortOrder") VALUES
    (
        'dddddddd-0001-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Rechtsanwalt Mark Lutz',
        'Fachanwalt f. Medizin- u. Sozialrecht. Seit 25 Jahren bieten wir unsere Dienste an. Remscheider Str. 216, 83012 Oberfeld. www.ra-lutz.de. (0762) 335 62',
        0
    ),
    (
        'dddddddd-0002-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Grober Schmutz muss weg!',
        'Ihr Spezialist in Sachen Reinigung Jasmin Lehr. Unterhaltsreinigung • Baureinigung • Winterdienst. Firma Grobe, Unter der Esche 8, 85689 Eickenpfahl. Heribert.Grobe@grobe.eu',
        1
    ),
    (
        'dddddddd-0003-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Anwälte Hilge, Neumann',
        'Fachanwälte für Patentrecht, zugelassen beim Europäischen Patentamt u. Gemeinschaftsmarkenamt. Unsere Kanzlei begleitet Sie über das Antragsverfahren bis zum Eintrag Ihrer Marke. Nussweg 9, 79876 Plauberg. info@hilgeneumann.de, 0345 2476',
        2
    ),
    (
        'dddddddd-0004-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Firma für Schutz',
        'Soforteinsatz mit Notdienst und 24-Stunden-Notrufzentrale. Baustellenbewachung, Unterstützung durch unsere speziell trainierten Vierbeiner, Wachhunde, Kassendienst. Kostenlose Rufnummer aus allen Mobilnetzen: 534209',
        3
    ),
    (
        'dddddddd-0005-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Wirtschaftsprüfungs- u. Steuerberatungsgesellschaft',
        'Ihr Ansprechpartner für ein erfolgreiches Unternehmen. Diplom-Betriebswirt Steuerberater Henrik Bott. info@henrik-bott.com',
        4
    ),
    (
        'dddddddd-0006-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Unsere Dienste zu Ihrer Verfügung!',
        'Kontroll- und Schließdienste, diskret und sicher. Wir führen regelmäßig Schließgänge durch, schalten Ihre Alarmanlage scharf und deaktivieren sie wieder. Bewachungs- und Sicherheitsdienst Plagemann. info@plagemann.de',
        5
    ),
    (
        'dddddddd-0007-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Wegmeier — Beratungsgesellschaft mbH',
        'GmbH-Beratung • Vereinssteuerrecht • Existenzgründungsberatung • Seminarangebot rund um Ihre Selbstständigkeit. 56498 Rippert, Wolframring 98–102. Tel.: 0987 9865',
        6
    ),
    (
        'dddddddd-0008-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Objektsicherheit',
        'Bären-Wache: Ein Einsatz für Kontroll-/Schließdienste! Wir kommen zu jeder Stunde, in jeder Jahreszeit — egal, ob es schneit oder die Sonne scheint. Wir vermitteln Ihnen auch kompetente Mitarbeiter für die Pforte oder den Empfang! An der Brücke 7, 23987 Erlenburg',
        7
    ),
    (
        'dddddddd-0009-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Zuverlässige Lohnbuchhalterin',
        'mit fundierten aktuellen Kenntnissen im Lohnsteuer-, Sozialversicherungs- und Tarifrecht sucht neue Herausforderung. PV 3445',
        8
    ),
    (
        'dddddddd-0010-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Jana Potok & Partner GbR',
        'Rechtsanwälte — Fachanwälte f. Arbeitsrecht. Wir beraten und vertreten Sie kompetent in allen Problemfällen rund um Ihre Arbeitsstelle. Ringstr. 11–14, 90187 Untermark. Buero-untermark@ra-potok-partner.de',
        9
    ),
    (
        'dddddddd-0011-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Klarsicht Gebäudereinigung GmbH',
        'Ihr Partner für alle Gebäudedienste. Fassadenreinigung • Glasreinigung • Desinfektion • Teppichreinigung. info@klarsicht.net. Rotbarschweg 9, 43651 Buchse',
        10
    ),
    (
        'dddddddd-0012-0003-0003-000000000001',
        'bbbbbbbb-0001-0003-0003-000000000001',
        'Frische Raumpflege GmbH & Co Gebäudereinigung & Service KG',
        'Sie werden staunen, was unsere Putzfeen vollbringen! E-mail: info@fr-born.de. www.frische-raumpflege-born.de',
        11
    );

-- ── 3. Situations ────────────────────────────────────────────

-- Situation 11 — correct: j = Jana Potok (dddddddd-0010)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0011-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    11,
    'Ihr Arbeitgeber hat Ihnen zwei Monate lang keinen Lohn gezahlt.',
    false,
    'dddddddd-0010-0003-0003-000000000001',
    0
);

-- Situation 12 — correct: g = Wegmeier (dddddddd-0007)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0012-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    12,
    'Sie wollen sich selbstständig machen und möchten sich noch besser informieren.',
    false,
    'dddddddd-0007-0003-0003-000000000001',
    1
);

-- Situation 13 — correct: d = Firma für Schutz (dddddddd-0004)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0013-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    13,
    'Das Gelände Ihrer Firma soll in der Nacht mit Wachhunden geschützt werden.',
    false,
    'dddddddd-0004-0003-0003-000000000001',
    2
);

-- Situation 14 — correct: h = Objektsicherheit (dddddddd-0008)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0014-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    14,
    'Sie suchen jemanden für den Empfang.',
    false,
    'dddddddd-0008-0003-0003-000000000001',
    3
);

-- Situation 15 — correct: X (no match)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0015-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    15,
    'Zum 50-jährigen Firmenjubiläum erwarten Sie viele Gäste. Sie wollen für ihre Sicherheit sorgen.',
    true,
    NULL,
    4
);

-- Situation 16 — correct: e = Wirtschaftsprüfungs- u. Steuerberatungsgesellschaft (dddddddd-0005)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0016-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    16,
    'Ihr Unternehmen benötigt Hilfe in Steuerfragen.',
    false,
    'dddddddd-0005-0003-0003-000000000001',
    5
);

-- Situation 17 — correct: k = Klarsicht (dddddddd-0011)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0017-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    17,
    'Die Fenster Ihrer Firma müssen gereinigt werden.',
    false,
    'dddddddd-0011-0003-0003-000000000001',
    6
);

-- Situation 18 — correct: l = Frische Raumpflege (dddddddd-0012)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0018-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    18,
    'Ihre Reinigungskraft im Großraumbüro arbeitet unzuverlässig und Sie suchen einen Ersatz.',
    false,
    'dddddddd-0012-0003-0003-000000000001',
    7
);

-- Situation 19 — correct: b = Grober Schmutz muss weg! (dddddddd-0002)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0019-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    19,
    'Am Firmenort hatten Sie im letzten Jahr große Schwierigkeiten mit dem Schnee, der nicht geräumt wurde.',
    false,
    'dddddddd-0002-0003-0003-000000000001',
    8
);

-- Situation 20 — correct: c = Anwälte Hilge, Neumann (dddddddd-0003)
INSERT INTO lesen_teil3_situations
    (id, "exerciseId", "situationNumber", content, "noMatch", "correctAnnouncementId", "sortOrder")
VALUES (
    'eeeeeeee-0020-0003-0003-000000000001',
    'bbbbbbbb-0001-0003-0003-000000000001',
    20,
    'Mitarbeiter Ihrer Firma wollen eine neue technische Erfindung anmelden und damit schützen.',
    false,
    'dddddddd-0003-0003-0003-000000000001',
    9
);

COMMIT;
