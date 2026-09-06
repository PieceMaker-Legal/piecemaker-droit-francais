/**
 * Levée temporaire de la protection sur tout un dossier juridique.
 *
 * La levée vise le dossier, pas ses pièces une à une : `.piecemaker/
 * protection-bypass.json` est le drapeau que lit `isProtectedFile`, si bien
 * qu'une pièce déposée pendant la levée en bénéficie sans nouvelle action.
 * `protection.json` n'est pas réécrit — le classement pièce par pièce du
 * cabinet redevient la règle dès que le drapeau disparaît.
 *
 * Un dossier levé par la version précédente porte, lui, une photographie du
 * classement (`version: 1`) parce que `protection.json` avait alors été
 * réécrit : elle est restituée à la réactivation.
 *
 * Les fonctions reçoivent la bibliothèque de protection en argument : elle vit
 * dans `vendor/`, que seul `router.cjs` a le droit de charger.
 */
const fs = require('node:fs');
const path = require('node:path');

const BYPASS_FILE = path.join('.piecemaker', 'protection-bypass.json');

function bypassFile(caseRoot) {
  return path.join(caseRoot, BYPASS_FILE);
}

function readBypass(caseRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(bypassFile(caseRoot), 'utf8'));
    return {
      active: true,
      savedAt: typeof raw?.savedAt === 'string' ? raw.savedAt : null,
      snapshot: Array.isArray(raw?.unprotected)
        ? { unprotected: raw.unprotected, resources: Array.isArray(raw?.resources) ? raw.resources : [] }
        : null,
    };
  } catch {
    return { active: false, savedAt: null, snapshot: null };
  }
}

function bypassState(caseRoot, protection) {
  const current = readBypass(caseRoot);
  const { unprotected } = protection.readProtection(caseRoot);
  return {
    active: current.active,
    savedAt: current.savedAt,
    savedCount: current.snapshot ? current.snapshot.unprotected.length : unprotected.size,
    unprotectedCount: unprotected.size,
  };
}

function activateBypass(caseRoot, protection) {
  if (!readBypass(caseRoot).active) {
    fs.mkdirSync(path.dirname(bypassFile(caseRoot)), { recursive: true });
    fs.writeFileSync(
      bypassFile(caseRoot),
      `${JSON.stringify({ version: 2, scope: 'dossier', savedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
  }
  return bypassState(caseRoot, protection);
}

function deactivateBypass(caseRoot, protection) {
  const current = readBypass(caseRoot);
  if (current.active) {
    if (current.snapshot) protection.writeProtection(caseRoot, current.snapshot);
    fs.rmSync(bypassFile(caseRoot), { force: true });
  }
  return bypassState(caseRoot, protection);
}

module.exports = { activateBypass, bypassState, deactivateBypass, BYPASS_FILE };
