import { etapes } from './api.js';
import type { Carte } from './api.js';

type CatalaShow = { project: string; nom: string };

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

export async function ouvrirMapping(carte: Carte, current: string | null) {
  allerAuDossier(carte, current);
  (window as Window & { __piecemakerMappingShow?: string }).__piecemakerMappingShow = carte.projectPath;
  window.dispatchEvent(new CustomEvent('piecemaker:mapping-show'));
  await etapes.volet(carte.projectPath, 'plugin:piecemaker-dossier');
}

export async function ouvrirRaisonnement(carte: Carte, current: string | null, chemin?: string) {
  allerAuDossier(carte, current);
  if (carte.raisonnement) {
    (window as Window & { __piecemakerCatalaShow?: CatalaShow }).__piecemakerCatalaShow = { project: carte.projectPath, nom: carte.raisonnement.nom };
    window.dispatchEvent(new CustomEvent('piecemaker:catala-show'));
  }
  await etapes.volet(carte.projectPath, 'plugin:piecemaker-catala');
  if (chemin) await etapes.volet(carte.projectPath, 'files', `${carte.projectPath}/${chemin}`);
}
