import type { ReasoningIssue } from '../../../shared/piecemaker-reasoning.js';
import type { SuiviBasis, SuiviDeadline, SuiviDossier, SuiviEvent, SuiviProof } from '../../../shared/piecemaker-suivi.js';
import { loadAll, markDone, verifySuivi } from './api.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor?(file: string): void };
type Scope = 'tous' | 'dossier';
type Group = 'retard' | 'aujourdhui' | 'semaine' | 'mois' | 'plus_tard' | 'sans_date' | 'faites';
type Row = { key: string; dossier: SuiviDossier; deadline: SuiviDeadline; issues: ReasoningIssue[] };

const GROUPS: Array<{ id: Group; title: string; hint?: string; folded?: boolean }> = [
  { id: 'retard', title: 'En retard', hint: 'Dépassées et non marquées faites' },
  { id: 'aujourdhui', title: 'Aujourd’hui' },
  { id: 'semaine', title: 'Cette semaine', hint: 'Dans les 7 jours' },
  { id: 'mois', title: 'Ce mois-ci', hint: 'Dans les 31 jours' },
  { id: 'plus_tard', title: 'Plus tard' },
  { id: 'sans_date', title: 'Date à établir', hint: 'Le calcul attend une date manquante' },
  { id: 'faites', title: 'Faites', folded: true },
];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const OVERDUE = 'échéance dépassée';
const SCOPE_KEY = 'piecemaker-echeances:scope';
const cleanups = new WeakMap<HTMLElement, () => void>();

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const localToday = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const utc = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
const between = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);
const french = (value: string) => value.split('-').reverse().join('/');
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
const relative = (days: number) => (days === 0 ? 'aujourd’hui' : days === 1 ? 'demain' : days === -1 ? 'hier' : days > 0 ? `dans ${days} jours` : `en retard de ${-days} jours`);
const readScope = (): Scope => { try { return localStorage.getItem(SCOPE_KEY) === 'dossier' ? 'dossier' : 'tous'; } catch { return 'tous'; } };
const saveScope = (scope: Scope) => { try { localStorage.setItem(SCOPE_KEY, scope); } catch { return; } };
const groupOf = (deadline: SuiviDeadline, today: string): Group => {
  if (deadline.fait) return 'faites';
  if (!deadline.date) return 'sans_date';
  const days = between(today, deadline.date);
  return days < 0 ? 'retard' : days === 0 ? 'aujourdhui' : days <= 7 ? 'semaine' : days <= 31 ? 'mois' : 'plus_tard';
};
const issueText = (issue: ReasoningIssue) => issue.avocat ?? issue.text;
const sourceLine = (basis: SuiviBasis) => `<li><span class="pme-src">${escape(basis.titre ?? basis.source)}</span>${basis.titre ? `<code>${escape(basis.source)}</code>` : ''}<q>${escape(basis.citation)}</q></li>`;

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pme piecemaker-ui';
  root.setAttribute('aria-label', 'Échéances des dossiers');
  container.replaceChildren(style, root);

  const state = {
    dossiers: [] as SuiviDossier[],
    loading: true,
    error: '',
    scope: readScope(),
    query: '',
    open: new Set<string>(),
    unfolded: new Set<string>(),
    busy: new Set<string>(),
    notice: '',
  };

  const project = () => api.context.project?.path ?? null;
  const visible = () => state.dossiers.filter((dossier) => state.scope === 'tous' || dossier.projectPath === project());
  const matches = (text: string) => !state.query || text.toLowerCase().includes(state.query.toLowerCase());

  const rows = (today: string) => visible().flatMap((dossier) => dossier.snapshot.echeances.map((deadline): Row => ({
    key: `${dossier.projectPath}#${deadline.nom}`, dossier, deadline,
    issues: dossier.snapshot.issues.filter((issue) => (issue.path === `echeances.${deadline.nom}` || issue.path.startsWith(`echeances.${deadline.nom}.`)) && !issue.text.startsWith(OVERDUE)),
  }))).filter((row) => matches(`${row.deadline.intitule} ${row.dossier.nom}`)).sort((left, right) => (left.deadline.fait && right.deadline.fait ? right.deadline.fait.date.localeCompare(left.deadline.fait.date) : (left.deadline.date ?? '9999').localeCompare(right.deadline.date ?? '9999')));

  const dateBlock = (value: string | null, today: string) => {
    if (!value) return '<div class="pme-date is-empty"><b>?</b><span>à établir</span></div>';
    const [year, month, day] = value.split('-').map(Number);
    return `<div class="pme-date"><span>${WEEKDAYS[new Date(utc(value)).getUTCDay()]}</span><b>${day}</b><span>${MONTHS[month - 1]}</span>${String(year) !== today.slice(0, 4) ? `<span>${year}</span>` : ''}</div>`;
  };

  const badges = (row: Row, today: string) => {
    const { deadline } = row;
    const out: string[] = [];
    if (deadline.fait) out.push(`<span class="pme-badge is-ok">Faite le ${french(deadline.fait.date)}</span>`);
    else if (deadline.date) {
      const days = between(today, deadline.date);
      out.push(`<span class="pme-badge ${days < 0 ? 'is-ko' : days <= 7 ? 'is-warn' : 'is-muted'}">${relative(days)}</span>`);
    }
    if (deadline.suppose) out.push('<span class="pme-badge is-muted" title="Calculée depuis une date supposée (acte non signé)">date supposée</span>');
    const errors = row.issues.filter((issue) => issue.kind === 'erreur').length;
    const gaps = row.issues.filter((issue) => issue.kind === 'manque').length;
    out.push(errors ? `<span class="pme-badge is-ko" title="Justification à corriger">${plural(errors, 'erreur')}</span>` : gaps ? `<span class="pme-badge is-warn" title="Justification à compléter">${plural(gaps, 'point')} à compléter</span>` : '<span class="pme-badge is-ok" title="Délai, décompte et preuves vérifiés">✓ vérifiée</span>');
    return out.join('');
  };

  const proofs = (dossier: SuiviDossier, list: SuiviProof[]) => list.map((proof) => `<li><span class="pme-src">${escape(proof.titre ?? proof.piece)}</span><q>${escape(proof.citation)}</q>${api.openFileInEditor && dossier.projectPath === project() ? `<button class="pme-link" data-open-piece="${escape(proof.piece)}">Ouvrir</button>` : ''}</li>`).join('');

  const detail = (row: Row, today: string) => {
    const { deadline, dossier } = row;
    const busy = state.busy.has(row.key);
    const parts: string[] = [];
    if (deadline.calcul.length) parts.push(`<div class="pme-block"><h4>${deadline.fixe ? 'Date' : 'Calcul'}</h4><ol class="pme-steps">${deadline.calcul.map((step) => `<li>${escape(step)}</li>`).join('')}</ol></div>`);
    if (deadline.preuve.length) parts.push(`<div class="pme-block"><h4>Pièce qui fixe la date</h4><ul class="pme-cites">${proofs(dossier, deadline.preuve)}</ul></div>`);
    if (deadline.selon.length) parts.push(`<div class="pme-block"><h4>Fondement du délai</h4><ul class="pme-cites">${deadline.selon.map(sourceLine).join('')}</ul></div>`);
    if (deadline.decompte.length) parts.push(`<div class="pme-block"><h4>Règle de décompte</h4><ul class="pme-cites">${deadline.decompte.map(sourceLine).join('')}</ul></div>`);
    if (row.issues.length) parts.push(`<div class="pme-block"><h4>À vérifier</h4><ul class="pme-issues">${row.issues.map((issue) => `<li class="is-${issue.kind === 'erreur' ? 'ko' : 'warn'}">${escape(issueText(issue))}</li>`).join('')}</ul></div>`);
    const done = deadline.fait;
    const actions = done
      ? `<p class="pme-done">Faite le ${french(done.date)}${done.par === 'avocat' ? ` · marquée par vous${done.piece ? ` · ${escape(done.piece)}` : ''}` : ' · prouvée dans le suivi'}</p>${done.par === 'avocat' ? `<button data-undo ${busy ? 'disabled' : ''}>Annuler</button>` : ''}`
      : `<label>Faite le <input type="date" data-done-date value="${today}" max="${today}"></label><label class="pme-grow">Pièce (facultatif) <input type="text" data-done-piece placeholder="pieces/…"></label><button class="pme-primary" data-done ${busy ? 'disabled' : ''}>Marquer faite</button>`;
    parts.push(`<div class="pme-actions">${actions}${dossier.session ? `<button data-go="${escape(dossier.session)}">Ouvrir le dossier</button>` : ''}</div>`);
    return `<div class="pme-detail">${parts.join('')}</div>`;
  };

  const rowHtml = (row: Row, today: string) => {
    const open = state.open.has(row.key);
    const tone = row.deadline.fait ? 'done' : groupOf(row.deadline, today);
    return `<li class="pme-row is-${tone}${open ? ' is-open' : ''}" data-key="${escape(row.key)}">
      <button class="pme-summary" data-toggle aria-expanded="${open}">
        ${dateBlock(row.deadline.date, today)}
        <span class="pme-main"><span class="pme-title">${escape(row.deadline.intitule)}</span>${state.scope === 'tous' ? `<span class="pme-folder">${escape(row.dossier.nom)}</span>` : ''}<span class="pme-badges">${badges(row, today)}</span></span>
        <span class="pme-chevron" aria-hidden="true">›</span>
      </button>
      ${open ? detail(row, today) : ''}
    </li>`;
  };

  const eventsHtml = (today: string) => {
    const events = visible().flatMap((dossier) => dossier.snapshot.evenements.map((event) => ({ dossier, event }))).filter(({ dossier, event }) => event.date <= today && matches(`${event.intitule} ${dossier.nom}`)).sort((left, right) => right.event.date.localeCompare(left.event.date));
    if (!events.length) return '';
    const line = ({ dossier, event }: { dossier: SuiviDossier; event: SuiviEvent }) => `<li class="pme-event"><span class="pme-when">${french(event.date)}</span><span class="pme-main"><span class="pme-title">${escape(event.intitule)}</span>${state.scope === 'tous' ? `<span class="pme-folder">${escape(dossier.nom)}</span>` : ''}</span>${event.suppose ? '<span class="pme-badge is-muted">date supposée</span>' : event.preuve.length ? `<span class="pme-badge is-muted" title="${escape(event.preuve.map((proof) => `${proof.titre ?? proof.piece} : « ${proof.citation} »`).join('\n'))}">${escape(event.preuve[0].titre ?? event.preuve[0].piece)}</span>` : ''}</li>`;
    return `<details class="pme-group"${state.unfolded.has('passees') ? ' open' : ''}><summary data-fold="passees"><h3>Dates passées</h3><span class="pme-count">${events.length}</span><span class="pme-hint">Actes et dates qui font courir les délais</span></summary><ul class="pme-list">${events.map(line).join('')}</ul></details>`;
  };

  const problemsHtml = () => {
    const broken = visible().map((dossier) => ({ dossier, issues: dossier.snapshot.issues.filter((issue) => !issue.path.startsWith('echeances.')) })).filter((entry) => entry.issues.length);
    if (!broken.length) return '';
    return `<details class="pme-alert"${state.unfolded.has('alertes') ? ' open' : ''}><summary data-fold="alertes">${plural(broken.reduce((total, entry) => total + entry.issues.length, 0), 'point')} à reprendre dans le suivi de ${plural(broken.length, 'dossier')}</summary><ul>${broken.map(({ dossier, issues }) => `<li><b>${escape(dossier.nom)}</b><ul class="pme-issues">${issues.map((issue) => `<li class="is-${issue.kind === 'erreur' ? 'ko' : 'warn'}">${escape(issueText(issue))}${issue.line ? ` <small>(ligne ${issue.line})</small>` : ''}</li>`).join('')}</ul></li>`).join('')}</ul><p class="pme-hint">Demandez à l’agent de corriger .piecemaker/suivi.yaml puis de relancer la vérification.</p></details>`;
  };

  const render = () => {
    const today = localToday();
    const current = project();
    const all = rows(today);
    const byGroup = new Map<Group, Row[]>(GROUPS.map((group) => [group.id, all.filter((row) => groupOf(row.deadline, today) === group.id)]));
    const counts = (id: Group) => byGroup.get(id)!.length;
    const head = `<header class="pme-head">
      <strong>Échéances</strong>
      <div class="pme-switch" role="tablist" aria-label="Portée">
        <button role="tab" data-scope="tous" aria-selected="${state.scope === 'tous'}">Tous les dossiers</button>
        <button role="tab" data-scope="dossier" aria-selected="${state.scope === 'dossier'}" ${current ? '' : 'disabled title="Ouvrez un dossier"'}>Ce dossier</button>
      </div>
      <input type="search" data-query placeholder="Rechercher" value="${escape(state.query)}" aria-label="Rechercher une échéance">
      ${state.scope === 'dossier' && current && state.dossiers.some((dossier) => dossier.projectPath === current) ? `<button data-verify ${state.busy.has('verify') ? 'disabled' : ''}>${state.busy.has('verify') ? 'Vérification…' : 'Revérifier'}</button>` : ''}
      <button data-refresh aria-label="Actualiser">↻</button>
    </header>`;
    const chips = `<div class="pme-chips">${[['retard', 'en retard', 'ko'], ['aujourdhui', 'aujourd’hui', 'warn'], ['semaine', 'cette semaine', 'warn'], ['mois', 'ce mois-ci', 'muted']].map(([id, label, tone]) => `<button class="pme-chip is-${tone}${counts(id as Group) ? '' : ' is-zero'}" data-jump="${id}"><b>${counts(id as Group)}</b> ${label}</button>`).join('')}</div>`;
    let body: string;
    if (state.loading && !state.dossiers.length) body = '<p class="pme-empty">Chargement des échéances…</p>';
    else if (state.error) body = `<p class="pme-empty is-error">${escape(state.error)}</p>`;
    else if (state.scope === 'dossier' && !current) body = '<p class="pme-empty">Ouvrez un dossier, ou affichez tous les dossiers.</p>';
    else if (!visible().length) body = `<div class="pme-empty"><p>${state.scope === 'dossier' ? 'Ce dossier n’a pas encore de suivi.' : 'Aucun dossier n’a encore de suivi.'}</p><p class="pme-hint">Demandez à l’agent d’« établir le suivi du dossier » : il relève les actes de procédure ou les dates qui conditionnent le contrat, calcule chaque échéance avec ses textes et la fait vérifier.</p></div>`;
    else {
      const groups = GROUPS.filter((group) => counts(group.id)).map((group) => {
        const content = `<ul class="pme-list">${byGroup.get(group.id)!.map((row) => rowHtml(row, today)).join('')}</ul>`;
        const title = `<h3>${group.title}</h3><span class="pme-count">${counts(group.id)}</span>${group.hint ? `<span class="pme-hint">${group.hint}</span>` : ''}`;
        return group.folded ? `<details class="pme-group is-${group.id}" data-group="${group.id}"${state.unfolded.has(group.id) ? ' open' : ''}><summary data-fold="${group.id}">${title}</summary>${content}</details>` : `<section class="pme-group is-${group.id}" data-group="${group.id}"><div class="pme-group-head">${title}</div>${content}</section>`;
      }).join('');
      body = `${problemsHtml()}${groups || '<p class="pme-empty">Aucune échéance ne correspond.</p>'}${eventsHtml(today)}`;
    }
    const focused = root.querySelector<HTMLInputElement>('[data-query]') === document.activeElement;
    root.innerHTML = `${head}${state.notice ? `<div class="pme-notice" role="status">${escape(state.notice)}</div>` : ''}${chips}<div class="pme-body">${body}</div>`;
    if (focused) { const input = root.querySelector<HTMLInputElement>('[data-query]')!; input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  };

  const reload = async () => {
    state.loading = true;
    render();
    try { state.dossiers = await loadAll(); state.error = ''; } catch (error) { state.error = error instanceof Error ? error.message : 'Échéances indisponibles.'; }
    state.loading = false;
    render();
  };
  const replace = (projectPath: string, snapshot: SuiviDossier['snapshot']) => { state.dossiers = state.dossiers.map((dossier) => (dossier.projectPath === projectPath ? { ...dossier, snapshot } : dossier)); };
  const flash = (message: string) => { state.notice = message; render(); window.setTimeout(() => { if (state.notice === message) { state.notice = ''; render(); } }, 4000); };
  const rowOf = (element: Element) => {
    const key = element.closest<HTMLElement>('[data-key]')?.dataset.key;
    return key ? rows(localToday()).find((row) => row.key === key) ?? null : null;
  };

  root.addEventListener('click', async (event) => {
    const target = (event.target as Element).closest<HTMLElement>('button, summary');
    if (!target) return;
    if (target.dataset.fold) { event.preventDefault(); if (state.unfolded.has(target.dataset.fold)) state.unfolded.delete(target.dataset.fold); else state.unfolded.add(target.dataset.fold); render(); return; }
    if (target.dataset.scope) { state.scope = target.dataset.scope as Scope; saveScope(state.scope); render(); return; }
    if (target.hasAttribute('data-refresh')) { void reload(); return; }
    if (target.dataset.jump) { state.unfolded.add(target.dataset.jump); render(); root.querySelector(`[data-group="${target.dataset.jump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (target.hasAttribute('data-verify')) {
      const current = project();
      if (!current) return;
      state.busy.add('verify'); render();
      try { replace(current, await verifySuivi(current)); flash('Suivi revérifié.'); } catch (error) { flash(error instanceof Error ? error.message : 'Vérification impossible.'); }
      state.busy.delete('verify'); render();
      return;
    }
    if (target.dataset.go) {
      window.history.pushState({}, '', `/session/${encodeURIComponent(target.dataset.go)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    const row = rowOf(target);
    if (!row) return;
    if (target.hasAttribute('data-toggle')) { if (state.open.has(row.key)) state.open.delete(row.key); else state.open.add(row.key); render(); return; }
    if (target.dataset.openPiece) { api.openFileInEditor?.(`${row.dossier.projectPath}/${target.dataset.openPiece}`); return; }
    if (target.hasAttribute('data-done') || target.hasAttribute('data-undo')) {
      const item = target.closest('[data-key]')!;
      const date = item.querySelector<HTMLInputElement>('[data-done-date]')?.value || localToday();
      const piece = item.querySelector<HTMLInputElement>('[data-done-piece]')?.value.trim() || null;
      state.busy.add(row.key); render();
      try {
        replace(row.dossier.projectPath, await markDone(row.dossier.projectPath, row.deadline.nom, target.hasAttribute('data-undo') ? { annuler: true } : { date, piece }));
        flash(target.hasAttribute('data-undo') ? `« ${row.deadline.intitule} » n’est plus marquée faite.` : `« ${row.deadline.intitule} » marquée faite.`);
      } catch (error) { state.notice = error instanceof Error ? error.message : 'Enregistrement impossible.'; } finally { state.busy.delete(row.key); render(); }
    }
  });
  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.matches('[data-query]')) { state.query = input.value; render(); }
  });

  root.dataset.theme = api.context.theme;
  const unsubscribe = api.onContextChange((context) => {
    root.dataset.theme = context.theme;
    if (!context.project && state.scope === 'dossier') state.scope = 'tous';
    render();
  });
  const onVisible = () => { if (document.visibilityState === 'visible') void reload(); };
  document.addEventListener('visibilitychange', onVisible);
  void reload();
  cleanups.set(container, () => { unsubscribe(); document.removeEventListener('visibilitychange', onVisible); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
