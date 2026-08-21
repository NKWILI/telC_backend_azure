-- Modelltest 2 normalized from modelltest2_seed_source.json.
-- Runtime-only mapping: extraction provenance/sourceTrack are intentionally omitted.
-- Re-running replaces only Modelltest 2 child content, keeping the seed deterministic.
BEGIN;

DO $$
DECLARE
  mt2 UUID;
  seed_exercise_id UUID;
BEGIN
  INSERT INTO "modelltests" ("number", "title")
  VALUES (2, 'Modelltest 2')
  ON CONFLICT ("number") DO UPDATE SET "title" = EXCLUDED."title"
  RETURNING "id" INTO mt2;

  INSERT INTO "lesen_teil1_exercises"
    ("contentRevision", "label", "instruction", "modelltest_id")
  VALUES ('modelltest-2-lesen-teil1-v1', 'Leseverstehen, Teil 1', 'Lesen Sie die folgenden fünf Texte. Es fehlt jeweils der Betreff. Entscheiden Sie, welcher Betreff (a–j) am besten zu welcher Betreffzeile (1–5) passt.
Tragen Sie Ihre Lösungen für die Aufgaben 1–5 in den Antwortbogen ein.', mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "contentRevision" = EXCLUDED."contentRevision",
    "label" = EXCLUDED."label",
    "instruction" = EXCLUDED."instruction"
  RETURNING "id" INTO seed_exercise_id;

  DELETE FROM "lesen_teil1_texts" WHERE "exerciseId" = seed_exercise_id;
  DELETE FROM "lesen_teil1_titles" WHERE "exerciseId" = seed_exercise_id;
  INSERT INTO "lesen_teil1_titles" ("exerciseId", "content", "sortOrder") VALUES
    (seed_exercise_id, 'Abschiedsfeier', 0),
    (seed_exercise_id, 'Beschwerde', 1),
    (seed_exercise_id, 'Eingangsbestätigung', 2),
    (seed_exercise_id, 'Erstbestellung', 3),
    (seed_exercise_id, 'Firmenjubiläum', 4),
    (seed_exercise_id, 'Krankmeldung', 5),
    (seed_exercise_id, 'Nachbestellung', 6),
    (seed_exercise_id, 'Termin verschieben?', 7),
    (seed_exercise_id, 'Terminabsage', 8),
    (seed_exercise_id, 'Terminbestätigung', 9);
  INSERT INTO "lesen_teil1_texts"
    ("exerciseId", "textNumber", "von", "an", "body", "sortOrder", "correctTitleId") VALUES
    (seed_exercise_id, 1, 'Wilfried Jung, Novo-Bank', 'Manfred Ulmen, Büro & Co.', 'Gesendet: 22.5.2015, 14:27

Sehr geehrter Herr Ulmen,
vielen Dank für Ihre E-Mail und Ihren Terminvorschlag. Gerne können wir uns am Freitag um 12 Uhr in unserem Konferenzraum treffen, um über eine mögliche Bestellung neuer Büromöbel zu sprechen.

Mit freundlichen Grüßen
W. Jung
Filialleiter Novo-Bank Neustadt', 0, (SELECT "id" FROM "lesen_teil1_titles" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 9)),
    (seed_exercise_id, 2, NULL, NULL, 'Sehr geehrte Damen und Herren,
wir bestätigen den Erhalt Ihrer Reklamation bezüglich Ihrer Telefonkosten. Wir werden die Angelegenheit umgehend prüfen und melden uns innerhalb der nächsten 14 Tage wieder bei Ihnen. Sollten Sie in der Zwischenzeit Fragen haben, stehen wir Ihnen unter unserer kostenlosen Hotline gerne zur Verfügung.

Mit freundlichen Grüßen
Telefix GmbH', 1, (SELECT "id" FROM "lesen_teil1_titles" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 2)),
    (seed_exercise_id, 3, NULL, NULL, 'Sehr geehrte Frau Thang,
wie Sie wissen, benutzen wir seit vielen Jahren in unserem Hotel die Geschirrserie „Sommerbrise“. Da in der Zwischenzeit wieder einige Sachen kaputt gegangen sind, würden wir gerne folgende Geschirrteile bestellen:

30 Teller (groß), Nr. 321-TL
15 Teller (tief), Nr. 321-TT
20 Salatteller, Nr. 321-ST

Ich hoffe, die Serie wird noch immer produziert. Bitte bestätigen Sie doch so schnell wie möglich die Bestellung. Vielen Dank!

Mit freundlichen Grüßen
Joachim Sauer
Restaurant „Zum Anker“', 2, (SELECT "id" FROM "lesen_teil1_titles" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 6)),
    (seed_exercise_id, 4, NULL, NULL, 'Liebe Marion,
wir hatten uns für morgen um 10 Uhr verabredet, um in Raum R001 gemeinsam an der Präsentation für die Betriebsversammlung zu arbeiten. Leider muss ich nun morgen Früh noch etwas für meinen Kollegen erledigen, der krank ist. Das wird so bis zum Mittag dauern, deshalb würde ich mich gerne erst gegen 14 Uhr treffen. Wäre das okay für dich?

Liebe Grüße
Christina', 3, (SELECT "id" FROM "lesen_teil1_titles" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 7)),
    (seed_exercise_id, 5, 'Maria Olbas', 'alle', 'Gesendet: 25.5.2015, 14:23

Liebe Kolleginnen und Kollegen,
am kommenden Montag wird unser Kollege Rolf Groß nach 35 Jahren Firmenzugehörigkeit in den Ruhestand verabschiedet. Die Feier beginnt gegen 10 Uhr und endet mit einem gemeinsamen Mittagessen um 12.30 Uhr.
Wer noch etwas Geld in das Sparschwein tun möchte, das wir Rolf am Montag schenken, kann sich noch bis Freitag bei mir melden.

Kollegiale Grüße
Maria Olbas (Betriebsrat)', 4, (SELECT "id" FROM "lesen_teil1_titles" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 0));

  INSERT INTO "lesen_teil2_exercises"
    ("contentRevision", "label", "instruction", "cautionNote", "topSender",
     "topReceiver", "topBody", "quotedThread", "modelltest_id")
  VALUES ('modelltest-2-lesen-teil2-v1', 'Leseverstehen, Teil 2', 'Lesen Sie die E-Mails und die Aufgaben 6–10. Welche Lösung (a, b oder c) ist jeweils richtig?
Markieren Sie Ihre Lösungen für die Aufgaben 6–10 auf dem Antwortbogen.',
    'Achtung!
Die Aufgaben stehen nicht immer in der gleichen Reihenfolge wie die Informationen im Text.', 'R. Hubert <ralf.hubert@hubert-renovierung.de>', 'M. Scheuer <margit.scheuer@tiptopreisen.eu>',
    'Betreff: Re: Aw: Re: Mängel bei Renovierungsarbeiten
Gesendet: 06.03. um 07:35 Uhr

Sehr geehrte Frau Scheuer,
vielen Dank für die Terminbestätigung. Den gewünschten Kostenvoranschlag erhalten Sie bis spätestens morgen mit gesonderter Mail.

Mit freundlichen Grüßen
Ralf Hubert', 'Margit Scheuer schrieb am 05.03. um 14:12 Uhr
> Sehr geehrter Herr Hubert,
> gerne bestätige ich den Termin am 09.03. für das Nachstreichen der Wand. Wegen des Kratzers im Boden
> muss ich mich bei Ihnen entschuldigen: Von meiner Chefin habe ich erfahren, dass der Kratzer im Boden bei
> der Lieferung eines neuen Schranks vorgestern entstanden ist. Der Schaden wird von der Versicherung des
> Lieferanten bezahlt. Machen Sie mir doch bitte einen Kostenvoranschlag für die Reparatur des Bodens.
>
> Mit freundlichen Grüßen
> Margit Scheuer

Ralf Hubert schrieb am 05.03. um 08:01 Uhr:
>> Sehr geehrte Frau Scheuer,
>> es tut mir sehr leid, dass Sie mit unserer Arbeit nicht ganz zufrieden sind. Natürlich werden wir noch einmal
>> in Ihr Reisebüro kommen und die Wand oberhalb des Regals richtig streichen. Würde es Ihnen am 09.03.
>> gegen 10 Uhr passen? Den Kratzer im Boden können wir aber leider nicht als Mangel akzeptieren: Wir
>> haben den Boden bereits vor 3 Tagen verlegt, und Ihre Chefin hat schriftlich bestätigt, dass die Arbeit
>> ordnungsgemäß ausgeführt wurde. Vor 3 Tagen war noch kein Kratzer im Boden.
>>
>> Mit freundlichen Grüßen
>> Ralf Hubert (Hubert Renovierungen)

Margit Scheuer schrieb am 04.03. um 12:49 Uhr:
>>> Sehr geehrter Herr Hubert,
>>> gestern Abend haben Sie ja die Renovierungsarbeiten in unserem Reisebüro abgeschlossen. Leider sind
>>> wir nicht ganz zufrieden und müssen uns daher bei Ihnen beschweren.
>>> Die neuen Böden in unserem Büro sehen zwar sehr gut aus, aber an einer Stelle ist ein großer Kratzer in
>>> der Oberfläche (direkt am Eingang!). Außerdem wurden die Wände nicht richtig gestrichen: Über dem
>>> Regal sieht man leider noch alte Farbe. Wir haben starken Kundenverkehr, und natürlich fallen diese
>>> Mängel sofort negativ auf. Wir möchten Sie daher bitten, die Mängel innerhalb einer Woche zu beseitigen.
>>> Vielen Dank im Voraus.
>>>
>>> Mit freundlichen Grüßen
>>> Margit Scheuer (TipTop-Reisen GmbH)', mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "contentRevision" = EXCLUDED."contentRevision", "label" = EXCLUDED."label",
    "instruction" = EXCLUDED."instruction", "cautionNote" = EXCLUDED."cautionNote",
    "topSender" = EXCLUDED."topSender", "topReceiver" = EXCLUDED."topReceiver",
    "topBody" = EXCLUDED."topBody", "quotedThread" = EXCLUDED."quotedThread"
  RETURNING "id" INTO seed_exercise_id;

  DELETE FROM "lesen_teil2_options" WHERE "questionId" IN
    (SELECT "id" FROM "lesen_teil2_questions" WHERE "exerciseId" = seed_exercise_id);
  DELETE FROM "lesen_teil2_questions" WHERE "exerciseId" = seed_exercise_id;
  INSERT INTO "lesen_teil2_questions"
    ("exerciseId", "questionNumber", "prompt", "sortOrder")
  VALUES (seed_exercise_id, 6, 'Herr Hubert', 0)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "lesen_teil2_options" ("questionId", "content", "isCorrect", "sortOrder") VALUES
    (seed_exercise_id, 'bringt den Kostenvoranschlag am 9.3. persönlich vorbei.', false, 0),
    (seed_exercise_id, 'informiert Frau Scheuer innerhalb von 24 Stunden telefonisch über die Kosten.', false, 1),
    (seed_exercise_id, 'schickt am 6. oder 7. März einen Kostenvoranschlag.', true, 2);
  SELECT "id" INTO seed_exercise_id FROM "lesen_teil2_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "lesen_teil2_questions"
    ("exerciseId", "questionNumber", "prompt", "sortOrder")
  VALUES (seed_exercise_id, 7, 'Nach dem Verlegen des Bodens', 1)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "lesen_teil2_options" ("questionId", "content", "isCorrect", "sortOrder") VALUES
    (seed_exercise_id, 'hat die Vorgesetzte von Frau Scheuer die Arbeiten geprüft.', true, 0),
    (seed_exercise_id, 'hat Frau Scheuer die Arbeiten überprüft.', false, 1),
    (seed_exercise_id, 'wurden die Arbeiten von Herrn Huberts Vorgesetztem geprüft.', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "lesen_teil2_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "lesen_teil2_questions"
    ("exerciseId", "questionNumber", "prompt", "sortOrder")
  VALUES (seed_exercise_id, 8, 'Die Schäden am Boden', 2)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "lesen_teil2_options" ("questionId", "content", "isCorrect", "sortOrder") VALUES
    (seed_exercise_id, 'sind durch Mitarbeiter des Reisebüros entstanden.', false, 0),
    (seed_exercise_id, 'werden am 09.03. von Herrn Hubert repariert.', false, 1),
    (seed_exercise_id, 'wurden von einer anderen Firma verursacht.', true, 2);
  SELECT "id" INTO seed_exercise_id FROM "lesen_teil2_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "lesen_teil2_questions"
    ("exerciseId", "questionNumber", "prompt", "sortOrder")
  VALUES (seed_exercise_id, 9, 'Herr Hubert', 3)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "lesen_teil2_options" ("questionId", "content", "isCorrect", "sortOrder") VALUES
    (seed_exercise_id, 'bietet einen Termin für die Reparatur des Bodens an.', false, 0),
    (seed_exercise_id, 'denkt, dass die Chefin des Reisebüros für den Kratzer verantwortlich ist.', false, 1),
    (seed_exercise_id, 'schreibt, dass der Boden ohne Beschädigung verlegt wurde.', true, 2);
  SELECT "id" INTO seed_exercise_id FROM "lesen_teil2_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "lesen_teil2_questions"
    ("exerciseId", "questionNumber", "prompt", "sortOrder")
  VALUES (seed_exercise_id, 10, 'Frau Scheuer beschwert sich, weil', 4)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "lesen_teil2_options" ("questionId", "content", "isCorrect", "sortOrder") VALUES
    (seed_exercise_id, 'die Kunden wegen der mangelhaften Renovierung nicht mehr kommen.', false, 0),
    (seed_exercise_id, 'die Malerarbeiten nicht richtig ausgeführt wurden.', true, 1),
    (seed_exercise_id, 'Herr Hubert einen Kratzer in die Eingangstür gemacht hat.', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "lesen_teil2_exercises" WHERE "modelltest_id" = mt2;

  INSERT INTO "lesen_teil3_exercises"
    ("contentRevision", "label", "instruction", "modelltest_id")
  VALUES ('modelltest-2-lesen-teil3-v1', 'Leseverstehen, Teil 3', 'Lesen Sie die Situationen 11–20 und die Anzeigen a–l. Finden Sie für jede Situation die passende Anzeige.
Sie können jede Anzeige nur einmal benutzen.
Markieren Sie Ihre Lösungen für die Aufgaben 11–20 auf dem Antwortbogen.
Wenn Sie zu einer Situation keine Anzeige finden, markieren Sie ein X.', mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "contentRevision" = EXCLUDED."contentRevision", "label" = EXCLUDED."label",
    "instruction" = EXCLUDED."instruction"
  RETURNING "id" INTO seed_exercise_id;

  DELETE FROM "lesen_teil3_situations" WHERE "exerciseId" = seed_exercise_id;
  DELETE FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id;
  INSERT INTO "lesen_teil3_announcements" ("exerciseId", "title", "content", "sortOrder") VALUES
    (seed_exercise_id, 'Elektroinstallationen', 'Wir führen Elektroinstallationen schnell und fachgerecht aus – von der Lampe bis zum Herd. Natürlich verlegen wir bei Bedarf auch neue Stromleitungen. Rabatte für Großkunden.
Elektriker Peter Reimann,
Tel. 0140/922 911 900', 0),
    (seed_exercise_id, 'Meininger – Dienstleistungen rund ums Büro', 'Zuverlässiger Dienstleister seit vielen Jahren, mehrere Großkunden. Angebot flexibel nach Ihren Bedürfnissen (Reinigung von Möbeln, Böden und Fenstern, Müllentsorgung, Versorgung von Pflanzen etc.).
Infos: Herr Paul, 0800/190921', 1),
    (seed_exercise_id, 'Elektronikgroßmarkt Mars', 'PCs, Notebooks, Monitore und mehr gibt es nur bei uns zum besten Preis. Super Angebote für Firmenkunden, sprechen Sie uns an!
Kostenlose Hotline: Tel. 0800/100 200 999
www.elektronik-mars.de', 2),
    (seed_exercise_id, 'Hilfe im Büro', 'Mittelständisches Unternehmen sucht Aushilfe auf Stundenbasis für Tätigkeiten wie das Kopieren und Sortieren von Unterlagen, Abtippen von Diktaten etc. Interesse?
Rufen Sie an: 0889/299293-0', 3),
    (seed_exercise_id, 'Bewegung statt sitzen', 'Sie arbeiten viel am Schreibtisch? Sie brauchen mehr Bewegung? Lauftreff in der Innenstadt, jeden Di. und Do. ab 18.30 Uhr. Anfänger willkommen. Laufrouten durch den Stadtpark.
Infos: Ingo Schmoll, Tel. 0179/660 123', 4),
    (seed_exercise_id, 'Bürowelt Markus', 'Umschläge (in allen Größen)
Schreibgeräte (Bleistifte, Kulis, Füller etc.)
Kleingeräte (Locher, Hefter usw.)
Papier (bis DIN A1 auf Lager)
Und vieles mehr!
www.bueroweltmarkus.eu', 5),
    (seed_exercise_id, 'Reinigungskraft', 'mit langjähriger Erfahrung im Reinigen von Innen- und Außenbereichen gesucht, pünktlich und zuverlässig. Bitte neues Betätigungsfeld ab sofort.
Tel. 0176/555090909', 6),
    (seed_exercise_id, 'Altes in neuem Gewand', 'Wir gestalten Ihre Büroräume neu mit schönen Tapeten und frischen Farben. Arbeiten können auch am Wochenende ausgeführt werden.
Kontakt: anfrage@malermeister-limm.eu', 7),
    (seed_exercise_id, 'Wer viel am Schreibtisch arbeitet, ...', '… weiß bequeme Möbel zu schätzen.
Unser Möbelhaus ist spezialisiert auf Büromöbel, auch für Großkunden.
Neuen Katalog jetzt anfordern!
ProBüro GmbH, 01805/132097', 8),
    (seed_exercise_id, 'Gesund im Beruf', 'Kurs für alle, die sich über gesundes Arbeiten informieren wollen: gesunder Arbeitsplatz, sich richtig bewegen, Stress vermeiden. 3 x Mo. 18–21 Uhr, Teilnahmegebühr 75 Euro, Übernahme durch Arbeitgeber möglich. Infos & Anmeldung:
www.bildungsakademie-neustadt.de', 9),
    (seed_exercise_id, 'Büroarbeiten', 'Erledige Büroarbeiten (Abtippen, Ablage, Korrespondenz usw.) auf selbstständiger Basis, zuverlässig und pünktlich. Noch freie Kapazitäten (ca. 10 Std./Woche).', 10),
    (seed_exercise_id, 'Wir reinigen für Sie!', 'Was? Außenanlagen wie Bürgersteige, Einfahrten, Parkplätze usw.
Wann? Reinigung ist ganz nach Bedarf rund um die Uhr möglich.
Wer? Reinigungsdienst Weber,
info@reinigungsdienstweber.de', 11);
  INSERT INTO "lesen_teil3_situations"
    ("exerciseId", "situationNumber", "content", "noMatch", "correctAnnouncementId", "sortOrder") VALUES
    (seed_exercise_id, 11, 'Ihr Unternehmen braucht neue Computer und Sie wollen ein Angebot einholen.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 2), 0),
    (seed_exercise_id, 12, 'Sie möchten den Gemeinschaftsraum in Ihrer Firma neu tapezieren lassen.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 7), 1),
    (seed_exercise_id, 13, 'Ihr kleines Unternehmen sucht jemanden, der für fünf Stunden pro Woche bei der Büroarbeit hilft.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 10), 2),
    (seed_exercise_id, 14, 'Sie suchen neue Bürostühle für Ihr Unternehmen.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 8), 3),
    (seed_exercise_id, 15, 'Sie suchen eine Stelle als Bürokraft in Teil- oder Vollzeit.', true, NULL, 4),
    (seed_exercise_id, 16, 'Sie suchen jemanden, der den Firmenparkplatz in Ordnung hält.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 11), 5),
    (seed_exercise_id, 17, 'Sie möchten Druckerpapier bestellen.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 5), 6),
    (seed_exercise_id, 18, 'Sie suchen einen Dienstleister für die Reinigung der Bürofenster.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 1), 7),
    (seed_exercise_id, 19, 'Sie wollen in Ihrem Unternehmen eine neue Beleuchtungsanlage anbringen lassen.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 0), 8),
    (seed_exercise_id, 20, 'Sie möchten Informationen darüber, was Sie gegen Stress am Arbeitsplatz tun können.', false, (SELECT "id" FROM "lesen_teil3_announcements" WHERE "exerciseId" = seed_exercise_id AND "sortOrder" = 9), 9);

  INSERT INTO "sprachbausteine_exercises"
    ("teil_number", "content_revision", "label", "instruction", "duration_minutes",
     "image_url", "body", "modelltest_id")
  VALUES (1, 'modelltest-2-sprachbausteine-teil1-v1', 'Sprachbausteine, Teil 1',
    'Lesen Sie den Text und schließen Sie die Lücken 21–30. Welche Lösung (a, b oder c) ist jeweils richtig?
Markieren Sie Ihre Lösungen für die Aufgaben 21–30 auf dem Antwortbogen.', 18, '', 'Information: Neue Schließanlage

Im kommenden Monat -21- in unserem Bürogebäude eine neue Schließanlage eingebaut. Wir möchten Sie schon jetzt -22- die wichtigsten Änderungen informieren.

Bis zum Ende dieses Monats kann jeder Mitarbeiter in der Personalabteilung -23- persönliche Zugangskarte abholen. Sie müssen bei der Abholung persönlich erscheinen und auch eine Quittung -24-.

Ab dem kommenden Monat können Sie den Haupteingang im Erdgeschoss sowie die Türen zu den Büros im ersten und zweiten Stock nur noch -25- Ihrer Zugangskarte öffnen. Einige Mitarbeiter (u. a. Abteilungsleiter) haben noch einen Schlüssel -26- den Haupteingang. Bitte geben Sie diese Schlüssel -27-, nachdem die neue Schließanlage eingebaut wurde.

Die Bedienung -28- Schließanlage ist ganz leicht: Halten Sie Ihre Zugangskarte einfach an das Lesegerät und die Tür wird automatisch geöffnet. Sollten Sie Probleme mit der Karte haben, -29- Sie sich jederzeit an die Mitarbeiter am Empfang wenden.

Wichtig: Wenn Sie Ihre Zugangskarte verlieren oder die Karte -30- wird, melden Sie sich bitte sofort beim Empfang! Wir müssen Ihre Karte dann sperren lassen.', mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "teil_number" = EXCLUDED."teil_number", "content_revision" = EXCLUDED."content_revision",
    "label" = EXCLUDED."label", "instruction" = EXCLUDED."instruction",
    "duration_minutes" = EXCLUDED."duration_minutes", "image_url" = EXCLUDED."image_url",
    "body" = EXCLUDED."body"
  RETURNING "id" INTO seed_exercise_id;

  DELETE FROM "sprachbausteine_gap_options" WHERE "gap_id" IN
    (SELECT "id" FROM "sprachbausteine_gaps" WHERE "exercise_id" = seed_exercise_id);
  DELETE FROM "sprachbausteine_gaps" WHERE "exercise_id" = seed_exercise_id;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '21', 21, 0)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'wird', true, 0),
    (seed_exercise_id, 'würde', false, 1),
    (seed_exercise_id, 'wurde', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '22', 22, 1)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'an', false, 0),
    (seed_exercise_id, 'für', false, 1),
    (seed_exercise_id, 'über', true, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '23', 23, 2)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'ihre', false, 0),
    (seed_exercise_id, 'seine', true, 1),
    (seed_exercise_id, 'unsere', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '24', 24, 3)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'unterschreiben', true, 0),
    (seed_exercise_id, 'unterschrieben', false, 1),
    (seed_exercise_id, 'zu unterschreiben', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '25', 25, 4)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'aus', false, 0),
    (seed_exercise_id, 'bei', false, 1),
    (seed_exercise_id, 'mit', true, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '26', 26, 5)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'für', true, 0),
    (seed_exercise_id, 'nach', false, 1),
    (seed_exercise_id, 'über', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '27', 27, 6)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'ab', true, 0),
    (seed_exercise_id, 'an', false, 1),
    (seed_exercise_id, 'zu', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '28', 28, 7)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'der', true, 0),
    (seed_exercise_id, 'des', false, 1),
    (seed_exercise_id, 'die', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '29', 29, 8)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'können', true, 0),
    (seed_exercise_id, 'möchten', false, 1),
    (seed_exercise_id, 'müssen', false, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;
  INSERT INTO "sprachbausteine_gaps"
    ("exercise_id", "gap_key", "gap_number", "sort_order")
  VALUES (seed_exercise_id, '30', 30, 9)
  RETURNING "id" INTO seed_exercise_id;
  INSERT INTO "sprachbausteine_gap_options" ("gap_id", "content", "is_correct", "sort_order") VALUES
    (seed_exercise_id, 'gestehlt', false, 0),
    (seed_exercise_id, 'gestiehlt', false, 1),
    (seed_exercise_id, 'gestohlen', true, 2);
  SELECT "id" INTO seed_exercise_id FROM "sprachbausteine_exercises" WHERE "modelltest_id" = mt2;

  INSERT INTO "sprachbausteine_teil2_exercises"
    ("contentRevision", "label", "instruction", "durationMinutes", "image_url", "body", "modelltest_id")
  VALUES ('modelltest-2-sprachbausteine-teil2-v1', 'Sprachbausteine, Teil 2', 'Lesen Sie den Text und schließen Sie die Lücken 31–40. Benutzen Sie die Wörter a–o.
Jedes Wort passt nur einmal.
Markieren Sie Ihre Lösungen für die Aufgaben 31–40 auf dem Antwortbogen.', 18, '', 'Papierbörse GmbH
Verkauf
Schlossweg 180
10130 Berlin

Pallhuber & Söhne
Einkauf
Kirchstraße 1
70900 Neudorf

20.04.2015

Reklamation

Sehr geehrte Damen und Herren,

am 03.04. haben wir bei Ihnen 100 Kartons Papier (Format DIN A4) sowie 50 Pakete Briefumschläge (Format C4) -31-.

Vor zwei Tagen haben wir Ihre -32- erhalten, aber leider war sie nicht vollständig. Wir haben nur 95 Kartons Papier und 40 Pakete Briefumschläge -33-. Natürlich haben wir sofort bei Ihnen angerufen, aber leider haben wir niemanden -34-. Deshalb beschweren wir uns nun schriftlich bei Ihnen. Bitte -35- Sie uns die fehlende Ware innerhalb einer Woche zu.

Wir sind -36- seit 5 Jahren Kunde bei Ihnen. In der Vergangenheit waren wir auch immer sehr zufrieden mit dem Versand sowie der Qualität der -37-. Wir hoffen, dass derartige -38- in Zukunft nicht mehr vorkommen.

Bitte antworten Sie uns -39- und bestätigen Sie den Erhalt dieser Reklamation. Gerne können Sie sich auch telefonisch bei uns -40-. Unsere Rufnummer haben Sie ja.

Mit freundlichen Grüßen
K. Meyer', mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "contentRevision" = EXCLUDED."contentRevision", "label" = EXCLUDED."label",
    "instruction" = EXCLUDED."instruction", "durationMinutes" = EXCLUDED."durationMinutes",
    "image_url" = EXCLUDED."image_url", "body" = EXCLUDED."body"
  RETURNING "id" INTO seed_exercise_id;

  DELETE FROM "sprachbausteine_teil2_gaps" WHERE "exerciseId" = seed_exercise_id;
  DELETE FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id;
  INSERT INTO "sprachbausteine_teil2_words" ("exerciseId", "letter", "content", "sortOrder") VALUES
    (seed_exercise_id, 'a', 'ANTWORT', 0),
    (seed_exercise_id, 'b', 'BEREITS', 1),
    (seed_exercise_id, 'c', 'BESTELLT', 2),
    (seed_exercise_id, 'd', 'ERHALTEN', 3),
    (seed_exercise_id, 'e', 'ERREICHT', 4),
    (seed_exercise_id, 'f', 'GEHÖRT', 5),
    (seed_exercise_id, 'g', 'LIEFERUNG', 6),
    (seed_exercise_id, 'h', 'MEISTENS', 7),
    (seed_exercise_id, 'i', 'MELDEN', 8),
    (seed_exercise_id, 'j', 'NACHTRÄGLICH', 9),
    (seed_exercise_id, 'k', 'NOCH', 10),
    (seed_exercise_id, 'l', 'PROBLEME', 11),
    (seed_exercise_id, 'm', 'SENDEN', 12),
    (seed_exercise_id, 'n', 'UMGEHEND', 13),
    (seed_exercise_id, 'o', 'WAREN', 14);
  INSERT INTO "sprachbausteine_teil2_gaps"
    ("exerciseId", "gapKey", "gapNumber", "correctWordId", "sortOrder") VALUES
    (seed_exercise_id, '31', 31, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'c'), 0),
    (seed_exercise_id, '32', 32, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'g'), 1),
    (seed_exercise_id, '33', 33, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'd'), 2),
    (seed_exercise_id, '34', 34, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'e'), 3),
    (seed_exercise_id, '35', 35, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'm'), 4),
    (seed_exercise_id, '36', 36, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'b'), 5),
    (seed_exercise_id, '37', 37, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'o'), 6),
    (seed_exercise_id, '38', 38, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'l'), 7),
    (seed_exercise_id, '39', 39, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'n'), 8),
    (seed_exercise_id, '40', 40, (SELECT "id" FROM "sprachbausteine_teil2_words" WHERE "exerciseId" = seed_exercise_id AND "letter" = 'i'), 9);

  INSERT INTO "listening_exercises"
    ("modelltest_id", "part", "title", "subtitle", "instruction", "content_revision",
     "duration_minutes", "audio_url", "bundled_audio_asset", "image_url", "transcript")
  VALUES (mt2, 1, 'Teil 1', 'Hörverstehen, Teil 1', 'Sie hören die Aussagen von fünf Personen. Sie hören die Aussagen nur einmal. Entscheiden Sie beim Hören, ob die Aussagen 41–45 richtig (+) oder falsch (–) sind.
Markieren Sie Ihre Lösungen für die Aufgaben 41–45 auf dem Antwortbogen.
Lesen Sie jetzt die Aufgaben 41–45. Sie haben dazu 30 Sekunden Zeit.',
    'modelltest-2-hoeren-teil1-v1', 10, '', '', '', 'Moderatorin: Das Thema unserer heutigen Umfrage betrifft eigentlich alle, die arbeiten: das Essen in der Mittagspause. Wir haben einige Mitarbeiter aus unterschiedlichen Firmen gefragt. Hören Sie nun die Antworten.

41
Carlos Ramirez, Lagerist
Seit etwa einem Monat haben wir in unserer Firma auch eine Kantine. Viele Kollegen waren skeptisch, weil man ja oft hört, dass das Essen in einer Kantine nicht so gut sein soll. Ehrlich gesagt habe ich das früher auch gedacht. Ich war dann gleich nach der Eröffnung in unserer Kantine essen, und ich muss sagen – die Qualität der Mahlzeiten ist wirklich super. Jetzt gehe ich fast jeden Tag in die Kantine, allerdings … es gibt sehr oft die gleichen Mahlzeiten, ich würde mir da deutlich mehr Abwechslung wünschen.

42
Julia Reichelt, Sekretärin
Wir haben keine Kantine in unserem Betrieb, dafür sind wir viel zu klein. Aber in der Nähe gibt es viele Restaurants, die haben oft Mittagsangebote, und das Essen schmeckt auch toll. Meine Kollegin Sabine geht fast jeden Tag mittags raus. Ehrlich gesagt, ist mir das aber auf Dauer zu teuer, deshalb esse ich meist in unserem Pausenraum, zum Beispiel ein belegtes Brot oder einen Salat. So etwas kann ich gut zu Hause vorbereiten und dann einfach mitnehmen.

43
Marcus Thon, Systemadministrator
Tja, ehrlich gesagt, bleibe ich mittags nicht so gerne in der Firma, obwohl wir einen sehr schönen Pausenraum haben. Ich brauche einfach frische Luft und muss auch mal was anderes sehen als immer nur die Büroräume unserer Firma. Und ich möchte mich in der Pause eigentlich auch nicht über die Arbeit unterhalten, Pause ist schließlich Pause. Deshalb bin ich beim Mittagessen am liebsten allein, da kann ich wirklich entspannen und mal den Kopf freikriegen.

44
Vera Ingelhoff, Teamleiterin
Wir haben schon lange eine Kantine in der Firma. Früher gab es natürlich viel Fleisch, wie in den meisten Kantinen. Viele Kolleginnen und Kollegen wollten aber vegetarisch essen und sind deshalb kaum in die Kantine gegangen. Inzwischen gibt es dort auch regelmäßig vegetarische Gerichte und sogar Bio-Mahlzeiten. Das finde ich super, jetzt findet wirklich jeder was. Ich esse übrigens auch ab und zu mal vegetarisch, aber ich mag auch Fleisch. Von daher finde ich das Angebot jetzt optimal.

45
Alexej Romanow, Mechatroniker
Ich arbeite in einer Autowerkstatt in einem Gewerbegebiet, und wir haben gegenüber einen Imbiss. Da gibt es Pommes, Currywurst und so was. Richtig gesund ist das ja nicht, und deshalb war ich früher auch höchstens einmal pro Woche dort. Aber … wir haben in letzter Zeit so viel Arbeit, dass kaum Zeit für die Pause bleibt – und was soll ich sagen? Zurzeit gehe ich fast täglich rüber zum Imbiss.')
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "instruction" = EXCLUDED."instruction", "content_revision" = EXCLUDED."content_revision",
    "duration_minutes" = EXCLUDED."duration_minutes", "audio_url" = EXCLUDED."audio_url",
    "bundled_audio_asset" = EXCLUDED."bundled_audio_asset", "image_url" = EXCLUDED."image_url",
    "transcript" = EXCLUDED."transcript"
  RETURNING "id" INTO seed_exercise_id;
  DELETE FROM "listening_questions" WHERE "exercise_id" = seed_exercise_id;
  INSERT INTO "listening_questions"
    ("exercise_id", "question_number", "prompt", "correct_answer", "sort_order") VALUES
    (seed_exercise_id, 41, 'Carlos Ramirez findet die Auswahl an Speisen in der Kantine seiner Firma sehr gut.', '-', 0),
    (seed_exercise_id, 42, 'Julia Reichelt bringt Essen von zu Hause mit, um Geld zu sparen.', '+', 1),
    (seed_exercise_id, 43, 'Marcus Thon geht mittags am liebsten ohne Kollegen essen.', '+', 2),
    (seed_exercise_id, 44, 'Vera Ingelhoff wünscht sich mehr vegetarische Gerichte in der Kantine.', '-', 3),
    (seed_exercise_id, 45, 'Alexej Romanow geht heute öfter zum Imbiss als früher.', '+', 4);

  INSERT INTO "listening_exercises"
    ("modelltest_id", "part", "title", "subtitle", "instruction", "content_revision",
     "duration_minutes", "audio_url", "bundled_audio_asset", "image_url", "transcript")
  VALUES (mt2, 2, 'Teil 2', 'Hörverstehen, Teil 2', 'Sie hören ein Gespräch. Sie hören das Gespräch zweimal. Entscheiden Sie beim Hören, ob die Aussagen 46–55 richtig (+) oder falsch (–) sind.
Markieren Sie Ihre Lösungen für die Aufgaben 46–55 auf dem Antwortbogen.
Lesen Sie jetzt die Aufgaben 46–55. Sie haben dazu eine Minute Zeit.',
    'modelltest-2-hoeren-teil2-v1', 10, '', '', '', 'Judith Rose, Ralf Trommler

Judith Rose: Guten Morgen, Herr Trommler! Das ist ja schön, dass wir uns als Betriebsrat heute zusammensetzen können, um über die Pläne der Firmenleitung für einen Fitnessraum zu sprechen.
Ralf Trommler: Hallo, Frau Rose. Ja, das finde ich auch. Der Betriebsrat hat ja vor vielen Jahren schon mal so einen Vorschlag gemacht, aber damals wurde er sofort vom Geschäftsführer abgelehnt.
Judith Rose: Ach ja? Da war ich wohl noch gar nicht in der Firma. Ich war nämlich ziemlich überrascht, als ich vorgestern von der Idee gehört habe, einen Fitnessraum in unserem Betrieb einzurichten. Ich dachte, das wäre ein ziemlich spontaner Einfall gewesen.
Ralf Trommler: So genau weiß ich ehrlich gesagt auch nicht mehr, wer den Vorschlag zuerst gemacht hat. Und noch ist ja nichts entschieden. Jedenfalls haben wir jetzt die Aufgabe, uns dazu Gedanken zu machen. Ich schlage vor, dass wir jetzt erst mal ein paar Ideen sammeln, zum Beispiel Vorteile und Nachteile so eines Raumes, und in den nächsten Wochen können wir auch noch die Mitarbeiter befragen.
Judith Rose: Ja, das wäre gut. Ich würde auch gerne wissen, was unsere Kolleginnen und Kollegen davon halten. Also, fangen wir erst mal an. Mein erster Gedanke war, dass so ein Fitnessraum sicher eine Menge Geld kostet. Das könnte man doch besser für neue Mitarbeiterparkplätze oder Monatstickets ausgeben.
Ralf Trommler: Okay … ich notiere das mal. Ich denke aber, dass wir viele Geräte auch günstig gebraucht kaufen können, das gibt es doch heutzutage sicher im Internet. Außerdem würde ich dann meine private Mitgliedschaft im Fitnessclub kündigen, da würde ich natürlich sparen.
Judith Rose: Hmm, da ist was dran. Was natürlich auch für einen Fitnessraum spricht, ist, dass bei uns ja viele Kolleginnen und Kollegen von morgens bis abends am Computer sitzen und sich schon oft über Probleme mit dem Rücken beklagt haben. Wenn man zwischendurch immer mal wieder kurz Sport machen kann, bleibt man länger gesund und kann auch besser arbeiten.
Ralf Trommler: Ja, da haben Sie recht. Vielleicht gibt es langfristig auch nicht mehr so viele Krankmeldungen wie im letzten Jahr. Dann wäre es aber auch sinnvoll, wenn die Mitarbeiter während ihrer Arbeitszeit Sport machen dürfen, oder?
Judith Rose: Na ja … so pauschal geht das sicher nicht, dann würden einige wahrscheinlich von morgens bis abends nur noch Sport machen. Aber vielleicht eine halbe Stunde pro Woche … Wir können es ja mal vorschlagen.
Ralf Trommler: Mir ist noch etwas anderes eingefallen. Diese Fitnessgeräte sind ja nicht gerade leise, das könnte doch die Arbeit der anderen beeinträchtigen. Natürlich hängt es davon ab, wie wir den Raum isolieren und wo der Raum genau ist, aber so viel Platz haben wir ja nun auch nicht, irgendein Büro wäre immer in der Nähe.
Judith Rose: Stimmt, das sollte man vorab prüfen. Ehrlich gesagt, haben wir jetzt schon einige Nachteile oder zumindest problematische Aspekte gefunden, sodass ich langsam denke, ein Lauftreff am Abend wäre vielleicht besser.
Ralf Trommler: Hmm, also ich persönlich möchte nach Feierabend lieber nach Hause zu meiner Familie und nicht erst noch eine Stunde durch den Park joggen. Ich würde bei so etwas nicht mitmachen. Aber gut, wir können ja jetzt erst mal einen Fragebogen machen und die Kollegen befragen …
Judith Rose: Genau, wir haben ja schon einiges, ich setze mich gleich an den Computer und trage mal die Vor- und Nachteile zusammen …')
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "instruction" = EXCLUDED."instruction", "content_revision" = EXCLUDED."content_revision",
    "duration_minutes" = EXCLUDED."duration_minutes", "audio_url" = EXCLUDED."audio_url",
    "bundled_audio_asset" = EXCLUDED."bundled_audio_asset", "image_url" = EXCLUDED."image_url",
    "transcript" = EXCLUDED."transcript"
  RETURNING "id" INTO seed_exercise_id;
  DELETE FROM "listening_questions" WHERE "exercise_id" = seed_exercise_id;
  INSERT INTO "listening_questions"
    ("exercise_id", "question_number", "prompt", "correct_answer", "sort_order") VALUES
    (seed_exercise_id, 46, 'Frau Rose kannte die Pläne für einen Fitnessraum schon seit mehreren Wochen.', '-', 0),
    (seed_exercise_id, 47, 'Herr Trommler schlägt vor, auch die Meinung der Kollegen einzuholen.', '+', 1),
    (seed_exercise_id, 48, 'Frau Rose findet, dass das Geld eher für andere Zwecke ausgegeben werden sollte.', '+', 2),
    (seed_exercise_id, 49, 'Herr Trommler denkt, dass man die Kosten niedrig halten kann.', '+', 3),
    (seed_exercise_id, 50, 'Viele Mitarbeiter in der Firma haben Rückenbeschwerden.', '+', 4),
    (seed_exercise_id, 51, 'Herr Trommler meint, dass es weniger Fehlstunden wegen Krankheit gibt, wenn die Mitarbeiter Sport machen.', '+', 5),
    (seed_exercise_id, 52, 'Frau Rose schlägt vor, dass die Mitarbeiter einen Tag pro Woche Sport machen sollten.', '-', 6),
    (seed_exercise_id, 53, 'Der Fitnessraum kann weit entfernt von den Büros eingerichtet werden.', '-', 7),
    (seed_exercise_id, 54, 'Frau Rose denkt, dass man andere Möglichkeiten suchen sollte, um Sport zu treiben.', '+', 8),
    (seed_exercise_id, 55, 'Für Ralf Trommler ist Sport im Anschluss an die Arbeit eine gute Alternative.', '-', 9);

  INSERT INTO "listening_exercises"
    ("modelltest_id", "part", "title", "subtitle", "instruction", "content_revision",
     "duration_minutes", "audio_url", "bundled_audio_asset", "image_url", "transcript")
  VALUES (mt2, 3, 'Teil 3', 'Hörverstehen, Teil 3', 'Sie hören fünf kurze Texte. Sie hören die Texte zweimal. Entscheiden Sie beim Hören, ob die Aussagen 56–60 richtig (+) oder falsch (–) sind.
Markieren Sie Ihre Lösungen für die Aufgaben 56–60 auf dem Antwortbogen.
Lesen Sie jetzt die Aufgabe 56.',
    'modelltest-2-hoeren-teil3-v1', 10, '', '', '', '56
Ihr PC funktioniert nicht und Sie rufen eine Hotline an.
Guten Tag, Sie haben die PC-Servicehotline für unsere klein- und mittelständischen Firmenkunden gewählt. Leider sind momentan alle Leitungen besetzt. Sie werden mit dem nächsten freien Mitarbeiter verbunden. Zur Verbesserung unserer Servicequalität werden einzelne Gespräche aufgezeichnet. Wenn Sie mit der Aufzeichnung Ihres Gesprächs einverstanden sind, sagen Sie jetzt bitte deutlich „Ja“ …

57
Sie besuchen eine Lebensmittelmesse und hören eine Durchsage.
Liebe Messebesucher, wir möchten Sie auf eine aktuelle Veranstaltung um 15 Uhr in Halle 4.3 aufmerksam machen. Mitarbeiter vom Deutschen Lebensmittelinstitut erläutern dort die neuesten Vorgaben für Zusatzstoffe. Auch die Kennzeichnung der Waren wird ein Thema sein. Gerne können Sie dort auch Ihre Fragen stellen. Die Veranstaltung ist für Messebesucher kostenlos.

58
Sie kommen Montagfrüh in den Betrieb und hören den Anrufbeantworter ab.
Ja, hallo, Schneider hier, Ralf Schneider. Ich hatte vergangene Woche bei Ihnen neues Büromaterial bestellt, 5000 Blatt Papier, diverse Stifte und auch noch neue Aktenordner. Jetzt ist Samstag, und die Lieferung ist gerade angekommen, nur leider fehlt ausgerechnet das Papier. Ich muss aber bis Mittwoch Unterlagen für eine Schulung ausdrucken. Bitte melden Sie sich doch umgehend bei mir.

59
Sie müssen zu einer Messe in Frankfurt und hören am Bahnhof folgende Durchsage:
Sehr geehrte Reisende, beachten Sie bitte folgenden Hinweis zur S8 nach Offenbach über Frankfurt Flughafen und Frankfurt Hauptbahnhof: Wegen einer Oberleitungsstörung müssen alle Züge des Nahverkehrs derzeit umgeleitet werden. Dadurch verlängert sich die Fahrtzeit um etwa 20 Minuten. Wir bitten dies zu entschuldigen. Reisende nach Frankfurt Hauptbahnhof können ohne Zuschlag den ICE 1597 nutzen. Der Zug steht abfahrbereit an Gleis 4.

60
Sie hören nach der Mittagspause folgende Nachricht auf Ihrem Anrufbeantworter:
Hallo, hier ist die Firma Reinigungsblitz. Sie hatten ja bei uns neue Reinigungsmittel bestellt, und wir hatten versprochen, dass wir heute noch liefern. Leider ist unser Lkw nun unterwegs liegengeblieben, und wir können noch nicht sagen, ob wir es heute noch schaffen, die Ware zu Ihnen zu bringen, oder erst morgen. Rufen Sie mich kurz zurück? Danke!')
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "instruction" = EXCLUDED."instruction", "content_revision" = EXCLUDED."content_revision",
    "duration_minutes" = EXCLUDED."duration_minutes", "audio_url" = EXCLUDED."audio_url",
    "bundled_audio_asset" = EXCLUDED."bundled_audio_asset", "image_url" = EXCLUDED."image_url",
    "transcript" = EXCLUDED."transcript"
  RETURNING "id" INTO seed_exercise_id;
  DELETE FROM "listening_questions" WHERE "exercise_id" = seed_exercise_id;
  INSERT INTO "listening_questions"
    ("exercise_id", "question_number", "prompt", "correct_answer", "sort_order") VALUES
    (seed_exercise_id, 56, 'Sie sollen während des Gesprächs etwas aufschreiben.', '-', 0),
    (seed_exercise_id, 57, 'Bei der Veranstaltung geht es auch um die Beschriftung von Lebensmitteln.', '+', 1),
    (seed_exercise_id, 58, 'Herr Schneider hatte die Ware am letzten Mittwoch bestellt.', '-', 2),
    (seed_exercise_id, 59, 'Der nächste Zug nach Frankfurt fährt in 20 Minuten.', '-', 3),
    (seed_exercise_id, 60, 'Das Auslieferungsfahrzeug hatte eine Panne.', '+', 4);

  INSERT INTO "writing_exercises"
    ("content_revision", "title", "subtitle", "task_type", "intro", "stimulus",
     "task_instructions", "bullet_points", "closing_reminder", "modelltest_id")
  VALUES ('modelltest-2-schreiben-v1', 'E-Mail / Brief', 'Formeller Brief',
    'brief', 'Sie lesen folgende Anzeige:', '{"heading":"Große Party für die Kleinen!","subheading":"Kindergeburtstage, Sommerfeste und vieles mehr ...","body":"Wir bieten Ihnen alles, was Sie für eine tolle Kinderparty brauchen, z. B.:","features":["Clown „Pedro“ mit seinen Luftballon-Tieren","Mini-Hüpfburg","Schminken und Verkleiden (Kostüme inklusive)","Spiele für Kinder zwischen 3 und 13 Jahren","Singen mit „Caruso“, dem singenden Clown","Zauberer „Merlin“"],"callToAction":"Wir haben auch für Ihre Party das passende Programm – sprechen Sie uns an!","contact":{"name":"Mini-Party","lines":["Schlossweg 213, 92280 Neudorf","E-Mail: info@miniparty.eu"]},"imageUrl":null}'::jsonb,
    'Sie arbeiten in einem Kindergarten. Die Kindergartenleiterin plant eine Feier. Schreiben Sie einen Brief an den Party-Veranstalter. Bitten Sie um Informationen und schreiben Sie etwas zu den folgenden vier Punkten:', ARRAY['beschreiben Sie die geplante Feier', 'welche Leistungen Sie wünschen', 'fragen Sie nach Kosten und Terminen', 'fragen Sie nach bisherigen Kunden (wer, Zufriedenheit, ...)'],
    'Bevor Sie den Brief schreiben, überlegen Sie sich die passende Reihenfolge der Punkte, eine passende Einleitung und einen passenden Schluss. Vergessen Sie auch nicht Datum und Anrede.', mt2)
  ON CONFLICT ("modelltest_id") DO UPDATE SET
    "content_revision" = EXCLUDED."content_revision", "title" = EXCLUDED."title",
    "subtitle" = EXCLUDED."subtitle", "task_type" = EXCLUDED."task_type",
    "intro" = EXCLUDED."intro", "stimulus" = EXCLUDED."stimulus",
    "task_instructions" = EXCLUDED."task_instructions",
    "bullet_points" = EXCLUDED."bullet_points", "closing_reminder" = EXCLUDED."closing_reminder";

  INSERT INTO "speaking_exercises"
    ("modelltest_id", "part", "title", "subtitle", "topic_title", "topic_description",
     "topic_points", "instructions", "duration_minutes", "prep_duration_seconds",
     "image_url", "exam_image_url", "content_revision")
  VALUES (mt2, 1, 'Mündlicher Ausdruck – Teil 1 Kontaktaufnahme', 'Teilnehmer/in A und B', 'Kontaktaufnahme',
    'Unterhalten Sie sich mit Ihrer Partnerin bzw. Ihrem Partner über folgende Themen:', '["Name","woher sie oder er kommt","wie sie oder er wohnt (Wohnung, Haus, Garten, ...)","Familie","wo sie oder er Deutsch gelernt hat","was sie oder er macht (Beruf, Arbeit, Ausbildung, ...)","Sprachen (welche? wie lange? warum?)","Zusätzliche Prüferfrage: was Ihnen an Ihrem Beruf besonders gut gefällt","Zusätzliche Prüferfrage: wie und wo Sie gern Ihren Urlaub verbringen"]'::jsonb, 'Die Prüfenden können außerdem noch weitere Fragen stellen.', 10,
    300, '', NULL, 'modelltest-2-sprechen-teil-1-v1')
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "topic_title" = EXCLUDED."topic_title", "topic_description" = EXCLUDED."topic_description",
    "topic_points" = EXCLUDED."topic_points", "instructions" = EXCLUDED."instructions",
    "duration_minutes" = EXCLUDED."duration_minutes",
    "prep_duration_seconds" = EXCLUDED."prep_duration_seconds",
    "image_url" = EXCLUDED."image_url", "exam_image_url" = EXCLUDED."exam_image_url",
    "content_revision" = EXCLUDED."content_revision";

  INSERT INTO "speaking_exercises"
    ("modelltest_id", "part", "title", "subtitle", "topic_title", "topic_description",
     "topic_points", "instructions", "duration_minutes", "prep_duration_seconds",
     "image_url", "exam_image_url", "content_revision")
  VALUES (mt2, 2, 'Mündlicher Ausdruck – Teil 2 Gespräch über ein Thema', '', 'Auswirkungen des Bahnstreiks',
    'Sie haben in einer Zeitung etwas zum Thema „Auswirkungen des Bahnstreiks“ gelesen. Berichten Sie Ihrer Partnerin bzw. Ihrem Partner, welche Informationen Sie haben.
Ihre Partnerin bzw. Ihr Partner hat zum gleichen Thema andere Informationen und berichtet auch darüber. Unterhalten Sie sich danach über das Thema. Erzählen Sie von persönlichen Erfahrungen, stellen Sie Fragen und reagieren Sie auf Fragen Ihrer Partnerin bzw. Ihres Partners.', '["Teilnehmer/in A — Nicole Siepenkotten (35 Jahre, Netzwerk-Installateurin): Ich bin Spezialistin für Netzwerke in einer IT-Firma. Meine Arbeit ist fast immer vor Ort bei den Kunden zu erledigen, also bin ich täglich in einer anderen Richtung unserer Region unterwegs. Ich fahre immer mit der Bahn. Und jetzt der Streik! Mein supermodernes Smartphone hilft mir aber, die letzten noch funktionierenden Verbindungen herauszufinden! Und so habe ich eigentlich keine wirklichen Probleme.","Teilnehmer/in B — Marc Heidinger (23 Jahre, Student): Ich studiere Mathematik und Informatik. Für mich ist es sehr wichtig, neben dem Studium noch ein Halbtagspraktikum in einer IT-Firma machen zu können. Da ich aber aus finanziellen Gründen noch bei meinen Eltern auf dem Dorf lebe, ist der Streik für mich eine Katastrophe. Die S-Bahn als einzige Verbindung in die Großstadt fährt momentan nur noch gelegentlich. Wenn ich mit Bussen fahre und dreimal umsteige, brauche ich zweieinhalb Stunden. Das ist sehr anstrengend."]'::jsonb, 'Sie haben in einer Zeitung etwas zum Thema „Auswirkungen des Bahnstreiks“ gelesen. Berichten Sie Ihrer Partnerin bzw. Ihrem Partner, welche Informationen Sie haben.
Ihre Partnerin bzw. Ihr Partner hat zum gleichen Thema andere Informationen und berichtet auch darüber. Unterhalten Sie sich danach über das Thema. Erzählen Sie von persönlichen Erfahrungen, stellen Sie Fragen und reagieren Sie auf Fragen Ihrer Partnerin bzw. Ihres Partners.', 15,
    300, '', NULL, 'modelltest-2-sprechen-teil-2-v1')
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "topic_title" = EXCLUDED."topic_title", "topic_description" = EXCLUDED."topic_description",
    "topic_points" = EXCLUDED."topic_points", "instructions" = EXCLUDED."instructions",
    "duration_minutes" = EXCLUDED."duration_minutes",
    "prep_duration_seconds" = EXCLUDED."prep_duration_seconds",
    "image_url" = EXCLUDED."image_url", "exam_image_url" = EXCLUDED."exam_image_url",
    "content_revision" = EXCLUDED."content_revision";

  INSERT INTO "speaking_exercises"
    ("modelltest_id", "part", "title", "subtitle", "topic_title", "topic_description",
     "topic_points", "instructions", "duration_minutes", "prep_duration_seconds",
     "image_url", "exam_image_url", "content_revision")
  VALUES (mt2, 3, 'Mündlicher Ausdruck – Teil 3 Gemeinsam eine Aufgabe lösen', 'Teilnehmer/in A und B', 'Firmenjubiläum planen',
    'Nächsten Monat hat ein Kollege Firmenjubiläum, er arbeitet schon seit 30 Jahren in der Firma. Sie sollen eine kleine Feier für ihn planen.
Hier einige Punkte, die Ihnen bei der Planung helfen:', '["Wo feiern?","Essen/Getränke kaufen, bestellen oder mitbringen?","Welche Dekoration (Tischdecken, Bilder, Luftballons, ...)?","Geschenk für den Kollegen (was für ein Geschenk/wer kauft es)?","Begrüßung/Rede (wer und wie lang?)"]'::jsonb, 'Entscheiden Sie zuerst, was Sie machen möchten und warum.
Tragen Sie Ihrem Partner Ihre Ideen vor und begründen Sie sie.
Reagieren Sie auf die Ideen Ihres Partners bzw. Ihrer Partnerin und die Begründungen.
Einigen Sie sich auf einen gemeinsamen Programmvorschlag.', 5,
    300, '', NULL, 'modelltest-2-sprechen-teil-3-v1')
  ON CONFLICT ("modelltest_id", "part") DO UPDATE SET
    "title" = EXCLUDED."title", "subtitle" = EXCLUDED."subtitle",
    "topic_title" = EXCLUDED."topic_title", "topic_description" = EXCLUDED."topic_description",
    "topic_points" = EXCLUDED."topic_points", "instructions" = EXCLUDED."instructions",
    "duration_minutes" = EXCLUDED."duration_minutes",
    "prep_duration_seconds" = EXCLUDED."prep_duration_seconds",
    "image_url" = EXCLUDED."image_url", "exam_image_url" = EXCLUDED."exam_image_url",
    "content_revision" = EXCLUDED."content_revision";

END $$;

COMMIT;
