import { citeCatala, loadCatala, verifyCatala } from './api.js';
import { mountExplanation } from './graph-view.js';
import { reasoning, reasoningCard, reasoningGraph, reasoningIssues, reasoningText, type Reasoning } from './graph.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void };
type File = { nom: string; chemin: string; contenu?: string };
type Check = { name: string; command: string; exit_code: number | null; seconds: number; passed: boolean; status?: string; message?: string; files?: string[] };
type Report = { started_utc: string; finished_utc: string; passed: boolean; checks: Check[] };
type Proof = Report & { fichier: string; scope: string; conflits: number; obligations?: number };
type Catleg = { date_controle: string; passed: boolean; fichiers: Array<{ fichier: string; passed: boolean; skipped?: boolean; articles?: string[]; versions?: Array<{ id: string; au: string; debut?: string; fin?: string | null; valide: boolean | null }>; messages: string[] }> };
type Program = { nom: string; enCours: boolean; perimee: boolean; fichiers: File[]; journaux: File[]; verification: Report | null; tests?: { 'test-results': Array<{ file: string; tests: { scopes: Array<{ scope_name: string; success: boolean; errors?: unknown[] }> } }> } | null; citations?: { results: Array<{ origin: string; target: string; quote: string; label?: string; title?: string; kind?: string; status: string; message: string }> } | null; preuve: Proof | null; catleg: Catleg | null; explication: (Report & { fichier: string; scope: string }) | null; graphe: string | null };
export type CatalaSnapshot = {
  pack: { id: string; platform: string; version: string; proof: boolean; installedAt: string } | null;
  status: { state: string; id?: string; step?: string; error?: string; updatedAt?: string } | null;
  programmes: Program[];
};

