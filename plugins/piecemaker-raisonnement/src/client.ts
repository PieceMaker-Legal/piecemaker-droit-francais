import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningCondition, ReasoningFact, ReasoningQuestion, ReasoningReview, ReasoningSnapshot, ReasoningSource, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';
import { appreciateFact, loadReasoning, reviewItem } from './api.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor?(file: string): void };
type Tab = 'schema' | 'code' | 'sources';

const FORCE_LABELS: Record<string, string> = { acte_authentique: 'Acte authentique', 'acte_sous_seing_privé': 'Acte sous seing privé', commencement_de_preuve: 'Commencement de preuve', indice: 'Indice', sans_valeur: 'Sans valeur probante' };
const STRENGTH_LABELS = { loi: 'Loi', jurisprudence: 'Jurisprudence', doctrine: 'Doctrine' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const slug = (value: string) => value.replace(/\s+/g, '-');
const badge = (status: string, label = status) => `<span class="pmr-badge pmr-s-${escape(slug(status))}">${escape(label)}</span>`;
const cleanups = new WeakMap<HTMLElement, () => void>();

function formatValue(value: ReasoningValue): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Vrai' : 'Faux';
  if (typeof value === 'number') return String(value).replace('.', ',');
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;
  return [value.ans && `${value.ans} an(s)`, value.mois && `${value.mois} mois`, value.jours && `${value.jours} jour(s)`].filter(Boolean).join(' ') || '0 jour';
}

