import { confirmDialog, errorMessage, escapeHtml as escape, formatDate, toast } from '../../piecemaker-tabular-review/src/client/dom.js';
import { etapes } from './api.js';
import type { Demande, Tache } from './api.js';
import { ouvrirSession } from './navigation.js';

const STATUT: Record<Tache['statut'], string> = { attente: 'En file', 'en-cours': 'En cours', question: 'Question', terminee: 'Terminée', echec: 'Échec' };

type Choix = { question: string; header?: string; multiSelect?: boolean; options?: { label: string; description?: string }[] };

const questionDe = (texte: string) => texte.slice(Math.max(0, texte.search(/^[\s*_>#-]*question\s*:/im))).trim();

const choixHtml = (demande: Demande) => ((demande.input.questions ?? []) as Choix[]).map((choix, index) => `<fieldset class="pme-choix" data-choix="${index}"><legend>${escape(choix.question)}</legend>${(choix.options ?? []).map((option) => `<label class="ptr-check"><input type="${choix.multiSelect ? 'checkbox' : 'radio'}" name="${escape(demande.requestId)}-${index}" value="${escape(option.label)}"><span>${escape(option.label)}${option.description ? ` <span class="pme-muted">— ${escape(option.description)}</span>` : ''}</span></label>`).join('')}</fieldset>`).join('');

const demandeHtml = (demande: Demande) => {
  const id = escape(demande.requestId);
  if (demande.toolName === 'AskUserQuestion') return `<div class="pme-demande" data-demande="${id}">${choixHtml(demande)}<div class="pme-actions"><span class="pme-spacer"></span><button type="button" class="ptr-button ptr-button-primary" data-answer>Envoyer</button></div></div>`;
  const plan = demande.toolName === 'ExitPlanMode';
  const detail = plan ? String(demande.input.plan ?? '') : JSON.stringify(demande.input, null, 2).slice(0, 600);
  return `<div class="pme-demande" data-demande="${id}"><p><strong>${plan ? 'Plan proposé' : `Autorisation demandée : ${escape(demande.toolName)}`}</strong></p><pre class="pme-question">${escape(detail)}</pre><div class="pme-actions"><span class="pme-spacer"></span><button type="button" class="ptr-button" data-deny>Refuser</button><button type="button" class="ptr-button ptr-button-primary" data-allow>${plan ? 'Approuver' : 'Autoriser'}</button></div></div>`;
};

const tacheHtml = (tache: Tache) => {
  return `<article class="pme-card" data-task="${escape(tache.id)}">
    <header class="pme-card-head"><div class="pme-card-title"><strong>${escape(tache.titre)}</strong><span class="pme-muted">${escape(tache.dossier)}${tache.raisonnement ? ` — ${escape(tache.raisonnement)}` : ''}</span></div><span class="pme-pill${tache.statut === 'en-cours' ? ' pme-pill--run' : tache.statut === 'echec' ? ' pme-pill--ko' : tache.statut === 'question' ? ' pme-pill--todo' : ''}">${STATUT[tache.statut]}</span></header>
    <p class="pme-muted pme-small">${escape(tache.provider)}${tache.model ? ` · ${escape(tache.model)}` : ''} · ${escape(formatDate(tache.creeLe))}</p>
    ${tache.erreur ? `<p class="pme-erreur">${escape(tache.erreur)}</p>` : ''}
    ${(tache.demandes ?? []).map(demandeHtml).join('')}
    ${tache.statut === 'question' ? `<p class="pme-question">${escape(questionDe(tache.question ?? ''))}</p><textarea class="ptr-textarea" rows="3" data-reply placeholder="Votre réponse"></textarea>` : ''}
    <div class="pme-actions">
      ${tache.sessionId ? '<button type="button" class="pme-link" data-session>Ouvrir la session</button>' : ''}
      <span class="pme-spacer"></span>
      ${tache.statut === 'attente' ? `<button type="button" class="ptr-button" data-toggle-auto>${tache.auto ? 'Rendre manuelle' : 'Rendre automatique'}</button><button type="button" class="ptr-button ptr-button-primary" data-run>Lancer immédiatement</button>` : ''}
      ${tache.statut === 'question' ? '<button type="button" class="ptr-button" data-finish>Terminer</button><button type="button" class="ptr-button ptr-button-primary" data-send>Répondre</button>' : ''}
      ${tache.statut === 'en-cours' || tache.statut === 'question' ? '' : '<button type="button" class="ptr-button ptr-button-danger" data-remove>Retirer</button>'}
    </div>
  </article>`;
};

const colonneHtml = (titre: string, aide: string, taches: Tache[]) => `<section class="pme-col"><h3>${titre} <span class="pme-muted">${taches.length}</span></h3><p class="pme-muted pme-small">${aide}</p>${taches.map(tacheHtml).join('') || '<p class="pme-muted">Aucune tâche.</p>'}</section>`;

export function createTaches(root: HTMLElement, ouvrirDossier: (projectPath: string, raisonnement: string | null) => void) {
  const element = document.createElement('div');
  element.className = 'pme-view';
  let taches: Tache[] = [];
  let signature = '';
  let terminees = false;
  const brouillons = new Map<string, string>();

  const paint = () => {
    const ouvertes = taches.filter((tache) => tache.statut === 'attente' || tache.statut === 'en-cours');
    const questions = taches.filter((tache) => tache.statut === 'question');
    const finies = taches.filter((tache) => tache.statut === 'terminee' || tache.statut === 'echec');
    element.innerHTML = `<div class="pme-board pme-board--two">
        ${questions.length ? colonneHtml('Questions', 'L’IA attend votre réponse pour continuer.', questions) : ''}
        ${colonneHtml('Automatiques', 'Lancées une à une, dans l’ordre de la file.', ouvertes.filter((tache) => tache.auto))}
        ${colonneHtml('Manuelles', 'Lancées seulement à votre demande.', ouvertes.filter((tache) => !tache.auto))}
      </div>
      ${finies.length ? `<details class="pme-done" data-done${terminees ? ' open' : ''}><summary>Terminées <span class="pme-muted">${finies.length}</span></summary><div class="pme-done-list">${finies.map(tacheHtml).join('')}</div></details>` : ''}`;
    element.querySelectorAll<HTMLTextAreaElement>('[data-reply]').forEach((zone) => { zone.value = brouillons.get(zone.closest<HTMLElement>('[data-task]')!.dataset.task!) ?? ''; });
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
  const confirmer = (titre: string, tache: Tache, bouton: string, work: () => Promise<unknown>) => void confirmDialog(root, titre, `<p>${escape(tache.titre)} — ${escape(tache.dossier)}</p>`, bouton).then((ok) => { if (ok) void run(work); });
  const repondre = (tache: Tache, card: HTMLElement) => {
    const texte = card.querySelector<HTMLTextAreaElement>('[data-reply]')?.value.trim() ?? '';
    if (!texte) return toast(root, 'Écrivez votre réponse.', 'error');
    void run(() => etapes.repondre(tache.id, texte).then(() => brouillons.delete(tache.id)));
  };
  const choisir = (tache: Tache, demande: Demande, bloc: HTMLElement) => {
    const answers: Record<string, string> = {};
    for (const [index, choix] of ((demande.input.questions ?? []) as Choix[]).entries()) {
      const coches = [...bloc.querySelectorAll<HTMLInputElement>(`[data-choix="${index}"] input:checked`)].map((input) => input.value);
      if (!coches.length) return toast(root, 'Répondez à chaque question.', 'error');
      answers[choix.question] = coches.join(', ');
    }
    void run(() => etapes.decision(tache.id, { requestId: demande.requestId, allow: true, updatedInput: { ...demande.input, answers } }));
  };

  element.addEventListener('toggle', (event) => { if ((event.target as HTMLElement).matches('[data-done]')) terminees = (event.target as HTMLDetailsElement).open; }, true);
  element.addEventListener('input', (event) => {
    const zone = event.target as HTMLElement;
    if (zone.matches('[data-reply]')) brouillons.set(zone.closest<HTMLElement>('[data-task]')!.dataset.task!, (zone as HTMLTextAreaElement).value);
  });
  element.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    const tache = taches.find((entry) => entry.id === (event.target as HTMLElement).closest<HTMLElement>('[data-task]')?.dataset.task);
    if (tache && !button && !(event.target as HTMLElement).closest('textarea, input, label, summary')) return ouvrirDossier(tache.projectPath, tache.raisonnement ?? null);
    if (!button || !tache) return;
    const data = button.dataset;
    const card = button.closest<HTMLElement>('[data-task]')!;
    const bloc = button.closest<HTMLElement>('[data-demande]');
    const demande = tache.demandes?.find((entry) => entry.requestId === bloc?.dataset.demande);
    if (demande && bloc) {
      if ('answer' in data) choisir(tache, demande, bloc);
      else if ('allow' in data) confirmer(demande.toolName === 'ExitPlanMode' ? 'Approuver ce plan ?' : `Autoriser ${demande.toolName} ?`, tache, demande.toolName === 'ExitPlanMode' ? 'Approuver' : 'Autoriser', () => etapes.decision(tache.id, { requestId: demande.requestId, allow: true }));
      else if ('deny' in data) void run(() => etapes.decision(tache.id, { requestId: demande.requestId, allow: false }));
      return;
    }
    if ('session' in data && tache.sessionId) ouvrirSession(tache.sessionId);
    else if ('run' in data) void run(() => etapes.lancer(tache.id));
    else if ('send' in data) repondre(tache, card);
    else if ('finish' in data) confirmer('Terminer cette tâche sans répondre ?', tache, 'Terminer', () => etapes.terminer(tache.id));
    else if ('toggleAuto' in data) void run(() => etapes.auto(tache.id, !tache.auto));
    else if ('remove' in data) void confirmDialog(root, 'Retirer cette tâche ?', `<p>${escape(tache.titre)} — ${escape(tache.dossier)}</p>`, 'Retirer', true).then((ok) => { if (ok) void run(() => etapes.retirer(tache.id)); });
  });

  return { element, refresh };
}
