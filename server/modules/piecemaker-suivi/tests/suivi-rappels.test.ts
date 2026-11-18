import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SuiviDeadline, SuiviDossier } from '../../../../shared/piecemaker-suivi.js';
import { describeRappels, localToday } from '../suivi-rappels.js';

const deadline = (nom: string, date: string | null, extra: Partial<SuiviDeadline> = {}): SuiviDeadline => ({
  nom, intitule: `Échéance ${nom}`, kind: 'délai', date, calcul: [], fixe: false, suppose: false,
  preuve: [], selon: [], decompte: [], fait: null, erreurs: 0, manques: 0, ...extra,
});

const dossier = (nom: string, echeances: SuiviDeadline[]): SuiviDossier => ({
  projectPath: `/dossiers/${nom}`, fichier: 'suivi.json', nom, session: null,
  snapshot: { revision: 1, updatedAt: null, code: '', hash: null, evenements: [], echeances, issues: [] },
});

test('reminders list overdue and upcoming open deadlines, in date order', () => {
  const texte = describeRappels([
    dossier('Dossier B', [deadline('appel', '2026-11-20'), deadline('loin', '2026-12-30'), deadline('sans-date', null)]),
    dossier('Dossier A', [
      deadline('conclusions', '2026-11-12'),
      deadline('faite', '2026-11-19', { fait: { date: '2026-11-18', preuve: [], par: 'avocat' } }),
      deadline('audience', '2026-11-18', { suppose: true }),
    ]),
  ], '2026-11-18', 7);
  assert.equal(texte, [
    'Échéances PieceMaker à 7 jours',
    '• En retard (12/11/2026) — Dossier A : Échéance conclusions',
    '• Aujourd’hui — Dossier A : Échéance audience (date supposée)',
    '• 20/11/2026 — Dossier B : Échéance appel',
  ].join('\n'));
});

test('no open deadline gives an empty text, so nothing is sent', () => {
  assert.equal(describeRappels([dossier('Dossier A', [deadline('loin', '2027-01-10')])], '2026-11-18', 7), '');
  assert.equal(localToday(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});
