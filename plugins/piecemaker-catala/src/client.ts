import { loadCatala, verifyCatala } from './api.js';
import { mountExplanation } from './graph-view.js';
import { explanationGraph } from './graph.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void };
type File = { nom: string; chemin: string; contenu?: string };
type Check = { name: string; command: string; exit_code: number; seconds: number; passed: boolean; files?: string[] };
type Report = { started_utc: string; finished_utc: string; passed: boolean; checks: Check[] };
type Proof = Report & { fichier: string; scope: string; conflits: number; obligations?: number };
type Catleg = { date_controle: string; passed: boolean; fichiers: Array<{ fichier: string; passed: boolean; messages: string[] }> };
type Program = { nom: string; enCours: boolean; perimee: boolean; fichiers: File[]; journaux: File[]; verification: Report | null; tests?: { 'test-results': Array<{ file: string; tests: { scopes: Array<{ scope_name: string; success: boolean; errors?: unknown[] }> } }> } | null; preuve: Proof | null; catleg: Catleg | null; explication: (Report & { fichier: string; scope: string }) | null; graphe: string | null };
export type CatalaSnapshot = {
  pack: { id: string; platform: string; version: string; proof: boolean; installedAt: string } | null;
  status: { state: string; id?: string; step?: string; error?: string; updatedAt?: string } | null;
  programmes: Program[];
};

