import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { cachedArticle, cachedDecision, keepArticle } from './article-cache.mjs';
import { catalaDocumentation, premiseCoverage, testsWithoutAssertion } from './catala-documentation.mjs';

export const CATALA_COMMANDS = ['env', 'lister', 'verifier', 'formater', 'preuve', 'catleg', 'expliquer', 'exceptions', 'executer', 'squelette', 'section', 'exec'];
export const CATALA_TOOLS = ['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap'];
const NAME = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]*$/u;
const NAME_SHAPE = 'minuscules, chiffres et tirets (ex. prime-anciennete)';
const IGNORED = new Set(['_build', '_targets', 'resultats']);
const SOURCE = /\.catala_(?:fr|en|pl)$/;
const PYTHON_PACKAGE = 'pm_python';
const PROOF_OK ='No errors found during the proof mode run.';
const PROOF_OBLIGATION = 'This verification condition was generated';
const Z3_UNTRANSLATED = /^\[([^\]]+)\] The translation to Z3 failed:\s*(?:\[Z3 encoding\]\s*)?(.*)$/;
const TYPECHECK = ['typecheck', '--color=never', '--catala-opts=--check-invariants', '--catala-opts=--message-format=gnu'];
const COMPILER_ERROR = /^(.+?):(\d+)\.[\d.-]+: \[ERROR\] (?:\d+\/\d+: )?(.+)$/;
const { verifyQuoteAgainstSource } = createRequire(import.meta.url)('../../../piecemaker-plugin/scripts/lib/verify-citations.cjs');