function parseInput(type: string, raw: string): ReasoningValue {
  if (type === 'booléen') return raw === 'vrai';
  if (type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('Date attendue.'); return raw; }
  if (type === 'durée') {
    const match = /^(\d+)\s*(an|ans|mois|jour|jours)$/.exec(raw.trim());
    if (!match) throw new Error('Durée attendue, par exemple « 5 an » ou « 2 mois ».');
    const unit = match[2].startsWith('an') ? 'ans' : match[2] === 'mois' ? 'mois' : 'jours';
    return { ans: 0, mois: 0, jours: 0, [unit]: Number(match[1]) };
  }
  const number = Number(raw.replace(',', '.'));
  if (!raw.trim() || !Number.isFinite(number)) throw new Error('Nombre attendu.');
  return number;
}

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pmr';
  root.setAttribute('aria-label', 'Raisonnement du dossier');
  root.innerHTML = `<header class="pmr-head"><strong>Raisonnement</strong><div class="pmr-tabs" role="tablist"><button role="tab" data-tab="schema">Schéma</button><button role="tab" data-tab="code">Code</button><button role="tab" data-tab="sources">Sources</button></div><button data-demo>Exemple fictif</button><button data-refresh aria-label="Actualiser">↻</button></header><div class="pmr-meta"></div><div class="pmr-warning" hidden></div><div class="pmr-body"></div>`;
  container.replaceChildren(style, root);
  let context = api.context;
  let snapshot: ReasoningSnapshot | null = null;
  let lastSerialized = '';
  let tab: Tab = 'schema';
  let editing = '';
  let sequence = 0;
  let stopped = false;
  let timer = 0;
  const body = root.querySelector<HTMLElement>('.pmr-body')!;
  const warning = root.querySelector<HTMLElement>('.pmr-warning')!;

  const source = (id: string) => snapshot?.sources.find((entry) => entry.id === id);
  const usedByFacts = () => new Set(snapshot?.facts.flatMap((fact) => fact.sources) ?? []);
  const kindLabel = (entry: ReasoningSource) => (entry.kind === 'article' ? 'Loi' : entry.kind === 'case' ? 'Jurisprudence' : usedByFacts().has(entry.id) ? 'Pièce' : 'Doctrine');
  const chips = (ids: string[]) => (ids.length ? `<div class="pmr-chips">${ids.map((id) => {
    const entry = source(id);
    const state = !entry ? ' · inconnue' : !entry.verified ? ' · introuvable' : entry.history?.status === 'remise en cause' ? ' · remise en cause' : '';
    return `<button class="pmr-chip" data-open="${escape(id)}" title="${escape(entry?.excerpt ?? id)}">${escape(entry ? `${kindLabel(entry)} · ${entry.title}` : id)}${escape(state)}</button>`;
  }).join('')}</div>` : '');
  const issues = (list: string[]) => (list.length ? `<ul class="pmr-issues">${list.map((issue) => `<li>${escape(issue)}</li>`).join('')}</ul>` : '');
  const review = (id: string, current?: ReasoningReview, fact = false) => {
    if (snapshot?.demo) return '';
    if (current) return `<div class="pmr-review">${badge(current.status, `${current.status === 'validé' ? 'Validé' : 'Écarté'} par l’avocat`)}${current.note ? `<span class="pmr-muted">${escape(current.note)}</span>` : ''}${fact ? `<button data-edit="${escape(id)}">Modifier</button>` : ''}<button data-review="${escape(id)}" data-status="">Annuler la décision</button></div>`;
    return `<div class="pmr-review"><button data-review="${escape(id)}" data-status="validé">Valider</button><button data-review="${escape(id)}" data-status="écarté">Écarter</button>${fact ? `<button data-edit="${escape(id)}">Modifier</button>` : ''}</div>`;
  };

  const lawCard = (condition: ReasoningCondition, conclusion = false) => `<div class="pmr-card law">
    <h4>${conclusion ? 'Conclusion · ' : ''}${escape(condition.label)}</h4>
    <div class="pmr-answer">${badge(condition.status)}${condition.strength ? `<span class="pmr-badge pmr-k-${condition.strength}">${STRENGTH_LABELS[condition.strength]}</span>` : ''}<code>${escape(condition.variable)}</code></div>
    ${chips(condition.sources)}${issues(condition.issues)}${review(condition.id, condition.review)}</div>`;

  const factForm = (fact: ReasoningFact) => {
    const value = fact.type === 'booléen'
      ? `<select name="value"><option value="vrai"${fact.value === true ? ' selected' : ''}>Vrai</option><option value="faux"${fact.value === false ? ' selected' : ''}>Faux</option></select>`
      : `<input name="value" ${fact.type === 'date' ? 'type="date"' : ''} value="${escape(fact.value === null ? '' : fact.type === 'durée' ? '' : fact.value)}" placeholder="${fact.type === 'durée' ? '5 an, 2 mois, 10 jour' : ''}" aria-label="Valeur">`;
    return `<form class="pmr-form" data-fact="${escape(fact.id)}">${value}<select name="force" aria-label="Force probante"><option value="">Force probante…</option>${REASONING_FORCES.map((force) => `<option value="${force}"${fact.force === force ? ' selected' : ''}>${FORCE_LABELS[force]}</option>`).join('')}</select><textarea name="appreciation" placeholder="Appréciation de la pièce" aria-label="Appréciation">${escape(fact.appreciation)}</textarea><input name="note" placeholder="Motif (facultatif)" aria-label="Motif"><div class="pmr-review"><button type="submit">Enregistrer et valider</button><button type="button" data-cancel>Annuler</button></div></form>`;
  };

  const factCard = (fact: ReasoningFact) => {
    const pieces = fact.sources.map(source).filter((entry): entry is ReasoningSource => Boolean(entry));
    return `<div class="pmr-card fact${fact.sources.length ? '' : ' missing'}">
      <h4>${escape(fact.variable)} = ${escape(formatValue(fact.value))}</h4>
      <div class="pmr-answer">${badge(fact.status)}${fact.force ? `<span class="pmr-badge">${escape(FORCE_LABELS[fact.force])}</span>` : ''}<span class="pmr-muted">appréciation : ${fact.author === 'avocat' ? 'avocat' : 'IA'}</span></div>
      ${fact.appreciation ? `<p class="pmr-muted">${escape(fact.appreciation)}</p>` : ''}
      ${chips(fact.sources)}${pieces.map((entry) => `<p class="pmr-excerpt">« ${escape(entry.excerpt)} »</p>`).join('')}
      ${issues(fact.issues)}${editing === fact.id ? factForm(fact) : review(fact.id, fact.review, true)}</div>`;
  };

  const questionView = (question: ReasoningQuestion) => {
    const conditions = question.conditions.map((id) => snapshot!.conditions.find((entry) => entry.id === id)!).filter(Boolean);
    const facts = snapshot!.facts.filter((fact) => fact.scope === question.scope);
    const resultId = `${question.scope}.${question.result}`;
    const linked = new Set<string>();
    const rows = conditions.filter((condition) => condition.id !== resultId).map((condition) => {
      const own = facts.filter((fact) => condition.dependsOn.includes(fact.id));
      own.forEach((fact) => linked.add(fact.id));
      return `${lawCard(condition)}<div class="pmr-arrow" aria-hidden="true">→</div><div>${own.length ? own.map(factCard).join('') : '<div class="pmr-card missing pmr-muted">Aucun fait rattaché.</div>'}</div>`;
    });
    const result = conditions.find((condition) => condition.id === resultId);
    const loose = facts.filter((fact) => !linked.has(fact.id));
    const vigueur = question.vigueur.map((entry) => `${escape(source(entry.source)?.title ?? entry.source)} : ${entry.inForce === true ? `en vigueur au ${formatValue(entry.date)}` : entry.inForce === false ? `non en vigueur au ${formatValue(entry.date)}` : 'vigueur indéterminée (date ou période inconnue)'}`).join(' · ');
    return `<article class="pmr-question">
      <h3>${escape(question.question || question.scope)}</h3>
      <div class="pmr-answer">${badge(question.status, `Réponse : ${question.status}`)}${question.valid ? '' : badge('indéterminée', 'Raisonnement incomplet')}<span class="pmr-muted">date de référence : ${escape(formatValue(question.referenceDate))}</span></div>
      ${issues(question.issues)}${vigueur ? `<p class="pmr-vigueur">Vigueur · ${vigueur}</p>` : ''}
      <div class="pmr-columns"><div class="pmr-colhead law">DROIT</div><div class="pmr-colhead gap"></div><div class="pmr-colhead fact">FAITS / PIÈCES</div>
      ${rows.join('')}
      ${loose.length ? `<div></div><div></div><div>${loose.map(factCard).join('')}</div>` : ''}
      ${result ? `${lawCard(result, true)}<div></div><div></div>` : ''}</div></article>`;
  };

  const paint = () => {
    root.dataset.theme = context.theme;
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
    root.querySelector<HTMLElement>('[data-demo]')!.textContent = snapshot?.demo ? 'Revenir au dossier' : 'Exemple fictif';
    const meta = root.querySelector<HTMLElement>('.pmr-meta')!;
    if (!snapshot) { body.innerHTML = ''; meta.textContent = context.project ? 'Chargement…' : 'Aucun dossier ouvert.'; return; }
    const pending = [...snapshot.conditions, ...snapshot.facts].filter((item) => !item.review).length;
    meta.textContent = snapshot.demo ? 'EXEMPLE FICTIF · non enregistré dans le dossier' : snapshot.revision ? `Révision ${snapshot.revision} · ${pending} élément(s) à valider` : '';
    warning.hidden = !snapshot.diagnostics.length;
    warning.textContent = snapshot.diagnostics.join(' · ');
    if (!snapshot.code) { body.innerHTML = '<div class="pmr-empty"><strong>Aucun raisonnement</strong><p>Posez une question de droit dans le chat : le raisonnement (conditions, fondements, pièces) apparaît ici à la fin du tour, et chaque élément attend votre validation.</p></div>'; return; }
    if (tab === 'code') body.innerHTML = `<pre class="pmr-code">${escape(snapshot.code)}</pre>`;
    else if (tab === 'sources') body.innerHTML = snapshot.sources.map((entry) => `<div class="pmr-source"><div class="pmr-answer"><span class="pmr-badge">${escape(kindLabel(entry))}</span><button class="pmr-chip" data-open="${escape(entry.id)}">${escape(entry.title)}</button>${badge(entry.verified ? 'établi' : 'non établi', entry.verified ? (entry.repaired ? 'Extrait recalé' : 'Extrait vérifié') : 'Extrait introuvable')}<code>${escape(entry.id)}</code></div><p class="pmr-excerpt">« ${escape(entry.excerpt)} »</p>${entry.validity ? `<p class="pmr-muted">Version du ${formatValue(entry.validity.from)} au ${entry.validity.to ? formatValue(entry.validity.to) : 'terme non fixé'} (fin exclusive)</p>` : entry.kind === 'article' ? '<p class="pmr-muted">Période de vigueur inconnue</p>' : ''}${entry.history ? `<p class="pmr-muted">Historique judiciaire : ${escape(entry.history.status)}</p>${entry.history.lines.map((line) => `<p class="pmr-muted">· ${escape(line)}</p>`).join('')}` : ''}</div>`).join('') || '<p class="pmr-muted">Aucune source.</p>';
    else body.innerHTML = snapshot.questions.map(questionView).join('') || '<p class="pmr-muted">Aucun champ d’application ne pose de question.</p>';
  };

  const showError = (error: unknown) => { warning.hidden = false; warning.textContent = error instanceof Error ? error.message : 'Action impossible.'; };
  const apply = (data: ReasoningSnapshot) => { lastSerialized = JSON.stringify(data); snapshot = data; editing = ''; paint(); };
  const load = async (example = false) => {
    const request = ++sequence;
    try {
      if (!example && !context.project) { paint(); return; }
      const data = await loadReasoning(context.project?.path ?? null, example);
      if (stopped || request !== sequence) return;
      const serialized = JSON.stringify(data);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      snapshot = data;
      if (!editing) paint();
    } catch (error) {
      if (!stopped && request === sequence) showError(error);
    }
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    if (button.dataset.tab) { tab = button.dataset.tab as Tab; paint(); }
    if (button.hasAttribute('data-demo')) { lastSerialized = ''; editing = ''; void load(!snapshot?.demo); }
    if (button.hasAttribute('data-refresh')) { lastSerialized = ''; void load(Boolean(snapshot?.demo)); }
    if (button.dataset.open) {
      const entry = source(button.dataset.open);
      if (entry?.token) api.openFileInEditor?.(`piecemaker://citation/${entry.token}/${encodeURIComponent(entry.title)}`);
    }
    if (button.dataset.edit) { editing = button.dataset.edit; paint(); }
    if (button.hasAttribute('data-cancel')) { editing = ''; paint(); }
    if (button.dataset.review && context.project && !snapshot?.demo) {
      const status = (button.dataset.status || null) as 'validé' | 'écarté' | null;
      const note = status ? window.prompt(status === 'validé' ? 'Motif de la validation (facultatif)' : 'Motif du rejet (facultatif)') ?? undefined : undefined;
      void reviewItem(context.project.path, button.dataset.review, status, note).then(apply).catch(showError);
    }
  });
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = (event.target as Element).closest<HTMLFormElement>('form[data-fact]');
    const fact = snapshot?.facts.find((entry) => entry.id === form?.dataset.fact);
    if (!form || !fact || !context.project) return;
    const data = new FormData(form);
    try {
      const value = parseInput(fact.type, String(data.get('value') ?? ''));
      void appreciateFact(context.project.path, fact.id, { value, force: String(data.get('force') || '') || null, appreciation: String(data.get('appreciation') ?? ''), note: String(data.get('note') ?? '') || undefined }).then(apply).catch(showError);
    } catch (error) { showError(error); }
  });

  const unsubscribe = api.onContextChange((next) => {
    const changed = next.project?.path !== context.project?.path;
    context = next;
    if (changed) { sequence++; snapshot = null; lastSerialized = ''; editing = ''; void load(); }
    paint();
  });
  const poll = () => { if (!stopped) { if (!snapshot?.demo) void load(); timer = window.setTimeout(poll, 2500); } };
  paint();
  void load();
  timer = window.setTimeout(poll, 2500);
  window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: 'plugin:piecemaker-raisonnement' } }));
  cleanups.set(container, () => { stopped = true; sequence++; window.clearTimeout(timer); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
