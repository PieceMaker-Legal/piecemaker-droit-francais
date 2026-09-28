/**
 * Conversion Markdown et pipeline d'anonymisation des pièces originales d'un
 * dossier juridique, pilotés depuis l'administration.
 *
 * Les originaux ne sortent jamais du dossier, et le pipeline porte sur toutes
 * les pièces du dossier, sans restriction de zone. Le Markdown d'une pièce de
 * `01_CORRESPONDANCE` ou `02_DATA_ROOM` est rangé dans le sous-dossier de
 * conversion métier correspondant ; celui d'une pièce hors de ces deux zones
 * rejoint le sous-dossier de travail générique. Le mapping vit en base et
 * l'état technique dans `.piecemaker/anonymization-state.json`. Seules les lignes `PROGRESS:` et un
 * extrait d'erreur sont conservés dans le journal d'un travail : la sortie
 * brute des scripts peut contenir du texte de pièce, qui ne doit jamais
 * remonter dans l'interface.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  ensureProcessTreeStopped,
  terminateProcessTree,
} = require('./process-group.cjs');

const { originalFilesOverview } = require('../piecemaker-plugin/scripts/lib/commits.cjs');
const {
  classifyRelativeCaseFolderPath,
  readCaseFolderStructure,
} = require('./case-folder-structure.cjs');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const PIECEMAKER_HOME = path.join(os.homedir(), '.piecemaker');
const configuredPythonPath = () => {
  try {
    const { pythonPath } = JSON.parse(fs.readFileSync(path.join(PIECEMAKER_HOME, 'config.json'), 'utf8'));
    return pythonPath && fs.existsSync(pythonPath) ? pythonPath : null;
  } catch {
    return null;
  }
};
const PYTHON = () => process.env.PYTHON_PATH || configuredPythonPath() || 'python3';
const MAX_LOG_LINES = 200;
const MAX_ERROR_LINES = 12;

const GIB = 1024 ** 3;
/**
 * Contrôle d'admission des traitements — pensé pour ne jamais saturer la machine
 * de l'utilisateur (sa priorité explicite). Deux contraintes :
 *  1. exclusivité GLiNER : au plus un `anonymize` à la fois, quel que soit le
 *     dossier (deux workers chargeraient chacun ~400 Mo de poids et figeraient
 *     l'ordinateur) ;
 *  2. budget RAM : les conversions peuvent tourner en parallèle tant que la somme
 *     de leurs réservations reste sous ~la moitié de la RAM.
 * Tout est réglable par variable d'environnement, ce qui rend aussi les tests
 * déterministes sans dépendre de la RAM réelle.
 */