const cleanups = new WeakMap<HTMLElement, () => void>();
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const pill = (tone: string, label: string) => `<span class="pmc-pill pmc-${tone}">${escape(label)}</span>`;
const verdict = (program: Program) => program.perimee ? pill('warn', 'Modifié depuis la vérification') : program.verification ? program.verification.passed ? pill('ok', 'Raisonnement vérifié') : pill('ko', 'Vérification à reprendre') : pill('muted', 'Jamais vérifié');

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
  let viewMode = 'written';

  const shown = () => data?.programmes.find((entry) => entry.nom === chosen) ?? data?.programmes[0];
  const explanationPart = (program: Program) => {
    const traced = !program.perimee && program.explication?.passed && program.graphe;
    let model: Reasoning;
    let failure = '';
    try { model = reasoning(traced ? program.graphe! : 'digraph G {}', program.fichiers, program.citations?.results); }
    catch (problem) { failure = problem instanceof Error ? problem.message : String(problem); model = reasoning('digraph G {}', program.fichiers, program.citations?.results); }
    const issues = reasoningIssues(model);
    const graph = reasoningGraph(model);
    const empty = `<p class="pmc-muted">${failure ? escape(failure) : 'Aucune exécution du raisonnement : lancez la vérification.'}</p>`;
    const choice = data!.programmes.length > 1 ? `<select data-program-choice aria-label="Raisonnement">${data!.programmes.map((entry) => `<option value="${escape(entry.nom)}"${entry === program ? ' selected' : ''}>${escape(entry.nom)}</option>`).join('')}</select>` : '';
    const open = issues.length ? `<details class="pmc-open-states"><summary class="pmc-warn">${issues.length} point${issues.length > 1 ? 's' : ''} à examiner</summary><ul>${issues.map((entry) => `<li>${entry.id ? `<a href="#" class="pmc-link" data-goto="${entry.id}">${escape(entry.title)}</a>` : escape(entry.title)} : ${escape(entry.issue)}</li>`).join('')}</ul></details>` : '';
    return `<section class="pmc-view" data-mode="${viewMode}"><div class="pmc-view-head"><div class="pmc-tabs" role="tablist" aria-label="Présentation du raisonnement"><button role="tab" data-mode="written" aria-selected="${viewMode === 'written'}">Vue écrite</button><button role="tab" data-mode="graph" aria-selected="${viewMode === 'graph'}">Graphe</button></div>${choice}</div>${open}<div class="pmc-written" role="tabpanel"${viewMode === 'written' ? '' : ' hidden'}>${model.steps.length ? '' : empty}${reasoningText(model)}</div><div class="pmc-explanation" role="tabpanel"${viewMode === 'graph' ? '' : ' hidden'}>${graph ? `<div class="pmc-legend"><span data-kind="answer">Question</span><span data-kind="law">Condition (droit)</span><span data-kind="exception">Exception</span><span data-kind="fact">Fait du dossier</span><span class="pmc-ok">Remplie</span><span class="pmc-ko">Non remplie</span></div><div class="pmc-canvas" aria-label="Graphe du raisonnement"><div class="pmc-stage">${graph}</div><aside class="pmc-inspector" aria-label="Détail" hidden></aside><div class="pmc-tools"><button data-zoom="1.2" aria-label="Zoomer">+</button><button data-zoom="0.833333" aria-label="Dézoomer">−</button><button data-fit>Ajuster</button></div></div>` : empty}</div><div class="pmc-cards" hidden>${model.steps.map((step) => reasoningCard(step, model)).join('')}</div></section>`;
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
    const run = `<div class="pmc-run"><button data-refresh>Actualiser</button><button class="pmc-primary" data-verify="${escape(program.nom)}"${running || verifying || !data.pack ? ' disabled' : ''}>${running ? 'Vérification en cours…' : 'Vérifier'}</button><span class="pmc-tally">${verdict(program)}</span></div>${data.pack ? '' : '<p class="pmc-muted">Catala n’est pas installé : la vérification est impossible.</p>'}`;
    panel.innerHTML = `${warning}${run}${explanationPart(program)}`;
    const view = panel.querySelector<HTMLElement>('.pmc-view');
    if (view) stopGraph = mountExplanation(view, (target, origin, quote) => {
      let legalId: string | undefined;
      try {
        const url = new URL(target);
        if (url.protocol === 'https:' && /^(?:www\.)?legifrance\.gouv\.fr$/.test(url.hostname)) legalId = url.pathname.match(/\/(LEGIARTI\d{12}|JURITEXT\d{12}|CETATEXT\d{12}|CONSTEXT\d{12})(?:\/|$)/)?.[1];
        if (url.protocol === 'https:' && url.hostname === 'www.courdecassation.fr') legalId = url.pathname.match(/^\/decision\/([a-f\d]{24})(?:\/|$)/i)?.[1];
      } catch {}
      if (legalId && context.project) {
        const projectPath = context.project.path;
        void citeCatala(projectPath, program.nom, origin, legalId, quote).then(({ token }) => {
          if (!stopped && context.project?.path === projectPath) window.dispatchEvent(new CustomEvent('piecemaker:open-in-editor', { detail: { path: `piecemaker://citation/${token}/${encodeURIComponent(legalId!)}` } }));
        }).catch((failure) => { if (!stopped) { error = failure instanceof Error ? failure.message : String(failure); paint(); } });
        return;
      }
      if (/^https?:\/\//i.test(target)) { error = 'Cette référence ne peut pas être ouverte par le lecteur interne. Renseignez un lien officiel vers l’article ou la décision.'; paint(); return; }
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
    const view = tab.closest<HTMLElement>('.pmc-view')!;
    view.dataset.mode = viewMode;
    view.querySelectorAll<HTMLElement>('[role="tab"]').forEach((item) => item.setAttribute('aria-selected', String(item === tab)));
    view.querySelector<HTMLElement>('.pmc-explanation')!.hidden = viewMode !== 'graph';
    view.querySelector<HTMLElement>('.pmc-written')!.hidden = viewMode !== 'written';
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
    if (select.hasAttribute('data-program-choice')) { chosen = select.value; paint(); }
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
    if (changed) { chosen = undefined; error = ''; data = null; serialized = ''; load(); }
    paint();
  });
  const updated = (event: Event) => {
    const project = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
    if (!project || project === context.project?.path) load();
  };
  window.addEventListener('piecemaker:catala-updated', updated);
  paint();
  load();
  window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: 'plugin:piecemaker-catala' } }));
  cleanups.set(container, () => { stopped = true; sequence++; window.removeEventListener('piecemaker:catala-updated', updated); stopGraph(); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
