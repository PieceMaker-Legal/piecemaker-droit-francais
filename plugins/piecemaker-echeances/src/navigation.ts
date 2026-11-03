import { etapes } from './api.js';
import type { Carte } from './api.js';

type RaisonnementShow = { project: string; nom: string };

export function ouvrirSession(sessionId: string) {
  window.history.pushState({}, '', `/session/${sessionId}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function allerAuDossier(carte: Carte, current: string | null) {
  if (current === carte.projectPath) return;
  if (!carte.session) throw new Error('Ouvrez d’abord une conversation dans ce dossier.');
  ouvrirSession(carte.session);
}

export async function ouvrirVolet(carte: Carte, current: string | null, tab: string) {
  allerAuDossier(carte, current);
  await etapes.volet(carte.projectPath, tab);
}

export async function ouvrirRaisonnement(carte: Carte, current: string | null, chemin?: string) {
  allerAuDossier(carte, current);
  if (carte.raisonnement) {
    (window as Window & { __piecemakerRaisonnementShow?: RaisonnementShow }).__piecemakerRaisonnementShow = { project: carte.projectPath, nom: carte.raisonnement.nom };
    window.dispatchEvent(new CustomEvent('piecemaker:raisonnement-show'));
  }
  await etapes.volet(carte.projectPath, 'plugin:piecemaker-raisonnement');
  if (chemin) await etapes.volet(carte.projectPath, 'files', `${carte.projectPath}/${chemin}`);
}
