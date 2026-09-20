import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capture, mustCapture } from './shell.mjs';
import { PRODUCT_NAME } from './paths.mjs';

function escapeForAppleScript(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function panelSource({ title, message, confirmLabel, cancelLabel, command, resultPath }) {
  return [
    `set resultPath to "${escapeForAppleScript(resultPath)}"`,
    'try',
    `\tdisplay dialog "${escapeForAppleScript(message)}" with title "${escapeForAppleScript(title)}" buttons {"${escapeForAppleScript(cancelLabel)}", "${escapeForAppleScript(confirmLabel)}"} default button "${escapeForAppleScript(confirmLabel)}" cancel button "${escapeForAppleScript(cancelLabel)}" with icon note`,
    'on error number -128',
    '\twriteResult(resultPath, "cancel")',
    '\treturn',
    'end try',
    'try',
    `\tdo shell script "${escapeForAppleScript(command)}"`,
    '\twriteResult(resultPath, "ok")',
    'on error errorMessage number errorNumber',
    '\twriteResult(resultPath, "error:" & errorNumber & " " & errorMessage)',
    'end try',
    '',
    'on writeResult(resultPath, value)',
    '\tset handle to open for access (POSIX file resultPath) with write permission',
    '\tset eof handle to 0',
    '\twrite value to handle',
    '\tclose access handle',
    'end writeResult',
    '',
  ].join('\n');
}

export async function runAuthorizationPanel(options) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piecemaker-panel-'));
  const resultPath = path.join(workDir, 'result');
  const sourcePath = path.join(workDir, 'panel.applescript');
  const appPath = path.join(workDir, `${PRODUCT_NAME}.app`);

  try {
    await fs.writeFile(resultPath, '', 'utf8');
    await fs.writeFile(sourcePath, panelSource({ ...options, resultPath }), 'utf8');
    mustCapture('osacompile', ['-o', appPath, sourcePath]);

    const launch = capture('open', ['-W', appPath]);
    if (launch.code !== 0) {
      throw new Error(`Ouverture du panneau impossible : ${launch.stderr || launch.stdout}`);
    }

    const outcome = (await fs.readFile(resultPath, 'utf8')).trim();
    if (outcome === 'ok') return { authorized: true };
    if (outcome === 'cancel') return { authorized: false };
    if (outcome.startsWith('error:')) {
      throw new Error(outcome.slice('error:'.length).trim());
    }
    throw new Error('Le panneau d\'autorisation ne s\'est pas terminé normalement.');
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
