import { loadCatala, verifyCatala } from './api.js';

type File = { nom: string; chemin: string };
type Check = { name: string; command: string; exit_code: number; seconds: number; passed: boolean; files?: string[] };
type Report = { started_utc: string; finished_utc: string; passed: boolean; checks: Check[] };
type Proof = Report & { fichier: string; scope: string; conflits: number };
type Catleg = { date_controle: string; passed: boolean; fichiers: Array<{ fichier: string; passed: boolean; messages: string[] }> };
type Program = { nom: string; enCours: boolean; fichiers: File[]; journaux: File[]; verification: Report | null; preuve: Proof | null; catleg: Catleg | null };
export type CatalaSnapshot = {
  pack: { id: string; platform: string; version: string; proof: boolean; installedAt: string } | null;
  status: { state: string; id?: string; step?: string; error?: string; updatedAt?: string } | null;
  programmes: Program[];
};

const STATES: Record<string, [string, string]> = { pret: ['ok', 'Prêt'], installation: ['warn', 'Installation en cours'], 'en-cours': ['warn', 'Installation en cours'], indisponible: ['ko', 'Indisponible'], echec: ['ko', 'Échec de l’installation'] };
const CHECKS: Record<string, string> = { typecheck: 'Typage et invariants', format: 'Mise en forme', tests: 'Tests clerk', 'tests-python': 'Tests Python' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const pill = (tone: string, label: string) => `<span class="pmr-pill pmr-${tone}">${escape(label)}</span>`;
const when = (value: string) => new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const seconds = (value: number) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;
const span = (report: Report) => seconds((Date.parse(report.finished_utc) - Date.parse(report.started_utc)) / 1000);
const opener = (file: File | undefined, label = file?.nom) => (file ? `<button class="pmr-link" data-catala-open="${escape(file.chemin)}">${escape(label)}</button>` : '');
const verdict = (report: Report | null) => (report ? report.passed ? pill('ok', 'Vérifié') : pill('ko', 'À corriger') : pill('muted', 'Jamais vérifié'));

export function mountCatala(panel: HTMLElement, onPrograms: (count: number) => void) {
  let project: string | null = null;
  let current: string | undefined;
  let chosen: string | undefined;
  let data: CatalaSnapshot | null = null;
  let serialized = '';
  let verifying = '';
  let error = '';
  let sequence = 0;

  const shown = () => {
    const names = data?.programmes.map((entry) => entry.nom) ?? [];
    return data?.programmes.find((entry) => entry.nom === ([chosen, current].find((name) => name && names.includes(name)) ?? names[0]));
  };
  const packPart = () => {
    const status = data?.status;
    const pack = data?.pack;
    const [tone, label] = STATES[status?.state ?? ''] ?? (pack ? ['ok', 'Prêt'] : ['muted', 'Non installé']);
    const detail = pack ? `Catala ${escape(pack.version)} · ${escape(pack.platform)} · installé le ${escape(when(pack.installedAt))}${pack.proof ? '' : ' · preuve non fournie sur cette plateforme'}` : 'L’app de bureau installe le pack au démarrage.';
    const problem = status?.error ? `<p class="pmr-ko">${escape(status.error)}${status.step ? ` (étape ${escape(status.step)})` : ''}</p>` : '';
    return `<section class="pmr-part"><h4>Pack Catala</h4><div class="pmr-run">${pack ? pill('ok', 'Installé') : pill(tone, label)}${pack && status && status.state !== 'pret' ? pill(tone, label) : ''}<span class="pmr-muted">${detail}</span></div>${problem}</section>`;
  };
  const listPart = (selected: Program | undefined) => `<section class="pmr-part"><h4>Programmes du dossier</h4><ol class="pmr-log">${data!.programmes.map((entry) => `<li class="pmr-entry" data-status="${entry.verification ? entry.verification.passed ? 'ok' : 'alerte' : 'neutre'}"><span class="pmr-mark" aria-hidden="true">${entry.verification ? entry.verification.passed ? '✓' : '!' : ''}</span><div class="pmr-entry-head"><button class="pmr-link" data-catala-program="${escape(entry.nom)}" aria-pressed="${entry === selected}"><strong>${escape(entry.nom)}</strong></button>${verdict(entry.verification)}${entry.verification ? `<span class="pmr-muted">${escape(when(entry.verification.finished_utc))}</span>` : ''}</div></li>`).join('')}</ol></section>`;
  const checkEntry = (entry: Check, program: Program) => `<li class="pmr-entry" data-status="${entry.passed ? 'ok' : 'alerte'}"><span class="pmr-mark" aria-hidden="true">${entry.passed ? '✓' : '!'}</span><div class="pmr-entry-head"><span class="pmr-step">${escape(CHECKS[entry.name] ?? entry.name)}</span><strong>${entry.passed ? 'Réussi' : 'Échoué'}</strong>${opener(program.journaux.find((file) => file.nom === `${entry.name}.log`), 'Journal')}</div><span class="pmr-entry-text"><code>${escape(entry.command)}</code> · code ${escape(entry.exit_code)} · ${seconds(entry.seconds)}${entry.files?.length ? ` · ${escape(entry.files.join(', '))}` : ''}</span></li>`;
  const verificationPhase = (program: Program) => {
    const report = program.verification;
    if (!report) return '<p class="pmr-muted">Pas encore vérifié : lancez la vérification.</p>';
    const failed = report.checks.filter((entry) => !entry.passed).length;
    return `<section class="pmr-phase" data-status="${report.passed ? 'ok' : 'alerte'}"><header><span class="pmr-step">Vérification</span><strong>${escape(when(report.finished_utc))}</strong><span class="pmr-phase-state">${report.passed ? 'Vérifié' : 'À corriger'}</span></header><p class="pmr-lead">${report.checks.length - failed} contrôle${report.checks.length - failed > 1 ? 's' : ''} réussi${report.checks.length - failed > 1 ? 's' : ''}, ${failed} échoué${failed > 1 ? 's' : ''} · durée ${span(report)}</p><ol class="pmr-log">${report.checks.map((entry) => checkEntry(entry, program)).join('')}</ol></section>`;
  };
  const proofPhase = (program: Program) => {
    const proof = program.preuve;
    if (!proof) return '<section class="pmr-phase"><header><span class="pmr-step">Preuve</span><strong>Pas de preuve</strong></header><p class="pmr-lead">Aucune preuve lancée sur ce programme.</p></section>';
    return `<section class="pmr-phase" data-status="${proof.passed ? 'ok' : 'alerte'}"><header><span class="pmr-step">Preuve</span><strong>${escape(proof.fichier)} › ${escape(proof.scope)}</strong><span class="pmr-phase-state">${proof.passed ? 'Aucune erreur' : 'Erreurs ou avertissements'}</span></header><p class="pmr-lead">${escape(when(proof.finished_utc))} · ${proof.conflits ? `${proof.conflits} chevauchement${proof.conflits > 1 ? 's' : ''} d’exceptions` : 'aucun chevauchement d’exceptions'} · ${opener(program.journaux.find((file) => file.nom === 'preuve.log'), 'Journal')}</p></section>`;
  };
  const catlegPhase = (program: Program) => {
    const report = program.catleg;
    if (!report) return '<section class="pmr-phase"><header><span class="pmr-step">Vigueur</span><strong>Pas de contrôle catleg</strong></header><p class="pmr-lead">La vigueur des articles cités n’a pas été contrôlée.</p></section>';
    const day = report.date_controle.split('-').reverse().join('/');
    return `<section class="pmr-phase" data-status="${report.passed ? 'ok' : 'alerte'}"><header><span class="pmr-step">Vigueur</span><strong>Contrôle du ${escape(day)}</strong><span class="pmr-phase-state">${report.passed ? 'Articles en vigueur' : 'À revoir'}</span></header><p class="pmr-lead">catleg contrôle la vigueur à la date du contrôle seulement.</p><ol class="pmr-log">${report.fichiers.map((entry) => `<li class="pmr-entry" data-status="${entry.passed ? 'ok' : 'alerte'}"><span class="pmr-mark" aria-hidden="true">${entry.passed ? '✓' : '!'}</span><div class="pmr-entry-head">${opener(program.fichiers.find((file) => file.nom === entry.fichier), entry.fichier) || `<strong>${escape(entry.fichier)}</strong>`}<span class="pmr-step">${entry.passed ? 'En vigueur ce jour' : 'À revoir'}</span></div>${entry.messages.length ? `<details><summary class="pmr-muted">Messages (${entry.messages.length})</summary><span class="pmr-entry-text">${entry.messages.map(escape).join('<br>')}</span></details>` : ''}</li>`).join('')}</ol></section>`;
  };
  const filesPart = (program: Program) => `<section class="pmr-part"><h4>Fichiers</h4>${program.fichiers.length ? `<ul class="pmr-files">${program.fichiers.map((file) => `<li>${opener(file)}</li>`).join('')}</ul>` : '<p class="pmr-muted">Aucun fichier .catala_fr.</p>'}${program.journaux.length ? `<h4>Journaux</h4><ul class="pmr-files">${program.journaux.map((file) => `<li>${opener(file)}</li>`).join('')}</ul>` : ''}</section>`;
  const paint = () => {
    if (!data) { panel.innerHTML = ''; return; }
    const program = shown();
    const running = Boolean(program && (program.enCours || verifying === program.nom));
    const run = program ? `<div class="pmr-run"><button class="pmr-primary" data-catala-verify="${escape(program.nom)}"${running || verifying || !data.pack ? ' disabled' : ''}>${running ? 'Vérification en cours…' : 'Vérifier'}</button><strong>${escape(program.nom)}</strong>${program.verification ? `<span class="pmr-tally">${verdict(program.verification)}</span>` : ''}</div>${data.pack ? '' : '<p class="pmr-muted">Pack Catala absent : la vérification est impossible.</p>'}` : '';
    panel.innerHTML = `${error ? `<div class="pmr-warning">${escape(error)}</div>` : ''}${run}${packPart()}${program ? `${listPart(program)}<section class="pmr-part"><h4>Dernier bilan</h4>${verificationPhase(program)}${proofPhase(program)}${catlegPhase(program)}</section>${filesPart(program)}` : ''}`;
  };
  const apply = (next: CatalaSnapshot | null) => {
    const text = JSON.stringify(next);
    if (text === serialized) return;
    serialized = text;
    data = next;
    onPrograms(next?.programmes.length ?? 0);
    paint();
  };

  panel.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (!button) return;
    if (button.dataset.catalaProgram) { chosen = button.dataset.catalaProgram; paint(); }
    if (button.dataset.catalaOpen) window.dispatchEvent(new CustomEvent('piecemaker:open-in-editor', { detail: { path: button.dataset.catalaOpen } }));
    if (button.dataset.catalaVerify && project && !verifying) {
      verifying = button.dataset.catalaVerify;
      error = '';
      paint();
      const target = project;
      verifyCatala(target, verifying).then((next) => { if (target === project) apply(next); }, (failure: unknown) => { error = failure instanceof Error ? failure.message : String(failure); }).finally(() => { verifying = ''; paint(); });
    }
  });

  return {
    refresh(nextProject: string | null, nextCurrent: string | undefined) {
      if (nextProject !== project) { chosen = undefined; error = ''; }
      const moved = nextCurrent !== current;
      if (moved) chosen = undefined;
      project = nextProject;
      current = nextCurrent;
      if (moved) paint();
      const request = ++sequence;
      if (!project) { apply(null); return; }
      loadCatala(project).then((next) => { if (request === sequence) apply(next); }, () => { if (request === sequence) apply(null); });
    },
    stop() { sequence++; project = null; },
  };
}
