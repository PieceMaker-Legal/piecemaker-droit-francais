import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HASH_FILE = path.join(HERE, 'forbidden-hashes.json');
const SKIPPED_PATH = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|forbidden-hashes\.json)$/;
const ZERO_SHA = /^0+$/;
const COMMIT_START = '\u0001';
const MESSAGE_END = '\u0002';

const hashFilePath = () => process.env.GUARD_HASH_FILE || DEFAULT_HASH_FILE;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const foldText = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const exactText = (value) => value.normalize('NFC').toLowerCase();
const tokensOf = (text) => text.match(/[\p{L}\p{N}]+/gu) || [];

const normalizers = { fold: foldText, exact: exactText };
const emptyList = () => ({ version: 1, terms: [] });

export function readList(file = hashFilePath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed.terms) ? parsed : emptyList();
  } catch {
    return emptyList();
  }
}

export function writeList(list, file = hashFilePath()) {
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
}

export function entryForTerm(term, mode) {
  const tokens = tokensOf(normalizers[mode](term));
  if (!tokens.length) return null;
  return { mode, words: tokens.length, first: sha256(tokens[0]), hash: sha256(tokens.join(' ')) };
}

export function addTerms(terms, mode, file = hashFilePath()) {
  const list = readList(file);
  const known = new Set(list.terms.map((entry) => `${entry.mode}:${entry.hash}`));
  let added = 0;
  for (const term of terms) {
    const entry = entryForTerm(term, mode);
    if (!entry || known.has(`${entry.mode}:${entry.hash}`)) continue;
    known.add(`${entry.mode}:${entry.hash}`);
    list.terms.push(entry);
    added += 1;
  }
  list.terms.sort((a, b) => a.hash.localeCompare(b.hash));
  writeList(list, file);
  return added;
}

export function createMatcher(list = readList()) {
  const byMode = {};
  for (const mode of Object.keys(normalizers)) {
    const entries = list.terms.filter((entry) => entry.mode === mode);
    byMode[mode] = {
      firsts: new Set(entries.map((entry) => entry.first)),
      hashes: new Set(entries.map((entry) => entry.hash)),
      sizes: [...new Set(entries.map((entry) => entry.words))],
    };
  }
  const tokenHashes = new Map();
  const hashToken = (token) => {
    let hash = tokenHashes.get(token);
    if (hash === undefined) {
      hash = sha256(token);
      tokenHashes.set(token, hash);
    }
    return hash;
  };

  return function containsForbiddenTerm(text) {
    for (const mode of Object.keys(normalizers)) {
      const { firsts, hashes, sizes } = byMode[mode];
      if (!firsts.size) continue;
      const tokens = tokensOf(normalizers[mode](text));
      for (let index = 0; index < tokens.length; index += 1) {
        if (!firsts.has(hashToken(tokens[index]))) continue;
        for (const size of sizes) {
          if (index + size > tokens.length) continue;
          if (hashes.has(sha256(tokens.slice(index, index + size).join(' ')))) return true;
        }
      }
    }
    return false;
  };
}

export function scanText(text, label, matcher = createMatcher()) {
  const findings = [];
  text.split('\n').forEach((line, index) => {
    if (matcher(line)) findings.push({ label, line: index + 1 });
  });
  return findings;
}

export function scanFileEdit(toolInput, projectDir, matcher = createMatcher()) {
  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  const resolved = filePath ? path.resolve(projectDir, filePath) : '';
  if (resolved && path.relative(projectDir, resolved).startsWith('..')) return [];
  const label = resolved ? path.relative(projectDir, resolved) : 'écriture';
  const texts = [
    toolInput.content,
    toolInput.new_string,
    toolInput.new_source,
    ...(Array.isArray(toolInput.edits) ? toolInput.edits.map((edit) => edit.new_string) : []),
  ].filter((value) => typeof value === 'string');
  const findings = scanText(label, `chemin ${label}`, matcher);
  for (const text of texts) findings.push(...scanText(text, label, matcher));
  return findings;
}

const GIT_WRITE_COMMAND = /\bgit\s+(?:-[^\s]+\s+)*(commit|tag|notes|push)\b/;