const STATES: Record<string, [string, string]> = { pret: ['ok', 'Prêt'], installation: ['warn', 'Installation en cours'], 'en-cours': ['warn', 'Installation en cours'], indisponible: ['ko', 'Indisponible'], echec: ['ko', 'Échec de l’installation'] };
const CHECKS: Record<string, string> = { typecheck: 'Typage et invariants', format: 'Mise en forme', tests: 'Tests clerk', 'tests-python': 'Tests Python' };
const cleanups = new WeakMap<HTMLElement, () => void>();
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const pill = (tone: string, label: string) => `<span class="pmc-pill pmc-${tone}">${escape(label)}</span>`;
const when = (value: string) => new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const seconds = (value: number) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;
const span = (report: Report) => seconds((Date.parse(report.finished_utc) - Date.parse(report.started_utc)) / 1000);
const opener = (file: File | undefined, label = file?.nom) => (file ? `<button class="pmc-link" data-open="${escape(file.chemin)}">${escape(label)}</button>` : '');
const verdict = (report: Report | null) => (report ? report.passed ? pill('ok', 'Vérifié') : pill('ko', 'À corriger') : pill('muted', 'Jamais vérifié'));

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

  const shown = () => data?.programmes.find((entry) => entry.nom === chosen) ?? data?.programmes[0];
  const packPart = () => {
    const status = data?.status;
    const pack = data?.pack;
    const [tone, label] = STATES[status?.state ?? ''] ?? (pack ? ['ok', 'Prêt'] : ['muted', 'Non installé']);
    const detail = pack ? `Catala ${escape(pack.version)} · ${escape(pack.platform)} · installé le ${escape(when(pack.installedAt))}${pack.proof ? '' : ' · preuve non fournie sur cette plateforme'}` : 'L’app de bureau installe le pack au démarrage.';
    const problem = status?.error ? `<p class="pmc-ko">${escape(status.error)}${status.step ? ` (étape ${escape(status.step)})` : ''}</p>` : '';
    return `<section class="pmc-part"><h4>Pack Catala</h4><div class="pmc-run">${pack ? pill('ok', 'Installé') : pill(tone, label)}${pack && status && status.state !== 'pret' ? pill(tone, label) : ''}<span class="pmc-muted">${detail}</span></div>${problem}</section>`;
  };
  const listPart = (selected: Program) => `<section class="pmc-part"><h4>Programmes du dossier</h4><ol class="pmc-log">${data!.programmes.map((entry) => `<li class="pmc-entry" data-status="${entry.verification ? entry.verification.passed ? 'ok' : 'alerte' : 'neutre'}"><span class="pmc-mark" aria-hidden="true">${entry.verification ? entry.verification.passed ? '✓' : '!' : ''}</span><div class="pmc-entry-head"><button class="pmc-link" data-program="${escape(entry.nom)}" aria-pressed="${entry === selected}"><strong>${escape(entry.nom)}</strong></button>${verdict(entry.verification)}${entry.verification ? `<span class="pmc-muted">${escape(when(entry.verification.finished_utc))}</span>` : ''}</div></li>`).join('')}</ol></section>`;
  const checkEntry = (entry: Check, program: Program) => `<li class="pmc-entry" data-status="${entry.passed ? 'ok' : 'alerte'}"><span class="pmc-mark" aria-hidden="true">${entry.passed ? '✓' : '!'}</span><div class="pmc-entry-head"><span class="pmc-step">${escape(CHECKS[entry.name] ?? entry.name)}</span><strong>${entry.passed ? 'Réussi' : 'Échoué'}</strong>${opener(program.journaux.find((file) => file.nom === `${entry.name}.log`), 'Journal')}</div><span class="pmc-entry-text"><code>${escape(entry.command)}</code> · code ${escape(entry.exit_code)} · ${seconds(entry.seconds)}${entry.files?.length ? ` · ${escape(entry.files.join(', '))}` : ''}</span></li>`;
  const verificationPhase = (program: Program) => {
    const report = program.verification;
    if (!report) return '<p class="pmc-muted">Pas encore vérifié : lancez la vérification.</p>';
    const failed = report.checks.filter((entry) => !entry.passed).length;
    return `<section class="pmc-phase" data-status="${report.passed ? 'ok' : 'alerte'}"><header><span class="pmc-step">Vérification</span><strong>${escape(when(report.finished_utc))}</strong><span class="pmc-phase-state">${report.passed ? 'Vérifié' : 'À corriger'}</span></header><p class="pmc-lead">${report.checks.length - failed} contrôle${report.checks.length - failed > 1 ? 's' : ''} réussi${report.checks.length - failed > 1 ? 's' : ''}, ${failed} échoué${failed > 1 ? 's' : ''} · durée ${span(report)}</p><ol class="pmc-log">${report.checks.map((entry) => checkEntry(entry, program)).join('')}</ol></section>`;
  };
  const proofPhase = (program: Program) => {
    const proof = program.preuve;
    if (!proof) return '<section class="pmc-phase"><header><span class="pmc-step">Preuve</span><strong>Pas de preuve</strong></header><p class="pmc-lead">Aucune preuve lancée sur ce programme.</p></section>';
    return `<section class="pmc-phase" data-status="${proof.passed ? 'ok' : 'alerte'}"><header><span class="pmc-step">Preuve</span><strong>${escape(proof.fichier)} › ${escape(proof.scope)}</strong><span class="pmc-phase-state">${proof.passed ? 'Obligations produites vérifiées' : 'Preuve non validée'}</span></header><p class="pmc-lead">${escape(when(proof.finished_utc))} · ${proof.conflits ? `${proof.conflits} chevauchement${proof.conflits > 1 ? 's' : ''} d’exceptions` : 'aucun chevauchement d’exceptions'} · ${opener(program.journaux.find((file) => file.nom === 'preuve.log'), 'Journal')}</p></section>`;
  };
  const catlegPhase = (program: Program) => {
    const report = program.catleg;
    if (!report) return '<section class="pmc-phase"><header><span class="pmc-step">Vigueur</span><strong>Pas de contrôle catleg</strong></header><p class="pmc-lead">La vigueur des articles cités n’a pas été contrôlée.</p></section>';
    const day = report.date_controle.split('-').reverse().join('/');
    return `<section class="pmc-phase" data-status="${report.passed ? 'ok' : 'alerte'}"><header><span class="pmc-step">Vigueur</span><strong>Contrôle du ${escape(day)}</strong><span class="pmc-phase-state">${report.passed ? 'Articles en vigueur' : 'À revoir'}</span></header><p class="pmc-lead">catleg contrôle la vigueur à la date du contrôle seulement.</p><ol class="pmc-log">${report.fichiers.map((entry) => `<li class="pmc-entry" data-status="${entry.passed ? 'ok' : 'alerte'}"><span class="pmc-mark" aria-hidden="true">${entry.passed ? '✓' : '!'}</span><div class="pmc-entry-head">${opener(program.fichiers.find((file) => file.nom === entry.fichier), entry.fichier) || `<strong>${escape(entry.fichier)}</strong>`}<span class="pmc-step">${entry.passed ? 'En vigueur ce jour' : 'À revoir'}</span></div>${entry.messages.length ? `<details><summary class="pmc-muted">Messages (${entry.messages.length})</summary><span class="pmc-entry-text">${entry.messages.map(escape).join('<br>')}</span></details>` : ''}</li>`).join('')}</ol></section>`;
  };
  const graphControls = (program: Program) => {
    const journal = (name: string) => {
      const file = program.journaux.find((entry) => entry.nom === `${name}.log`);
      return file ? { target: file.nom, origin: file.chemin, detail: file.contenu ?? '' } : {};
    };
    const diagnostics = (name: string) => {
      const content = program.journaux.find((entry) => entry.nom === `${name}.log`)?.contenu;
      return content?.trim() ? content.replace(/\u001b\[[0-9;]*m/g, '').trim().split(/\r?\n/) : ['Diagnostic non fourni : ouvrez le journal du contrôle.'];
    };
    const verification = program.verification;
    const proof = program.preuve;
    const catleg = program.catleg;
    const testsCheck = verification?.checks.find((check) => check.name === 'tests');
    const scenarios = program.tests?.['test-results'].flatMap((file) => file.tests.scopes.map((scope) => `${file.file} › ${scope.scope_name} : ${scope.success ? 'réussi' : 'échoué'}${scope.errors?.length ? ` · ${scope.errors.map((error) => typeof error === 'string' ? error : JSON.stringify(error)).join(' · ')}` : ''}`)) ?? [];
    return [
      ...(verification ? verification.checks.map((check) => ({ title: CHECKS[check.name] ?? check.name, lines: [check.passed ? 'Réussi' : 'Échoué', `Contrôle : ${when(verification.finished_utc)}`, check.command, `Code ${check.exit_code} · ${seconds(check.seconds)}`, ...(check.files ?? []), ...(!check.passed ? diagnostics(check.name) : [])], value: check.passed ? 'Vrai' : 'Faux', ...journal(check.name) })) : [{ title: 'Vérification', lines: ['Jamais vérifié'], value: 'Indéterminé' }]),
      ...(program.tests ? [{ title: 'Scénarios et couverture des tests', lines: scenarios, detail: JSON.stringify(program.tests, null, 2), value: testsCheck ? testsCheck.passed ? 'Vrai' : 'Faux' : 'Indéterminé' }] : []),
      ...(proof ? [{ title: 'Preuve', lines: [proof.passed ? 'Obligations produites vérifiées' : 'Preuve non validée', `${proof.fichier} › ${proof.scope}`, `Contrôle : ${when(proof.finished_utc)}`, `${proof.conflits} chevauchement(s) d’exceptions`, ...(proof.obligations === undefined ? [] : [`${proof.obligations} obligations produites`]), ...proof.checks.map((check) => `${check.command} · code ${check.exit_code} · ${seconds(check.seconds)}`), ...(!proof.passed ? diagnostics('preuve') : [])], value: proof.passed ? 'Vrai' : 'Faux', ...journal('preuve') }] : [{ title: 'Preuve', lines: ['Aucune preuve lancée'], value: 'Indéterminé' }]),
      ...(catleg ? catleg.fichiers.map((file) => ({ title: `Vigueur · ${file.fichier}`, file: file.fichier, lines: [`Date du contrôle : ${catleg.date_controle}`, file.passed ? 'Contrôle du fichier réussi' : 'Contrôle du fichier à revoir', ...file.messages, 'Version applicable à la date des faits : non contrôlée'], value: file.passed ? 'Vrai' : 'Faux' })) : [{ title: 'Vigueur des articles', lines: ['Aucun contrôle catleg', 'Version applicable à la date des faits : non contrôlée'], value: 'Indéterminé' }]),
      { title: 'Exécution expliquée', lines: [program.explication?.fichier ?? '', program.explication?.scope ?? '', program.explication ? when(program.explication.finished_utc) : 'Aucune exécution'], value: program.explication ? program.explication.passed ? 'Vrai' : 'Faux' : 'Indéterminé', ...journal('explication') },
    ];
  };
  const explanationPart = (program: Program) => {
    const report = program.explication;
    const stale = program.perimee || !report;
    let graph: string;
    try { graph = explanationGraph(!stale && report?.passed && program.graphe ? program.graphe : 'digraph G {}', program.fichiers, graphControls(program)); }
    catch (failure) { graph = `<p class="pmc-ko">${escape(failure instanceof Error ? failure.message : failure)}</p>` + explanationGraph('digraph G {}', program.fichiers, graphControls(program)); }
    return `<section class="pmc-view" data-mode="${viewMode}"><div class="pmc-tabs" role="tablist" aria-label="Vue Catala"><button role="tab" data-mode="graph" aria-selected="${viewMode === 'graph'}">Graphe</button><button role="tab" data-mode="written" aria-selected="${viewMode === 'written'}">Vue écrite</button></div><div class="pmc-explanation"${viewMode === 'written' ? ' hidden' : ''}><header class="pmc-graph-head"><select data-result aria-label="Étape du programme"></select><span class="pmc-muted">${report ? `${escape(report.scope)} · ${escape(when(report.finished_utc))}` : 'Aucune trace d’exécution disponible.'}${program.perimee ? ' · Trace périmée : relancez la vérification.' : ''}</span></header><div class="pmc-open-states" aria-live="polite"></div><div class="pmc-canvas" aria-label="Graphe Catala"><div class="pmc-stage">${graph}</div><div class="pmc-legend" hidden><span class="is-calculation">Règle · résultat</span><span class="is-condition">Condition appliquée</span><span class="is-input">Donnée du scénario</span><span class="is-piece">Pièce citée</span><span class="is-article">Article · source</span><span class="is-article">Jurisprudence</span><span class="is-reference">Autre référence</span><span>Contrôle du programme</span><span class="pmc-ok">Vrai</span><span class="pmc-ko">Faux</span><span class="pmc-warn">Pointillés : état ouvert ou condition</span><p>Une donnée vraie n’est pas une preuve. Les règles et conditions décrivent les branches exécutées. Les traits fins pointillés relient les contrôles de source. Les bilans globaux apparaissent une seule fois après les étapes.</p></div><aside class="pmc-inspector" aria-label="Détail de l’étape" hidden></aside><div class="pmc-tools"><button data-legend aria-pressed="false">Légende</button><button data-zoom="1.2" aria-label="Zoomer">+</button><button data-zoom="0.833333" aria-label="Dézoomer">−</button><button data-fit>Ajuster</button><button data-replay>Dérouler</button></div></div></div><div class="pmc-written" role="tabpanel"${viewMode === 'graph' ? ' hidden' : ''}><p class="pmc-lead">${report ? `${escape(report.fichier)} › ${escape(report.scope)}` : 'Aucune trace d’exécution disponible.'} · ${opener(program.journaux.find((file) => file.nom === 'explication.log'), 'Journal')} · Actualisé après la vérification du programme.</p><div class="pmc-step-list"></div><details class="pmc-part"><summary>Contrôles et fichiers</summary>${packPart()}${listPart(program)}<section class="pmc-part"><h4>Dernier bilan</h4>${verificationPhase(program)}${proofPhase(program)}${catlegPhase(program)}</section>${filesPart(program)}</details></div></section>`;
  };
  const filesPart = (program: Program) => `<section class="pmc-part"><h4>Fichiers</h4>${program.fichiers.length ? `<ul class="pmc-files">${program.fichiers.map((file) => `<li>${opener(file)}</li>`).join('')}</ul>` : '<p class="pmc-muted">Aucun fichier .catala_fr.</p>'}${program.journaux.length ? `<h4>Journaux</h4><ul class="pmc-files">${program.journaux.map((file) => `<li>${opener(file)}</li>`).join('')}</ul>` : ''}</section>`;
  const paint = () => {
    stopGraph();
    root.dataset.theme = context.theme;
    const warning = error ? `<div class="pmc-warning">${escape(error)}</div>` : '';
    if (!context.project) { panel.innerHTML = '<p class="pmc-muted">Ouvrez un dossier pour voir ses programmes Catala.</p>'; return; }
    if (!data) { panel.innerHTML = warning; return; }
    const program = shown();
    if (!program) { panel.innerHTML = `${warning}${packPart()}<p class="pmc-muted">Aucun programme Catala dans ce dossier : un programme est un dossier .piecemaker/catala/&lt;nom&gt;/ avec clerk.toml.</p>`; return; }
    const running = program.enCours || verifying === program.nom;
    const run = `<div class="pmc-run"><button data-refresh>Actualiser</button><button class="pmc-primary" data-verify="${escape(program.nom)}"${running || verifying || !data.pack ? ' disabled' : ''}>${running ? 'Vérification en cours…' : 'Vérifier'}</button><strong>${escape(program.nom)}</strong>${data.programmes.length > 1 ? `<select data-program-choice aria-label="Programme Catala">${data.programmes.map((entry) => `<option value="${escape(entry.nom)}"${entry === program ? ' selected' : ''}>${escape(entry.nom)}</option>`).join('')}</select>` : ''}${program.verification ? `<span class="pmc-tally">${verdict(program.verification)}</span>` : ''}</div>${data.pack ? '' : '<p class="pmc-muted">Pack Catala absent : la vérification est impossible.</p>'}`;
    panel.innerHTML = `${warning}${run}${explanationPart(program)}`;
    const graph = panel.querySelector<HTMLElement>('.pmc-explanation');
    if (graph) stopGraph = mountExplanation(graph, (source) => {
      let filename = '';
      try { filename = decodeURIComponent(new URL(source).pathname).split('/').pop() ?? ''; } catch { return; }
      const matches = program.fichiers.filter((file) => file.nom.split('/').pop() === filename);
      if (matches.length === 1) window.dispatchEvent(new CustomEvent('piecemaker:open-in-editor', { detail: { path: matches[0].chemin } }));
    }, (target, origin) => {
      if (/^https?:\/\//i.test(target)) { window.open(target, '_blank', 'noopener,noreferrer'); return; }
      const project = context.project?.path.replaceAll('\\', '/').replace(/\/$/, '');
      if (!project || ![...program.fichiers, ...program.journaux].some((file) => file.chemin === origin)) return;
      try {
        const base = new URL(`file:///${origin.replaceAll('\\', '/').replace(/^\/+/, '')}`);
        const resolved = new URL(target, base);
        const root = new URL(`file:///${project.replace(/^\/+/, '')}/`);
        if (resolved.protocol !== 'file:' || resolved.host !== root.host || !resolved.pathname.startsWith(root.pathname)) return;
        const path = decodeURIComponent(resolved.pathname).replace(/^\/(\w:)/, '$1');
        if (path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.')) return;
        window.dispatchEvent(new CustomEvent('piecemaker:open-in-editor', { detail: { path } }));
      } catch { return; }
    });
  };

  panel.addEventListener('click', (event) => {
    const tab = (event.target as Element).closest<HTMLElement>('[role="tab"][data-mode]');
    if (!tab) return;
    viewMode = tab.dataset.mode ?? 'graph';
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
    if (button.dataset.program) { chosen = button.dataset.program; paint(); }
    if (button.dataset.open) window.dispatchEvent(new CustomEvent('piecemaker:open-in-editor', { detail: { path: button.dataset.open } }));
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
