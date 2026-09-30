import type { ColumnFormat, Option, Provider, ResearchDecision, ResearchFilters, ResearchPage, ResearchSource, ResearchState, ResearchText, ResearchView, ReviewDetail, Template } from '../shared.js';
import {
  APPEL_SIEGES,
  BULLETIN_PUBLICATIONS,
  CAA_VILLES,
  CASSATION_MATIERES,
  LEBON_PUBLICATIONS,
  ORIGIN_LABELS,
  PREMIERE_INSTANCE_TYPES,
  RESEARCH_LIMIT,
  RESEARCH_SOURCES,
  REVIEW_FOLDER,
  ZONE_LABELS,
  ZONE_ORIGIN_LABELS,
} from '../shared.js';
import type { App, View } from './app.js';
import { confirmDialog, errorMessage, escapeHtml, toast } from './dom.js';
import { anonymizationProxyOrigin, loadModels } from './host.js';
import type { HostProject, ModelOption } from './host.js';
import type { DraftColumn } from './templates.js';
import { draftColumns, questionHtml } from './templates.js';

const POLL_INTERVAL = 700;
const TEXT_CACHE = 30;
const RUNNING: ResearchState['phase'][] = ['counting', 'listing', 'downloading'];

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
];

const SOURCE_LABEL = Object.fromEntries(RESEARCH_SOURCES.map((source) => [source.value, source.label])) as Record<ResearchSource, string>;

type Form = Omit<ResearchFilters, 'query' | 'dateDebut' | 'dateFin' | 'dispositifOnly'>;

function checkboxes(name: keyof Form, options: Option[], selected: string[]): string {
  return options.map((option) => `<label class="ptr-check"><input type="checkbox" data-form="${name}" value="${escapeHtml(option.value)}"${selected.includes(option.value) ? ' checked' : ''}> ${escapeHtml(option.label)}</label>`).join('');
}