export function catalaHomes(env = process.env, homeDir = os.homedir()) {
  return [...new Set([env.PIECEMAKER_COMPONENTS_HOME, env.PIECEMAKER_HOME, path.join(homeDir, '.piecemaker')].filter(Boolean))];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function findCatalaPack({ env = process.env, homeDir = os.homedir() } = {}) {
  const homes = catalaHomes(env, homeDir);
  for (const home of homes) {
    const pack = readJson(path.join(home, 'catala', 'pack.json'));
    if (pack?.bin?.catala && fs.existsSync(pack.bin.catala)) return { home, pack, status: readJson(path.join(home, 'catala', 'status.json')) };
  }
  const status = homes.map((home) => readJson(path.join(home, 'catala', 'status.json'))).find(Boolean);
  return { home: null, pack: null, status };
}

export function sharedPython({ env = process.env, homeDir = os.homedir() } = {}) {
  for (const home of catalaHomes(env, homeDir)) {
    const pythonPath = readJson(path.join(home, 'config.json'))?.pythonPath;
    if (pythonPath && fs.existsSync(pythonPath)) return pythonPath;
  }
  return null;
}

export function pisteCredentials(homeDir = os.homedir()) {
  const values = {};
  let text = '';
  try {
    text = fs.readFileSync(path.join(homeDir, '.config', 'mcp-legifrance', '.env'), 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  if (!values.LEGIFRANCE_CLIENT_ID || !values.LEGIFRANCE_CLIENT_SECRET) return null;
  return { CATLEG_LF_CLIENT_ID: values.LEGIFRANCE_CLIENT_ID, CATLEG_LF_CLIENT_SECRET: values.LEGIFRANCE_CLIENT_SECRET };
}

function programsRoot(cwd) {
  return path.join(cwd, '.piecemaker', 'catala');
}

export function listPrograms(cwd) {
  let entries = [];
  try {
    entries = fs.readdirSync(programsRoot(cwd), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && NAME.test(entry.name) && fs.existsSync(path.join(programsRoot(cwd), entry.name, 'clerk.toml')))
    .map((entry) => entry.name)
    .sort();
}

export function selectProgram(cwd, name) {
  if (name !== undefined) {
    if (!NAME.test(name)) throw new TypeError(`Nom de programme ${name} mal écrit. Format : ${NAME_SHAPE}.`);
    const directory = path.join(programsRoot(cwd), name);
    if (!fs.existsSync(path.join(directory, 'clerk.toml'))) throw new TypeError(`Programme Catala introuvable : .piecemaker/catala/${name}/clerk.toml.`);
    return { name, directory };
  }
  const names = listPrograms(cwd);
  if (!names.length) throw new TypeError('Aucun programme Catala : créez .piecemaker/catala/<nom>/clerk.toml.');
  if (names.length > 1) throw new TypeError(`Plusieurs programmes Catala (${names.join(', ')}) : indiquez --programme <nom>.`);
  return { name: names[0], directory: path.join(programsRoot(cwd), names[0]) };
}

const TASK_TYPES = ['litigation', 'transactional'];

function isDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function vigueurOf(context, program, flags = {}) {
  const taskDate = readJson(path.join(program.directory, 'tache.json'))?.date_vigueur;
  const [value, origine, libelle] = flags.au !== undefined && flags.au !== true ? [flags.au, '--au', 'date donnée par --au'] : taskDate !== undefined ? [taskDate, 'tache.json', 'date de tache.json'] : [];
  if (value === undefined) throw new Error('Date de vigueur absente : inscrivez date_vigueur dans tache.json ou passez --au, avec today ou AAAA-MM-JJ.');
  if (value === 'today') return { date: context.now().slice(0, 10), origine, libelle: `${libelle} (today)` };
  if (!isDay(value)) throw new Error(`${origine === '--au' ? '--au' : 'date_vigueur'} attend today ou une date valide AAAA-MM-JJ.`);
  return { date: value, origine, libelle };
}

function taskErrors(directory, files) {
  const file = path.join(directory, 'tache.json');
  if (!fs.existsSync(file)) return ['tâche absente : créez tache.json avec tache, type, date_vigueur et raisonnements.'];
  let task;
  try { task = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return ['tâche illisible : JSON invalide.']; }
  const sources = files.map((name) => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
  const declared = (scope) => new RegExp(`(?:déclaration champ d'application|declaration scope)\\s+${String(scope).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(sources);
  const parts = Array.isArray(task?.raisonnements) ? task.raisonnements : [];
  return [
    typeof task?.tache === 'string' && task.tache.trim() ? '' : 'tâche sans nom : renseignez « tache ».',
    TASK_TYPES.includes(task?.type) ? '' : `type de tâche inconnu : écrivez ${TASK_TYPES.join(', ')}.`,
    task?.date_vigueur === undefined ? 'date_vigueur absente : écrivez today ou AAAA-MM-JJ.' : task.date_vigueur === 'today' || isDay(task.date_vigueur) ? '' : 'date_vigueur invalide : écrivez today ou AAAA-MM-JJ.',
    parts.length ? '' : 'tâche sans raisonnement : renseignez « raisonnements ».',
    ...parts.flatMap((part) => [
      part?.champ && declared(part.champ) ? '' : `raisonnement « ${part?.champ ?? ''} » : aucun champ d’application de ce nom.`,
      typeof part?.objectif === 'string' && part.objectif.trim() ? '' : `raisonnement « ${part?.champ ?? ''} » sans objectif.`,
    ]),
  ].filter(Boolean);
}

export function sourceFiles(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory() && !IGNORED.has(entry.name) && !entry.name.startsWith('.')) files.push(...sourceFiles(directory, child));
    else if (entry.isFile() && SOURCE.test(entry.name)) files.push(child);
  }
  return files.sort();
}

export function sourcesDigest(directory, files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(`${file.split(path.sep).join('/')}\0`).update(fs.readFileSync(path.join(directory, file))).update('\0');
  return hash.digest('hex');
}

// Inputs of the program not derived from an OKF premise (errors), and premises of the case index
// whose fact sets no input of any Catala program of the case (warnings).
export function premiseLinks(root, name) {
  const read = (program) => {
    const directory = path.join(programsRoot(root), program);
    return sourceFiles(directory).map((file) => ({ name: file, content: fs.readFileSync(path.join(directory, file), 'utf8') }));
  };
  const exists = (source) => fs.existsSync(path.join(root, '.piecemaker', 'okf', source.replace(/^okf:\/+/, '')));
  const own = premiseCoverage(read(name), { exists });
  const used = new Set(own.used);
  for (const other of listPrograms(root)) if (other !== name) for (const source of premiseCoverage(read(other), { exists }).used) used.add(source);
  let premises = [];
  try { premises = fs.readdirSync(path.join(root, '.piecemaker', 'okf', '_premises')).filter((file) => file.endsWith('.md')).sort(); } catch {}
  const unlinked = premises.filter((file) => !used.has(`okf:/_premises/${file}`));
  const located = own.warnings.map((entry) => ({ ...entry, message: `[WARNING] ${entry.message}` }));
  const elsewhere = [];
  for (const file of unlinked) {
    const source = `okf:/_premises/${file}`;
    const cited = own.mentions.filter((mention) => mention.source === source);
    if (cited.length) for (const mention of cited) located.push({ ...mention, message: `[WARNING] premise ${source} is cited here, but its fact sets no input of a Catala program. Use it to compute the input it establishes.` });
    else elsewhere.push(`.piecemaker/okf/_premises/${file}:1: [WARNING] premise ${source} is not used by any Catala program.`);
  }
  located.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const warnings = [...located.map((entry) => `${entry.file}:${entry.line}: ${entry.message}`), ...elsewhere];
  return {
    errors: own.errors.map((entry) => `${entry.file}:${entry.line}: [ERROR] ${entry.message}`),
    warnings,
    inputs: own.inputs.length,
    mentions: own.mentions.length,
    underived: new Set(own.errors.map((entry) => entry.input)).size,
    premises: premises.length,
    used: premises.length - unlinked.length,
    unlinked,
  };
}

function isTestFile(directory, file) {
  return /#\[test\]/.test(fs.readFileSync(path.join(directory, file), 'utf8'));
}

export function toolCommand(pack, name, args, platform = process.platform, env = process.env) {
  const binary = pack.bin[name];
  if (!binary) throw new TypeError(`Outil Catala inconnu : ${name}. Outils : ${CATALA_TOOLS.join(', ')}.`);
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(binary)) return { command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', binary, ...args] };
  return { command: binary, args };
}

export function packEnv(pack, env = process.env) {
  return { ...env, ...pack.env, PATH: [...(pack.path || []), env.PATH || ''].join(path.delimiter) };
}

export function runProcess(command, args, { cwd, env, inherit = false, input, timeout } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, timeout, windowsHide: true, stdio: inherit ? 'inherit' : [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input !== undefined) child.stdin.end(input);
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: stderr || error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function requirePack(context) {
  if (context.pack) return context.pack;
  const status = context.status;
  const detail = status ? ` État : ${status.state}${status.step ? `, étape ${status.step}` : ''}${status.error ? `, ${status.error}` : ''}.` : '';
  throw new Error(`Pack Catala non installé : l'app de bureau PieceMaker l'installe au démarrage.${detail}`);
}

function writeResult(directory, file, content) {
  const target = path.join(directory, 'resultats', file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

export function compilerErrors(output, limit = 8) {
  const lines = [...new Set(output.split('\n').map((line) => line.trim()).filter((line) => /\[(?:ERROR|WARNING)\]/.test(line)).map((line) => line.replace(/\[(ERROR|WARNING)\] \d+\/\d+: /, '[$1] ')))];
  return lines.length > limit ? [...lines.slice(0, limit), `… ${lines.length - limit} autre(s) ligne(s) dans le journal.`] : lines;
}

export async function typecheckErrors(directory, file, content, { env = process.env, homeDir = os.homedir(), run = runProcess, timeout = 10000 } = {}) {
  const { pack } = findCatalaPack({ env, homeDir });
  if (!pack?.bin?.clerk || !fs.existsSync(path.join(directory, 'clerk.toml'))) return [];
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-catala-typecheck-'));
  try {
    fs.cpSync(directory, work, { recursive: true, filter: (source) => !IGNORED.has(path.basename(source)) });
    const copy = path.join(work, path.relative(directory, file));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.writeFileSync(copy, content);
    const { command, args } = toolCommand(pack, 'clerk', TYPECHECK, process.platform, env);
    const result = await run(command, args, { cwd: work, env: packEnv(pack, env), timeout });
    if (result.code === 0) return [];
    const lines = new Set(`${result.stdout}${result.stderr}`.split('\n').map((line) => line.trim()));
    return [...lines].map((line) => line.match(COMPILER_ERROR)).filter((match) => match && !/^Required module not found/.test(match[3])).map(([, name, line, message]) => ({ file: name, line: Number(line), message }));
  } catch {
    return [];
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function check(context, directory, name, tool, args, judge = (result) => result.code === 0, input) {
  const { command, args: argv } = toolCommand(context.pack, tool, args, context.platform, context.env);
  const started = Date.now();
  const result = await context.run(command, argv, { cwd: directory, env: packEnv(context.pack, context.env), ...(input === undefined ? {} : { input }) });
  const seconds = Math.round((Date.now() - started) / 10) / 100;
  writeResult(directory, `${name}.log`, `${result.stdout}${result.stderr}`);
  return { entry: { name, command: [tool, ...args].join(' '), exit_code: result.code, seconds, passed: judge(result) }, result };
}

function testSummary(stdout) {
  try {
    const report = JSON.parse(stdout);
    const scopes = report['test-results'].flatMap((file) => file.tests.scopes.map((scope) => ({ file: path.basename(file.file), ...scope })));
    return { report, scopes };
  } catch {
    return { report: null, scopes: [] };
  }
}

async function pythonTests(context, program, tests) {
  const started = Date.now();
  const entry = (exit_code) => ({ name: 'tests-python', command: 'catala python --whole-program --autotest + python --test', exit_code, seconds: Math.round((Date.now() - started) / 10) / 100, passed: exit_code === 0 });
  const prepared = await check(context, program.directory, 'python-preparation', 'clerk', ['run', '--backend=python', '--prepare-only', ...tests]);
  if (!prepared.entry.passed) return entry(prepared.entry.exit_code);
  const target = path.join(program.directory, '_build', PYTHON_PACKAGE);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const library of [path.join(program.directory, '_build', 'libcatala', 'python'), path.join(program.directory, '_build', 'python')]) {
    for (const file of fs.existsSync(library) ? fs.readdirSync(library) : []) if (file.endsWith('.py')) fs.copyFileSync(path.join(library, file), path.join(target, file));
  }
  const logs = [];
  let exitCode = 0;
  for (const test of tests) {
    const module = path.basename(test).replace(SOURCE, '').replace(/\W/g, '_');
    const compiled = await check(context, program.directory, 'python-compilation', 'catala', ['python', '--whole-program', '--autotest', test, '-I', '.', '-o', path.join('_build', PYTHON_PACKAGE, `${module}.py`)]);
    if (!compiled.entry.passed) {
      exitCode ||= compiled.entry.exit_code;
      logs.push(`${test}: compilation échouée\n${compiled.result.stdout}${compiled.result.stderr}`);
      continue;
    }
    const script = `import runpy, sys; sys.path[:0] = ['_build', ${JSON.stringify(path.join('_build', PYTHON_PACKAGE))}]; runpy.run_module('${PYTHON_PACKAGE}.${module}', run_name='__main__')`;
    const result = await context.run(context.python, ['-I', '-c', script, '--test'], { cwd: program.directory, env: context.env });
    logs.push(`${test}: code ${result.code}\n${result.stdout}${result.stderr}`);
    exitCode ||= result.code;
  }
  writeResult(program.directory, 'tests-python.log', logs.join('\n'));
  return entry(exitCode);
}

async function clerkTests(context, program, tests) {
  const started = Date.now();
  const digest = sourcesDigest(program.directory, sourceFiles(program.directory));
  const reports = [];
  let failed = false;
  for (const [index, file] of tests.entries()) {
    const report = path.join('resultats', `tests-${index}.report`);
    fs.rmSync(path.join(program.directory, report), { force: true });
    const outcome = await check(context, program.directory, `tests-${index}`, 'clerk', ['runtest', '--whole-program', '-I', '.', '--code-coverage', ...(context.pack.env?.CATALA_STDLIB ? [`--catala-opts=--stdlib=${context.pack.env.CATALA_STDLIB}`] : []), `--report=${report}`, file]);
    failed ||= !outcome.entry.passed;
    if (fs.existsSync(path.join(program.directory, report))) reports.push(report);
  }
  const { entry, result } = await check(context, program.directory, 'tests', 'clerk', ['report', '--json', '--code-coverage', ...reports]);
  const summary = testSummary(result.stdout);
  if (summary.report) writeResult(program.directory, 'tests.json', { ...summary.report, sources_sha256: digest });
  return { entry: { ...entry, command: 'clerk runtest --whole-program + clerk report --json', seconds: Math.round((Date.now() - started) / 10) / 100, passed: !failed && reports.length === tests.length && entry.passed && summary.scopes.length > 0 && summary.scopes.every((scope) => scope.success) }, scopes: summary.scopes };
}

async function correctedCitations(context, program) {
  const report = await context.citations({ cwd: program.root, programme: program.name });
  for (const result of report.results ?? []) {
    if (!result.correction || !path.resolve(result.origin).startsWith(path.resolve(program.directory) + path.sep)) continue;
    const content = fs.readFileSync(result.origin, 'utf8');
    if (content.includes(result.correction.avant)) fs.writeFileSync(result.origin, content.replace(result.correction.avant, () => result.correction.apres));
    result.quote = result.correction.apres;
  }
  return report;
}

async function verifier(context, program, flags = {}) {
  const files = sourceFiles(program.directory);
  if (!files.length) throw new TypeError(`Aucun fichier .catala_fr dans .piecemaker/catala/${program.name}/.`);
  vigueurOf(context, program, flags);
  const started = context.now();
  const formatted = context.pack ? await formatSources(context, program, files) : null;
  const cited = context.citations ? await correctedCitations(context, program).catch((error) => ({ error })) : null;
  const digest = sourcesDigest(program.directory, files);
  const previous = readJson(path.join(program.directory, 'resultats', 'explication.json'));
  for (const file of ['preuve.json', 'catleg.json', 'citations.json', 'tests.json', 'explication.json', 'explication.dot', 'scenarios.json']) fs.rmSync(path.join(program.directory, 'resultats', file), { force: true });
  const checks = [];
  const provenanceCache = new Map();
  const record = async (name, command, work) => {
    let entry;
    const begin = Date.now();
    fs.rmSync(path.join(program.directory, 'resultats', `${name}.log`), { force: true });
    try { entry = { name, command, exit_code: 0, seconds: 0, ...await work() }; }
    catch (error) {
      entry = { name, command, exit_code: 1, passed: false, message: error.message };
      writeResult(program.directory, `${name}.log`, error.message);
    }
    entry.status ??= entry.passed ? 'passed' : 'failed';
    entry.seconds = Math.round((Date.now() - begin) / 10) / 100;
    if (!fs.existsSync(path.join(program.directory, 'resultats', `${name}.log`))) writeResult(program.directory, `${name}.log`, entry.message || entry.status);
    checks.push(entry);
    return entry;
  };
  const contents = files.map((file) => ({ name: file, content: fs.readFileSync(path.join(program.directory, file), 'utf8') }));
  const contract = readJson(path.join(program.directory, 'tache.json'))?.type === 'transactional';
  await record('documentation', 'Titres, sources juridiques des règles, faits justifiés, ouverture des blocs', async () => {
    const errors = contents.flatMap(({ name, content }) => catalaDocumentation(content, { test: /^test_/.test(path.basename(name)), contract }).errors.map((error) => `${name}:${error.line}: ${error.message}`));
    errors.push(...taskErrors(program.directory, files).map((message) => `tache.json:1: ${message}`));
    return { passed: !errors.length, exit_code: errors.length ? 1 : 0, errors };
  });
  await record('premisses', 'Inputs derived from OKF premises', async () => {
    if (contract) return { passed: true, exit_code: 0, message: 'Contrat : les cas de figure posent des hypothèses ; aucune prémisse n’est exigée.' };
    const links = premiseLinks(program.root, program.name);
    const message = `${links.inputs - links.underived}/${links.inputs} input(s) derived from OKF premises; ${links.used}/${links.premises} premise(s) of the case index set an input.`;
    return { passed: !links.errors.length, exit_code: links.errors.length ? 1 : 0, message, errors: links.errors, warnings: links.warnings };
  });
  const missing = (message) => ({ exit_code: null, passed: false, status: 'missing', message });
  const blocked = (message) => ({ exit_code: null, passed: false, status: 'blocked', message });
  const execution = async () => {
    const typed = await record('typecheck', 'clerk typecheck', async () => {
      if (!context.pack) return missing('Pack Catala absent.');
      const { entry, result } = await check(context, program.directory, 'typecheck', 'clerk', TYPECHECK, (outcome) => outcome.code === 0 && !/\[WARNING\]/.test(`${outcome.stdout}${outcome.stderr}`));
      return entry.passed ? entry : { ...entry, errors: compilerErrors(`${result.stdout}${result.stderr}`).flatMap(moduleNameFix) };
    });
    await record('format', 'catala-format', async () => {
      if (!context.pack) return missing('Pack Catala absent.');
      if (!typed.passed) return blocked('Compilation non validée.');
      writeResult(program.directory, 'format.log', formatted.log);
      return { passed: !formatted.failed.length, exit_code: formatted.failed.length ? 1 : 0, files: formatted.failed, message: formatted.rewritten.length ? `reformatés : ${formatted.rewritten.join(', ')}` : '' };
    });
    const tests = files.filter((file) => isTestFile(program.directory, file));
    let scopes = [];
    await record('tests', 'clerk runtest + clerk report', async () => {
      if (!typed.passed) return blocked('Compilation non validée.');
      if (!tests.length) return missing('Aucun scénario #[test].');
      const tested = await clerkTests(context, program, tests);
      scopes = tested.scopes;
      const failed = scopes.filter((scope) => !scope.success);
      const errors = failed.flatMap((scope) => (scope.errors || []).map((error) => `${scope.file}:${error.location?.range?.start?.line ?? '?'} › ${scope.scope_name} : ${error.message}`));
      const empty = tests.flatMap((file) => testsWithoutAssertion(fs.readFileSync(path.join(program.directory, file), 'utf8')).map(({ scope, line }) => `${file}:${line} › ${scope} : test sans assertion, il réussit toujours. Ajoutez une assertion sur le résultat attendu.`));
      errors.push(...empty);
      return { ...tested.entry, passed: tested.entry.passed && !empty.length, message: failed.map((scope) => `${scope.file} › ${scope.scope_name}`).join(', '), ...(errors.length ? { errors: errors.slice(0, 8) } : {}) };
    });
    await record('tests-python', 'clerk run --backend=python + python --test', async () => {
      if (!typed.passed) return blocked('Compilation non validée.');
      if (!context.python || !tests.length) return missing(!context.python ? 'Python partagé absent.' : 'Aucun scénario #[test].');
      return pythonTests(context, program, tests);
    });
    await record('preuve', 'catala dependency-graph + catala proof', async () => {
      if (!typed.passed) return blocked('Compilation non validée.');
      if (!context.pack.proof) return missing('Preuve indisponible dans ce pack.');
      const reports = [], logs = [];
      for (const file of files.filter((file) => !isTestFile(program.directory, file))) {
        try {
          const listed = await check(context, program.directory, 'champs', 'catala', ['dependency-graph', '--color=never', '-I', '.', file]);
          if (!listed.entry.passed) throw new Error(listed.result.stderr || 'Inventaire des champs échoué.');
          const names = Object.values(JSON.parse(listed.result.stdout).inter_scopes.nodes);
          if (!names.length) throw new Error('Aucun champ à prouver.');
          for (const scope of names) {
            try {
              await preuve(context, program, { fichier: file, scope });
              reports.push(readJson(path.join(program.directory, 'resultats', 'preuve.json')));
              logs.push(fs.readFileSync(path.join(program.directory, 'resultats', 'preuve.log'), 'utf8'));
            } catch (error) { reports.push({ fichier: file, scope, passed: false, checks: [], obligations: 0, conflits: 0, error: error.message }); logs.push(`${file} › ${scope}: ${error.message}`); }
          }
        } catch (error) { reports.push({ fichier: file, scope: '', passed: false, checks: [], obligations: 0, conflits: 0, error: error.message }); logs.push(`${file}: ${error.message}`); }
      }
      const report = { started_utc: started, finished_utc: context.now(), programme: program.name, fichier: 'Fichiers métier', scope: `${reports.length} champ(s)`, passed: reports.length > 0 && reports.every((item) => item.passed), obligations: reports.reduce((n, item) => n + item.obligations, 0), conflits: reports.reduce((n, item) => n + item.conflits, 0), vides: reports.reduce((n, item) => n + (item.vides ?? 0), 0), non_couvertes: reports.reduce((n, item) => n + (item.non_couvertes ?? 0), 0), checks: reports.flatMap((item) => item.checks), scopes: reports, sources_sha256: digest };
      writeResult(program.directory, 'preuve.json', report);
      writeResult(program.directory, 'preuve.log', logs.join('\n'));
      const failures = reports.filter((item) => !item.passed).map((item) => `${item.fichier}${item.scope ? ` › ${item.scope}` : ''} : ${item.error ?? item.checks[0].message}`);
      return { passed: report.passed, message: failures.join(' · ') || reports.map((item) => item.checks[0].message).filter(Boolean).join(' '), ...(!reports.length ? missing('Aucun champ métier à prouver.') : {}) };
    });
    await record('explication', 'catala explain', async () => {
      if (!typed.passed) return blocked('Compilation non validée.');
      const scenarios = [], logs = [];
      for (const scope of scopes) {
        const matching = tests.filter((file) => path.basename(file) === scope.file);
        if (matching.length !== 1) continue;
        const trace = await explainScenario(context, program, matching[0], scope.scope_name, provenanceCache);
        scenarios.push({ ...trace.report, test_reussi: scope.success, graphe: trace.graphe, message: trace.message });
        logs.push(`${matching[0]} › ${scope.scope_name}\n${trace.message || 'Graphe calculé.'}`);
      }
      writeResult(program.directory, 'scenarios.json', { sources_sha256: digest, scenarios });
      writeResult(program.directory, 'explication.log', logs.join('\n'));
      const valid = scenarios.filter((scenario) => scenario.test_reussi && scenario.passed);
      const selected = valid.find((scenario) => scenario.scope === previous?.scope && scenario.fichier === previous?.fichier) ?? valid[0];
      const crashed = scenarios.filter((scenario) => scenario.test_reussi && !scenario.passed);
      if (!selected && crashed.length) return { passed: false, exit_code: 1, message: 'catala explain échoue sur un scénario dont le test réussit.', errors: crashed.map(explainFailure) };
      if (!selected) return blocked('Aucun scénario réussi identifiable pour expliquer son exécution.');
      const { graphe, message, test_reussi, ...report } = selected;
      writeResult(program.directory, 'explication.json', report);
      writeResult(program.directory, 'explication.dot', graphe);
      return { passed: scenarios.every((scenario) => scenario.passed), message: scenarios.filter((scenario) => !scenario.passed).map((scenario) => `${scenario.fichier} › ${scenario.scope}`).join(', ') };
    });
  };
  await Promise.all([
    execution(),
    record('catleg', 'catleg check-expiry', async () => {
      if (!context.python || !context.credentials) return missing(!context.python ? 'Python partagé absent.' : 'Identifiants PISTE absents.');
      await catleg(context, program, { au: flags.au });
      const report = readJson(path.join(program.directory, 'resultats', 'catleg.json'));
      return { passed: report.passed, message: report.fichiers.filter((file) => !file.passed && !file.skipped).flatMap((file) => file.messages).join(' · ') };
    }),
    record('citations', 'Contrôle des citations PieceMaker', async () => {
      if (!context.citations) return missing('Contrôle de citations indisponible : serveur PieceMaker requis.');
      if (cited.error) throw cited.error;
      const report = contract && !cited.results?.length ? { ...cited, passed: true, status: 'passed', message: 'Aucun texte externe cité : les clauses figurent dans le programme.' } : cited;
      writeResult(program.directory, 'citations.json', { ...report, sources_sha256: digest, started_utc: started, finished_utc: context.now() });
      return { passed: report.passed, status: report.status, message: [report.message, ...(report.warnings ?? []), ...(report.results ?? []).flatMap((result) => result.mention ? [`${result.label || result.target} : ${result.mention}`] : [])].join(' · ') };
    }),
  ]);
  const changed = digest !== sourcesDigest(program.directory, sourceFiles(program.directory));
  if (changed) { checks.push({ name: 'sources', command: '', exit_code: 1, seconds: 0, passed: false, status: 'blocked', message: 'Code modifié pendant la vérification : relancez verifier.' }); writeResult(program.directory, 'explication.dot', ''); }
  const order = ['documentation', 'premisses', 'typecheck', 'format', 'tests', 'tests-python', 'preuve', 'catleg', 'citations', 'explication', 'sources'];
  checks.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, passed: checks.every((entry) => entry.passed), sources_sha256: digest, checks };
  writeResult(program.directory, 'verification.json', report);
  const labels = { passed: 'ok', failed: 'échec', blocked: 'bloqué', missing: 'non effectué' };
  return [`Programme ${program.name} : ${report.passed ? 'vérifié' : 'à corriger'}.`, ...checks.map((entry) => `- ${entry.name} : ${labels[entry.status]}${entry.message ? ` — ${entry.message}` : ''}${entry.files?.length ? ` (${entry.files.join(', ')})` : ''}${entry.errors?.length ? `\n  ${entry.errors.join('\n  ')}` : ''}${entry.warnings?.length ? `\n  ${entry.warnings.join('\n  ')}` : ''}`), `Détail : .piecemaker/catala/${program.name}/resultats/`].join('\n');
}

async function formatSources(context, program, files) {
  const failed = [], rewritten = [], logs = [];
  for (const file of files) {
    const before = fs.readFileSync(path.join(program.directory, file), 'utf8');
    const { result } = await check(context, program.directory, 'format', 'catala-format', ['--in-place', file]);
    if (result.code !== 0) failed.push(file);
    else if (fs.readFileSync(path.join(program.directory, file), 'utf8') !== before) rewritten.push(file);
    logs.push(`${file}:\n${result.code !== 0 ? result.stdout + result.stderr : rewritten.includes(file) ? 'Reformaté.' : 'Conforme.'}`);
  }
  return { failed, rewritten, log: logs.join('\n') };
}

async function formater(context, program) {
  const { failed, rewritten, log } = await formatSources(context, program, sourceFiles(program.directory));
  if (failed.length) throw new Error(`catala-format a échoué sur ${failed.join(', ')} :\n${log}`);
  return rewritten.length ? `Formatés : ${rewritten.join(', ')}.` : 'Déjà formatés.';
}

function defaultProofFile(program) {
  const files = sourceFiles(program.directory).filter((file) => !isTestFile(program.directory, file));
  if (files.length !== 1) throw new TypeError(`Indiquez --fichier parmi : ${sourceFiles(program.directory).join(', ')}.`);
  return files[0];
}

function proofWarnings(output) {
  const blocks = [];
  let open = null;
  for (const line of output.split('\n')) {
    if (line.includes('[WARNING]')) blocks.push(open = [`│  ${line.replace(/^.*\[WARNING\][─\s]*/, '')}`]);
    else if (/^\s*└─/.test(line)) open = null;
    else if (open) open.push(line);
  }
  return blocks.map((block) => {
    const text = block.map((line) => line.match(/^\s*│ {2}(\S.*)$/)?.[1]).filter(Boolean).join(' ').replace(/:$/, '');
    const place = block.join('\n').match(/─➤ (\S+?):(\d+)\./);
    const example = block.map((line) => line.match(/^\s*--> (.*)$/)?.[1]).filter(Boolean).map((value) => value.replace(' : ', ' = '));
    return `${text}${place ? ` (${place[1]}, ligne ${place[2]})` : ''}${example.length ? ` — contre-exemple : ${example.join(', ')}` : ''}`;
  });
}

function explainFailure({ fichier, scope, message }) {
  const place = message.match(/─➤ (\S+?):(\d+)\./);
  const error = message.split('\n').map((line) => line.match(/^\s*│ {2}(\S.*)$/)?.[1] ?? '').join('\n').split(/\n{2,}/).map((text) => text.trim().replace(/\n/g, ' ')).find((text) => text && !/bug in the compiler|Please report/.test(text)) ?? message.trim().split('\n')[0];
  const condition = message.match(/value ø[\s\S]*?(?:contexte|entrée) (\S+) condition/)?.[1];
  const advice = /ø|∅/.test(message) ? `Le scénario laisse une entrée condition sans valeur : écrivez « règle calcul.${condition ?? '<condition>'} non rempli » pour chaque condition fausse.` : 'Lisez resultats/explication.log et réécrivez la règle désignée.';
  return `${fichier} › ${scope}${place ? ` (${place[1]}:${place[2]})` : ''} : ${error} — ${advice}`;
}

function moduleNameFix(line) {
  const [, module, file] = line.match(/Module declared as (\S+), which does not match the file name "([^"]+)"/) ?? [];
  return module ? [line, `— Renommez le fichier « ${file} » en « ${module}.catala_fr » et gardez « > Module ${module} » : un nom de module n'a pas de tiret. Le dossier du programme garde son nom.`] : [line];
}

function uncoveredNote(variables) {
  return variables.length ? `${variables.length} variable(s) non couverte(s) par Z3 : ${variables.join(', ')}. Les autres obligations sont prouvées.` : '';
}

async function preuve(context, program, flags) {
  if (!context.pack.proof) throw new Error('La preuve n’est pas disponible dans ce pack Catala.');
  if (flags.whole_program) throw new TypeError('Preuve --whole-program refusée : Catala 1.3 peut masquer des conflits dans ce mode.');
  if (!flags.scope || flags.scope === true) throw new TypeError('Indiquez --scope <ChampDApplication>.');
  const file = flags.fichier && flags.fichier !== true ? String(flags.fichier) : defaultProofFile(program);
  const started = context.now();
  const args = ['proof', '--debug', '--color=never', '-I', '.', file, '-s', String(flags.scope)];
  const { entry, result } = await check(context, program.directory, 'preuve', 'catala', args);
  const output = `${result.stdout}${result.stderr}`;
  const obligations = output.split(PROOF_OBLIGATION).length - 1;
  const warnings = proofWarnings(output);
  const uncovered = warnings.map((warning) => warning.match(Z3_UNTRANSLATED)).filter(Boolean).map(([, variable, reason]) => `${variable}${reason ? ` (${reason})` : ''}`);
  const failures = [...warnings.filter((warning) => !Z3_UNTRANSLATED.test(warning)), ...(obligations ? [] : ['aucune obligation produite'])];
  if (!failures.length && !(result.code === 0 && (uncovered.length || result.stdout.includes(PROOF_OK)))) failures.push(`catala proof a échoué (code ${result.code}) : lisez resultats/preuve.log`);
  entry.passed = !failures.length;
  entry.message = failures.join(' ; ') || uncoveredNote(uncovered);
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, fichier: file, scope: String(flags.scope), passed: entry.passed, obligations, conflits: (output.match(/At least two exceptions overlap/g) || []).length, vides: (output.match(/This variable might return an empty error/g) || []).length, non_couvertes: uncovered.length, checks: [entry] };
  writeResult(program.directory, 'preuve.json', report);
  return `Preuve ${file} › ${flags.scope} : ${entry.passed ? `aucune erreur sur les obligations produites.${entry.message ? ` ${entry.message}` : ''}` : `échec — ${entry.message}.`}\n${output.trim()}\nDétail : .piecemaker/catala/${program.name}/resultats/preuve.json`;
}

async function expliquer(context, program, flags) {
  if (!flags.scope || flags.scope === true) throw new TypeError('Indiquez --scope <ChampSansEntrees>.');
  const files = sourceFiles(program.directory);
  const file = flags.fichier && flags.fichier !== true ? String(flags.fichier) : files.length === 1 ? files[0] : null;
  if (!file || !files.includes(file)) throw new TypeError(`Indiquez --fichier parmi : ${files.join(', ')}.`);
  const { report, graphe, message } = await explainScenario(context, program, file, String(flags.scope));
  writeResult(program.directory, 'explication.dot', graphe);
  writeResult(program.directory, 'explication.json', report);
  if (!report.passed) throw new Error(`Explication échouée :\n${message}\nDétail : .piecemaker/catala/${program.name}/resultats/explication.log`);
  return `Explication ${file} › ${flags.scope} : graphe des formules et conditions appliquées.\nGraphe : .piecemaker/catala/${program.name}/resultats/explication.dot`;
}

async function explainScenario(context, program, file, scope, cache) {
  const started = context.now();
  const digest = sourcesDigest(program.directory, sourceFiles(program.directory));
  const { entry, result } = await check(context, program.directory, 'explication', 'catala', ['explain', '--color=never', '--whole-program', '--conditions', '--dot', '-I', '.', file, '-s', scope, '-o', '-']);
  const provenance = await nativeProvenance(context, program, file, scope, cache);
  const dotPassed = entry.passed && /^digraph\s/.test(result.stdout.trim());
  if (!dotPassed && provenance.trace.length) provenance.issues.push('Explication DOT indisponible : graphe issu de la trace JSON et des dépendances Catala.');
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, fichier: file, scope, passed: (dotPassed || provenance.trace.length > 0) && digest === sourcesDigest(program.directory, sourceFiles(program.directory)), sources_sha256: digest, checks: [entry], provenance };
  return { report, graphe: report.passed && dotPassed ? result.stdout : '', message: report.passed ? '' : `${result.stdout}${result.stderr}` || 'Trace indisponible ou sources modifiées pendant le calcul.' };
}

async function nativeProvenance(context, program, file, scope, cache) {
  const cachedCheck = async (name, args) => {
    if (!cache) return check(context, program.directory, name, 'catala', args);
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, check(context, program.directory, name, 'catala', args));
    const cached = await cache.get(key);
    writeResult(program.directory, `${name}.log`, `${cached.result.stdout}${cached.result.stderr}`);
    return cached;
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-catala-trace-'));
  const traceFile = path.join(directory, 'trace.json');
  const data = { trace: [], definitions: [], dependencies: [], issues: [] };
  try {
    const execution = await check(context, program.directory, 'provenance', 'catala', ['interpret', '--color=never', '--whole-program', `--trace=${traceFile}`, '--trace-format=json', '-I', '.', file, '-s', scope]);
    const trace = readJson(traceFile);
    if (!execution.entry.passed || !Array.isArray(trace) || !trace.length) { data.issues.push('Trace JSON Catala indisponible pour ce scénario.'); return data; }
    data.trace = trace;
    const files = sourceFiles(program.directory);
    const declarations = new Map();
    const visit = (events) => {
      for (const event of events) {
        for (const position of [event.pos, event.element?.decl_pos, event.element?.cons_pos]) if (position?.file) position.file = path.resolve(program.directory, position.file);
        if (event.element?.kind === 'scope_call') {
          const declaration = event.element.decl_pos;
          const name = files.find((name) => path.resolve(program.directory, name) === declaration?.file);
          if (name) for (const variable of event.trace ?? []) {
            if (variable.element?.kind !== 'scope_var' || variable.element.input === 'only_input') continue;
            const entry = { fichier: declaration.file, scope: event.element.name, variable: variable.element.name, file: name };
            declarations.set(JSON.stringify([entry.fichier, entry.scope, entry.variable]), entry);
          }
        }
        visit(event.trace ?? []);
      }
    };
    visit(trace);
    for (const name of new Set([...declarations.values()].map((entry) => entry.file))) {
      const listed = await cachedCheck('provenance-dependances', ['dependency-graph', '--color=never', '-I', '.', name]);
      try {
        if (!listed.entry.passed) throw new Error();
        const graph = JSON.parse(listed.result.stdout);
        if (!graph.intra_scopes) throw new Error();
        data.dependencies.push({ fichier: path.resolve(program.directory, name), intra_scopes: graph.intra_scopes });
      } catch { data.issues.push(`Dépendances Catala indisponibles pour ${name}.`); }
    }
    for (const declaration of declarations.values()) {
      const result = await cachedCheck('provenance-definitions', ['exceptions', '--color=never', '--output-format=json', '-I', '.', declaration.file, '-s', declaration.scope, '-v', declaration.variable]);
      try {
        if (!result.entry.passed) throw new Error();
        const definitions = JSON.parse(result.result.stdout);
        if (!Array.isArray(definitions.trees)) throw new Error();
        data.definitions.push({ fichier: declaration.fichier, ...definitions });
      } catch { data.issues.push(`Définitions Catala indisponibles pour ${declaration.scope}.${declaration.variable}.`); }
    }
    return data;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function chosenFile(program, flags, fallback) {
  const files = sourceFiles(program.directory);
  const file = flags.fichier && flags.fichier !== true ? String(flags.fichier) : fallback();
  if (!files.includes(file)) throw new TypeError(`Indiquez --fichier parmi : ${files.join(', ')}.`);
  return file;
}

function requireScope(flags, hint = 'ChampDApplication') {
  if (!flags.scope || flags.scope === true) throw new TypeError(`Indiquez --scope <${hint}>.`);
  return String(flags.scope);
}

async function exceptions(context, program, flags) {
  const scope = requireScope(flags);
  if (!flags.variable || flags.variable === true) throw new TypeError('Indiquez --variable <nom>.');
  const file = chosenFile(program, flags, () => defaultProofFile(program));
  const { entry, result } = await check(context, program.directory, 'exceptions', 'catala', ['exceptions', '--color=never', '-I', '.', file, '-s', scope, '-v', String(flags.variable)]);
  const output = `${result.stdout}${result.stderr}`;
  if (!entry.passed) throw new Error(`Arbre des exceptions indisponible :\n${compilerErrors(output).join('\n')}`);
  return `Arbre des exceptions ${file} › ${scope}.${flags.variable} :\n${output.trim()}`;
}

async function executer(context, program, flags) {
  const scope = requireScope(flags, 'ChampSansEntrees');
  const files = sourceFiles(program.directory);
  const file = chosenFile(program, flags, () => (files.length === 1 ? files[0] : null));
  const stdlib = context.pack.env?.CATALA_STDLIB ? [`--stdlib=${context.pack.env.CATALA_STDLIB}`] : [];
  const { entry, result } = await check(context, program.directory, 'execution', 'catala', ['interpret', '--color=never', '--message-format=gnu', ...stdlib, '--whole-program', '--trace', '-I', '.', file, '-s', scope]);
  const output = `${result.stdout}${result.stderr}`.trim();
  const lines = output.split('\n');
  const shown = lines.length > 200 ? [...lines.slice(0, 200), `… trace tronquée : ${lines.length - 200} ligne(s) de plus dans resultats/execution.log.`] : lines;
  if (!entry.passed) throw new Error(`Exécution échouée ${file} › ${scope} :\n${shown.join('\n')}`);
  return `Exécution ${file} › ${scope} (trace) :\n${shown.join('\n')}`;
}

async function squelette(context, program, flags) {
  const scope = requireScope(flags);
  const file = chosenFile(program, flags, () => defaultProofFile(program));
  const stdlib = context.pack.env?.CATALA_STDLIB;
  if (!stdlib || !fs.existsSync(stdlib)) throw new Error('Bibliothèque standard Catala introuvable dans le pack.');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-catala-squelette-'));
  try {
    for (const source of sourceFiles(program.directory).filter((name) => !isTestFile(program.directory, name))) {
      fs.mkdirSync(path.dirname(path.join(work, source)), { recursive: true });
      fs.copyFileSync(path.join(program.directory, source), path.join(work, source));
    }
    fs.mkdirSync(path.join(work, '_build', 'libcatala'), { recursive: true });
    for (const name of fs.readdirSync(stdlib)) if (SOURCE.test(name)) fs.copyFileSync(path.join(stdlib, name), path.join(work, '_build', 'libcatala', name));
    const generated = await check(context, work, 'squelette', 'catala', ['testcase', 'generate', '--color=never', '--message-format=gnu', '--whole-program', '--default-values', '-I', '.', file, '-s', scope]);
    if (!generated.entry.passed) throw new Error(`Squelette impossible :\n${compilerErrors(`${generated.result.stdout}${generated.result.stderr}`).join('\n')}`);
    const written = await check(context, work, 'squelette', 'catala', ['testcase', 'write', '--color=never', '-l', 'fr'], undefined, generated.result.stdout);
    if (!written.entry.passed) throw new Error(`Squelette impossible :\n${written.result.stdout}${written.result.stderr}`);
    const text = written.result.stdout.split('\n').filter((line) => !/^#\[testcase\./.test(line) && !/éditeur de tests métier/.test(line)).join('\n').replace(/^\n+/, '').replace(/[ \t]+$/gm, '');
    return `Squelette de test pour ${file} › ${scope}, entrées à leur valeur par défaut. Copiez-le dans test_<module>.catala_fr, renommez le champ par scénario, fixez les entrées avec les faits du dossier et ajoutez une assertion par résultat :\n\n${text.trim()}\n`;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const LEGAL_HEADING = /^(#{1,6})\s+(.*?)\s*\|\s*((?:LEGIARTI|JORFARTI)\d{12})\b(.*)$/;

function articleSections(content) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  let fence = '';
  lines.forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) fence = fence ? (marker[1][0] === fence[0] ? '' : fence) : marker[1];
    const heading = !fence && line.match(LEGAL_HEADING);
    if (!heading) return;
    const end = lines.findIndex((other, at) => at > index && /^(#{1,6})\s/.test(other) && other.match(/^#+/)[0].length <= heading[1].length);
    sections.push({ id: heading[3], line: index + 1, label: heading[2].replace(/\[archive\]/gi, '').trim(), archive: /\[archive\]/i.test(line), text: lines.slice(index + 1, end < 0 ? lines.length : end).join('\n') });
  });
  return sections;
}

const normalizedNumber = (value) => String(value).replace(/\[archive\]/gi, '').replace(/^\s*article\s*/i, '').replace(/[\s.]/g, '').toLowerCase();

async function wholeText(context, program, file, content, credentials) {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!LEGAL_HEADING.test(line)) return;
    let start = index + 1;
    for (;;) {
      while (start < lines.length && !lines[start].trim()) start++;
      if (!lines[start]?.trim().startsWith('«')) return;
      for (; start < lines.length; start++) {
        const closed = lines[start].includes('»');
        lines[start] = '';
        if (closed) break;
      }
    }
  });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-catleg-'));
  const copy = path.join(work, path.basename(file));
  try {
    fs.writeFileSync(copy, lines.join('\n'));
    const result = await context.run(context.python, ['-I', '-c', 'import sys; from catleg.catleg import main; sys.argv[0]="catleg"; main()', 'diff', copy], { cwd: program.directory, env: { ...context.env, ...credentials } });
    const raw = `${result.stdout}${result.stderr}`;
    const output = raw.replace(/\u001b\[[0-9;]*m/g, '');
    if (result.code !== 0) return [`texte intégral non comparé : ${/git/i.test(output) ? 'git introuvable sur ce poste' : output.trim().split('\n').at(-1) || 'catleg diff a échoué'}.`];
    const found = [...raw.matchAll(/^((?:LEGIARTI|JORFARTI)\d{12})\n[^\n]*:(\d+)\n([\s\S]*?)(?=^(?:LEGIARTI|JORFARTI)\d{12}\n|^Found \d+ articles|(?![\s\S]))/gm)];
    const missing = [...output.matchAll(/Could not retrieve article '([^']+)'/g)].map((match) => `${match[1]} : texte officiel indisponible pour la comparaison.`);
    const fragments = (block, color) => [...block.matchAll(new RegExp(`\\u001b\\[${color}m([^\\u001b]*)`, 'g'))].map((match) => match[1].trim()).filter(Boolean);
    const differences = found.flatMap((match) => {
      const written = fragments(match[3], 31);
      const official = fragments(match[3], 32);
      if ((written.length || official.length) && written.join('').replace(/\s/g, '') === official.join('').replace(/\s/g, '')) return [];
      const detail = written.length || official.length ? `écrit « ${written.join(' … ')} », officiel « ${official.join(' … ')} »` : match[3].replace(/\u001b\[[0-9;]*m/g, '').trim();
      return [`${file}:${Number(match[2]) + 1}: ${match[1]} : le texte recopié diffère du texte officiel (NOTA compris) : ${detail}`];
    });
    return [...differences, ...missing];
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function articleResponse(context, cwd, id) {
  const cached = cachedArticle(context.env, context.homeDir, id);
  if (cached) return { code: 0, stdout: JSON.stringify(cached) };
  const response = await context.run(context.python, ['-I', '-c', 'import sys; from catleg.catleg import main; sys.argv[0]="catleg"; main()', 'lf', 'article', id], { cwd, env: { ...context.env, ...context.credentials } });
  try { if (response.code === 0) keepArticle(context.env, context.homeDir, id, JSON.parse(response.stdout)); } catch {}
  return response;
}

async function catleg(context, program, flags) {
  const python = context.python;
  if (!python) throw new Error('Python partagé de PieceMaker introuvable (config.json › pythonPath).');
  const credentials = context.credentials;
  if (!credentials) throw new Error('Identifiants PISTE absents : configurez Légifrance dans PieceMaker (~/.config/mcp-legifrance/.env).');
  const files = flags.fichier && flags.fichier !== true ? [String(flags.fichier)] : sourceFiles(program.directory);
  if (files.some((file) => !sourceFiles(program.directory).includes(file))) throw new Error('Fichier Catala absent du programme.');
  const { date, origine, libelle: origineLibelle } = vigueurOf(context, program, flags);
  const dates = [date];
  const started = context.now();
  const results = [];
  for (const file of files) {
    const inspect = 'import json,sys; from catleg.parse_catala_markdown import parse_catala_file; from pathlib import Path; f=Path(sys.argv[2]); articles=parse_catala_file(f.open(), file_path=f); print("PIECEMAKER_ARTICLES="+json.dumps([{"id":a.id.upper(),"archive":a.is_archive} for a in articles]),flush=True); from catleg.catleg import main; sys.argv[0]="catleg"; main() if articles else None';
    const result = await context.run(python, ['-I', '-c', inspect, 'check-expiry', file], { cwd: program.directory, env: { ...context.env, ...credentials } });
    const output = `${result.stdout}${result.stderr}`;
    if (/No module named '?catleg/.test(output)) throw new Error(`catleg absent du Python partagé (${python}) : mettez à jour l'app PieceMaker.`);
    const marker = /^PIECEMAKER_ARTICLES=(.+)$/m.exec(output);
    let articles = [];
    try { articles = JSON.parse(marker?.[1] ?? '[]'); } catch {}
    const content = fs.readFileSync(path.join(program.directory, file), 'utf8');
    const sections = articleSections(content);
    const cited = [...new Set(sections.map((section) => section.id))];
    const checked = [...new Set([...articles.map((article) => article.id), ...cited])];
    const messages = output.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('PIECEMAKER_ARTICLES='));
    const differences = cited.length ? await wholeText(context, program, file, content, credentials) : [];
    messages.push(...differences);
    if (!checked.length) messages.push('Aucun article contrôlé : aucun titre d’article reconnu.');
    const versions = [];
    for (const id of checked) {
      const response = await articleResponse(context, program.directory, id);
      try {
        const reply = JSON.parse(response.stdout);
        const article = reply.article;
        const official = (value) => typeof value === 'number' ? new Date(value).toISOString().slice(0, 10) : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
        const debut = official(article?.dateDebut), fin = official(article?.dateFin);
        if (response.code !== 0 || article?.id !== id || !debut || !fin) throw new Error('Période officielle indisponible');
        const own = sections.filter((section) => section.id === id);
        const number = normalizedNumber(article?.num ?? '');
        if (!number) messages.push(`${id} : numéro officiel absent, vérifiez le titre à la main.`);
        for (const section of own) if (number && normalizedNumber(section.label) !== number) messages.push(`${id} : le titre « ${section.label} » ne correspond pas à l'article ${article.num}.`);
        const numbered = !number || own.every((section) => normalizedNumber(section.label) === number);
        for (const at of dates) {
          const bounded = fin < '2999-01-01' && own.some((section) => section.text.includes(`|${debut}|`) && section.text.includes(`|${fin}|`));
          const valide = numbered && ((debut <= at && at < fin) || bounded);
          versions.push({ id, au: at, debut, fin: fin >= '2999-01-01' ? null : fin, valide });
          messages.push(`${id} : période officielle ${debut} → ${fin >= '2999-01-01' ? 'sans fin publiée' : fin} ; ${valide ? 'couvre' : 'ne couvre pas'} le ${at}. Applicabilité juridique à justifier séparément.`);
        }
      } catch {
        for (const at of dates) versions.push({ id, au: at, valide: null });
        messages.push(`${id} : période officielle non obtenue pour le ${dates.join(', ')}.`);
      }
    }
    const skipped = Boolean(marker) && !cited.length && !articles.length;
    results.push({ fichier: file, exit_code: result.code, passed: Boolean(marker) && checked.length > 0 && versions.every((version) => version.valide === true) && !differences.length && !/Could not retrieve article/.test(output), skipped, articles: checked, versions, messages });
  }
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, date_controle: started.slice(0, 10), dates_reference: dates, origine_date: origine, passed: results.some((entry) => entry.articles.length) && results.filter((entry) => !entry.skipped).every((entry) => entry.passed), fichiers: results };
  writeResult(program.directory, 'catleg.json', report);
  const lines = results.map((entry) => `- ${entry.fichier} : ${entry.skipped ? 'sans article cité, non contrôlé' : entry.passed ? `${entry.articles.length} article(s) contrôlé(s), en vigueur au ${dates.join(', ')}` : 'à revoir'}${entry.passed ? '' : `\n  ${entry.messages.join('\n  ')}`}`);
  return [`catleg (vigueur au ${dates.join(', ')}, ${origineLibelle}) :`, ...lines, `Détail : .piecemaker/catala/${program.name}/resultats/catleg.json`].join('\n');
}

const SECTION_SOURCE = /^(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d{12}$/;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const plainText = (value) => value.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (entity, decimal, hex, name) => decimal ? String.fromCodePoint(Number(decimal)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[name.toLowerCase()] ?? entity);
const paragraphs = (html, text) => plainText(html || text || '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
const wrapped = (paragraph) => paragraph.split(' ').reduce((lines, word) => {
  if (lines.length && `${lines.at(-1)} ${word}`.length <= 80) lines[lines.length - 1] += ` ${word}`;
  else lines.push(word);
  return lines;
}, []).join('\n');

async function officialSource(context, cwd, id) {
  if (/^(?:LEGIARTI|JORFARTI)/.test(id)) {
    if (!cachedArticle(context.env, context.homeDir, id) && (!context.python || !context.credentials)) throw new Error(`${id} absent du cache local : lisez l'article avec consulter_article (MCP legifrance), puis relancez.`);
    const response = await articleResponse(context, cwd, id);
    let article;
    try { article = JSON.parse(response.stdout).article; } catch {}
    if (response.code !== 0 || article?.id !== id || !article?.texte) throw new Error(`${id} introuvable sur Légifrance : vérifiez l'identifiant ou lisez l'article avec consulter_article (MCP legifrance).`);
    const nota = paragraphs(article.notaHtml, article.nota);
    return { titre: article.num ? `Article ${article.num}` : '', paragraphes: [...paragraphs(article.texteHtml, article.texte), ...(nota.length ? ['NOTA :', ...nota] : [])] };
  }
  const entry = cachedDecision(context.env, context.homeDir, id);
  if (!entry) throw new Error(`${id} absent du cache local : lisez la décision avec consulter_decision (MCP legifrance), puis relancez.`);
  return { titre: entry.titre, paragraphes: paragraphs(entry.reponse?.text?.texteHtml, entry.texte) };
}

async function section(context, program, flags) {
  const id = typeof flags.source === 'string' ? flags.source.trim() : '';
  if (!SECTION_SOURCE.test(id)) throw new TypeError('Indiquez --source LEGIARTI…, JORFARTI…, JURITEXT…, CETATEXT… ou CONSTEXT… : le préfixe suivi de 12 chiffres.');
  const extrait = typeof flags.extrait === 'string' ? flags.extrait.replace(/\s+/g, ' ').replace(/^[\s«]+|[\s»]+$/g, '') : '';
  if (!extrait) throw new TypeError('Indiquez --extrait "passage appliqué, recopié mot pour mot".');
  const target = path.resolve(program.directory, typeof flags.fichier === 'string' ? flags.fichier : '');
  const relative = path.relative(program.directory, target);
  const parts = relative.split(path.sep);
  if (!SOURCE.test(target) || path.isAbsolute(relative) || parts.some((part) => part === '..' || IGNORED.has(part) || part.startsWith('.'))) throw new TypeError(`Indiquez --fichier <nom>.catala_fr, dans .piecemaker/catala/${program.name}/ (hors resultats/).`);
  const source = await officialSource(context, program.directory, id);
  const titre = (typeof flags.titre === 'string' ? flags.titre : source.titre || '').replace(/\s+/g, ' ').trim();
  if (!titre || titre.includes('|')) throw new TypeError('Indiquez --titre "…", sans « | » : "Article 1224" ou "Cass. civ. 3e, 1er janvier 2024, n° 00-00.000".');
  const found = verifyQuoteAgainstSource(source.paragraphes.join('\n'), extrait);
  if (!found.verified) throw new Error(`Extrait absent du texte de ${id} : recopiez-le mot pour mot depuis le texte officiel, ou marquez une coupure par « … ».`);
  const quote = (found.source_excerpt ?? extrait).replace(/\s+/g, ' ');
  const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const head = before.trim() ? `${before.replace(/\s*$/, '')}\n\n` : '';
  const line = head ? head.split('\n').length : 1;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${head}## ${titre} | ${id}\n\n« ${quote} »\n\n${source.paragraphes.map(wrapped).join('\n\n')}\n`);
  return `Section ajoutée : .piecemaker/catala/${program.name}/${parts.join('/')}:${line} (${titre} | ${id}).${quote === extrait ? '' : ' Extrait aligné sur le texte officiel.'} Écrivez ensuite son bloc \`\`\`catala sous le texte.`;
}

export async function runCatala({ commande, cwd, programme, flags = {}, args = [], deps = {} }) {
  const env = deps.env || process.env;
  const homeDir = deps.homeDir || os.homedir();
  const found = deps.findPack ? deps.findPack() : findCatalaPack({ env, homeDir });
  const context = {
    ...found,
    env,
    homeDir,
    platform: deps.platform || process.platform,
    run: deps.run || runProcess,
    now: deps.now || (() => new Date().toISOString()),
    python: deps.python !== undefined ? deps.python : sharedPython({ env, homeDir }),
    citations: deps.citations,
    credentials: deps.credentials !== undefined ? deps.credentials : pisteCredentials(homeDir),
  };
  if (commande === 'env') {
    return JSON.stringify({ pack: found.pack, status: found.status, python: context.python, piste: Boolean(context.credentials), programmes: listPrograms(cwd) }, null, 2);
  }
  if (commande === 'lister') {
    const names = listPrograms(cwd);
    if (!names.length) return 'Aucun programme Catala dans .piecemaker/catala/.';
    return names.map((name) => {
      const report = readJson(path.join(programsRoot(cwd), name, 'resultats', 'verification.json'));
      return `${name} : ${report ? `${report.passed ? 'vérifié' : 'à corriger'} le ${report.finished_utc}` : 'jamais vérifié'}`;
    }).join('\n');
  }
  if (commande === 'verifier') { const program = selectProgram(cwd, programme); return verifier(context, { ...program, root: cwd }, flags); }
  if (commande === 'section') return section(context, selectProgram(cwd, programme), flags);
  const pack = requirePack(context);
  if (commande === 'exec') {
    const [tool, ...rest] = args;
    if (!tool) throw new TypeError(`pm catala exec attend un outil : ${CATALA_TOOLS.join(', ')}.`);
    const { command, args: argv } = toolCommand(pack, tool, rest, context.platform, env);
    const result = await context.run(command, argv, { cwd, env: packEnv(pack, env), inherit: true });
    return { exitCode: result.code };
  }
  const program = selectProgram(cwd, programme);
  if (commande === 'formater') return formater(context, program);
  if (commande === 'preuve') return preuve(context, program, flags);
  if (commande === 'catleg') return catleg(context, program, flags);
  if (commande === 'expliquer') return expliquer(context, program, flags);
  if (commande === 'exceptions') return exceptions(context, program, flags);
  if (commande === 'executer') return executer(context, program, flags);
  if (commande === 'squelette') return squelette(context, program, flags);
  throw new TypeError(`pm catala attend ${CATALA_COMMANDS.join(', ')}.`);
}
