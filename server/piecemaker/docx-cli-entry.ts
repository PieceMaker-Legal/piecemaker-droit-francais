import { accessSync, constants, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { docxFileArgument, runDocxCli } from './docx-cli.js';

const args = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { locateProjectCase } = require(process.env.PIECEMAKER_DOCX_CASE_FOLDERS ?? './vendor/piecemaker-plugin/scripts/lib/case-folders.cjs');
const binDirectory = process.env.PIECEMAKER_DOCX_WRAPPER_DIR;
const candidates = (process.env.PATH ?? '').split(path.delimiter)
  .filter((directory) => directory && path.resolve(directory) !== binDirectory)
  .flatMap((directory) => process.platform === 'win32' ? ['docx.exe', 'docx.cmd'].map((name) => path.join(directory, name)) : [path.join(directory, 'docx')]);
const binary = candidates.find((candidate) => {
  try { accessSync(candidate, constants.X_OK); return realpathSync(candidate) !== fileURLToPath(import.meta.url); }
  catch { return false; }
});
try {
  if (!binary) throw new Error('Binaire docx introuvable. Exécutez le bootstrap du skill docx-cli.');
  const index = docxFileArgument(args);
  const project = index < 0 ? null : locateProjectCase(path.resolve(args[index]))?.caseRoot ?? null;
  const result = await runDocxCli(args, binary, project);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
} catch (error) {
  process.stderr.write(`[PieceMaker] ${error instanceof Error ? error.message : 'Édition Word impossible.'}\n`);
  process.exitCode = 1;
}
