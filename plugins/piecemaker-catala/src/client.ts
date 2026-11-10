import { citeCatala, loadCatala, verifyCatala } from './api.js';
import { mountExplanation } from './graph-view.js';
import { human, reasoning, reasoningGraph, reasoningIssues, reasoningText, type Reasoning, type Coverage } from './graph.js';
import type { NativeProvenance } from './native-provenance.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void };
type File = { nom: string; chemin: string; contenu?: string };
type Check = { name: string; command: string; exit_code: number | null; errors?: string[]; seconds: number; passed: boolean; status?: string; message?: string; files?: string[] };
type Report = { started_utc: string; finished_utc: string; passed: boolean; checks: Check[] };
type Proof = Report & { fichier: string; scope: string; conflits: number; obligations?: number };
type Catleg = { date_controle: string; dates_reference?: string[]; passed: boolean; fichiers: Array<{ fichier: string; passed: boolean; skipped?: boolean; articles?: string[]; versions?: Array<{ id: string; au: string; debut?: string; fin?: string | null; valide: boolean | null }>; messages: string[] }> };
type Scenario = { fichier: string; scope: string; passed: boolean; test_reussi: boolean; graphe: string; message: string; provenance?: NativeProvenance };
type Program = { nom: string; enCours: boolean; perimee: boolean; fichiers: File[]; journaux: File[]; verification: Report | null; tests?: { coverage?: Coverage; 'test-results': Array<{ file: string; tests: { scopes: Array<{ scope_name: string; success: boolean; errors?: unknown[] }> } }> } | null; citations?: { results: Array<{ origin: string; target: string; quote: string; label?: string; title?: string; id?: string; kind?: string; status: string; message: string }> } | null; preuve: Proof | null; catleg: Catleg | null; explication: (Report & { fichier: string; scope: string; provenance?: NativeProvenance }) | null; graphe: string | null; scenarios?: Scenario[] };
export type CatalaSnapshot = {
  pack: { id: string; platform: string; version: string; proof: boolean; installedAt: string } | null;
  status: { state: string; id?: string; step?: string; error?: string; updatedAt?: string } | null;
  programmes: Program[];
};

