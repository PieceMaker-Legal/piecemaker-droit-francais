/**
 * Étape 06 — hooks Claude Code (protection des pièces, recherche, documents IA).
 *
 * Prouve que chaque script tourne proprement en lui envoyant une charge
 * utile synthétique sur stdin — le contrat exact qu'utilise Claude Code (voir
 * piecemaker-plugin/scripts/lib/hook-io.mjs).
 *
 * Le mapping PII n'est plus appliqué par des hooks Claude Code : le proxy
 * PII couvre Claude Code et Codex au même point de passage. Le scan reste
 * dans le pipeline de l'administration, seul endroit où les modèles NER sont
 * chargés.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { log, spinner } from '../lib/ui.mjs';
import { HOME_DIR, REPO_ROOT, runCapture } from '../lib/platform.mjs';

const require = createRequire(import.meta.url);
const {
  claudeHooksStatus,
  claudeStatusLineStatus,
  installClaudeHooks,
  installClaudeStatusLine,
} = require('../../websocket-server/claude-hooks.cjs');

export const meta = {
  id: '06-hooks',
  label: 'Hooks Claude Code (protection des pièces)',
  description: 'Configure les garde-fous et les hooks de recherche et de classement des documents IA',
};

const PLUGIN_ROOT = path.join(REPO_ROOT, 'piecemaker-plugin');
const SCRIPTS_DIR = path.join(PLUGIN_ROOT, 'scripts');
const HOOKS_JSON = path.join(PLUGIN_ROOT, 'hooks', 'hooks.json');

const HOOK_SCRIPTS = {
  protect: path.join(SCRIPTS_DIR, 'protect-originals.mjs'),
  classify: path.join(SCRIPTS_DIR, 'classify-ai-documents.mjs'),
  statusline: path.join(SCRIPTS_DIR, 'statusline.mjs'),
};

/** Run one hook script exactly like Claude Code would: JSON payload on stdin, JSON (or nothing) on stdout, exit 0 expected. */
function runHookSelfTest(label, scriptPath, payload) {
  if (!fs.existsSync(scriptPath)) {
    return { label, ok: false, note: `script manquant : ${scriptPath}` };
  }

  const result = runCapture('node', [scriptPath], {
    input: JSON.stringify(payload),
    cwd: REPO_ROOT,
    timeout: 15000,
  });

  if (result.error) {
    return { label, ok: false, note: `échec du lancement : ${result.error.message}` };
  }
  if (result.code !== 0) {
    return { label, ok: false, note: `code de sortie ${result.code}${result.stderr ? ` — ${result.stderr}` : ''}` };
  }
  if (result.stdout) {
    try {
      JSON.parse(result.stdout);
    } catch {
      return { label, ok: false, note: 'sortie stdout non-JSON — contrat de hook invalide' };
    }
  }
  return { label, ok: true, stdout: result.stdout, note: result.stdout ? 'sortie JSON valide' : 'exit 0 (aucune sortie)' };
}

