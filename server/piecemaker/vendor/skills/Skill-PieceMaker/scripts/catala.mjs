import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CATALA_COMMANDS = ['env', 'lister', 'verifier', 'formater', 'preuve', 'catleg', 'exec'];
export const CATALA_TOOLS = ['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap'];
const NAME = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]*$/u;
const NAME_SHAPE = 'minuscules, chiffres et tirets (ex. prime-anciennete)';
const IGNORED = new Set(['_build', '_targets', 'resultats']);
const SOURCE = /\.catala_(?:fr|en|pl)$/;
const PYTHON_PACKAGE = 'pm_python';
const PROOF_OK ='No errors found during the proof mode run.';

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

export function sourceFiles(directory, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory() && !IGNORED.has(entry.name) && !entry.name.startsWith('.')) files.push(...sourceFiles(directory, child));
    else if (entry.isFile() && SOURCE.test(entry.name)) files.push(child);
  }
  return files.sort();
}

function sourcesDigest(directory, files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(`${file.split(path.sep).join('/')}\0`).update(fs.readFileSync(path.join(directory, file))).update('\0');
  return hash.digest('hex');
}

function isTestFile(directory, file) {
  return /#\[test\]/.test(fs.readFileSync(path.join(directory, file), 'utf8'));
}

export function toolCommand(pack, name, args, platform = process.platform, env = process.env) {
  const binary = pack.bin[name];
  if (!binary) throw new TypeError(`Outil Catala inconnu : ${name}. Outils : ${CATALA_TOOLS.join(', ')}.`);
  if (platform === 'win32') return { command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', binary, ...args] };
  return { command: binary, args };
}

export function packEnv(pack, env = process.env) {
  return { ...env, ...pack.env, PATH: [...(pack.path || []), env.PATH || ''].join(path.delimiter) };
}

export function runProcess(command, args, { cwd, env, inherit = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
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

async function check(context, directory, name, tool, args, judge = (result) => result.code === 0) {
  const { command, args: argv } = toolCommand(context.pack, tool, args, context.platform, context.env);
  const started = Date.now();
  const result = await context.run(command, argv, { cwd: directory, env: packEnv(context.pack, context.env) });
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
  for (const test of tests) {
    const module = path.basename(test).replace(SOURCE, '').replace(/\W/g, '_');
    const compiled = await check(context, program.directory, 'python-compilation', 'catala', ['python', '--whole-program', '--autotest', test, '-I', '.', '-o', path.join('_build', PYTHON_PACKAGE, `${module}.py`)]);
    if (!compiled.entry.passed) return entry(compiled.entry.exit_code);
    const script = `import runpy, sys; sys.path[:0] = ['_build', ${JSON.stringify(path.join('_build', PYTHON_PACKAGE))}]; runpy.run_module('${PYTHON_PACKAGE}.${module}', run_name='__main__')`;
    const result = await context.run(context.python, ['-I', '-c', script, '--test'], { cwd: program.directory, env: context.env });
    logs.push(`${result.stdout}${result.stderr}`);
    writeResult(program.directory, 'tests-python.log', logs.join('\n'));
    if (result.code !== 0) return entry(result.code);
  }
  return entry(0);
}

async function verifier(context, program) {
  const files = sourceFiles(program.directory);
  if (!files.length) throw new TypeError(`Aucun fichier .catala_fr dans .piecemaker/catala/${program.name}/.`);
  const started = context.now();
  const checks = [];
  checks.push((await check(context, program.directory, 'typecheck', 'clerk', ['typecheck', '--catala-opts=--check-invariants'])).entry);
  const unformatted = [];
  for (const file of files) {
    const { result } = await check(context, program.directory, 'format', 'catala-format', [file]);
    if (result.code !== 0 || result.stdout !== fs.readFileSync(path.join(program.directory, file), 'utf8')) unformatted.push(file);
  }
  checks.push({ name: 'format', command: 'catala-format', exit_code: unformatted.length ? 1 : 0, seconds: 0, passed: !unformatted.length, files: unformatted });
  const tests = files.filter((file) => isTestFile(program.directory, file));
  let scopes = [];
  if (tests.length) {
    const { entry, result } = await check(context, program.directory, 'tests', 'clerk', ['test', '--json', '--code-coverage', ...tests]);
    const summary = testSummary(result.stdout);
    scopes = summary.scopes;
    if (summary.report) writeResult(program.directory, 'tests.json', summary.report);
    checks.push({ ...entry, passed: entry.exit_code === 0 && scopes.length > 0 && scopes.every((scope) => scope.success) });
  } else checks.push({ name: 'tests', command: 'clerk test', exit_code: 1, seconds: 0, passed: false, files: [] });
  if (context.python && tests.length) checks.push(await pythonTests(context, program, tests));
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, passed: checks.every((entry) => entry.passed), sources_sha256: sourcesDigest(program.directory, files), checks };
  writeResult(program.directory, 'verification.json', report);
  const failed = scopes.filter((scope) => !scope.success).map((scope) => `${scope.file} › ${scope.scope_name}`);
  const lines = [`Programme ${program.name} : ${report.passed ? 'vérifié' : 'à corriger'}.`];
  for (const entry of checks) lines.push(`- ${entry.name} : ${entry.passed ? 'ok' : 'échec'}${entry.files?.length ? ` (${entry.files.join(', ')})` : ''}`);
  if (!tests.length) lines.push('Aucun test : ajoutez un champ d’application #[test].');
  if (scopes.some((scope) => scope.scope_name === 'compilation')) lines.push('Compilation des tests en échec : un module n’expose que ses blocs catala-metadata.');
  if (failed.length) lines.push(`Tests en échec : ${failed.join(', ')}.`);
  lines.push(`Détail : .piecemaker/catala/${program.name}/resultats/`);
  return lines.join('\n');
}

async function formater(context, program) {
  const files = sourceFiles(program.directory);
  const changed = [];
  for (const file of files) {
    const before = fs.readFileSync(path.join(program.directory, file), 'utf8');
    const { result } = await check(context, program.directory, 'format', 'catala-format', ['--in-place', file]);
    if (result.code !== 0) throw new Error(`catala-format a échoué sur ${file} :\n${result.stdout}${result.stderr}`);
    if (fs.readFileSync(path.join(program.directory, file), 'utf8') !== before) changed.push(file);
  }
  return changed.length ? `Formatés : ${changed.join(', ')}.` : 'Déjà formatés.';
}

function defaultProofFile(program) {
  const files = sourceFiles(program.directory).filter((file) => !isTestFile(program.directory, file));
  if (files.length !== 1) throw new TypeError(`Indiquez --fichier parmi : ${sourceFiles(program.directory).join(', ')}.`);
  return files[0];
}

async function preuve(context, program, flags) {
  if (!context.pack.proof) throw new Error('catala proof n’est pas fourni sur cette plateforme (Windows : pas de Z3 dans le pack officiel).');
  if (!flags.scope || flags.scope === true) throw new TypeError('Indiquez --scope <ChampDApplication>.');
  const file = flags.fichier && flags.fichier !== true ? String(flags.fichier) : defaultProofFile(program);
  const started = context.now();
  await check(context, program.directory, 'start', 'clerk', ['start']);
  const args = ['proof', '--color=never', ...(flags.whole_program ? ['--whole-program'] : []), '-I', '.', file, '-s', String(flags.scope)];
  const { entry, result } = await check(context, program.directory, 'preuve', 'catala', args, (outcome) => outcome.code === 0 && outcome.stdout.includes(PROOF_OK) && !/\[WARNING\]/.test(`${outcome.stdout}${outcome.stderr}`));
  const output = `${result.stdout}${result.stderr}`;
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, fichier: file, scope: String(flags.scope), passed: entry.passed, conflits: (output.match(/At least two exceptions overlap/g) || []).length, checks: [entry] };
  writeResult(program.directory, 'preuve.json', report);
  return `Preuve ${file} › ${flags.scope} : ${entry.passed ? 'aucune erreur' : 'erreurs ou avertissements'}.\n${output.trim()}\nDétail : .piecemaker/catala/${program.name}/resultats/preuve.json`;
}

async function catleg(context, program, flags) {
  const python = context.python;
  if (!python) throw new Error('Python partagé de PieceMaker introuvable (config.json › pythonPath).');
  const credentials = context.credentials;
  if (!credentials) throw new Error('Identifiants PISTE absents : configurez Légifrance dans PieceMaker (~/.config/mcp-legifrance/.env).');
  const files = flags.fichier && flags.fichier !== true ? [String(flags.fichier)] : sourceFiles(program.directory);
  const started = context.now();
  const results = [];
  for (const file of files) {
    const result = await context.run(python, ['-I', '-c', 'import sys; from catleg.catleg import main; sys.argv[0] = "catleg"; main()', 'check-expiry', file], { cwd: program.directory, env: { ...context.env, ...credentials } });
    const output = `${result.stdout}${result.stderr}`;
    results.push({ fichier: file, exit_code: result.code, passed: result.code === 0 && !/Could not retrieve article/.test(output), messages: output.split('\n').map((line) => line.trim()).filter(Boolean) });
  }
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, date_controle: started.slice(0, 10), passed: results.every((entry) => entry.passed), fichiers: results };
  writeResult(program.directory, 'catleg.json', report);
  const lines = results.map((entry) => `- ${entry.fichier} : ${entry.passed ? 'articles en vigueur ce jour' : 'à revoir'}${entry.passed ? '' : `\n  ${entry.messages.join('\n  ')}`}`);
  return [`catleg (vigueur au ${report.date_controle} seulement) :`, ...lines, `Détail : .piecemaker/catala/${program.name}/resultats/catleg.json`].join('\n');
}

