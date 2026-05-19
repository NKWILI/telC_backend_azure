import type { WritingExerciseDto } from './dto';

/** Known exercise type ids (Teile) for Schreiben. */
export const WRITING_TEIL_IDS = ['1', '2'];

/**
 * Full content of each Schreiben exercise (telc B1).
 * Keyed by Teil id ('1' = Brief/E-Mail, '2' = Forumsbeitrag).
 * Imported by WritingService (for the /exercise endpoint) AND
 * WritingCorrectionService (for the AI grading prompt). Living in a separate
 * file avoids a circular dependency between the two services.
 */
export const WRITING_EXERCISES: Record<string, WritingExerciseDto> = {
  '1': {
    id: '1',
    part: 1,
    title: 'E-Mail / Brief',
    subtitle: 'Formeller Brief',
    taskType: 'brief',
    intro: 'Sie sehen folgende Anzeige:',
    stimulus: {
      heading: 'Büroräume in Neubaukomplex zu vermieten!',
      body: 'In unserem neu gebauten Bürogebäude sind noch Räume frei',
      features: [
        'Gebäude mit 6 Stockwerken',
        'zentrale Lage',
        'helle, großzügige Büros, zwischen 15 und 25 m²',
        'Kaffeeküche',
        'Konferenzräume',
        'vier Aufzüge',
        'moderne Anschlüsse in allen Räumen (z. B. Internet/DSL-Anschlüsse)',
        'Hausmeisterservice rund um die Uhr',
        'moderne Sicherheitstechnik',
      ],
      callToAction:
        'Vereinbaren Sie einen Besichtigungstermin oder fordern Sie weitere Informationen an:',
      contact: {
        name: 'CenterBüros GmbH',
        lines: ['Neuer Wall 120', '50160 Köln'],
      },
    },
    taskInstructions:
      'Sie arbeiten in einem Übersetzerbüro. Ihr Chef möchte größere Büroräume mieten. Schreiben Sie einen Brief an die CenterBüros GmbH. Bitten Sie um Informationen und schreiben Sie etwas zu den folgenden Punkten:',
    bulletPoints: [
      'Beschreiben Sie Ihr Unternehmen.',
      'Was für Räume brauchen Sie?',
      'Wie viele Räume brauchen Sie?',
      'Wann brauchen Sie die Räume?',
      'Fragen Sie nach den Kosten.',
    ],
    closingReminder:
      'Bevor Sie den Brief schreiben, überlegen Sie sich die passende Reihenfolge der Punkte, eine passende Einleitung und einen passenden Schluss. Vergessen Sie auch nicht Datum und Anrede.',
  },
  '2': {
    id: '2',
    part: 2,
    title: 'Forumsbeitrag',
    subtitle: 'Beitrag in einem Online-Forum',
    taskType: 'forumsbeitrag',
    taskInstructions: 'TODO: real Teil 2 content pending',
    bulletPoints: [],
  },
};
