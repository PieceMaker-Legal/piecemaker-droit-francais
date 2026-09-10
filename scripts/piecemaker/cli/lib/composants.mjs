import fs from 'node:fs';
import path from 'node:path';

import { APP, INSTALLER_ENTRY, PIECEMAKER_HOME } from './config.mjs';
import { runInherited } from './exec.mjs';
import { runtimeEnv } from './node-runtime.mjs';

const STATE_FILE = path.join(PIECEMAKER_HOME, 'state.json');

export const COMPONENTS = [
  { id: '01-prerequis', label: 'Prérequis système', timeout: 2 * 60_000 },
  { id: '06-hooks', label: 'Protection des pièces (hooks Claude Code)', timeout: 2 * 60_000 },
  { id: '09-codex-plugin', label: 'Protection des pièces (hooks Codex)', timeout: 2 * 60_000 },
  { id: '03-python-gliner', label: 'Python, GLiNER & anonymisation', timeout: 45 * 60_000 },
  { id: '03b-python-graphify', label: 'Graphify (graphe juridique)', timeout: 15 * 60_000 },
  { id: '04-conversion-md', label: 'Conversion de documents en Markdown', timeout: 10 * 60_000 },
  { id: '12-mcp-piecemaker', label: 'Serveur MCP piecemaker', timeout: 2 * 60_000 },
  { id: '07-legifrance', label: 'Serveur MCP PieceMaker (Légifrance, clés PISTE)', timeout: 5 * 60_000 },
];

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { steps: {} };
  }
}

function stepStatus(id) {
  return readState().steps?.[id] || null;
}

export async function installComponents(runtime, report) {
  if (!fs.existsSync(INSTALLER_ENTRY)) {
    report.warn('Socle PieceMaker introuvable — composants non installés');
    return;
  }

  for (const component of COMPONENTS) {
    const recorded = stepStatus(component.id);
    if (recorded?.status === 'done') {
      report.ok(`${component.label} — déjà installé`);
      continue;
    }

    report.step(`${component.label} — installation`);
    const result = await runInherited(runtime.nodePath, [INSTALLER_ENTRY, '--step', component.id, '--yes'], {
      cwd: APP.directory,
      env: runtimeEnv(runtime, { PIECEMAKER_NON_INTERACTIVE: '1', PIECEMAKER_YES: '1' }),
      timeout: component.timeout,
    });

    if (result.timedOut) {
      report.warn(`${component.label} — délai dépassé (${Math.round(component.timeout / 60_000)} min) ; relancez « piecemaker » pour reprendre`);
      continue;
    }
    if (result.error) {
      report.warn(`${component.label} — échec de démarrage : ${result.error.message}`);
      continue;
    }

    const status = stepStatus(component.id);
    if (status?.status === 'done') report.ok(`${component.label} — installé`);
    else if (status?.status === 'partial') report.warn(`${component.label} — installation partielle${status.note ? ` : ${status.note}` : ''}`);
    else if (status?.status === 'skipped') report.warn(`${component.label} — ignoré${status.note ? ` : ${status.note}` : ''}`);
    else report.warn(`${component.label} — échec (code ${result.code})`);
  }
}