export async function runCatala({ commande, cwd, programme, flags = {}, args = [], deps = {} }) {
  const env = deps.env || process.env;
  const homeDir = deps.homeDir || os.homedir();
  const found = deps.findPack ? deps.findPack() : findCatalaPack({ env, homeDir });
  const context = {
    ...found,
    env,
    platform: deps.platform || process.platform,
    run: deps.run || runProcess,
    now: deps.now || (() => new Date().toISOString()),
    python: deps.python !== undefined ? deps.python : sharedPython({ env, homeDir }),
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
  const pack = requirePack(context);
  if (commande === 'exec') {
    const [tool, ...rest] = args;
    if (!tool) throw new TypeError(`pm catala exec attend un outil : ${CATALA_TOOLS.join(', ')}.`);
    const { command, args: argv } = toolCommand(pack, tool, rest, context.platform, env);
    const result = await context.run(command, argv, { cwd, env: packEnv(pack, env), inherit: true });
    return { exitCode: result.code };
  }
  const program = selectProgram(cwd, programme);
  if (commande === 'verifier') return verifier(context, program);
  if (commande === 'formater') return formater(context, program);
  if (commande === 'preuve') return preuve(context, program, flags);
  if (commande === 'catleg') return catleg(context, program, flags);
  throw new TypeError(`pm catala attend ${CATALA_COMMANDS.join(', ')}.`);
}
