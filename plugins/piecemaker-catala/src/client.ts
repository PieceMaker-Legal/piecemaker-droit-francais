import { loadCatala, verifyCatala } from './api.js';
import { explanationGraph } from './graph.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void };
type File = { nom: string; chemin: string };
type Check = { name: string; command: string; exit_code: number; seconds: number; passed: boolean; files?: string[] };
type Report = { started_utc: string; finished_utc: string; passed: boolean; checks: Check[] };
type Proof = Report & { fichier: string; scope: string; conflits: number };
type Catleg = { date_controle: string; passed: boolean; fichiers: Array<{ fichier: string; passed: boolean; messages: string[] }> };
type Program = { nom: string; enCours: boolean; fichiers: File[]; journaux: File[]; verification: Report | null; preuve: Proof | null; catleg: Catleg | null; explication: (Report & { fichier: string; scope: string }) | null; graphe: string | null };
export type CatalaSnapshot = {
  pack: { id: string; platform: string; version: string; proof: boolean; installedAt: string } | null;
  status: { state: string; id?: string; step?: string; error?: string; updatedAt?: string } | null;
  programmes: Program[];
};

const STATES: Record<string, [string, string]> = { pret: ['ok', 'Prêt'], installation: ['warn', 'Installation en cours'], 'en-cours': ['warn', 'Installation en cours'], indisponible: ['ko', 'Indisponible'], echec: ['ko', 'Échec de l’installation'] };
const CHECKS: Record<string, string> = { typecheck: 'Typage et invariants', format: 'Mise en forme', tests: 'Tests clerk', 'tests-python': 'Tests Python' };
const POLL_MS = 2500;
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
  let sequence = 0;
  let stopped = false;
  let timer = 0;

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
  const explanationPart = (program: Program) => {
    const report = program.explication;
    if (!report) return '';
    let graph = '<p class="pmc-muted">Graphe absent. Relancez l’explication.</p>';
    if (report.passed && program.graphe) {
      try { graph = explanationGraph(program.graphe); }
      catch (failure) { graph = `<p class="pmc-ko">${escape(failure instanceof Error ? failure.message : failure)}</p>`; }
    }
    return `<section class="pmc-part"><h4>Explication de l’exécution</h4><p>${escape(report.fichier)} › ${escape(report.scope)} · ${escape(when(report.finished_utc))} · ${opener(program.journaux.find((file) => file.nom === 'explication.log'), 'Journal')}</p><p class="pmc-muted">Les flèches pointillées indiquent les conditions appliquées. Ce graphe explique cette exécution ; il ne prouve pas les faits.</p>${report.passed ? `<div class="pmc-graph">${graph}</div>` : '<p class="pmc-ko">L’explication a échoué. Consultez le journal.</p>'}</section>`;
  };
  const filesPart = (program: Program) => `<section class="pmc-part"><h4>Fichiers</h4>${program.fichiers.length ? `<ul class="pmc-files">${program.fichiers.map((file) => `<li>${opener(file)}</li>`).join('')}</ul>` : '<p class="pmc-muted">Aucun fichier .catala_fr.</p>'}${program.journaux.length ? `<h4>Journaux</h4><ul class="pmc-files">${program.journaux.map((file) => `<li>${opener(file)}</li>`).join('')}</ul>` : ''}</section>`;
  const paint = () => {
    root.dataset.theme = context.theme;
    const warning = error ? `<div class="pmc-warning">${escape(error)}</div>` : '';
    if (!context.project) { panel.innerHTML = '<p class="pmc-muted">Ouvrez un dossier pour voir ses programmes Catala.</p>'; return; }
    if (!data) { panel.innerHTML = warning; return; }
    const program = shown();
    if (!program) { panel.innerHTML = `${warning}${packPart()}<p class="pmc-muted">Aucun programme Catala dans ce dossier : un programme est un dossier .piecemaker/catala/&lt;nom&gt;/ avec clerk.toml.</p>`; return; }
    const running = program.enCours || verifying === program.nom;
    const run = `<div class="pmc-run"><button class="pmc-primary" data-verify="${escape(program.nom)}"${running || verifying || !data.pack ? ' disabled' : ''}>${running ? 'Vérification en cours…' : 'Vérifier'}</button><strong>${escape(program.nom)}</strong>${program.verification ? `<span class="pmc-tally">${verdict(program.verification)}</span>` : ''}</div>${data.pack ? '' : '<p class="pmc-muted">Pack Catala absent : la vérification est impossible.</p>'}`;
    panel.innerHTML = `${warning}${run}${packPart()}${listPart(program)}<section class="pmc-part"><h4>Dernier bilan</h4>${verificationPhase(program)}${proofPhase(program)}${catlegPhase(program)}</section>${explanationPart(program)}${filesPart(program)}`;
  };
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
    loadCatala(project).then((next) => { if (!stopped && request === sequence) apply(next); }, () => { if (!stopped && request === sequence) apply(null); });
  };
  const poll = () => { if (stopped) return; if (!verifying) load(); timer = window.setTimeout(poll, POLL_MS); };

  panel.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
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
  paint();
  load();
  timer = window.setTimeout(poll, POLL_MS);
  window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: 'plugin:piecemaker-catala' } }));
  cleanups.set(container, () => { stopped = true; sequence++; window.clearTimeout(timer); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