export function scanClaudeToolUse(payload, matcher = createMatcher()) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const toolInput = payload.tool_input || {};
  if (payload.tool_name === 'Bash') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    return GIT_WRITE_COMMAND.test(command) ? scanText(command, 'commande git', matcher) : [];
  }
  return scanFileEdit(toolInput, projectDir, matcher);
}

function streamGitLog(args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    child.on('error', reject);
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', onLine);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args[0]} a échoué (${code})`))));
  });
}

export async function scanRevisions(revisionArgs, matcher = createMatcher()) {
  const findings = [];
  const state = { commit: '', inMessage: false, path: '', messageLine: 0 };
  const args = [
    'log', '-p', '-U0', '--no-color', '--no-ext-diff', '--no-renames',
    `--format=${COMMIT_START}%h%n%B${MESSAGE_END}`, ...revisionArgs,
  ];
  await streamGitLog(args, (line) => {
    if (line.startsWith(COMMIT_START)) {
      state.commit = line.slice(1);
      state.inMessage = true;
      state.path = '';
      state.messageLine = 0;
      return;
    }
    if (state.inMessage) {
      if (line.startsWith(MESSAGE_END)) {
        state.inMessage = false;
        return;
      }
      state.messageLine += 1;
      if (matcher(line)) findings.push({ label: `${state.commit} message`, line: state.messageLine });
      return;
    }
    if (line.startsWith('diff --git ')) {
      state.path = line.split(' b/').pop();
      if (matcher(state.path)) findings.push({ label: `${state.commit} chemin ${state.path}`, line: 0 });
      return;
    }
    if (SKIPPED_PATH.test(state.path)) return;
    if (line.startsWith('+') && !line.startsWith('+++') && matcher(line)) {
      findings.push({ label: `${state.commit} ${state.path}`, line: 0 });
    }
  });
  return findings;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function reportFindings(findings, write = (line) => process.stderr.write(`${line}\n`)) {
  write('Donnée réelle détectée — jamais dans le dépôt, ses tests, sa documentation ni ses messages de commit.');
  for (const finding of findings.slice(0, 20)) {
    write(`  - ${finding.label}${finding.line ? `, ligne ${finding.line}` : ''}`);
  }
  if (findings.length > 20) write(`  … et ${findings.length - 20} autre(s)`);
  write('Utiliser des valeurs fictives (Jean Dupont, Société Exemple SAS, 12 rue des Lilas). Voir CLAUDE.md.');
}

async function runPrePush(remoteName) {
  const input = await readStdin();
  const matcher = createMatcher();
  const findings = [];
  for (const line of input.split('\n').filter(Boolean)) {
    const [, localSha] = line.split(' ');
    if (!localSha || ZERO_SHA.test(localSha)) continue;
    const known = remoteName ? [`--remotes=${remoteName}`] : ['--remotes'];
    findings.push(...(await scanRevisions([localSha, '--not', ...known], matcher)));
  }
  return findings;
}

async function runClaudeHook() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }
  return scanClaudeToolUse(payload);
}

async function runAdd(argv) {
  const exact = argv.includes('--exact');
  const operands = argv.filter((argument) => argument !== '--exact');
  const terms = operands.includes('-')
    ? (await readStdin()).split('\n').map((term) => term.trim()).filter(Boolean)
    : operands;
  const added = addTerms(terms, exact ? 'exact' : 'fold');
  process.stdout.write(`${added} terme(s) ajouté(s) (hachés, aucun texte en clair stocké).\n`);
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'add') return runAdd(rest);
  let findings;
  if (command === 'pre-push') findings = await runPrePush(rest[0]);
  else if (command === 'range') findings = await scanRevisions(rest);
  else if (command === 'claude-hook') findings = await runClaudeHook();
  else {
    process.stderr.write('Usage : check.mjs pre-push <remote> | range <rev…> | claude-hook | add [--exact] <terme…|->\n');
    return 64;
  }
  if (!findings.length) return 0;
  reportFindings(findings);
  return command === 'claude-hook' ? 2 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code || 0; },
    (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
  );
}
