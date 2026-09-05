/**
 * Levée temporaire de la protection sur tout un dossier juridique.
 *
 * `protection.json` n'enregistre que des exceptions : lever la protection du
 * dossier revient donc à inscrire chaque pièce protégeable dans `unprotected`.
 * L'état antérieur est photographié dans `.piecemaker/protection-bypass.json`
 * avant la première levée, et c'est lui qu'on réécrit à la réactivation — le
 * classement pièce par pièce du cabinet n'est jamais perdu.
 *
 * Les fonctions reçoivent la bibliothèque de protection en argument : elle vit
 * dans `vendor/`, que seul `router.cjs` a le droit de charger.
 */
const fs = require('node:fs');
const path = require('node:path');

const BYPASS_FILE = path.join('.piecemaker', 'protection-bypass.json');
const IGNORED_DIRECTORIES = new Set(['node_modules']);

function bypassFile(caseRoot) {
  return path.join(caseRoot, BYPASS_FILE);
}

function readSnapshot(caseRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(bypassFile(caseRoot), 'utf8'));
    return {
      active: true,
      savedAt: typeof raw?.savedAt === 'string' ? raw.savedAt : null,
      unprotected: Array.isArray(raw?.unprotected) ? raw.unprotected : [],
      resources: Array.isArray(raw?.resources) ? raw.resources : [],
    };
  } catch {
    return { active: false, savedAt: null, unprotected: [], resources: [] };
  }
}

function protectableKeys(caseRoot, protection) {
  const keys = [];
  const walk = (directory) => {
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || protection.isMappingFile(absolute)) continue;
      const key = protection.exceptionKey(absolute, caseRoot);
      if (key) keys.push(key);
    }
  };
  walk(caseRoot);
  return keys;
}

function bypassState(caseRoot, protection) {
  const snapshot = readSnapshot(caseRoot);
  const { unprotected } = protection.readProtection(caseRoot);
  return {
    active: snapshot.active,
    savedAt: snapshot.savedAt,
    savedCount: snapshot.unprotected.length,
    unprotectedCount: unprotected.size,
  };
}

/**
 * Idempotent : relancée alors que la levée est déjà active, elle réétend la
 * couverture aux pièces déposées depuis, sans écraser la photographie.
 */
function activateBypass(caseRoot, protection) {
  const snapshot = readSnapshot(caseRoot);
  if (!snapshot.active) {
    const current = protection.readProtection(caseRoot);
    fs.mkdirSync(path.dirname(bypassFile(caseRoot)), { recursive: true });
    fs.writeFileSync(
      bypassFile(caseRoot),
      `${JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        unprotected: [...current.unprotected],
        resources: [...current.resources],
      }, null, 2)}\n`,
      'utf8',
    );
  }
  protection.writeProtection(caseRoot, { unprotected: protectableKeys(caseRoot, protection) });
  return bypassState(caseRoot, protection);
}

function deactivateBypass(caseRoot, protection) {
  const snapshot = readSnapshot(caseRoot);
  if (snapshot.active) {
    protection.writeProtection(caseRoot, {
      unprotected: snapshot.unprotected,
      resources: snapshot.resources,
    });
    fs.rmSync(bypassFile(caseRoot), { force: true });
  }
  return bypassState(caseRoot, protection);
}

module.exports = { activateBypass, bypassState, deactivateBypass, protectableKeys, BYPASS_FILE };