export async function install(ctx) {
  if (ctx.dryRun) {
    log.info('[simulation] hooks PieceMaker fusionnés directement dans ~/.claude/settings.json');
    return { status: 'skipped', note: 'Mode simulation — hooks non vérifiés.' };
  }

  const spin = spinner('Vérification des hooks (payload synthétique sur stdin)...');
  const testResults = [];
  let testDir = null;
  let selftestRegistered = false;
  const { publishProjectSource } = require('../../piecemaker-plugin/scripts/lib/case-folders.cjs');

  try {
    // Un vrai dossier juridique factice, sans point de tête : les hooks
    // ignorent les répertoires cachés, un bac de test caché ne prouverait donc
    // rien du garde-fou. Comme seul un projet publié est un dossier juridique,
    // on le publie le temps du test sous une source dédiée, retirée ensuite,
    // et comme anonymisé : le garde-fou n'agit que sous un bouclier vert.
    // Les dossiers temporaires du système ne sont jamais des dossiers
    // juridiques : le bac vit donc dans le répertoire PieceMaker.
    fs.mkdirSync(HOME_DIR, { recursive: true });
    testDir = fs.realpathSync(fs.mkdtempSync(path.join(HOME_DIR, 'hook-selftest-')));
    fs.writeFileSync(path.join(testDir, 'piece-selftest.pdf'), 'PIECE DE TEST', 'utf8');
    publishProjectSource('installer-selftest', [testDir], [testDir]);
    selftestRegistered = true;

    // 1. protect-originals.mjs — une pièce du bac de test : protégée par
    //    défaut, donc la réponse de blocage doit être produite et bien formée.
    const protectedResult = runHookSelfTest('protect-originals.mjs', HOOK_SCRIPTS.protect, {
      hook_event_name: 'PreToolUse',
      session_id: 'installer-selftest',
      cwd: REPO_ROOT,
      transcript_path: '',
      permission_mode: 'default',
      tool_name: 'Read',
      tool_input: { file_path: path.join(testDir, 'piece-selftest.pdf') },
      tool_use_id: 'toolu_installer_originals_selftest',
    });
    if (protectedResult.ok && !/"permissionDecision"\s*:\s*"deny"/.test(protectedResult.stdout || '')) {
      protectedResult.ok = false;
      protectedResult.note = 'la pièce du bac de test n\'a pas été bloquée';
    } else if (protectedResult.ok) {
      protectedResult.note = 'pièce protégée bloquée';
    }
    testResults.push(protectedResult);

    // 2. classify-ai-documents.mjs — un document « créé par l'IA » dans le bac
    //    de test enregistré doit ressortir classé « espace de travail » dans
    //    `.piecemaker/protection.json`, sans quoi l'IA ne pourrait pas se
    //    relire. On vérifie l'effet de bord, pas seulement le code de sortie.
    const createdDoc = path.join(testDir, 'note-selftest.pdf');
    fs.writeFileSync(createdDoc, '%PDF-1.4 NOTE DE TEST', 'utf8');
    const classifyResult = runHookSelfTest('classify-ai-documents.mjs', HOOK_SCRIPTS.classify, {
      hook_event_name: 'PostToolUse',
      session_id: 'installer-selftest',
      cwd: testDir,
      transcript_path: '',
      permission_mode: 'default',
      tool_name: 'Write',
      tool_input: { file_path: createdDoc },
      tool_response: { success: true },
      tool_use_id: 'toolu_installer_classify_selftest',
    });
    if (classifyResult.ok) {
      const { readProtection } = require('../../piecemaker-plugin/scripts/lib/protection.cjs');
      if (!readProtection(testDir).unprotected.has('note-selftest.pdf')) {
        classifyResult.ok = false;
        classifyResult.note = 'le document créé n\'a pas été classé « espace de travail »';
      } else {
        classifyResult.note = 'document créé classé « espace de travail »';
      }
    }
    testResults.push(classifyResult);
  } finally {
    // Rétablir la liste des dossiers enregistrés : le bac de test ne doit pas
    // rester surveillé après l'installation.
    if (selftestRegistered) publishProjectSource('installer-selftest', null);
    if (testDir) fs.rmSync(testDir, { recursive: true, force: true });
  }

  const allOk = testResults.every((r) => r.ok);
  if (allOk) spin.succeed(`Hooks vérifiés — les ${testResults.length} scripts répondent au contrat stdin/stdout`);

  else spin.fail('Échec de vérification d\'au moins un hook');

  for (const r of testResults) {
    if (r.ok) log.ok(`${r.label} : ${r.note}`);
    else log.error(`${r.label} : ${r.note}`);
  }
  if (!fs.existsSync(HOOKS_JSON)) {
    log.warn(`hooks/hooks.json introuvable dans le plugin : ${HOOKS_JSON}`);
  }

  if (!allOk) {
    const failed = testResults.filter((r) => !r.ok).map((r) => r.label).join(', ');
    return { status: 'failed', note: `Échec de la vérification : ${failed}. Corrigez puis relancez cette étape.` };
  }
  const registration = installClaudeHooks(REPO_ROOT, os.homedir());
  if (!registration.ok) {
    return { status: 'failed', note: registration.reason };
  }
  if (registration.cleanup?.removed || registration.cleanup?.deletedFile) {
    log.ok(`${registration.cleanup.removed} ancien(s) branchement(s) de mapping retiré(s)`
      + (registration.cleanup.deletedFile ? ', script global supprimé.' : '.'));
  }
  log.ok(`${registration.registered} hook(s) PieceMaker ${registration.changed ? 'enregistré(s)' : 'déjà enregistré(s)'} directement dans ~/.claude/settings.json.`);

  const statusLine = installClaudeStatusLine(REPO_ROOT, os.homedir());
  if (statusLine.conflict) {
    log.warn(`statusLine Claude Code personnelle détectée — laissée telle quelle (${statusLine.reason}). Bandeau d'état PieceMaker non installé.`);
  } else if (!statusLine.ok) {
    log.warn(`statusLine Claude Code non installée : ${statusLine.reason}.`);
  } else {
    log.ok(`statusLine Claude Code ${statusLine.changed ? 'installée' : 'déjà à jour'} (${statusLine.command}).`);
  }

  return { status: 'done', note: '' };
}

export async function check() {
  const scriptsExist = Object.values(HOOK_SCRIPTS).every((p) => fs.existsSync(p));
  const hooksJsonExists = fs.existsSync(HOOKS_JSON);
  const hooksRegistered = claudeHooksStatus(REPO_ROOT, os.homedir()).ok;
  const statusLine = claudeStatusLineStatus(REPO_ROOT, os.homedir());
  const statusLineOk = statusLine.ok || statusLine.conflict; // une statusLine personnelle n'est pas une anomalie

  if (!scriptsExist || !hooksJsonExists) {
    return { status: 'failed', note: 'Fichiers du plugin manquants (scripts ou hooks.json) — réinstallez piecemaker-plugin/.' };
  }
  if (!hooksRegistered) {
    return { status: 'partial', note: 'Scripts présents mais hooks non enregistrés dans Claude Code — relancez cette étape.' };
  }
  if (!statusLineOk) {
    return { status: 'partial', note: `statusLine Claude Code absente ou périmée (${statusLine.reason}) — relancez cette étape.` };
  }
  return { status: 'done', note: '' };
}
