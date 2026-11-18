import { citeCatala, loadCatala, verifyCatala } from './api.js';
import { mountExplanation } from './graph-view.js';
import { human, reasoning, reasoningGraph, reasoningIssues, reasoningBrief, reasoningText, type Reasoning, type Coverage, type Step } from './graph.js';
import type { NativeProvenance } from './native-provenance.js';
import { programDocument } from './program-view.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void };
type File = { nom: string; chemin: string; contenu?: string };
type Check = { name: string; command: string; exit_code: number | null; errors?: string[]; seconds: number; passed: boolean; status?: string; message?: string; files?: string[] };
type Report = { started_utc: string; finished_utc: string; passed: boolean; checks: Check[] };
type Proof = Report & { fichier: string; scope: string; conflits: number; obligations?: number };
type Catleg = { date_controle: string; dates_reference?: string[]; passed: boolean; fichiers: Array<{ fichier: string; passed: boolean; skipped?: boolean; articles?: string[]; versions?: Array<{ id: string; au: string; debut?: string; fin?: string | null; valide: boolean | null }>; messages: string[] }> };
type Scenario = { fichier: string; scope: string; passed: boolean; test_reussi: boolean; graphe: string; message: string; provenance?: NativeProvenance };
type Part = { champ: string; objectif?: string; rang?: string };
type Task = { tache?: string; type?: string; raisonnements?: Part[] };
type Program = { nom: string; tache?: Task | null; enCours: boolean; perimee: boolean; fichiers: File[]; journaux: File[]; verification: Report | null; tests?: { coverage?: Coverage; 'test-results': Array<{ file: string; tests: { scopes: Array<{ scope_name: string; success: boolean; errors?: unknown[] }> } }> } | null; citations?: { results: Array<{ origin: string; target: string; quote: string; label?: string; title?: string; id?: string; kind?: string; status: string; message: string }> } | null; preuve: Proof | null; catleg: Catleg | null; explication: (Report & { fichier: string; scope: string; provenance?: NativeProvenance }) | null; graphe: string | null; scenarios?: Scenario[] };
export type CatalaSnapshot = {
  pack: { id: string; platform: string; version: string; proof: boolean; installedAt: string } | null;
  status: { state: string; id?: string; step?: string; error?: string; updatedAt?: string } | null;
  programmes: Program[];
  styles?: Array<{ nom: string; regle: string }>;
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
  const requested = () => {
    const holder = window as Window & { __piecemakerCatalaShow?: { project: string; nom: string } };
    const show = holder.__piecemakerCatalaShow;
    if (!show || show.project !== context.project?.path) return;
    delete holder.__piecemakerCatalaShow;
    chosen = show.nom; chosenPart = ''; chosenScenario = '';
  };
  let data: CatalaSnapshot | null = null;
  let serialized = '';
  let verifying = '';
  let error = '';
  let stopped = false;
  let stopGraph = () => {};
  let sequence = 0;
  let viewMode = 'graph';
  let alertsOpen = false;
  let fixRequest = '';
  let draftOpen = false;
  let draftBase = '';
  let chosenScenario = '';
  let chosenPart = '';
  let picking = false;
  let steps: Step[] = [];
  let shownScenario = '';
  const setPicking = (on: boolean) => {
    if (on === picking) return;
    picking = on;
    root.toggleAttribute('data-picking', on);
    window.dispatchEvent(new CustomEvent('piecemaker:panel-pick-state', { detail: { tab: TAB, active: on } }));
  };

  const shown = () => data?.programmes.find((entry) => entry.nom === chosen) ?? data?.programmes[0];
  const plainGap = (message: string) => {
    const [, file = '', line = '', text = message] = message.match(/^(.*?):(\d+):\s*(.*)$/) ?? [];
    const meaning = /titre manquant/i.test(text) ? 'Titre manquant : cette entrée n’a pas de titre ## texte court.'
      : /règle sans source juridique/i.test(text) ? 'Règle sans source : placez-la sous le titre d’un article ou d’une décision, suivi de l’extrait cité.'
      : text;
    return { meaning, place: file ? `${file}, ligne ${line}` : '' };
  };
  const explanationPart = (program: Program, recalc: string, gaps: string[]) => {
    const parts = (program.tache?.raisonnements ?? []).filter((entry) => entry?.champ);
    const several = parts.length > 1;
    const part = parts.find((entry) => entry.champ === chosenPart) ?? parts[0];
    const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = "(?:déclaration champ d'application|declaration scope)\\s+";
    const exercises = (scenario: Scenario, entry: Part) => {
      const source = program.fichiers.find((file) => file.nom === scenario.fichier)?.contenu ?? '';
      const block = source.split(new RegExp(`(?=${declaration})`)).find((piece) => new RegExp(`^${declaration}${literal(scenario.scope)}\\s*:`).test(piece)) ?? '';
      return new RegExp(`[^\\p{L}\\p{N}_]${literal(entry.champ)}(?![\\p{L}\\p{N}_])`, 'u').test(block);
    };
    const own = (entry: Part) => (program.scenarios ?? []).filter((scenario) => exercises(scenario, entry));
    const scenarios = several ? own(part) : program.scenarios ?? [];
    const selected = scenarios.find((scenario) => `${scenario.fichier}:${scenario.scope}` === chosenScenario)
      ?? scenarios.find((scenario) => scenario.scope === program.explication?.scope && scenario.fichier === program.explication?.fichier)
      ?? scenarios.find((scenario) => scenario.passed) ?? scenarios[0];
    const build = (scenario: Scenario | undefined) => {
      const provenance = scenario?.provenance ?? (!several && !program.perimee ? program.explication?.provenance : undefined);
      const traced = Boolean(scenario ? scenario.passed && (scenario.graphe || provenance?.trace.length) : !several && !program.perimee && program.explication?.passed && (program.graphe || provenance?.trace.length));
      const dot = scenario?.graphe ?? (several ? null : program.graphe);
      let model: Reasoning;
      let failure = scenario && !scenario.passed ? 'Ce scénario ne produit pas de graphe. Corrigez son exécution Catala.' : '';
      try { model = reasoning(traced ? dot || 'digraph G {}' : 'digraph G {}', program.fichiers, program.citations?.results, program.tests?.coverage, traced ? provenance : undefined); }
      catch (problem) { failure = problem instanceof Error ? problem.message : String(problem); model = reasoning('digraph G {}', program.fichiers, program.citations?.results, program.tests?.coverage); }
      return { model, failure, traced, scope: traced ? scenario?.scope ?? program.explication?.scope ?? '' : '' };
    };
    const { model, failure, traced, scope } = build(selected);
    if (part?.objectif) model.objective = part.objectif;
    model.scope = part?.champ;
    steps = model.steps;
    shownScenario = scope;
    const issues = reasoningIssues(model);
    const graph = reasoningGraph(model);
    const empty = `<p class="pmc-muted">${failure ? escape(failure) : 'Aucun raisonnement calculé pour ce scénario.'}</p>`;
    const choice = data!.programmes.length > 1 ? `<select data-program-choice aria-label="Tâche" title="Tâche">${data!.programmes.map((entry) => `<option value="${escape(entry.nom)}"${entry === program ? ' selected' : ''}>${escape(entry.tache?.tache || entry.nom)}</option>`).join('')}</select>` : '';
    const named = (entry: Part) => [entry.rang, entry.objectif].filter(Boolean).join(' — ') || entry.champ;
    const partChoice = several ? `<select data-part-choice aria-label="Raisonnement" title="Raisonnement">${parts.map((entry) => `<option value="${escape(entry.champ)}"${entry === part ? ' selected' : ''}>${escape(named(entry))}</option>`).join('')}</select>` : '';
    const task = program.tache?.tache ? `<p class="pmc-scenario" data-part="task">Tâche : <strong>${escape(program.tache.tache)}</strong>${program.tache.type ? ` <span class="pmc-muted">${escape(program.tache.type)}</span>` : ''}</p>` : '';
    const alerts = [...issues.map((entry) => `<li>${entry.id ? `<button type="button" class="pmc-text-action" data-goto="${entry.id}">${escape(entry.title)}</button>` : escape(entry.title)} : ${escape(entry.issue)}</li>`), ...gaps.map(plainGap).map((gap) => `<li>${escape(gap.meaning)}${gap.place ? ` <span class="pmc-muted">${escape(gap.place)}</span>` : ''}</li>`)];
    fixRequest = [`Corrige les erreurs du programme Catala \`${program.nom}\`, puis relance \`pm catala verifier\`. N’invente aucune source ni citation : signale ce qui manque.`, ...issues.map((entry) => `- ${entry.title} : ${entry.issue}`), ...gaps.map(plainGap).map((gap) => `- ${gap.meaning}${gap.place ? ` (${gap.place})` : ''}`)].join('\n');
    const briefs = several ? parts.map((entry) => {
      const built = entry === part ? { model, traced, scope } : build(own(entry).find((scenario) => scenario.passed));
      return `Raisonnement — ${named(entry)}${built.scope ? ` (scénario ${built.scope})` : ''} :\n${built.traced ? reasoningBrief(built.model) : '- non calculé'}`;
    }).join('\n\n') : `Raisonnement :\n${reasoningBrief(model)}`;
    draftBase = `${[`Fonde le document sur le raisonnement Catala \`${program.nom}\`${program.tache?.tache ? `, tâche « ${program.tache.tache} »${program.tache.type ? ` (${program.tache.type})` : ''}` : ''}${scope && !several ? `, scénario ${scope}` : ''} (\`.piecemaker/catala/${program.nom}/\`). N’écris ni code ni identifiant Catala dans le document. Signale tout fait ou fondement que tu ajoutes au raisonnement.`, alerts.length ? `Le raisonnement compte ${alerts.length} erreur${alerts.length > 1 ? 's' : ''} non corrigée${alerts.length > 1 ? 's' : ''} : signale-les avant de rédiger.` : ''].filter(Boolean).join('\n')}\n\n${briefs}`;
    const styles = data!.styles ?? [];
    const drafts = draftOpen && traced ? `<div class="pmc-alert-list pmc-draft-list" role="region" aria-label="Document à rédiger"><p class="pmc-muted">Quel document rédiger ? La demande s’ouvre dans un nouveau chat.</p><div class="pmc-alert-actions">${styles.map((style, index) => `<button type="button" data-draft-style="${index}">${escape(style.nom)}</button>`).join('')}<button type="button" data-draft-style="-1">Autre document</button></div></div>` : '';
    const run = `<span class="pmc-run">${freshness(program)}<button type="button" data-draft aria-expanded="${draftOpen && Boolean(traced)}" title="${traced ? 'Rédiger un document à partir de ce raisonnement' : 'Calculez d’abord le raisonnement.'}"${traced ? '' : ' disabled'}>Rédiger</button><button type="button" class="pmc-alerts" data-alerts${alerts.length ? ` data-count="${alerts.length}"` : ''} aria-expanded="${alertsOpen}" title="${alerts.length ? `${alerts.length} erreur${alerts.length > 1 ? 's' : ''} à corriger` : 'Résultat de la vérification'}">Vérification${alerts.length ? `<span class="pmc-bubble">${alerts.length}</span>` : ''}</button></span>`;
    const outcome = alerts.length ? `<ul>${alerts.join('')}</ul>` : traced ? '<p>Aucune erreur.</p>' : '';
    const list = alertsOpen ? `<div class="pmc-alert-list" role="region" aria-label="Résultat de la vérification"><div class="pmc-alert-actions"><span class="pmc-muted">${escape(analysed(program))}</span>${recalc}${alerts.length ? `<button type="button" data-fix="${alerts.length}">Demander la correction</button>` : ''}</div>${outcome}</div>` : '';
    const scenario = scenarios.length ? `<select data-scenario-choice aria-label="Scénario Catala" title="Scénario">${scenarios.map((entry) => `<option value="${escape(`${entry.fichier}:${entry.scope}`)}"${entry === selected ? ' selected' : ''}>${escape(human(entry.scope).replace(/^Test\s*/i, ''))} — ${entry.test_reussi ? 'test réussi' : 'test en échec'}</option>`).join('')}</select>` : program.explication?.scope ? `<span class="pmc-scenario" title="Scénario"><strong>${escape(program.explication.scope)}</strong></span>` : '';
    const day = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
    const check = program.perimee ? null : program.catleg;
    const dates = check?.dates_reference ?? [];
    const reference = check ? `<p class="pmc-scenario" data-part="reference-date">Droit apprécié au : <strong>${dates.length ? dates.map(day).join(', ') : `${day(check.date_controle)} (jour du contrôle)`}</strong>${check.passed ? '' : ' <span class="pmc-warn">vigueur à vérifier</span>'}</p>` : '';
    const tab = (mode: string, label: string) => `<button role="tab" data-mode="${mode}" aria-selected="${viewMode === mode}">${label}</button>`;
    const zoom = graph && viewMode === 'graph' ? '<span class="pmc-map-tools"><button data-map-zoom="out" aria-label="Dézoomer" title="Dézoomer">−</button><button data-map-zoom="in" aria-label="Zoomer" title="Zoomer">+</button><button data-map-zoom="fit" aria-label="Ajuster à la largeur" title="Ajuster à la largeur">↔</button></span>' : '';
    return `<section class="pmc-view" data-mode="${viewMode}"><div class="pmc-bar"><div class="pmc-tabs" role="tablist" aria-label="Présentation du raisonnement">${tab('graph', 'Graphe')}${tab('written', 'Raisonnement')}${tab('program', 'Programme')}</div>${choice}${partChoice}${scenario}${zoom}${run}</div>${list}${drafts}<div class="pmc-written" role="tabpanel"${viewMode === 'written' ? '' : ' hidden'}>${task}${reference}${model.steps.length ? '' : empty}${reasoningText(model)}</div><div class="pmc-explanation" role="tabpanel"${viewMode === 'graph' ? '' : ' hidden'}>${graph ? `<div class="pmc-map-scroll" aria-label="Graphe du raisonnement">${graph}</div>` : empty}</div>${viewMode === 'program' ? `<div class="pmc-program" role="tabpanel">${programDocument(model, program.fichiers)}</div>` : ''}</section>`;
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
    const recalc = `<button class="pmc-primary" data-verify="${escape(program.nom)}" title="${escape(data.pack ? analysed(program) : 'Le calcul du raisonnement n’est pas disponible sur ce poste.')}"${running || verifying || !data.pack ? ' disabled' : ''}>${running ? 'Analyse en cours…' : 'Recalculer'}</button>`;
    const documentationErrors = program.verification?.checks.find((check) => check.name === 'documentation')?.errors ?? [];
    panel.innerHTML = `${warning}${explanationPart(program, recalc, documentationErrors)}`;
    const view = panel.querySelector<HTMLElement>('.pmc-view');
    if (view) stopGraph = mountExplanation(view, (target, origin, quote, id, parent) => {
      let legalId = id && (/^(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d+$/.test(id) || /^[0-9a-f]{24}$/i.test(id)) ? id : undefined;
      try {
        const url = new URL(target);
        if (!legalId && url.protocol === 'https:' && /^(?:www\.)?legifrance\.gouv\.fr$/.test(url.hostname)) legalId = url.pathname.match(/\/(LEGIARTI\d+|JORFARTI\d+|JURITEXT\d+|CETATEXT\d+|CONSTEXT\d+)(?:\/|$)/)?.[1];
        if (!legalId && url.protocol === 'https:' && url.hostname === 'www.courdecassation.fr') legalId = url.pathname.match(/^\/decision\/([a-f\d]{24})(?:\/|$)/i)?.[1];
      } catch {}
      if (legalId && context.project) {
        const projectPath = context.project.path;
        void citeCatala(projectPath, program.nom, origin, legalId, quote, parent).then(({ token }) => {
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
    if ((event.target as Element).closest('[data-alerts]')) { alertsOpen = !alertsOpen; draftOpen = false; paint(); return; }
    if ((event.target as Element).closest('[data-draft]')) { draftOpen = !draftOpen; alertsOpen = false; paint(); return; }
    const draft = (event.target as Element).closest<HTMLElement>('[data-draft-style]');
    if (draft) {
      const style = data?.styles?.[Number(draft.dataset.draftStyle)];
      const demande = [style ? `Rédige ce document : ${style.nom}.` : 'Rédige un document à partir de ce raisonnement.', style ? `Charge le skill \`style-redaction-cabinet\` et applique sa règle \`${style.regle}\`.` : 'Charge le skill `style-redaction-cabinet`, donne-moi la liste de ses documents et demande-moi lequel rédiger.', draftBase].join('\n');
      window.dispatchEvent(new CustomEvent('piecemaker:panel-new-chat', { detail: { tab: TAB } }));
      window.dispatchEvent(new CustomEvent('piecemaker:catala-card-pick', { detail: { titre: `Rédiger : ${style?.nom ?? 'document'}`, demande } }));
      window.dispatchEvent(new CustomEvent('piecemaker:panel-picked', { detail: { tab: TAB } }));
      draftOpen = false;
      paint();
      return;
    }
    const fix = (event.target as Element).closest<HTMLElement>('[data-fix]');
    if (fix) {
      const count = Number(fix.dataset.fix);
      window.dispatchEvent(new CustomEvent('piecemaker:catala-card-pick', { detail: { titre: `Corriger ${count} erreur${count > 1 ? 's' : ''}`, demande: fixRequest } }));
      window.dispatchEvent(new CustomEvent('piecemaker:panel-picked', { detail: { tab: TAB } }));
      alertsOpen = false;
      paint();
      return;
    }
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
    if (select.hasAttribute('data-program-choice')) { chosen = select.value; chosenPart = ''; chosenScenario = ''; paint(); }
    if (select.hasAttribute('data-part-choice')) { chosenPart = select.value; chosenScenario = ''; paint(); }
    if (select.hasAttribute('data-scenario-choice')) { chosenScenario = select.value; paint(); }
  });
  panel.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
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
    requested();
    paint();
  });
  const onShow = () => { requested(); paint(); };
  window.addEventListener('piecemaker:catala-show', onShow);
  const togglePick = (event: Event) => { if ((event as CustomEvent<{ tab?: string }>).detail?.tab === TAB) setPicking(!picking); };
  const cancelPick = (event: KeyboardEvent) => { if (event.key === 'Escape') setPicking(false); };
  root.addEventListener('click', (event) => {
    if (!picking) return;
    const card = (event.target as Element).closest('[data-card]');
    const titre = card?.querySelector('h3')?.textContent?.trim();
    if (!card || !titre) return;
    event.preventDefault();
    event.stopPropagation();
    setPicking(false);
    const step = steps.find((entry) => entry.id === card.getAttribute('data-card'));
    const origins = step?.origins ?? [];
    const origin = origins.find((entry) => entry.selected && entry.role === 'definition') ?? origins[0];
    const folder = `${context.project?.path.replaceAll('\\', '/') ?? ''}/`;
    const file = origin?.file.replaceAll('\\', '/');
    window.dispatchEvent(new CustomEvent('piecemaker:catala-card-pick', { detail: { titre, fichier: file?.startsWith(folder) ? file.slice(folder.length) : file, debut: origin?.blockStart, fin: origin?.blockEnd, identifiant: step?.name || undefined, valeur: step?.value || undefined, scenario: shownScenario || undefined } }));
    window.dispatchEvent(new CustomEvent('piecemaker:panel-picked', { detail: { tab: TAB } }));
  }, true);
  window.addEventListener('piecemaker:panel-pick', togglePick);
  window.addEventListener('keydown', cancelPick);
  const updated = (event: Event) => {
    const project = (event as CustomEvent<{ projectPath?: string }>).detail?.projectPath;
    if (!project || project === context.project?.path) load();
  };
  window.addEventListener('piecemaker:catala-updated', updated);
  requested();
  paint();
  load();
  window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: TAB } }));
  cleanups.set(container, () => { stopped = true; sequence++; setPicking(false); window.removeEventListener('piecemaker:panel-pick', togglePick); window.removeEventListener('keydown', cancelPick); window.removeEventListener('piecemaker:catala-updated', updated); window.removeEventListener('piecemaker:catala-show', onShow); stopGraph(); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