const TAB = 'plugin:piecemaker-catala';
const cleanups = new WeakMap<HTMLElement, () => void>();
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const pill = (tone: string, label: string) => `<span class="pmc-pill pmc-${tone}">${escape(label)}</span>`;
const freshness = (program: Program) => program.perimee ? pill('warn', 'Raisonnement à recalculer') : program.explication?.passed && (program.graphe || program.explication.provenance?.trace.length) ? '' : pill('muted', 'Aucun raisonnement calculé');
const analysed = (program: Program) => {
  const date = program.explication?.finished_utc;
  if (!date) return '';
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? '' : `Analysé le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(value)}`;
};

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pmc piecemaker-ui';
  root.setAttribute('aria-label', 'Programmes Catala du dossier');
  root.innerHTML = '<div class="pmc-detail"></div>';
  container.replaceChildren(style, root);
  const panel = root.querySelector<HTMLElement>('.pmc-detail')!;
  let context = api.context;
  let chosen: string | undefined;
  let data: CatalaSnapshot | null = null;
  let serialized = '';
  let verifying = '';
  let error = '';
  let stopped = false;
  let stopGraph = () => {};
  let sequence = 0;
  let viewMode = 'graph';
  let chosenScenario = '';
  let picking = false;
  const setPicking = (on: boolean) => {
    if (on === picking) return;
    picking = on;
    root.toggleAttribute('data-picking', on);
    window.dispatchEvent(new CustomEvent('piecemaker:panel-pick-state', { detail: { tab: TAB, active: on } }));
  };

  const shown = () => data?.programmes.find((entry) => entry.nom === chosen) ?? data?.programmes[0];
  const explanationPart = (program: Program) => {
    const scenarios = program.scenarios ?? [];
    const selected = scenarios.find((scenario) => `${scenario.fichier}:${scenario.scope}` === chosenScenario)
      ?? scenarios.find((scenario) => scenario.scope === program.explication?.scope && scenario.fichier === program.explication?.fichier)
      ?? scenarios.find((scenario) => scenario.passed) ?? scenarios[0];
    const provenance = selected?.provenance ?? (!program.perimee ? program.explication?.provenance : undefined);
    const traced = selected ? selected.passed && (selected.graphe || provenance?.trace.length) : !program.perimee && program.explication?.passed && (program.graphe || provenance?.trace.length);
    const dot = selected?.graphe ?? program.graphe;
    let model: Reasoning;
    let failure = selected && !selected.passed ? 'Ce scénario ne produit pas de graphe. Corrigez son exécution Catala.' : '';
    try { model = reasoning(traced ? dot || 'digraph G {}' : 'digraph G {}', program.fichiers, program.citations?.results, program.tests?.coverage, traced ? provenance : undefined); }
    catch (problem) { failure = problem instanceof Error ? problem.message : String(problem); model = reasoning('digraph G {}', program.fichiers, program.citations?.results, program.tests?.coverage); }
    const issues = reasoningIssues(model);
    const graph = reasoningGraph(model);
    const empty = `<p class="pmc-muted">${failure ? escape(failure) : 'Aucun raisonnement calculé pour ce scénario.'}</p>`;
    const choice = data!.programmes.length > 1 ? `<select data-program-choice aria-label="Raisonnement">${data!.programmes.map((entry) => `<option value="${escape(entry.nom)}"${entry === program ? ' selected' : ''}>${escape(entry.nom)}</option>`).join('')}</select>` : '';
    const open = issues.length ? `<details class="pmc-open-states"><summary class="pmc-warn">${issues.length} point${issues.length > 1 ? 's' : ''} à examiner</summary><ul>${issues.map((entry) => `<li>${entry.id ? `<button type="button" class="pmc-text-action" data-goto="${entry.id}">${escape(entry.title)}</button>` : escape(entry.title)} : ${escape(entry.issue)}</li>`).join('')}</ul></details>` : '';
    const scenario = scenarios.length ? `<label class="pmc-scenario">Scénario : <select data-scenario-choice aria-label="Scénario Catala">${scenarios.map((entry) => `<option value="${escape(`${entry.fichier}:${entry.scope}`)}"${entry === selected ? ' selected' : ''}>${escape(human(entry.scope).replace(/^Test\s*/i, ''))} — ${entry.test_reussi ? 'test réussi' : 'test en échec'}</option>`).join('')}</select></label>` : program.explication?.scope ? `<span class="pmc-scenario">Scénario : <strong>${escape(program.explication.scope)}</strong></span>` : '';
    const day = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
    const check = program.perimee ? null : program.catleg;
    const dates = check?.dates_reference ?? [];
    const reference = check ? `<span class="pmc-scenario" data-part="reference-date">Droit apprécié au : <strong>${dates.length ? dates.map(day).join(', ') : `${day(check.date_controle)} (jour du contrôle)`}</strong>${check.passed ? '' : ' <span class="pmc-warn">vigueur à vérifier</span>'}</span>` : '';
    return `<section class="pmc-view" data-mode="${viewMode}"><div class="pmc-view-head"><div class="pmc-tabs" role="tablist" aria-label="Présentation du raisonnement"><button role="tab" data-mode="written" aria-selected="${viewMode === 'written'}">Raisonnement</button><button role="tab" data-mode="graph" aria-selected="${viewMode === 'graph'}">Graphe</button></div>${scenario}${reference}${choice}</div>${open}<div class="pmc-written" role="tabpanel"${viewMode === 'written' ? '' : ' hidden'}>${model.steps.length ? '' : empty}${reasoningText(model)}</div><div class="pmc-explanation" role="tabpanel"${viewMode === 'graph' ? '' : ' hidden'}>${graph ? `<div class="pmc-map-tools"><button data-map-zoom="in" aria-label="Zoomer">+</button><button data-map-zoom="out" aria-label="Dézoomer">−</button><button data-map-zoom="fit">Ajuster la largeur</button></div><div class="pmc-map-scroll" aria-label="Graphe du raisonnement">${graph}</div>` : empty}</div></section>`;
  };
  const paint = () => {
    stopGraph();
    root.dataset.theme = context.theme;
    const warning = error ? `<div class="pmc-warning">${escape(error)}</div>` : '';
    if (!context.project) { panel.innerHTML = '<p class="pmc-muted">Ouvrez un dossier pour voir ses programmes Catala.</p>'; return; }
    if (!data) { panel.innerHTML = warning; return; }
    const program = shown();
    if (!program) { panel.innerHTML = `${warning}<p class="pmc-muted">Aucun programme Catala dans ce dossier : un programme est un dossier .piecemaker/catala/&lt;nom&gt;/ avec clerk.toml.</p>`; return; }
    const running = program.enCours || verifying === program.nom;
    const run = `<div class="pmc-run"><button data-refresh>Actualiser</button><button class="pmc-primary" data-verify="${escape(program.nom)}"${running || verifying || !data.pack ? ' disabled' : ''}>${running ? 'Analyse en cours…' : 'Recalculer'}</button><span class="pmc-tally">${freshness(program)}</span><span class="pmc-analysed">${analysed(program)}</span></div>${data.pack ? '' : '<p class="pmc-muted">Le calcul du raisonnement n’est pas disponible sur ce poste.</p>'}`;
    const documentationErrors = program.verification?.checks.find((check) => check.name === 'documentation')?.errors ?? [];
    const documentation = documentationErrors.length ? `<div class="pmc-warning"><strong>Documentation du raisonnement à compléter</strong><ul>${documentationErrors.map((message) => `<li>${escape(message)}</li>`).join('')}</ul></div>` : '';
    panel.innerHTML = `${warning}${run}${documentation}${explanationPart(program)}`;
    const view = panel.querySelector<HTMLElement>('.pmc-view');
    if (view) stopGraph = mountExplanation(view, (target, origin, quote, id) => {
      let legalId = id && (/^(?:LEGIARTI|JURITEXT|CETATEXT|CONSTEXT)\d+$/.test(id) || /^[0-9a-f]{24}$/i.test(id)) ? id : undefined;
      try {
        const url = new URL(target);
        if (!legalId && url.protocol === 'https:' && /^(?:www\.)?legifrance\.gouv\.fr$/.test(url.hostname)) legalId = url.pathname.match(/\/(LEGIARTI\d+|JURITEXT\d+|CETATEXT\d+|CONSTEXT\d+)(?:\/|$)/)?.[1];
        if (!legalId && url.protocol === 'https:' && url.hostname === 'www.courdecassation.fr') legalId = url.pathname.match(/^\/decision\/([a-f\d]{24})(?:\/|$)/i)?.[1];
      } catch {}
      if (legalId && context.project) {
        const projectPath = context.project.path;
        void citeCatala(projectPath, program.nom, origin, legalId, quote).then(({ token }) => {
          if (!stopped && context.project?.path === projectPath) window.dispatchEvent(new CustomEvent('piecemaker:open-in-editor', { detail: { path: `piecemaker://citation/${token}/${encodeURIComponent(legalId!)}` } }));
        }).catch((failure) => { if (!stopped) { error = failure instanceof Error ? failure.message : String(failure); paint(); } });
        return;
      }
      if (/^https?:\/\//i.test(target)) { error = 'Cette référence ne peut pas être ouverte par le lecteur interne. Renseignez un lien officiel vers l’article ou la décision.'; paint(); return; }
      if (!target) return;
      const project = context.project?.path.replaceAll('\\', '/').replace(/\/$/, '');
      if (!project || ![...program.fichiers, ...program.journaux].some((file) => file.chemin === origin)) return;
      try {
        const base = new URL(`file:///${origin.replaceAll('\\', '/').replace(/^\/+/, '')}`);
        const resolved = new URL(target, base);
        const root = new URL(`file:///${project.replace(/^\/+/, '')}/`);
        if (resolved.protocol !== 'file:' || resolved.host !== root.host || !resolved.pathname.startsWith(root.pathname)) return;
        const path = decodeURIComponent(resolved.pathname).replace(/^\/(\w:)/, '$1');
        if (path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.')) return;
        window.dispatchEvent(new CustomEvent('piecemaker:open-in-editor', { detail: { path, ...(quote ? { passage: { quote } } : {}) } }));
      } catch { return; }
    });
  };

  panel.addEventListener('click', (event) => {
    const tab = (event.target as Element).closest<HTMLElement>('[role="tab"][data-mode]');
    if (!tab) return;
    viewMode = tab.dataset.mode ?? 'written';
    paint();
  });
  const apply = (next: CatalaSnapshot | null) => {
    const text = JSON.stringify(next);
    if (text === serialized) return;
    serialized = text;
    data = next;
    paint();
  };
  const load = () => {
    const request = ++sequence;
    const project = context.project?.path;
    if (!project) { apply(null); return; }
    loadCatala(project).then((next) => {
      if (!stopped && request === sequence) { if (error) serialized = ''; error = ''; apply(next); }
    }, (failure: unknown) => { if (!stopped && request === sequence) { error = failure instanceof Error ? failure.message : String(failure); paint(); } });
  };

  panel.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.hasAttribute('data-program-choice')) { chosen = select.value; chosenScenario = ''; paint(); }
    if (select.hasAttribute('data-scenario-choice')) { chosenScenario = select.value; paint(); }
  });
  panel.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    if (button.hasAttribute('data-refresh')) load();
    const project = context.project?.path;
    if (button.dataset.verify && project && !verifying) {
      verifying = button.dataset.verify;
      error = '';
      paint();
      verifyCatala(project, verifying).then((next) => { if (!stopped && project === context.project?.path) apply(next); }, (failure: unknown) => { error = failure instanceof Error ? failure.message : String(failure); }).finally(() => { verifying = ''; if (!stopped) paint(); });
    }
  });
  const unsubscribe = api.onContextChange((next) => {
    const changed = next.project?.path !== context.project?.path;
    context = next;
    if (changed) { chosen = undefined; chosenScenario = ''; error = ''; data = null; serialized = ''; load(); }
    paint();
  });
  const togglePick = (event: Event) => { if ((event as CustomEvent<{ tab?: string }>).detail?.tab === TAB) setPicking(!picking); };
  const cancelPick = (event: KeyboardEvent) => { if (event.key === 'Escape') setPicking(false); };
  root.addEventListener('click', (event) => {
    if (!picking) return;
    const title = (event.target as Element).closest('[data-card]')?.querySelector('h3')?.textContent?.trim();
    if (!title) return;
    event.preventDefault();
    event.stopPropagation();
    setPicking(false);
    const program = shown();
    window.dispatchEvent(new CustomEvent('piecemaker:composer-insert', { detail: { text: `Carte « ${title} »${program && data!.programmes.length > 1 ? ` du raisonnement « ${program.nom} »` : ''} : ` } }));
  }, true);
  window.addEventListener('piecemaker:panel-pick', togglePick);
  window.addEventListener('keydown', cancelPick);
  const updated = (event: Event) => {
    const project = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
    if (!project || project === context.project?.path) load();
  };
  window.addEventListener('piecemaker:catala-updated', updated);
  paint();
  load();
  window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: TAB } }));
  cleanups.set(container, () => { stopped = true; sequence++; setPicking(false); window.removeEventListener('piecemaker:panel-pick', togglePick); window.removeEventListener('keydown', cancelPick); window.removeEventListener('piecemaker:catala-updated', updated); stopGraph(); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
