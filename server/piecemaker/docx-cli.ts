import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { runDirectDocxReview } from '../modules/piecemaker-docx/index.js';
import type { DirectDocxReason, DirectDocxRevision } from '../modules/piecemaker-docx/index.js';

const mutators = new Set(['replace', 'edit', 'insert', 'delete', 'styles', 'sections', 'headers', 'footers', 'footnotes', 'endnotes', 'tables', 'images', 'links', 'comments']);

export function docxFileArgument(args: string[]) {
  return args.findIndex((arg, index) => index > 0 && arg.toLowerCase().endsWith('.docx') && existsSync(path.resolve(arg)));
}

function execute(binary: string, args: string[], input?: Buffer, inherit = false): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: process.env, windowsHide: true, stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 60000);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

export async function runDocxCli(args: string[], binary: string, project: string | null) {
  const index = docxFileArgument(args);
  if (!project || index < 0 || !mutators.has(args[0]) || args.some((arg) => ['--help', '-h', '--dry-run', '-o', '--output'].includes(arg) || arg.startsWith('--output='))) {
    return execute(binary, args, undefined, true);
  }
  const filename = await realpath(path.resolve(args[index]));
  const batchIndex = args.indexOf('--batch');
  let input: Buffer | undefined;
  let reasons: DirectDocxReason[] = [];
  if (batchIndex >= 0) {
    const batch = args[batchIndex + 1];
    if (batch === '-') {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      input = Buffer.concat(chunks);
    }
    const lines = batch === '-' ? input! : await readFile(batch);
    try { reasons = lines.toString().split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)).filter((entry) => entry && typeof entry === 'object' && typeof entry.reason === 'string'); }
    catch { reasons = []; }
  }
  return runDirectDocxReview(project, filename, {
    reasons,
    inventory: async (file) => {
      const result = await execute(binary, ['track-changes', 'list', file, '--json']);
      if (result.code) throw new Error('Impossible de lire les révisions Word.');
      return JSON.parse(result.stdout) as DirectDocxRevision[];
    },
    mutate: async (staging) => {
      const command = [...args]; command[index] = staging;
      const result = await execute(binary, command, input);
      return { ...result, stdout: result.stdout.split(staging).join(args[index]), stderr: result.stderr.split(staging).join(args[index]) };
    },
  });
}
