import { confirmDialog, errorMessage, escapeHtml as escape, formatDate, toast } from '../../piecemaker-tabular-review/src/client/dom.js';
import { etapes } from './api.js';
import type { Tache } from './api.js';
import { ouvrirSession } from './navigation.js';

const STATUT: Record<Tache['statut'], string> = { attente: 'En file', 'en-cours': 'En cours', terminee: 'Terminée', echec: 'Échec' };

const tacheHtml = (tache: Tache) => {
  return `<article class="pme-card" data-task="${escape(tache.id)}">
    <header class="pme-card-head"><div class="pme-card-title"><strong>${escape(tache.titre)}</strong><span class="pme-muted">${escape(tache.dossier)}${tache.raisonnement ? ` — ${escape(tache.raisonnement)}` : ''}</span></div><span class="pme-pill${tache.statut === 'en-cours' ? ' pme-pill--run' : tache.statut === 'echec' ? ' pme-pill--ko' : ''}">${STATUT[tache.statut]}</span></header>
    <p class="pme-muted pme-small">${escape(tache.provider)}${tache.model ? ` · ${escape(tache.model)}` : ''} · ${escape(formatDate(tache.creeLe))}</p>
    ${tache.erreur ? `<p class="pme-erreur">${escape(tache.erreur)}</p>` : ''}
    <div class="pme-actions">
      ${tache.sessionId ? '<button type="button" class="pme-link" data-session>Ouvrir la session</button>' : ''}
      <span class="pme-spacer"></span>
      ${tache.statut === 'attente' ? `<button type="button" class="ptr-button" data-toggle-auto>${tache.auto ? 'Rendre manuelle' : 'Rendre automatique'}</button><button type="button" class="ptr-button ptr-button-primary" data-run>Lancer immédiatement</button>` : ''}
      ${tache.statut === 'en-cours' ? '' : '<button type="button" class="ptr-button ptr-button-danger" data-remove>Retirer</button>'}
    </div>
  </article>`;
};

const colonneHtml = (titre: string, aide: string, taches: Tache[]) => `<section class="pme-col"><h3>${titre} <span class="pme-muted">${taches.length}</span></h3><p class="pme-muted pme-small">${aide}</p>${taches.map(tacheHtml).join('') || '<p class="pme-muted">Aucune tâche.</p>'}</section>`;

export function createTaches(root: HTMLElement) {
  const element = document.createElement('div');
  element.className = 'pme-view';
  let taches: Tache[] = [];
  let signature = '';
  let terminees = false;

  const paint = () => {
    const ouvertes = taches.filter((tache) => tache.statut === 'attente' || tache.statut === 'en-cours');
    const finies = taches.filter((tache) => tache.statut === 'terminee' || tache.statut === 'echec');
    element.innerHTML = `<div class="pme-board pme-board--two">
        ${colonneHtml('Automatiques', 'Lancées une à une, dans l’ordre de la file.', ouvertes.filter((tache) => tache.auto))}
        ${colonneHtml('Manuelles', 'Lancées seulement à votre demande.', ouvertes.filter((tache) => !tache.auto))}
      </div>
      ${finies.length ? `<details class="pme-done" data-done${terminees ? ' open' : ''}><summary>Terminées <span class="pme-muted">${finies.length}</span></summary><div class="pme-done-list">${finies.map(tacheHtml).join('')}</div></details>` : ''}`;
  };
  const refresh = async () => {
    const next = await etapes.taches();
    const value = JSON.stringify(next);
    if (value === signature) return;
    signature = value;
    taches = next;
    paint();
  };
  const run = (work: () => Promise<unknown>) => work().then(refresh, (error: unknown) => toast(root, errorMessage(error), 'error'));

  element.addEventListener('toggle', (event) => { if ((event.target as HTMLElement).matches('[data-done]')) terminees = (event.target as HTMLDetailsElement).open; }, true);
  element.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    const tache = taches.find((entry) => entry.id === button?.closest<HTMLElement>('[data-task]')?.dataset.task);
    if (!button || !tache) return;
    const data = button.dataset;
    if ('session' in data && tache.sessionId) ouvrirSession(tache.sessionId);
    else if ('run' in data) void run(() => etapes.lancer(tache.id));
    else if ('toggleAuto' in data) void run(() => etapes.auto(tache.id, !tache.auto));
    else if ('remove' in data) void confirmDialog(root, 'Retirer cette tâche ?', `<p>${escape(tache.titre)} — ${escape(tache.dossier)}</p>`, 'Retirer', true).then((ok) => { if (ok) void run(() => etapes.retirer(tache.id)); });
  });

  return { element, refresh };
}
