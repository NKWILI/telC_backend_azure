-- Seed: Büroräume E-Mail/Brief exercise for Modelltest 1 (TELC B1+ Beruf Schreiben)
-- Only inserts if Modelltest 1 exists and no writing exercise is already linked to it.
INSERT INTO writing_exercises (
    id,
    content_revision,
    title,
    subtitle,
    task_type,
    intro,
    stimulus,
    task_instructions,
    bullet_points,
    closing_reminder,
    modelltest_id
)
SELECT
    gen_random_uuid(),
    'v1',
    'E-Mail / Brief',
    'Formeller Brief',
    'brief',
    'Sie sehen folgende Anzeige:',
    '{
        "heading": "Büroräume in Neubaukomplex zu vermieten!",
        "body": "In unserem neu gebauten Bürogebäude sind noch Räume frei",
        "features": [
            "Gebäude mit 6 Stockwerken",
            "zentrale Lage",
            "helle, großzügige Büros, zwischen 15 und 25 m²",
            "Kaffeeküche",
            "Konferenzräume",
            "vier Aufzüge",
            "moderne Anschlüsse in allen Räumen (z. B. Internet/DSL-Anschlüsse)",
            "Hausmeisterservice rund um die Uhr",
            "moderne Sicherheitstechnik"
        ],
        "callToAction": "Vereinbaren Sie einen Besichtigungstermin oder fordern Sie weitere Informationen an:",
        "contact": {
            "name": "CenterBüros GmbH",
            "lines": ["Neuer Wall 120", "50160 Köln"]
        }
    }'::jsonb,
    'Sie arbeiten in einem Übersetzerbüro. Ihr Chef möchte größere Büroräume mieten. Schreiben Sie einen Brief an die CenterBüros GmbH. Bitten Sie um Informationen und schreiben Sie etwas zu den folgenden Punkten:',
    ARRAY[
        'Beschreiben Sie Ihr Unternehmen.',
        'Was für Räume brauchen Sie?',
        'Wie viele Räume brauchen Sie?',
        'Wann brauchen Sie die Räume?',
        'Fragen Sie nach den Kosten.'
    ],
    'Bevor Sie den Brief schreiben, überlegen Sie sich die passende Reihenfolge der Punkte, eine passende Einleitung und einen passenden Schluss. Vergessen Sie auch nicht Datum und Anrede.',
    (SELECT id FROM modelltests WHERE number = 1)
WHERE
    EXISTS (SELECT 1 FROM modelltests WHERE number = 1)
    AND NOT EXISTS (
        SELECT 1 FROM writing_exercises we
        JOIN modelltests m ON we.modelltest_id = m.id
        WHERE m.number = 1
    );