function selectHtml(name: keyof Form, options: Option[], value: string): string {
  return `<select class="ptr-select" data-form="${name}">${options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
}

function multiSummary(options: Option[], selected: string[], all: string): string {
  if (!selected.length) return all;
  const labels = options.filter((option) => selected.includes(option.value)).map((option) => option.label);
  return labels.length <= 3 ? labels.join(', ') : `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`;
}

function multiHtml(name: keyof Form, options: Option[], selected: string[], all: string): string {
  return `<details class="ptr-multi"><summary data-summary="${name}">${escapeHtml(multiSummary(options, selected, all))}</summary><div class="ptr-multi-grid">${checkboxes(name, options, selected)}</div></details>`;
}

function sourceFilters(form: Form): string {
  const blocks: string[] = [];
  if (form.sources.includes('cassation')) {
    blocks.push(`<fieldset class="ptr-fieldset"><legend>Cour de cassation</legend>
      <span class="ptr-label">Matière (chambres) — obligatoire</span><div class="ptr-choice-row">${checkboxes('matieres', CASSATION_MATIERES, form.matieres)}</div>
      <span class="ptr-small ptr-muted">Assemblée plénière, chambre mixte, chambres réunies et avis toujours inclus.</span>
      <label class="ptr-field"><span class="ptr-label">Publication</span>${selectHtml('publicationBulletin', BULLETIN_PUBLICATIONS, form.publicationBulletin)}</label></fieldset>`);
  }
  if (form.sources.includes('appel')) {
    blocks.push(`<fieldset class="ptr-fieldset"><legend>Cours d’appel</legend>
      <span class="ptr-label">Siège</span>${multiHtml('sieges', APPEL_SIEGES, form.sieges, 'Toutes les cours d’appel')}
      <span class="ptr-small ptr-muted">Aucune facette de matière n’existe pour les cours d’appel : ciblez par les mots de la requête.</span></fieldset>`);
  }
  if (form.sources.includes('conseil_etat')) {
    blocks.push(`<fieldset class="ptr-fieldset"><legend>Conseil d’État</legend>
      <label class="ptr-field"><span class="ptr-label">Recueil Lebon</span>${selectHtml('publicationConseilEtat', LEBON_PUBLICATIONS, form.publicationConseilEtat)}</label></fieldset>`);
  }
  if (form.sources.includes('caa')) {
    blocks.push(`<fieldset class="ptr-fieldset"><legend>Cours administratives d’appel</legend>
      <span class="ptr-label">Ville</span>${multiHtml('villesCaa', CAA_VILLES, form.villesCaa, 'Toutes les CAA')}
      <label class="ptr-field"><span class="ptr-label">Recueil Lebon</span>${selectHtml('publicationCaa', LEBON_PUBLICATIONS, form.publicationCaa)}</label></fieldset>`);
  }
  if (form.sources.includes('premiere_instance')) {
    blocks.push(`<fieldset class="ptr-fieldset"><legend>Première instance</legend>
      <span class="ptr-label">Juridictions — obligatoire</span><div class="ptr-multi-grid ptr-multi-open">${checkboxes('typesPremiereInstance', PREMIERE_INSTANCE_TYPES, form.typesPremiereInstance)}</div>
      <span class="ptr-small ptr-muted">Fonds limité (environ 2 000 décisions) : sans ET/OU explicite, les mots sont reliés par OU.</span></fieldset>`);
  }
  return blocks.join('');
}

function missingFilters(form: Form, query: string): string[] {
  const missing: string[] = [];
  if (!query.trim()) missing.push('une requête');
  if (!form.sources.length) missing.push('au moins une juridiction');
  if (form.sources.includes('cassation') && !form.matieres.length) missing.push('une matière pour la Cour de cassation');
  if (form.sources.includes('premiere_instance') && !form.typesPremiereInstance.length) missing.push('un type de juridiction de première instance');
  return missing;
}

function filenamePreview(title: string): string {
  const now = new Date();
  const stamp = [now.getFullYear() % 100, now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
  return `${stamp} - Tabular Review Recherche juridique - ${title || '…'}`;
}

function countDetail(count: ResearchState['counts'][number]): string {
  return count.judilibre === undefined ? '' : ` (Légifrance ${count.legifrance ?? 0} · Judilibre ${count.judilibre})`;
}

function countsHtml(state: ResearchState): string {
  return state.counts.map((count) => `<span class="ptr-chip">${escapeHtml(SOURCE_LABEL[count.source])} : ${count.total}${countDetail(count)}</span>`).join('');
}

function warningsHtml(state: ResearchState): string {
  return (state.warnings ?? []).map((warning) => `<div class="ptr-warning">${escapeHtml(warning)}</div>`).join('');
}

function decisionHtml(decision: ResearchDecision, dispositifOnly: boolean): string {
  const zone = dispositifOnly && decision.zone !== 'motifs' ? `<span class="ptr-chip ptr-chip-partial" title="${escapeHtml(ZONE_LABELS[decision.zone])}">${decision.zone === 'dispositif' ? 'Dispositif seul' : 'Partie du juge non repérée'}</span>` : '';
  const error = decision.error ? `<span class="ptr-chip ptr-chip-cancelled" title="${escapeHtml(decision.error)}">Texte indisponible</span>` : '';
  const origin = ORIGIN_LABELS[decision.origin ?? 'legifrance'];
  const originChip = decision.origin === 'judilibre' ? `<span class="ptr-chip" title="Décision absente de Légifrance, issue de Judilibre">${origin}</span>` : '';
  const analysis = decision.analysisKind === 'aucune'
    ? '<div class="ptr-analysis ptr-muted">Aucune analyse officielle.</div>'
    : `<div class="ptr-analysis ptr-clamp" data-analysis>${decision.analysisKind === 'extrait' ? '<span class="ptr-label">Extrait · </span>' : ''}${escapeHtml(decision.analysis)}</div>`;
  return `
    <article class="ptr-decision" data-decision="${escapeHtml(decision.id)}">
      <div class="ptr-decision-head">
        <span class="ptr-rank">${decision.rank}</span>
        <span class="ptr-chip${/Inédit|Cour d’appel|Première instance|Cour administrative/.test(decision.importance) ? '' : ' ptr-chip-important'}">${escapeHtml(decision.importance)}</span>
        <a class="ptr-decision-title" href="${escapeHtml(decision.link)}" target="_blank" rel="noopener noreferrer" title="Ouvrir sur ${origin}">${escapeHtml(decision.title)}</a>
        ${originChip}${zone}${error}
      </div>
      ${decision.titrage ? `<div class="ptr-titrage ptr-clamp-2" title="${escapeHtml(decision.titrage)}">${escapeHtml(decision.titrage)}</div>` : ''}
      ${analysis}
      <div class="ptr-decision-actions">
        <button type="button" class="ptr-link-button" data-more hidden>Lire la suite</button>
        ${decision.error ? '' : `<button type="button" class="ptr-link-button" data-read="retained">${dispositifOnly ? 'Lire la partie retenue' : 'Lire la décision'}</button>`}
        ${decision.error || !dispositifOnly ? '' : '<button type="button" class="ptr-link-button" data-read="full">Texte intégral</button>'}
      </div>
      <div class="ptr-decision-text" data-text hidden></div>
    </article>`;
}

export function createResearchView(app: App): View {
  const element = document.createElement('div');
  element.className = 'ptr-page';
  element.innerHTML = `
    <div class="ptr-grid">
      <label class="ptr-field"><span class="ptr-label">Dossier</span><select class="ptr-select" data-project></select></label>
      <label class="ptr-field" style="grid-column:span 2"><span class="ptr-label">Nom de la tabular review</span><input class="ptr-input" data-title maxlength="120" placeholder="ex. Faute grave et dissimulation de documents"></label>
    </div>
    <div data-legifrance></div>
    <section class="ptr-panel">
      <div class="ptr-panel-header">Recherche Légifrance et Judilibre</div>
      <div class="ptr-search-body">
        <label class="ptr-field"><span class="ptr-label">Requête</span>
          <textarea class="ptr-textarea" data-query rows="2" maxlength="2000" placeholder="(&quot;faute grave&quot; OU &quot;faute lourde&quot;) ET licenciement"></textarea>
          <span class="ptr-small ptr-muted">Guillemets : expression exacte · ET prioritaire sur OU · parenthèses pour regrouper · mots sans opérateur reliés par ET · références normalisées (L. 1235-3).</span>
        </label>
        <div class="ptr-field"><span class="ptr-label">Juridictions</span><div class="ptr-choice-row">${RESEARCH_SOURCES.map((source) => `<label class="ptr-pill"><input type="checkbox" data-form="sources" value="${source.value}"> ${escapeHtml(source.label)}</label>`).join('')}</div></div>
        <div class="ptr-source-filters" data-source-filters></div>
        <div class="ptr-search-row">
          <label class="ptr-field" style="width:150px"><span class="ptr-label">Décisions du</span><input class="ptr-input" type="date" data-date-start></label>
          <label class="ptr-field" style="width:150px"><span class="ptr-label">Au</span><input class="ptr-input" type="date" data-date-end></label>
          <label class="ptr-check ptr-dispositif"><input type="checkbox" data-dispositif checked><span><strong>Chercher dans le dispositif uniquement</strong><br><span class="ptr-small ptr-muted">Seule la partie où le juge statue est lue et transmise à l’IA : motifs de la juridiction (« Sur ce », « Mais attendu que », « Réponse de la Cour », « Considérant »…) et dispositif (« Par ces motifs », « Décide »). Faits, procédure, moyens et prétentions des parties sont écartés. Pour les juridictions judiciaires, le découpage officiel de Judilibre est utilisé quand il existe ; sinon, repérage par formules.</span></span></label>
          <span class="ptr-spacer"></span>
          <button type="button" class="ptr-button ptr-button-primary" data-search>Rechercher</button>
        </div>
        <div class="ptr-small ptr-muted" data-missing></div>
      </div>
    </section>
    <div data-status></div>
    <section class="ptr-panel" data-results tabindex="-1" hidden>
      <div class="ptr-panel-header"><span data-results-title></span><span class="ptr-spacer"></span><span data-pager></span></div>
      <div data-list></div>
      <div class="ptr-panel-header ptr-panel-bottom"><span class="ptr-spacer"></span><span data-pager></span></div>
    </section>
    <section class="ptr-panel" data-questions hidden>
      <div class="ptr-panel-header">
        <span data-question-count>Questions à poser</span>
        <span class="ptr-spacer"></span>
        <select class="ptr-select" data-template-source style="max-width:240px;height:1.6rem;padding:0 6px"></select>
        <button type="button" class="ptr-button" data-add-question>+ Ajouter une question</button>
      </div>
      <div class="ptr-search-body" data-question-list></div>
    </section>
    <div class="ptr-footer-bar" data-launch-bar hidden>
      <label class="ptr-field" style="width:120px"><span class="ptr-label">IA</span><select class="ptr-select" data-provider>${PROVIDERS.map((provider) => `<option value="${provider.value}">${provider.label}</option>`).join('')}</select></label>
      <label class="ptr-field" style="width:240px"><span class="ptr-label">Modèle IA</span><select class="ptr-select" data-model></select></label>
      <label class="ptr-field" style="width:150px"><span class="ptr-label">Sessions simultanées</span><select class="ptr-select" data-concurrency>${[1, 2, 3, 4, 5, 6, 8].map((value) => `<option value="${value}"${value === 3 ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
      <span class="ptr-spacer"></span>
      <span class="ptr-small ptr-muted" data-filename></span>
      <button type="button" class="ptr-button ptr-button-primary" data-launch>Lancer la revue</button>
    </div>
    <div data-model-warning></div>`;

  const $ = <T extends HTMLElement>(selector: string) => element.querySelector<T>(selector)!;
  const projectSelect = $<HTMLSelectElement>('[data-project]');
  const titleInput = $<HTMLInputElement>('[data-title]');
  const queryInput = $<HTMLTextAreaElement>('[data-query]');
  const startInput = $<HTMLInputElement>('[data-date-start]');
  const endInput = $<HTMLInputElement>('[data-date-end]');
  const dispositifInput = $<HTMLInputElement>('[data-dispositif]');
  const providerSelect = $<HTMLSelectElement>('[data-provider]');
  const modelSelect = $<HTMLSelectElement>('[data-model]');
  const concurrencySelect = $<HTMLSelectElement>('[data-concurrency]');
  const templateSource = $<HTMLSelectElement>('[data-template-source]');
  const results = $('[data-results]');
  const list = $('[data-list]');

  const form: Form = {
    sources: [],
    matieres: [],
    publicationBulletin: 'TOUS',
    sieges: [],
    publicationConseilEtat: 'TOUS',
    villesCaa: [],
    publicationCaa: 'TOUS',
    typesPremiereInstance: [],
  };
  let projects: HostProject[] = [];
  let templates: Template[] = [];
  let questions: DraftColumn[] = draftColumns(null);
  let models: { options: ModelOption[]; cheapest: string } = { options: [], cheapest: '' };
  let configured = true;
  let state: ResearchState | null = null;
  let view: ResearchView = 'kept';
  let page = 1;
  let pageCount = 1;
  let searching = false;
  let launching = false;
  let destroyed = false;
  let timer = 0;
  let pageRequest = 0;
  const pages = new Map<string, Promise<ResearchPage>>();
  const texts = new Map<string, Promise<ResearchText>>();

  const running = () => Boolean(state && RUNNING.includes(state.phase));
  const launchable = () => (state?.phase === 'done' ? state.kept : 0);

  function renderMissing() {
    const missing = missingFilters(form, queryInput.value);
    $('[data-missing]').textContent = missing.length ? `À renseigner : ${missing.join(', ')}.` : '';
    const button = $<HTMLButtonElement>('[data-search]');
    button.disabled = searching || running() || !configured || missing.length > 0;
    button.textContent = searching || running() ? 'Recherche…' : 'Rechercher';
  }

  function renderSourceFilters() {
    $('[data-source-filters]').innerHTML = sourceFilters(form);
    renderMissing();
  }

  function renderStatus() {
    const target = $('[data-status]');
    if (!state) {
      target.innerHTML = '';
      return;
    }
    const stop = '<button type="button" class="ptr-button ptr-button-danger" data-stop>Arrêter</button>';
    switch (state.phase) {
      case 'counting':
        target.innerHTML = `<div class="ptr-status"><span class="ptr-spinner"></span> Comptage des résultats sur Légifrance et Judilibre…<span class="ptr-spacer"></span>${stop}</div>`;
        return;
      case 'listing':
        target.innerHTML = `<div class="ptr-status"><span class="ptr-spinner"></span> Liste des résultats : ${state.listed} / ${state.total}${countsHtml(state)}<span class="ptr-spacer"></span>${stop}</div>`;
        return;
      case 'downloading': {
        const percent = state.listed ? Math.round((state.downloaded / state.listed) * 100) : 0;
        target.innerHTML = `<div class="ptr-status"><span class="ptr-spinner"></span> Téléchargement des décisions : ${state.downloaded} / ${state.listed}<div class="ptr-progress" style="flex:1;max-width:320px"><div style="width:${percent}%"></div></div>${countsHtml(state)}<span class="ptr-spacer"></span>${stop}</div>`;
        return;
      }
      case 'too_broad':
        target.innerHTML = `${warningsHtml(state)}<div class="ptr-warning">Requête trop large : <strong>${state.total} résultats</strong> (${state.counts.map((count) => `${escapeHtml(SOURCE_LABEL[count.source])} ${count.total}${countDetail(count)}`).join(', ')}). Au-delà de ${RESEARCH_LIMIT} résultats, la recherche est refusée pour manque de contexte : précisez les termes (guillemets, ET), l’article visé, la matière ou bornez les dates.</div>`;
        return;
      case 'error':
        target.innerHTML = `<div class="ptr-error-box">${escapeHtml(state.error ?? 'Recherche en échec.')}</div>`;
        return;
      case 'cancelled':
        target.innerHTML = '<div class="ptr-status ptr-muted">Recherche arrêtée.</div>';
        return;
      case 'done': {
        const details: string[] = [];
        if (state.excluded) details.push(`<button type="button" class="ptr-link-button" data-view="${view === 'excluded' ? 'kept' : 'excluded'}">${view === 'excluded' ? 'Revenir aux décisions retenues' : `${state.excluded} écartée${state.excluded > 1 ? 's' : ''} : termes absents de la partie du juge`}</button>`);
        if (state.undetected) details.push(`${state.undetected} sans partie du juge repérée (conservée${state.undetected > 1 ? 's' : ''}, signalée${state.undetected > 1 ? 's' : ''})`);
        if (state.failed) details.push(`<span class="ptr-status-error">${state.failed} téléchargement${state.failed > 1 ? 's' : ''} en échec (exclu${state.failed > 1 ? 's' : ''} de la revue)</span>`);
        target.innerHTML = `${warningsHtml(state)}<div class="ptr-status"><strong>${state.kept} décision${state.kept > 1 ? 's' : ''} retenue${state.kept > 1 ? 's' : ''}</strong> sur ${state.listed} décision${state.listed > 1 ? 's' : ''} distincte${state.listed > 1 ? 's' : ''}${countsHtml(state)}${details.length ? ` · ${details.join(' · ')}` : ''}</div>`;
      }
    }
  }

  function pagerHtml(): string {
    return `<span class="ptr-pager">
      <button type="button" class="ptr-icon-button" data-page="1" aria-label="Première page"${page <= 1 ? ' disabled' : ''}>«</button>
      <button type="button" class="ptr-icon-button" data-page="${page - 1}" aria-label="Page précédente"${page <= 1 ? ' disabled' : ''}>‹</button>
      <span class="ptr-small">Page ${page} / ${pageCount}</span>
      <button type="button" class="ptr-icon-button" data-page="${page + 1}" aria-label="Page suivante"${page >= pageCount ? ' disabled' : ''}>›</button>
      <button type="button" class="ptr-icon-button" data-page="${pageCount}" aria-label="Dernière page"${page >= pageCount ? ' disabled' : ''}>»</button>
    </span>`;
  }

  function fetchPage(target: number): Promise<ResearchPage> {
    const key = `${view}:${target}`;
    let pending = pages.get(key);
    if (!pending) {
      pending = app.rpc<ResearchPage>('GET', `/research/page?id=${encodeURIComponent(state!.id)}&page=${target}&view=${view}`);
      pending.catch(() => pages.delete(key));
      pages.set(key, pending);
    }
    return pending;
  }

  function markOverflow() {
    window.requestAnimationFrame(() => {
      list.querySelectorAll<HTMLElement>('[data-analysis]').forEach((analysis) => {
        const more = analysis.closest('.ptr-decision')?.querySelector<HTMLElement>('[data-more]');
        if (more) more.hidden = analysis.scrollHeight <= analysis.clientHeight + 1;
      });
    });
  }

  async function showPage(target: number, scroll = false) {
    if (!state || state.phase !== 'done') return;
    const request = ++pageRequest;
    let result: ResearchPage;
    try {
      result = await fetchPage(target);
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
      return;
    }
    if (request !== pageRequest || destroyed) return;
    const focused = document.activeElement instanceof HTMLElement && results.contains(document.activeElement) ? document.activeElement : null;
    const focusedPager = focused?.closest('[data-pager]') ? [...element.querySelectorAll('[data-pager]')].indexOf(focused.closest('[data-pager]')!) : -1;
    const focusedLabel = focused?.getAttribute('aria-label') ?? '';
    page = result.page;
    pageCount = result.pageCount;
    results.hidden = false;
    $('[data-results-title]').textContent = view === 'excluded'
      ? `Décisions écartées (${result.count}) — termes absents de la partie du juge`
      : `Décisions par ordre d’importance (${result.count})`;
    element.querySelectorAll<HTMLElement>('[data-pager]').forEach((pager) => { pager.innerHTML = result.count ? pagerHtml() : ''; });
    list.innerHTML = result.items.length
      ? result.items.map((decision) => decisionHtml(decision, state!.filters.dispositifOnly)).join('')
      : '<div class="ptr-empty">Aucune décision.</div>';
    markOverflow();
    if (focused && !results.contains(focused)) {
      const button = element.querySelectorAll('[data-pager]')[focusedPager]?.querySelector<HTMLButtonElement>(`[aria-label="${focusedLabel}"]:not(:disabled)`);
      (button ?? results).focus({ preventScroll: true });
    }
    if (scroll) results.scrollIntoView({ block: 'start' });
    if (page < pageCount) void fetchPage(page + 1).catch(() => undefined);
  }

  function renderQuestions() {
    $('[data-question-list]').innerHTML = questions.map((column, index) => questionHtml(column, index, questions.length)).join('');
    $('[data-question-count]').textContent = `Questions à poser (${questions.length})`;
  }

  function renderTemplateSource() {
    templateSource.innerHTML = `<option value="">Partir d’un modèle…</option>${templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)} — ${template.columns.length} question${template.columns.length > 1 ? 's' : ''}</option>`).join('')}`;
  }

  function preparedQuestions() {
    return questions
      .filter((column) => column.prompt.trim())
      .map((column) => ({
        name: (column.name.trim() || column.prompt.trim().replace(/\s+/g, ' ').slice(0, 60)),
        prompt: column.prompt.trim(),
        format: column.format,
        ...(column.format === 'tags' ? { tags: column.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean) } : {}),
      }));
  }

  function renderLaunch() {
    const ready = state?.phase === 'done' && launchable() > 0;
    $('[data-questions]').hidden = !ready;
    $('[data-launch-bar]').hidden = !ready;
    if (!ready) {
      $('[data-model-warning]').innerHTML = '';
      return;
    }
    const count = launchable();
    const button = $<HTMLButtonElement>('[data-launch]');
    button.disabled = launching || !projectSelect.value || !titleInput.value.trim() || !preparedQuestions().length || !modelSelect.value;
    button.textContent = launching ? 'Lancement…' : `Lancer la revue (${count} décision${count > 1 ? 's' : ''})`;
    $('[data-filename]').textContent = `${REVIEW_FOLDER}/${filenamePreview(titleInput.value.trim())}`;
    $('[data-model-warning]').innerHTML = modelSelect.value && modelSelect.value !== models.cheapest
      ? `<div class="ptr-warning">Modèle plus puissant que le modèle par défaut : chaque décision lance une session IA complète (${count} session${count > 1 ? 's' : ''}), la consommation de tokens peut être très élevée.</div>`
      : '';
  }

  function renderAll() {
    renderMissing();
    renderStatus();
    renderLaunch();
  }

  function schedule() {
    window.clearTimeout(timer);
    if (!destroyed && running()) timer = window.setTimeout(() => void poll(), POLL_INTERVAL);
  }

  async function poll() {
    if (!state) return;
    try {
      const next = await app.rpc<ResearchState>('GET', `/research/state?id=${encodeURIComponent(state.id)}`);
      if (destroyed || next.id !== state.id) return;
      state = next;
    } catch (error) {
      if (destroyed) return;
      state = { ...state, phase: 'error', error: errorMessage(error) };
    }
    renderAll();
    if (state.phase === 'done') await showPage(1);
    schedule();
  }

  async function search() {
    const missing = missingFilters(form, queryInput.value);
    if (missing.length || searching || running()) return;
    searching = true;
    renderMissing();
    try {
      const filters: ResearchFilters = { ...form, query: queryInput.value.trim(), dateDebut: startInput.value, dateFin: endInput.value, dispositifOnly: dispositifInput.checked };
      state = await app.rpc<ResearchState>('POST', '/research', filters);
      view = 'kept';
      page = 1;
      pages.clear();
      texts.clear();
      results.hidden = true;
      list.innerHTML = '';
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    } finally {
      searching = false;
      renderAll();
      schedule();
    }
  }

  async function readText(article: HTMLElement, kind: 'retained' | 'full') {
    const id = article.dataset.decision ?? '';
    const box = article.querySelector<HTMLElement>('[data-text]')!;
    if (!box.hidden && box.dataset.kind === kind) {
      box.hidden = true;
      return;
    }
    let pending = texts.get(id);
    if (!pending) {
      pending = app.rpc<ResearchText>('GET', `/research/text?id=${encodeURIComponent(state!.id)}&decision=${encodeURIComponent(id)}`);
      pending.catch(() => texts.delete(id));
      texts.set(id, pending);
      if (texts.size > TEXT_CACHE) texts.delete(texts.keys().next().value!);
    }
    box.hidden = false;
    box.dataset.kind = kind;
    box.innerHTML = '<span class="ptr-muted"><span class="ptr-spinner"></span> Chargement…</span>';
    try {
      const text = await pending;
      if (box.dataset.kind !== kind) return;
      box.innerHTML = `<div class="ptr-label">${escapeHtml(kind === 'full' ? 'Texte intégral' : `${ZONE_LABELS[text.zone]}${text.zoneOrigin ? ` · ${ZONE_ORIGIN_LABELS[text.zoneOrigin]}` : ''}`)}</div>${escapeHtml(kind === 'full' ? text.full : text.retained)}`;
    } catch (error) {
      box.innerHTML = `<span class="ptr-status-error">${escapeHtml(errorMessage(error))}</span>`;
    }
  }

  async function launch() {
    const title = titleInput.value.trim();
    const columns = preparedQuestions();
    const project = projectSelect.value;
    const count = launchable();
    if (!state || !title || !columns.length || !project || !count) return;
    const provider = providerSelect.value as Provider;
    const model = modelSelect.value;
    const confirmed = await confirmDialog(
      app.root,
      'Lancer la revue ?',
      `<p>Vous allez lancer <strong>${count} session${count > 1 ? 's' : ''} IA</strong> (une par décision) avec <strong>${escapeHtml(provider)} — ${escapeHtml(modelSelect.selectedOptions[0]?.textContent ?? model)}</strong>, chacune pour ${columns.length} question${columns.length > 1 ? 's' : ''} :</p>
       <ul class="ptr-summary-list">${columns.map((column) => `<li>${escapeHtml(column.name)}</li>`).join('')}</ul>
       <p class="ptr-muted">${state.filters.dispositifOnly ? 'Seule la partie de chaque décision où le juge statue est transmise à l’IA. ' : ''}Les décisions sont enregistrées dans « ${escapeHtml(REVIEW_FOLDER)}/docs » du dossier et la revue dans « ${escapeHtml(filenamePreview(title))} », avec la catégorie « Recherche juridique ».</p>
       ${model !== models.cheapest ? '<div class="ptr-warning">Attention : ce modèle consomme beaucoup de tokens.</div>' : ''}`,
      'Lancer',
    );
    if (!confirmed) return;
    launching = true;
    renderLaunch();
    try {
      const proxyOrigin = await anonymizationProxyOrigin();
      const detail = await app.rpc<ReviewDetail>('POST', '/research/review', { id: state.id, project, title, columns, provider, model, concurrency: Number(concurrencySelect.value), proxyOrigin });
      titleInput.value = '';
      app.openReview(detail.project, detail.file);
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    } finally {
      launching = false;
      renderLaunch();
    }
  }

  async function loadProviderModels() {
    const provider = providerSelect.value as Provider;
    modelSelect.innerHTML = '<option value="">Chargement…</option>';
    try {
      models = await loadModels(provider);
    } catch {
      models = { options: provider === 'claude' ? [{ value: 'haiku', label: 'Haiku' }] : [], cheapest: provider === 'claude' ? 'haiku' : '' };
    }
    modelSelect.innerHTML = models.options.length
      ? models.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === models.cheapest ? ' selected' : ''}>${escapeHtml(option.label)}${option.value === models.cheapest ? ' (par défaut, économique)' : ''}</option>`).join('')
      : '<option value="">Aucun modèle disponible</option>';
    renderLaunch();
  }

  function renderProjects(preferred: string | null) {
    const current = projectSelect.value || preferred;
    projectSelect.innerHTML = projects.length
      ? projects.map((project) => `<option value="${escapeHtml(project.fullPath)}"${project.fullPath === current ? ' selected' : ''}>${escapeHtml(project.displayName)}</option>`).join('')
      : '<option value="">Aucun dossier</option>';
  }

  function updateForm(input: HTMLInputElement | HTMLSelectElement) {
    const key = input.dataset.form as keyof Form;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      const values = form[key] as string[];
      const next = input.checked ? [...new Set([...values, input.value])] : values.filter((value) => value !== input.value);
      (form as Record<string, unknown>)[key] = key === 'sources' ? RESEARCH_SOURCES.map((source) => source.value).filter((source) => next.includes(source)) : next;
      if (key === 'sources') {
        renderSourceFilters();
        return;
      }
      const summary = element.querySelector<HTMLElement>(`[data-summary="${key}"]`);
      if (summary) summary.textContent = key === 'sieges' ? multiSummary(APPEL_SIEGES, form.sieges, 'Toutes les cours d’appel') : multiSummary(CAA_VILLES, form.villesCaa, 'Toutes les CAA');
    } else {
      (form as Record<string, unknown>)[key] = input.value;
    }
    renderMissing();
  }

  element.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement) && target.dataset.form) updateForm(target);
    else if (target === providerSelect) void loadProviderModels();
    else if (target === modelSelect || target === projectSelect) renderLaunch();
    else if (target === templateSource) {
      const template = templates.find((entry) => entry.id === templateSource.value);
      templateSource.value = '';
      if (!template) return;
      questions = draftColumns(template);
      renderQuestions();
      renderLaunch();
    }
  });

  element.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (target === queryInput) renderMissing();
    else if (target === titleInput) renderLaunch();
    else if (target.closest('[data-question-list]')) {
      const column = questions[Number(target.closest<HTMLElement>('[data-question]')?.dataset.question)];
      const key = target.dataset.field;
      if (!column || !key) return;
      if (key === 'format') {
        column.format = target.value as ColumnFormat;
        renderQuestions();
      } else if (key === 'name' || key === 'prompt' || key === 'tagsText') {
        column[key] = target.value;
      }
      renderLaunch();
    }
  });

  element.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Enter' && target === queryInput && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void search();
      return;
    }
    if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || results.hidden || !results.contains(target) || target.matches('input, textarea, select')) return;
    const next = page + (event.key === 'ArrowRight' ? 1 : -1);
    if (next >= 1 && next <= pageCount) void showPage(next);
  });

  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-search]')) {
      void search();
      return;
    }
    if (target.closest('[data-stop]') && state) {
      void app.rpc<ResearchState>('POST', '/research/cancel', { id: state.id }).catch((error: unknown) => toast(app.root, errorMessage(error), 'error'));
      return;
    }
    const pageButton = target.closest<HTMLButtonElement>('[data-page]');
    if (pageButton && !pageButton.disabled) {
      void showPage(Number(pageButton.dataset.page), Boolean(pageButton.closest('.ptr-panel-bottom')));
      return;
    }
    const viewButton = target.closest<HTMLElement>('[data-view]');
    if (viewButton) {
      view = viewButton.dataset.view === 'excluded' ? 'excluded' : 'kept';
      renderStatus();
      void showPage(1);
      return;
    }
    const more = target.closest<HTMLElement>('[data-more]');
    if (more) {
      const analysis = more.closest('.ptr-decision')?.querySelector<HTMLElement>('[data-analysis]');
      const collapsed = analysis?.classList.toggle('ptr-clamp');
      more.textContent = collapsed ? 'Lire la suite' : 'Réduire';
      return;
    }
    const read = target.closest<HTMLElement>('[data-read]');
    if (read && state) {
      void readText(read.closest<HTMLElement>('[data-decision]')!, read.dataset.read === 'full' ? 'full' : 'retained');
      return;
    }
    if (target.closest('[data-launch]')) {
      void launch();
      return;
    }
    if (target.closest('[data-add-question]')) {
      questions.push({ name: '', prompt: '', format: 'text', tagsText: '' });
      renderQuestions();
      element.querySelector<HTMLTextAreaElement>(`[data-question="${questions.length - 1}"] [data-field="prompt"]`)?.focus();
      renderLaunch();
      return;
    }
    const question = target.closest<HTMLElement>('[data-question]');
    const index = Number(question?.dataset.question);
    if (!question || !questions[index]) return;
    const move = target.closest<HTMLElement>('[data-move]');
    if (move) {
      const destination = index + Number(move.dataset.move);
      if (destination < 0 || destination >= questions.length) return;
      [questions[index], questions[destination]] = [questions[destination], questions[index]];
      renderQuestions();
    } else if (target.closest('[data-remove]') && questions.length > 1) {
      questions = questions.filter((_, position) => position !== index);
      renderQuestions();
      renderLaunch();
    }
  });

  const stopTemplates = app.onTemplatesChange((next) => {
    templates = next;
    renderTemplateSource();
  });

  async function initialize() {
    renderSourceFilters();
    renderQuestions();
    renderAll();
    void loadProviderModels();
    void app.rpc<{ configured: boolean }>('GET', '/research/legifrance').then((result) => {
      configured = result.configured;
      $('[data-legifrance]').innerHTML = configured ? '' : '<div class="ptr-warning">Identifiants Légifrance (PISTE) absents : renseignez LEGIFRANCE_CLIENT_ID et LEGIFRANCE_CLIENT_SECRET dans ~/.config/mcp-legifrance/.env, par exemple avec l’étape « Légifrance » de l’installation PieceMaker.</div>';
      renderMissing();
    }).catch(() => undefined);
    try {
      [projects, templates] = await Promise.all([app.projects(), app.templates()]);
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    }
    renderTemplateSource();
    renderProjects(app.context().project?.path ?? null);
    renderLaunch();
  }

  void initialize();

  return {
    element,
    show() {
      void app.projects().then((loaded) => {
        projects = loaded;
        renderProjects(null);
        renderLaunch();
      }).catch(() => undefined);
      schedule();
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
      stopTemplates();
    },
  };
}
