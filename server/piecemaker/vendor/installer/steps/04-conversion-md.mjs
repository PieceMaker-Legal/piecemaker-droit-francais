/**
 * Step 04 — document-to-Markdown conversion pipeline.
 *
 * smart_converter.py (websocket-server/scripts/) auto-routes between
 * markitdown (fast text extraction) and PP-OCRv6 Small (OCR, for scanned PDFs and
 * images). markitdown/pypdf come from requirements.txt (step 03); PP-OCRv6 Small is
 * downloaded separately from the Python libraries.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, spinner } from '../lib/ui.mjs';
import { confirm } from '../lib/prompt.mjs';
import { run, runCapture, venvPaths, REPO_ROOT } from '../lib/platform.mjs';
import { writeEnv } from '../lib/state.mjs';

export const meta = {
  id: '04-conversion-md',
  label: 'Conversion de documents en Markdown',
  description: 'Vérifie markitdown/pypdf et propose PP-OCRv6 Small pour les PDF scannés',
};

const SCRIPTS_DIR = path.join(REPO_ROOT, 'websocket-server', 'scripts');
const SMART_CONVERTER = path.join(SCRIPTS_DIR, 'smart_converter.py');
const OCR_MODELS = path.join(SCRIPTS_DIR, 'ocr_small_models.py');

async function installSmall(vp, sharedPython = false) {
  const probe = ['-c', 'import importlib.util; assert all(importlib.util.find_spec(name) for name in ("paddleocr", "onnxruntime", "pypdfium2", "psutil"))'];
  if (sharedPython) {
    if (runCapture(vp.python, probe).code !== 0) {
      log.error('Composant Small absent de l’environnement Python commun : installez les composants de cette version.');
      return false;
    }
  } else {
    const installed = await run(vp.python, ['-m', 'pip', 'install', '-r', path.join(SCRIPTS_DIR, 'requirements.txt')], {
      cwd: os.homedir(),
      onLine: (line) => log.info(line),
    });
    if (installed !== 0) return false;
  }
  const models = spinner('Téléchargement des modèles PP-OCRv6 Small…');
  const downloaded = await run(vp.python, [OCR_MODELS, '--download'], {
    cwd: os.homedir(),
    onLine: (line) => models.update(line.slice(0, 150)),
  });
  if (downloaded !== 0) {
    models.fail('Échec du téléchargement de Small');
    return false;
  }
  models.succeed('PP-OCRv6 Small est prêt');
  return true;
}

function checkImports(pythonBin) {
  return runCapture(pythonBin, ['-c', 'import markitdown, pypdf']);
}

async function smokeTest(pythonBin) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-smoke-'));
  const outDir = path.join(tmpDir, 'out');
  const inputFile = path.join(tmpDir, 'smoke.txt');
  fs.writeFileSync(inputFile, 'Bonjour installateur PieceMaker.\n', 'utf8');

  try {
    const result = runCapture(pythonBin, [
      SMART_CONVERTER,
      inputFile,
      '-o',
      outDir,
      '--engine',
      'markitdown',
    ]);
    const outputFile = path.join(outDir, 'smoke.md');
    const ok = result.code === 0 && fs.existsSync(outputFile);
    return { ok, code: result.code, stderr: result.stderr };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function install(ctx) {
  if (!fs.existsSync(SMART_CONVERTER)) {
    return { status: 'failed', note: `smart_converter.py introuvable : ${SMART_CONVERTER}` };
  }

  const vp = venvPaths(ctx.config.venvPath);

  // Dry run reports intent only: step 03 has not run yet in simulation mode,
  // so a missing venv here is expected rather than a failure.
  if (ctx.dryRun) {
    log.info(`[simulation] Vérification des imports markitdown/pypdf dans ${vp.python}`);
    log.info('[simulation] Écriture de SMART_CONVERTER_PATH dans .env');
    log.info('[simulation] Test de conversion sur un fichier temporaire');
    return { status: 'skipped', note: 'Mode simulation — aucune modification effectuée.' };
  }

  if (!vp.exists) {
    return {
      status: 'failed',
      note: 'Environnement virtuel introuvable — exécutez d\'abord l\'étape "03-python-gliner".',
    };
  }

  // 1. Verify markitdown + pypdf are importable in the venv.
  const importCheck = checkImports(vp.python);
  if (importCheck.code !== 0) {
    return {
      status: 'failed',
      note: 'markitdown ou pypdf non installés dans le venv. Relancez l\'étape "03-python-gliner" (pip install -r requirements.txt).',
    };
  }
  log.ok('markitdown et pypdf disponibles dans le venv');

  writeEnv({ SMART_CONVERTER_PATH: SMART_CONVERTER });
  log.ok(`SMART_CONVERTER_PATH enregistré : ${SMART_CONVERTER}`);

  const smallRequested = process.env.PIECEMAKER_INSTALL_OCR_SMALL === '1' || process.env.PIECEMAKER_INSTALL_MINERU === '1';
  const wantSmall = smallRequested || await confirm(
    'Installer PP-OCRv6 Small (OCR pour PDF scannés et images) ? Optionnel, modèles de 31 Mo, exécutés sur CPU.',
    false
  );
  let smallNote = '';
  if (wantSmall) {
    if (!(await installSmall(vp, ctx.config.pythonRuntime?.kind === 'shared'))) {
      if (smallRequested) return { status: 'failed', note: 'PP-OCRv6 Small n\'a pas pu être installé.' };
      smallNote = ' PP-OCRv6 Small n\'a pas pu être installé automatiquement — consultez sa documentation pour l\'installer manuellement.';
    }
  } else {
    log.info('PP-OCRv6 Small non installé — les PDF scannés et images ne pourront pas être convertis (OCR).');
  }

  // 3. Smoke test: convert a throwaway .txt file end-to-end.
  const spin = spinner('Test de conversion (fichier temporaire)...');
  const smoke = await smokeTest(vp.python);
  if (!smoke.ok) {
    spin.fail('Le test de conversion a échoué');
    return {
      status: 'failed',
      note: `smart_converter.py a échoué (code ${smoke.code}) : ${smoke.stderr.slice(0, 200)}`,
    };
  }
  spin.succeed('Conversion de test réussie');

  return {
    status: wantSmall && smallNote ? 'partial' : 'done',
    note: smallNote.trim(),
  };
}

export async function check(ctx) {
  if (!fs.existsSync(SMART_CONVERTER)) {
    return { status: 'failed', note: `smart_converter.py introuvable : ${SMART_CONVERTER}` };
  }
  const vp = venvPaths(ctx.config.venvPath);
  if (!vp.exists) {
    return { status: 'failed', note: 'Environnement virtuel introuvable.' };
  }
  const importCheck = checkImports(vp.python);
  if (importCheck.code !== 0) {
    return { status: 'failed', note: 'markitdown ou pypdf non installés.' };
  }
  // PP-OCRv6 Small is optional (OCR only) — its absence does not degrade the status.
  const smallAvailable = runCapture(vp.python, [OCR_MODELS]).code === 0;
  return {
    status: 'done',
    note: smallAvailable ? '' : 'PP-OCRv6 Small non installé (optionnel — nécessaire seulement pour l\'OCR des PDF scannés).',
  };
}
