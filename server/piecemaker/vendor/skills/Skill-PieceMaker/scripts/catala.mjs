import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CATALA_COMMANDS = ['env', 'lister', 'verifier', 'formater', 'preuve', 'catleg', 'expliquer', 'exec'];
export const CATALA_TOOLS = ['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap'];
const NAME = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]*$/u;
const NAME_SHAPE = 'minuscules, chiffres et tirets (ex. prime-anciennete)';
const IGNORED = new Set(['_build', '_targets', 'resultats']);
const SOURCE = /\.catala_(?:fr|en|pl)$/;
const PYTHON_PACKAGE = 'pm_python';
const PROOF_OK ='No errors found during the proof mode run.';
const PROOF_OBLIGATION = 'This verification condition was generated';

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

export function sourcesDigest(directory, files) {
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
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(binary)) return { command: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', binary, ...args] };
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

async function clerkTests(context, program, tests) {
  const started = Date.now();
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
  if (summary.report) writeResult(program.directory, 'tests.json', summary.report);
  return { entry: { ...entry, command: 'clerk runtest --whole-program + clerk report --json', seconds: Math.round((Date.now() - started) / 10) / 100, passed: !failed && reports.length === tests.length && entry.passed && summary.scopes.length > 0 && summary.scopes.every((scope) => scope.success) }, scopes: summary.scopes };
}

async function verifier(context, program) {
  const files = sourceFiles(program.directory);
  if (!files.length) throw new TypeError(`Aucun fichier .catala_fr dans .piecemaker/catala/${program.name}/.`);
  const started = context.now();
  const digest = sourcesDigest(program.directory, files);
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
    const tested = await clerkTests(context, program, tests);
    scopes = tested.scopes;
    checks.push(tested.entry);
  } else checks.push({ name: 'tests', command: 'clerk test', exit_code: 1, seconds: 0, passed: false, files: [] });
  if (context.python && tests.length) checks.push(await pythonTests(context, program, tests));
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, passed: checks.every((entry) => entry.passed) && digest === sourcesDigest(program.directory, sourceFiles(program.directory)), sources_sha256: digest, checks };
  writeResult(program.directory, 'verification.json', report);
  const failed = scopes.filter((scope) => !scope.success).map((scope) => `${scope.file} › ${scope.scope_name}`);
  const lines = [`Programme ${program.name} : ${report.passed ? 'vérifié' : 'à corriger'}.`];
  for (const entry of checks) lines.push(`- ${entry.name} : ${entry.passed ? 'ok' : 'échec'}${entry.files?.length ? ` (${entry.files.join(', ')})` : ''}`);
  if (report.sources_sha256 !== sourcesDigest(program.directory, sourceFiles(program.directory))) lines.push('Code modifié pendant la vérification : relancez verifier.');
  if (!tests.length) lines.push('Aucun test : ajoutez un champ d’application #[test].');
  if (scopes.some((scope) => scope.scope_name === 'compilation')) lines.push('Compilation des tests en échec : un module n’expose que ses blocs catala-metadata.');
  if (failed.length) lines.push(`Tests en échec : ${failed.join(', ')}.`);
  if (report.passed) {
    const candidates = scopes.filter((scope) => scope.success && tests.some((file) => path.basename(file) === scope.file));
    const previous = readJson(path.join(program.directory, 'resultats', 'explication.json'));
    const selected = candidates.find((scope) => scope.scope_name === previous?.scope && scope.file === path.basename(previous?.fichier ?? '')) ?? candidates[0];
    const matching = selected ? tests.filter((file) => path.basename(file) === selected.file) : [];
    if (selected && matching.length === 1) {
      try {
        await expliquer(context, program, { fichier: matching[0], scope: selected.scope_name });
        lines.push(`Graphe actualisé : ${matching[0]} › ${selected.scope_name}.`);
      } catch (error) { lines.push(error.message); }
    } else lines.push('Graphe non produit : indiquez un scénario avec pm catala expliquer.');
  } else writeResult(program.directory, 'explication.dot', '');
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
  if (!context.pack.proof) throw new Error('La preuve n’est pas disponible dans ce pack Catala.');
  if (flags.whole_program) throw new TypeError('Preuve --whole-program refusée : Catala 1.3 peut masquer des conflits dans ce mode.');
  if (!flags.scope || flags.scope === true) throw new TypeError('Indiquez --scope <ChampDApplication>.');
  const file = flags.fichier && flags.fichier !== true ? String(flags.fichier) : defaultProofFile(program);
  const started = context.now();
  const args = ['proof', '--debug', '--color=never', '-I', '.', file, '-s', String(flags.scope)];
  const { entry, result } = await check(context, program.directory, 'preuve', 'catala', args, (outcome) => outcome.code === 0 && outcome.stdout.includes(PROOF_OK) && `${outcome.stdout}${outcome.stderr}`.includes(PROOF_OBLIGATION) && !/\[WARNING\]/.test(`${outcome.stdout}${outcome.stderr}`));
  const output = `${result.stdout}${result.stderr}`;
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, fichier: file, scope: String(flags.scope), passed: entry.passed, obligations: output.split(PROOF_OBLIGATION).length - 1, conflits: (output.match(/At least two exceptions overlap/g) || []).length, checks: [entry] };
  writeResult(program.directory, 'preuve.json', report);
  return `Preuve ${file} › ${flags.scope} : ${entry.passed ? 'aucune erreur sur les obligations produites' : 'erreurs, avertissements ou aucune obligation produite'}.\n${output.trim()}\nDétail : .piecemaker/catala/${program.name}/resultats/preuve.json`;
}

async function expliquer(context, program, flags) {
  if (!flags.scope || flags.scope === true) throw new TypeError('Indiquez --scope <ChampSansEntrees>.');
  const files = sourceFiles(program.directory);
  const file = flags.fichier && flags.fichier !== true ? String(flags.fichier) : files.length === 1 ? files[0] : null;
  if (!file || !files.includes(file)) throw new TypeError(`Indiquez --fichier parmi : ${files.join(', ')}.`);
  const started = context.now();
  const digest = sourcesDigest(program.directory, files);
  const { entry, result } = await check(context, program.directory, 'explication', 'catala', ['explain', '--color=never', '--whole-program', '--conditions', '--dot', '-I', '.', file, '-s', String(flags.scope), '-o', '-']);
  const report = { started_utc: started, finished_utc: context.now(), programme: program.name, fichier: file, scope: String(flags.scope), passed: entry.passed && /^digraph\s/.test(result.stdout.trim()) && digest === sourcesDigest(program.directory, sourceFiles(program.directory)), sources_sha256: digest, checks: [entry] };
  writeResult(program.directory, 'explication.dot', report.passed ? result.stdout : '');
  writeResult(program.directory, 'explication.json', report);
  if (!report.passed) throw new Error(`Explication échouée :\n${result.stdout}${result.stderr}\nDétail : .piecemaker/catala/${program.name}/resultats/explication.log`);
  return `Explication ${file} › ${flags.scope} : graphe des formules et conditions appliquées.\nGraphe : .piecemaker/catala/${program.name}/resultats/explication.dot`;
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
  if (commande === 'expliquer') return expliquer(context, program, flags);
  throw new TypeError(`pm catala attend ${CATALA_COMMANDS.join(', ')}.`);
}