const RAM_BUDGET_BYTES = () => Number(process.env.PIECEMAKER_RAM_BUDGET_BYTES) || Math.floor(os.totalmem() * 0.5);
const JOB_RESERVE_BYTES = (action) => {
  if (action === 'anonymize') return Number(process.env.PIECEMAKER_ANONYMIZE_JOB_BYTES) || 3 * GIB;
  return Number(process.env.PIECEMAKER_CONVERT_JOB_BYTES) || 2 * GIB;
};
/** Priorité CPU (nice) des process de traitement : cède la main dès que l'utilisateur travaille. */
const JOB_NICE = () => {
  const value = Number(process.env.PIECEMAKER_JOB_NICE);
  return Number.isFinite(value) ? value : 10;
};
/** Threads torch du scanner : abaissé de 6 à 4 pour laisser des cœurs libres (le worker lit cette variable). */
const JOB_TORCH_THREADS = () => process.env.PIECEMAKER_TORCH_THREADS || '4';
const JOB_TIMEOUT_MS = () => {
  const value = Number(process.env.PIECEMAKER_ORIGINALS_JOB_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 60 * 60 * 1000;
};
const PROCESS_TERMINATION_GRACE_MS = () => {
  const value = Number(process.env.PIECEMAKER_PROCESS_GROUP_GRACE_MS);
  return Number.isFinite(value) && value > 0 ? value : 2_000;
};

/** Les pièces d'un dossier listées dans l'administration : tout sauf le Markdown. */
async function listOriginals(caseRoot) {
  const originals = await originalFilesOverview(caseRoot);
  const snapshot = readCaseFolderStructure(caseRoot);
  return originals
    .map((file) => ({
      file,
      info: classifyRelativeCaseFolderPath(file.path, snapshot.structure, { managed: snapshot.exists }),
    }))
    // Les images et autres dérivés produits avec le Markdown ne redeviennent
    // jamais des pièces originales dans l'administration.
    .filter(({ file, info }) => file.extension !== '.md' && !info.generated)
    .map(({ file, info }) => ({
      ...file,
      businessArea: info.area,
    }));
}

// ── Travaux de conversion / anonymisation ──────────────────────────────────

function appendLog(job, line) {
  const text = String(line || '').trim();
  if (!text) return;
  job.log.push(text);
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

// ── Contrôle d'admission : sérialise GLiNER, plafonne les conversions par la RAM ─

/** Descripteurs de traitements admis mais pas encore lancés, du plus ancien au plus récent. */
const waiting = [];
let reservedBytes = 0;
let acceptingJobs = true;

/**
 * Traitements en cours, tous consommateurs confondus : l'exclusivité GLiNER
 * doit rester vraie quel que soit celui qui a lancé le traitement.
 */
const runningManaged = new Set();

function runningAnonymize() {
  for (const job of runningManaged) {
    if (job.action === 'anonymize') return true;
  }
  return false;
}

/**
 * Un job peut-il démarrer maintenant ? Exclusivité GLiNER pour `anonymize`, puis
 * budget RAM. Un job seul est toujours admis même s'il dépasse le budget, sinon
 * un traitement plus gros que la moitié de la RAM ne partirait jamais.
 */
function canAdmit(job) {
  if (job.action === 'anonymize' && runningAnonymize()) return false;
  if (reservedBytes > 0 && reservedBytes + job.reserveBytes > RAM_BUDGET_BYTES()) return false;
  return true;
}

/**
 * Admet les traitements en file qui rentrent désormais, du plus ancien au plus
 * récent.
 */
function pumpQueue() {
  if (!acceptingJobs) return;
  for (let index = 0; index < waiting.length; index += 1) {
    const descriptor = waiting[index];
    if (!canAdmit(descriptor.job)) continue;
    waiting.splice(index, 1);
    index -= 1;
    launchManagedJob(descriptor);
  }
}

/**
 * Lance le script Python et suit son avancement. Seules les lignes
 * `PROGRESS:PHASE:pct:courant:total` alimentent le journal ; le reste de la
 * sortie est ignoré (texte de pièce potentiel), à l'exception d'un extrait de
 * stderr conservé pour diagnostiquer un échec.
 *
 * `progressScale` reporte le pourcentage 0-100 de cet appel dans la part
 * `[offset, offset + weight]` du travail global : un appelant qui enchaîne
 * plusieurs appels garde ainsi une progression monotone plutôt qu'un
 * pourcentage qui repart de zéro à chaque appel.
 *
 * `convert_and_scan_pipeline.py` enchaîne lui-même CONVERT (markitdown) puis
 * SCAN/CHUNKS (GLiNER) au sein d'un même appel, chacun avec son propre 0-100 :
 * sans repère de sous-phase, le pourcentage retomberait à zéro au passage de
 * l'un à l'autre. Le poids du groupe est donc partagé entre les deux, GLiNER
 * (chargement du modèle puis analyse) dominant largement markitdown en durée.
 */
const CONVERT_SUBPHASE_SHARE = 0.25;

function cancellationError(job) {
  return new Error(
    job.cancelReason === 'timeout'
      ? 'Traitement interrompu après dépassement du délai maximal.'
      : 'Traitement interrompu.'
  );
}

function stopRunningJob(job, reason) {
  if (!job.cancelled) {
    job.cancelled = true;
    job.cancelReason = reason;
  }
  if (!job.processGroupId) return Promise.resolve();
  if (!job.stopPromise) {
    job.stopPromise = terminateProcessTree(job.processGroupId, {
      graceMs: PROCESS_TERMINATION_GRACE_MS(),
    });
  }
  return job.stopPromise;
}

async function verifyJobProcessTreeStopped(job, processGroupId = job.processGroupId) {
  if (!processGroupId) return;
  if (job.stopPromise) await job.stopPromise;
  await ensureProcessTreeStopped(processGroupId, {
    graceMs: PROCESS_TERMINATION_GRACE_MS(),
  });
}

function spawnTracked(job, script, args, progressScale = {}, io = {}) {
  const offset = progressScale.offset || 0;
  const weight = progressScale.weight ?? 100;
  const convertWeight = weight * CONVERT_SUBPHASE_SHARE;
  const scanWeight = weight - convertWeight;
  return new Promise((resolve, reject) => {
    if (job.cancelled) {
      reject(cancellationError(job));
      return;
    }
    if (!fs.existsSync(script)) {
      reject(new Error(`Script introuvable : ${path.basename(script)}`));
      return;
    }
    const child = spawn(PYTHON(), [script, ...args], {
      cwd: SCRIPTS_DIR,
      // POSIX descendants inherit this dedicated process group. It lets the
      // host stop Python, GLiNER, MinerU and office converters as one unit.
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        // Le worker et MinerU, enfants de ce process, héritent de la variable.
        PIECEMAKER_TORCH_THREADS: JOB_TORCH_THREADS(),
      },
      windowsHide: true,
    });
    job.child = child;
    job.processGroupId = child.pid;
    job.stopPromise = null;
    // Basse priorité CPU : un scan long ne doit pas figer la machine. Les enfants
    // (worker GLiNER, MinerU) héritent du nice sous POSIX. Best-effort — un échec
    // (droits, plateforme) ne doit jamais empêcher le traitement.
    try {
      os.setPriority(child.pid, JOB_NICE());
    } catch {
      // priorité inchangée, sans conséquence sur le résultat
    }
    const errorLines = [];
    let stdoutRest = '';
    let stderrRest = '';

    const consumeStdout = (chunk) => {
      stdoutRest += chunk;
      const lines = stdoutRest.split(/\r?\n/);
      stdoutRest = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('MAPPING:')) {
          try {
            io.onMapping?.(JSON.parse(line.slice('MAPPING:'.length)));
          } catch (error) {
            errorLines.push(`mapping illisible : ${error.message}`);
          }
          continue;
        }
        const progress = /^PROGRESS:([A-Z]+):(\d+):(\d+):(\d+)/.exec(line.trim());
        if (!progress) continue;
        const [, marker, pct, current, total] = progress;
        // CONVERT : fichier par fichier. SCAN : fichier par fichier de la phase PII.
        // CHUNKS : progression *à l'intérieur* d'un scan (réémise par le pipeline
        // depuis le worker) — c'est elle qui fait vivre la barre pendant les longues
        // minutes d'un gros document, là où SCAN restait figé sur « 1/1 ».
        job.phase = marker === 'CONVERT' ? 'convert' : 'scan';
        const subPct = Math.min(100, Number(pct) || 0);
        job.percent = job.phase === 'convert'
          ? Math.min(100, offset + (subPct * convertWeight) / 100)
          : Math.min(100, offset + convertWeight + (subPct * scanWeight) / 100);
        job.processed = Number(current) || 0;
        job.total = Number(total) || job.total;
        const unit = marker === 'CHUNKS' ? ' segments' : '';
        appendLog(job, `${job.phase === 'scan' ? 'Analyse PII' : 'Conversion'} ${job.processed}/${job.total}${unit}`);
      }
    };
    const consumeStderr = (chunk) => {
      stderrRest += chunk;
      const lines = stderrRest.split(/\r?\n/);
      stderrRest = lines.pop() || '';
      for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        errorLines.push(text);
        if (errorLines.length > MAX_ERROR_LINES) errorLines.shift();
      }
    };

    if (io.input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(io.input);
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', consumeStdout);
    child.stderr.on('data', consumeStderr);
    let settled = false;
    const finish = async (code, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      const processGroupId = job.processGroupId;
      try {
        await verifyJobProcessTreeStopped(job, processGroupId);
        if (spawnError) throw spawnError;
        if (job.cancelled) throw cancellationError(job);
        if (code !== 0) {
          const detail = errorLines.slice(-3).join(' · ');
          throw new Error(`${path.basename(script)} a échoué (${signal || `code ${code}`})${detail ? ` : ${detail}` : ''}`);
        }
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        if (job.child === child) job.child = null;
        if (job.processGroupId === processGroupId) job.processGroupId = null;
        job.stopPromise = null;
      }
    };

    // `exit` fires when the direct Python process ends. Waiting only for
    // `close` can hang forever when an orphan still owns an inherited pipe.
    child.once('error', (error) => void finish(null, null, error));
    child.once('exit', (code, signal) => void finish(code, signal));
  });
}

