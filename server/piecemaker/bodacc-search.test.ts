import assert from 'node:assert/strict';
import test from 'node:test';

import { bodaccReportMarkdown, type BodaccAnnouncement } from './bodacc-search.js';

const generatedAt = new Date(2026, 0, 15);

const announcement: BodaccAnnouncement = {
  id: 'A202600001',
  datePublication: '2025-03-12',
  typeAvis: 'Avis de dépôt des comptes',
  familleAvis: 'Dépôts des comptes',
  commercant: 'Société Exemple SAS',
  ville: 'Paris',
  tribunal: '',
  jugement: 'Premier jugement\nsur deux lignes',
  acte: '',
  url: 'https://www.bodacc.fr/annonce/exemple',
};

test('rend le rapport avec alertes, annonces et lien officiel', () => {
  const markdown = bodaccReportMarkdown({ siren: '123456789', total: 5, alertes: ['Procédure collective en cours'], annonces: [announcement] }, generatedAt);
  assert.match(markdown, /^# Annonces BODACC — SIREN 123456789\n/);
  assert.match(markdown, /1 annonce sur 5\./);
  assert.match(markdown, /## Alertes\n\n- Procédure collective en cours/);
  assert.match(markdown, /## Avis de dépôt des comptes — 2025-03-12/);
  assert.match(markdown, /- Entreprise : Société Exemple SAS\n- Ville : Paris\n- Jugement : Premier jugement sur deux lignes/);
  assert.doesNotMatch(markdown, /Tribunal|Acte/);
  assert.match(markdown, /\[Ouvrir l’annonce officielle\]\(https:\/\/www\.bodacc\.fr\/annonce\/exemple\)/);
});

test('omet la section Alertes quand il n’y en a pas et utilise la famille ou un titre par défaut', () => {
  const markdown = bodaccReportMarkdown({ siren: '123456789', total: 2, alertes: [], annonces: [{ ...announcement, typeAvis: '' }, { ...announcement, typeAvis: '', familleAvis: '', url: '' }] }, generatedAt);
  assert.doesNotMatch(markdown, /## Alertes/);
  assert.match(markdown, /2 annonces sur 2\./);
  assert.match(markdown, /## Dépôts des comptes — 2025-03-12/);
  assert.match(markdown, /## Annonce BODACC — 2025-03-12/);
});

test('signale l’absence d’annonce', () => {
  const markdown = bodaccReportMarkdown({ siren: '123456789', total: 0, alertes: [], annonces: [] }, generatedAt);
  assert.match(markdown, /Aucune annonce BODACC trouvée pour le SIREN 123456789\./);
  assert.doesNotMatch(markdown, /##/);
});