/**
 * Point d'entrée générique pour tout traitement devant passer par le même
 * contrôle d'admission que les pièces originales (exclusivité GLiNER, budget
 * RAM, file d'attente, nice, timeout, arrêt propre du groupe de process).
 *
 * Cette fonction ne connaît aucune notion de dossier juridique enregistré
 * (`legalCase`, mapping, commit) : elle sert les consommateurs qui ont leur
 * propre gestion du résultat (le
 * pipeline `knowledge`, dont le `projectId` n'est pas un dossier juridique du
 * registre) mais qui doivent néanmoins partager le même verrou GLiNER et le
 * même budget RAM que l'administration — sinon rien n'empêche deux scans
 * simultanés de charger chacun leur propre modèle et de figer la machine.
 *
 * Lance directement `script` avec `args` via `spawnTracked` (même parseur de
 * lignes `PROGRESS:`, même gestion du groupe de process, même priorité nice).
 * `onProgress`, si fourni, est appelé à chaque mise à jour de la progression
 * avec `{ phase, percent, processed, total }`.
 */
function runManagedPythonJob({ action, script, args, onProgress, signal, input, onMapping } = {}) {
  if (!['convert', 'anonymize'].includes(action)) throw new Error('Action inconnue.');
  if (!acceptingJobs) throw new Error('Le serveur est en cours d’arrêt : aucun nouveau traitement ne peut démarrer.');
  const job = {
    action,
    cancelled: false,
    cancelReason: null,
    child: null,
    processGroupId: null,
    stopPromise: null,
    phase: 'convert',
    percent: 0,
    processed: 0,
    total: 0,
    log: [],
    reserveBytes: JOB_RESERVE_BYTES(action),
  };
  if (onProgress) {
    for (const key of ['phase', 'percent', 'processed', 'total']) {
      let value = job[key];
      Object.defineProperty(job, key, {
        get: () => value,
        set: (next) => {
          value = next;
          onProgress({ phase: job.phase, percent: job.percent, processed: job.processed, total: job.total });
        },
      });
    }
  }
  const abort = () => { void stopRunningJob(job, 'user-cancellation'); };
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  const run = () => spawnTracked(job, script, args, {}, { input, onMapping });
  const descriptor = { job, run };
  const completion = new Promise((resolve, reject) => {
    descriptor.resolve = resolve;
    descriptor.reject = reject;
  });
  if (canAdmit(job)) {
    launchManagedJob(descriptor);
  } else {
    waiting.push(descriptor);
  }
  return completion.finally(() => {
    signal?.removeEventListener('abort', abort);
  });
}

/** Lancement d'un descripteur `runManagedPythonJob` (pas de `legalCase`/commit à gérer ici). */
function launchManagedJob(descriptor) {
  const { job, run, resolve, reject } = descriptor;
  runningManaged.add(job);
  reservedBytes += job.reserveBytes;
  const timeoutId = setTimeout(() => {
    void stopRunningJob(job, 'timeout');
  }, JOB_TIMEOUT_MS());
  (async () => {
    try {
      if (job.cancelled) throw cancellationError(job);
      const result = await run(job);
      if (job.cancelled) throw cancellationError(job);
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      clearTimeout(timeoutId);
      const processGroupId = job.processGroupId;
      try {
        await verifyJobProcessTreeStopped(job, processGroupId);
      } catch {
        // Best-effort : une erreur de nettoyage ne doit pas masquer le résultat déjà tranché ci-dessus.
      }
      job.child = null;
      job.processGroupId = null;
      job.stopPromise = null;
      runningManaged.delete(job);
      reservedBytes -= job.reserveBytes;
      pumpQueue();
    }
  })();
}

let stopAllPromise = null;

/**
 * Arrêt serveur : ferme l'admission, annule toute la file, tue chaque groupe
 * actif et attend le `finally` de chaque job avant de rendre la main.
 */
function stopOriginalsJobs() {
  if (stopAllPromise) return stopAllPromise;
  acceptingJobs = false;

  stopAllPromise = (async () => {
    for (const descriptor of waiting.splice(0)) {
      const { job } = descriptor;
      job.cancelled = true;
      job.cancelReason = 'server-shutdown';
      descriptor.reject(cancellationError(job));
    }

    const running = [...runningManaged];
    const groups = [...new Set(running.map((job) => job.processGroupId).filter(Boolean))];
    await Promise.allSettled(running.map((job) => stopRunningJob(job, 'server-shutdown')));

    // Contrôle défensif final, y compris si un enfant a fermé ses pipes avant
    // que son événement `exit` ait été traité par le suivi normal du job.
    await Promise.all(groups.map((processGroupId) => ensureProcessTreeStopped(processGroupId, {
      graceMs: PROCESS_TERMINATION_GRACE_MS(),
    })));
  })();
  return stopAllPromise;
}

module.exports = {
  // Point d'entrée partagé : tout consommateur d'un pipeline GLiNER/markitdown
  // (même hors dossier juridique enregistré, ex. `knowledge/pipeline.ts`) doit
  // passer par ici pour rester sous l'exclusivité GLiNER et le budget RAM.
  runManagedPythonJob,
  stopOriginalsJobs,
  listOriginals,
};
