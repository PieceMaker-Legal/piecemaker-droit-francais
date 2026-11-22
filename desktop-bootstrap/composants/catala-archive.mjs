import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalaArchiveAsset, catalaRecipe, catalaTools, installCatalaPack } from './catala.mjs';

export const catalaPlugins = ['explain', 'lazy_interpreter', 'proof', 'python', 'testcase'];
export const catalaGrammars = ['catala_en', 'catala_fr', 'catala_pl'];
const SYSTEM_DLL = /^(?:api-ms-win-.+|ext-ms-.+|kernel32|kernelbase|ntdll|advapi32|msvcrt|bcrypt|bcryptprimitives|ole32|oleaut32|shell32|shlwapi|version|ws2_32|user32|gdi32|crypt32|secur32|userenv|rpcrt4|dbghelp|psapi|iphlpapi|ncrypt|winmm|powrprof|synchronization)\.dll$/i;
const SYSTEM_DYLIB = /^(?:\/usr\/lib\/|\/System\/Library\/)/;

export function isSystemDll(name) {
  return SYSTEM_DLL.test(name);
}

export function peImports(buffer) {
  const header = buffer.readUInt32LE(0x3c);
  if (buffer.toString('latin1', header, header + 4) !== 'PE\0\0') throw new Error('Fichier PE invalide.');
  const sections = buffer.readUInt16LE(header + 6);
  const optional = header + 24;
  const table = optional + buffer.readUInt16LE(header + 20);
  const directories = optional + (buffer.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const offset = (rva) => {
    for (let index = 0; index < sections; index += 1) {
      const entry = table + index * 40;
      const start = buffer.readUInt32LE(entry + 12);
      const size = Math.max(buffer.readUInt32LE(entry + 8), buffer.readUInt32LE(entry + 16));
      if (rva >= start && rva < start + size) return rva - start + buffer.readUInt32LE(entry + 20);
    }
    throw new Error(`Adresse PE hors section : ${rva}.`);
  };
  const text = (rva) => {
    const start = offset(rva);
    return buffer.toString('latin1', start, buffer.indexOf(0, start));
  };
  const names = [];
  const imports = buffer.readUInt32LE(directories + 8);
  if (imports) for (let entry = offset(imports); buffer.readUInt32LE(entry + 12); entry += 20) names.push(text(buffer.readUInt32LE(entry + 12)));
  const delayed = buffer.readUInt32LE(directories + 13 * 8);
  if (delayed) for (let entry = offset(delayed); buffer.readUInt32LE(entry + 4); entry += 32) names.push(text(buffer.readUInt32LE(entry + 4)));
  return names;
}

export function grammarRevision(ncl) {
  const revisions = [...new Set([...ncl.matchAll(/rev\s*=\s*"([0-9a-f]{40})"/g)].map((match) => match[1]))];
  if (revisions.length !== 1) throw new Error('Révision des grammaires Catala introuvable dans catala.ncl.');
  return revisions[0];
}

export function grammarCache(platformKey, env = process.env, homeDir = os.homedir()) {
  if (platformKey === 'windows') return path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'topiary', 'cache');
  return path.join(homeDir, 'Library', 'Caches', 'topiary');
}

export function catalaBuildFingerprint(recipe = catalaRecipe) {
  return crypto.createHash('sha256').update(JSON.stringify({ catala: recipe.catala, build: recipe.build })).digest('hex');
}

export function pinArchive(recipe, tag, assets, receipts) {
  const archive = { repository: recipe.archive.repository, tag };
  for (const platformKey of ['macos', 'windows']) {
    const asset = catalaArchiveAsset(platformKey);
    const found = assets.find((entry) => entry.name === asset);
    const sha256 = found?.digest?.replace(/^sha256:/, '');
    if (!found || !/^[0-9a-f]{64}$/.test(sha256 || '')) throw new Error(`${asset} absent de la release ${tag} ou sans empreinte SHA-256.`);
    const receipt = receipts?.[platformKey];
    if (!receipt || receipt.sha256 !== sha256 || receipt.buildFingerprint !== catalaBuildFingerprint(recipe) || receipt.platform !== platformKey || !['version', 'typecheck', 'interpret', 'clerkTest', 'python', 'format', 'proof', 'lsp', 'dap'].every((key) => receipt.checks?.[key])) throw new Error(`Archive ${platformKey} sans contrôle complet correspondant à la recette.`);
    archive[platformKey] = { asset, sha256, size: found.size, verification: receipt };
  }
  return { ...recipe, archive };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} a échoué (${result.status}) : ${`${result.stdout}${result.stderr}`.trim().slice(-2000)}`);
  return result.stdout;
}

function copy(source, target, mode) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(fs.realpathSync(source), target);
  fs.chmodSync(target, mode ?? (fs.statSync(source).mode & 0o111 ? 0o755 : 0o644));
}

function firstExisting(candidates, label) {
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error(`${label} introuvable : ${candidates.filter(Boolean).join(', ')}`);
  return found;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function tarCommand() {
  return process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}

function fetchVerified(url, sha256, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, path.basename(new URL(url).pathname));
  run(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe') : 'curl', ['--fail', '--location', '--silent', '--show-error', '--output', file, url]);
  if (sha256File(file) !== sha256) throw new Error(`Empreinte inattendue pour ${url}.`);
  const extracted = path.join(directory, 'contenu');
  fs.mkdirSync(extracted);
  run(tarCommand(), ['-xf', file, '-C', extracted]);
  return extracted;
}

function stageTools({ platformKey, prefix, stage, ninja, topiary }) {
  const exe = platformKey === 'windows' ? '.exe' : '';
  const bin = path.join(stage, 'bin');
  for (const name of catalaTools) copy(firstExisting([path.join(prefix, 'bin', `${name}${exe}`), path.join(prefix, 'bin', name)], name), path.join(bin, `${name}${exe}`), 0o755);
  copy(ninja, path.join(bin, `ninja${exe}`), 0o755);
  copy(firstExisting([topiary, path.join(prefix, 'bin', '.topiary-wrapped', `topiary${exe}`), path.join(prefix, 'bin', '.topiary-wrapped', 'topiary')], 'topiary'), path.join(bin, '.topiary-wrapped', `topiary${exe}`), 0o755);
  for (const plugin of catalaPlugins) copy(path.join(prefix, 'lib', 'catala', 'plugins', `${plugin}.cmxs`), path.join(stage, 'lib', 'catala', 'plugins', `${plugin}.cmxs`), 0o755);
  const documentation = path.join(prefix, 'doc');
  for (const file of walk(documentation).filter((file) => /^(LICENSE|COPYING|NOTICE)/i.test(path.basename(file)))) copy(file, path.join(stage, 'licenses', path.relative(documentation, file)), 0o644);
  const runtime = path.join(prefix, 'lib', 'catala', 'runtime');
  for (const file of walk(runtime).filter((file) => {
    const relative = path.relative(runtime, file);
    return !relative.includes('__pycache__') && (file.endsWith('.catala_en') || file.endsWith('.catala_fr') || file.endsWith('.catala_pl') || file.endsWith('.py'));
  })) copy(file, path.join(stage, 'lib', 'catala', 'runtime', path.relative(runtime, file)), 0o644);
  for (const file of [['queries', 'catala.scm'], ['configs', 'catala.ncl']]) copy(path.join(prefix, 'share', 'topiary', ...file), path.join(stage, 'share', 'topiary', ...file), 0o644);
}

function stageStdlib({ platformKey, prefix, stage, out }) {
  const work = path.join(out, 'stdlib-build');
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'clerk.toml'), '[project]\nname = "stdlib"\n');
  const env = { ...process.env, PATH: [path.join(prefix, 'bin'), process.env.PATH].join(path.delimiter), NINJA_BIN: path.join(stage, 'bin', platformKey === 'windows' ? 'ninja.exe' : 'ninja') };
  delete env.OPAM_SWITCH_PREFIX;
  run(path.join(prefix, 'bin', platformKey === 'windows' ? 'clerk.exe' : 'clerk'), ['start'], { cwd: work, env });
  for (const file of walk(path.join(work, '_build', 'libcatala', 'ocaml')).filter((file) => file.endsWith('.cmxs'))) copy(file, path.join(stage, 'lib', 'catala', 'runtime', 'ocaml', path.basename(file)), 0o755);
}

function stageGrammars({ platformKey, stage, cache, compilerEnv }) {
  const exe = platformKey === 'windows' ? '.exe' : '';
  const ncl = path.join(stage, 'share', 'topiary', 'configs', 'catala.ncl');
  const revision = grammarRevision(fs.readFileSync(ncl, 'utf8'));
  run(path.join(stage, 'bin', '.topiary-wrapped', `topiary${exe}`), ['prefetch', '-C', ncl], { env: { ...process.env, ...compilerEnv } });
  const extension = platformKey === 'windows' ? 'dll' : 'dylib';
  return catalaGrammars.map((language) => {
    const file = path.join('share', 'topiary', 'grammars', `${language}.${extension}`);
    copy(path.join(cache, language, `${revision}.${extension}`), path.join(stage, file), 0o755);
    return { language, extensions: [language, `${language}.md`], file: file.split(path.sep).join('/') };
  });
}

function machoFiles(stage) {
  return walk(stage).filter((file) => {
    const header = Buffer.alloc(4);
    const descriptor = fs.openSync(file, 'r');
    fs.readSync(descriptor, header, 0, 4, 0);
    fs.closeSync(descriptor);
    return ['cffaedfe', 'cafebabe', 'feedfacf'].includes(header.toString('hex'));
  });
}

function machoId(file) {
  return run('otool', ['-D', file]).split('\n').slice(1).map((line) => line.trim()).find(Boolean) || '';
}

function machoDependencies(file) {
  const own = machoId(file);
  return run('otool', ['-L', file]).split('\n').slice(1).map((line) => line.trim().replace(/ \(compatibility.*$/, '')).filter((dep) => dep && dep !== own);
}

function machoRpaths(file) {
  return [...run('otool', ['-l', file]).matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path (.+) \(offset \d+\)/g)].map((match) => match[1]);
}

function relocateMacos(stage) {
  const lib = path.join(stage, 'lib');
  const queue = machoFiles(stage);
  const done = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (done.has(file)) continue;
    done.add(file);
    for (const dependency of machoDependencies(file)) {
      if (SYSTEM_DYLIB.test(dependency) || dependency.startsWith('@')) continue;
      if (!dependency.startsWith('/')) throw new Error(`Dépendance relative non gérée dans ${file} : ${dependency}`);
      const bundled = path.join(lib, path.basename(dependency));
      if (!fs.existsSync(bundled)) {
        copy(dependency, bundled, 0o755);
        run('install_name_tool', ['-id', `@loader_path/${path.basename(dependency)}`, bundled]);
        queue.push(bundled);
      }
      const relative = path.relative(path.dirname(file), bundled).split(path.sep).join('/');
      run('install_name_tool', ['-change', dependency, `@loader_path/${relative}`, file]);
    }
    for (const rpath of machoRpaths(file)) if (!rpath.startsWith('@')) run('install_name_tool', ['-delete_rpath', rpath, file]);
    if (machoId(file).startsWith('/')) run('install_name_tool', ['-id', `@loader_path/${path.basename(file)}`, file]);
  }
  for (const file of machoFiles(stage)) {
    run('codesign', ['--force', '--sign', '-', file]);
    for (const dependency of machoDependencies(file)) {
      if (SYSTEM_DYLIB.test(dependency)) continue;
      const target = dependency.startsWith('@loader_path/') ? path.resolve(path.dirname(file), dependency.slice('@loader_path/'.length)) : null;
      if (!target || !fs.existsSync(target)) throw new Error(`Dépendance hors archive dans ${path.relative(stage, file)} : ${dependency}`);
    }
    if (machoRpaths(file).length) throw new Error(`LC_RPATH restant dans ${path.relative(stage, file)}.`);
  }
}

function bundleWindowsDlls(stage, directories) {
  const bin = path.join(stage, 'bin');
  const isPe = (file) => /\.(exe|dll|cmxs)$/i.test(file);
  const queue = walk(stage).filter(isPe);
  const done = new Set();
  const missing = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (done.has(file)) continue;
    done.add(file);
    for (const name of peImports(fs.readFileSync(file))) {
      if (isSystemDll(name)) continue;
      const present = fs.readdirSync(bin).find((entry) => entry.toLowerCase() === name.toLowerCase());
      if (present) {
        queue.push(path.join(bin, present));
        continue;
      }
      const source = directories.map((directory) => path.join(directory, name)).find((candidate) => fs.existsSync(candidate));
      if (!source) {
        missing.add(`${name} (${path.relative(stage, file)})`);
        continue;
      }
      copy(source, path.join(bin, name), 0o755);
      queue.push(path.join(bin, name));
    }
  }
  if (missing.size) throw new Error(`DLL introuvables : ${[...missing].join(', ')}`);
}

function opamVar(name) {
  return run('opam', ['var', name]).trim();
}

export function buildCatalaArchive({ platformKey, prefix, out, ninja, topiary, cache, dllDirectories = [], compilerEnv = {}, recipe = catalaRecipe }) {
  const stage = path.join(out, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  stageTools({ platformKey, prefix, stage, ninja, topiary });
  stageStdlib({ platformKey, prefix, stage, out });
  const grammars = stageGrammars({ platformKey, stage, cache, compilerEnv });
  if (platformKey === 'macos') relocateMacos(stage);
  else bundleWindowsDlls(stage, dllDirectories);
  const exe = platformKey === 'windows' ? '.exe' : '';
  const manifest = {
    format: 1,
    platform: platformKey,
    catala: recipe.catala,
    tools: Object.fromEntries([...catalaTools, 'ninja'].map((name) => [name, `bin/${name}${exe}`])),
    runtimePython: 'lib/catala/runtime/python/src',
    topiaryConfig: 'share/topiary/configs/catala.ncl',
    grammars,
  };
  fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const asset = catalaArchiveAsset(platformKey);
  const archive = path.join(out, asset);
  fs.rmSync(archive, { force: true });
  run(tarCommand(), ['-czf', archive, '-C', stage, 'manifest.json', 'bin', 'lib', 'share', 'licenses'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const sha256 = sha256File(archive);
  fs.writeFileSync(`${archive}.sha256`, `${sha256}  ${asset}\n`);
  const extractedSize = walk(stage).reduce((total, file) => total + fs.statSync(file).size, 0);
  return { archive, sha256, size: fs.statSync(archive).size, extractedSize, files: walk(stage).map((file) => path.relative(stage, file).split(path.sep).join('/')).sort() };
}

function opamInstall({ platformKey, topiary, recipe = catalaRecipe }) {
  const { compiler, pins, windowsPins, packages } = recipe.build;
  const env = { ...process.env, OPAMYES: '1', OPAMCONFIRMLEVEL: 'unsafe-yes', OPAMCOLOR: 'never' };
  if (platformKey === 'windows') {
    const root = opamVar('root');
    const cygwin = path.join(root, '.cygwin', 'root');
    const compilerBin = path.join(cygwin, 'bin');
    const pythonAlias = path.join(compilerBin, 'python3.exe');
    if (!fs.existsSync(pythonAlias)) {
      const resolved = run(path.join(compilerBin, 'sh.exe'), ['-lc', 'cygpath -w "$(readlink -f /usr/bin/python3)"']).trim();
      const pythonSource = firstExisting([`${resolved}.exe`, resolved], 'Python Cygwin');
      fs.copyFileSync(pythonSource, pythonAlias);
    }
    Object.assign(env, { CC: 'x86_64-w64-mingw32-gcc', CXX: 'x86_64-w64-mingw32-g++', PATH: [compilerBin, path.join(opamVar('prefix'), 'bin'), env.PATH].join(path.delimiter) });
    const python = run(path.join(compilerBin, 'python3.exe'), ['-c', 'import os; print(os.name)']).trim();
    if (python !== 'posix') throw new Error('La compilation Z3 Windows exige Python Cygwin (posix).');
  }
  if (opamVar('ocaml:version') !== compiler.replace('ocaml-base-compiler.', '')) throw new Error(`Le switch opam doit utiliser ${compiler}.`);
  const opam = (...args) => run('opam', args, { env, stdio: 'inherit' });
  for (const [name, url] of Object.entries({ ...(platformKey === 'windows' ? windowsPins : {}), ...pins })) opam('pin', 'add', '--no-action', '--yes', name, url);
  let list = packages;
  if (platformKey === 'windows') {
    opam('install', '--yes', 'conf-pkg-config');
    copy(topiary, path.join(opamVar('bin'), '.topiary-wrapped', 'topiary.exe'), 0o755);
    const fake = packages.find((name) => name.startsWith('topiary.'));
    opam('install', '--yes', '--fake', fake);
    list = packages.filter((name) => name !== fake && !name.startsWith('dune.'));
  }
  opam('install', '--yes', `--jobs=${os.availableParallelism?.() ?? os.cpus().length}`, ...list);
}

const PROGRAM = `> Module Prime

# Prime d'ancienneté fictive

La Société Exemple SAS verse 100 € par année d'ancienneté. Une faute grave prive le salarié de la prime.

\`\`\`catala-metadata
déclaration champ d'application PrimeAnciennete:
  entrée annees_anciennete contenu entier
  entrée faute_grave condition
  résultat montant contenu argent
\`\`\`

\`\`\`catala
champ d'application PrimeAnciennete:
  étiquette base définition montant égal à 100 € * annees_anciennete
  exception base
  définition montant
  sous condition faute_grave
  conséquence égal à
    0 €
\`\`\`
`;

const TESTS = `> Usage de Prime

\`\`\`catala
#[test]
déclaration champ d'application JeanDupont:
  résultat calcul champ d'application Prime.PrimeAnciennete

champ d'application JeanDupont:
  définition calcul.annees_anciennete égal à 3
  définition calcul.faute_grave égal à faux
  assertion calcul.montant = 300 €
\`\`\`
`;

const CONFLICT = `> Module Conflit

\`\`\`catala-metadata
déclaration champ d'application Prime:
  entrée faute_grave condition
  entrée cadre condition
  résultat montant contenu argent
\`\`\`

\`\`\`catala
champ d'application Prime:
  étiquette base définition montant égal à 100 €
  exception base définition montant sous condition faute_grave conséquence égal à 0 €
  exception base définition montant sous condition cadre conséquence égal à 200 €
\`\`\`
`;

function systemPath() {
  if (process.platform !== 'win32') return ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const root = process.env.SystemRoot || 'C:\\Windows';
  return [path.join(root, 'System32'), root];
}

function lspRequest(body) {
  const text = JSON.stringify(body);
  return `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`;
}

function talk(command, env, messages, expected) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${path.basename(command)} n'a pas répondu : ${output.slice(-500)}`));
    }, 30_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (expected.test(output)) {
        clearTimeout(timer);
        child.kill();
        resolve(output);
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => { clearTimeout(timer); if (!expected.test(output)) reject(new Error(`${path.basename(command)} arrêté (${code}) : ${output.slice(-500)}`)); });
    for (const message of messages) child.stdin.write(lspRequest(message));
  });
}

export async function smokeCatalaPack(packFile, work) {
  const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
  const home = path.join(work, 'Profil vide');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...pack.env, CATALA_STDLIB: path.join(pack.prefix, 'lib', 'catala', 'runtime'), PATH: [...pack.path, ...systemPath()].join(path.delimiter), HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), APPDATA: path.join(home, 'AppData', 'Roaming'), SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(), LANG: 'C.UTF-8' };
  const tool = (name, args, cwd = work) => run(pack.bin[name], args, { cwd, env });
  const results = {};
  results.version = tool('catala', ['--version']).trim();
  if (results.version !== pack.catala.version) throw new Error(`Version Catala inattendue : ${results.version}`);
  const project = path.join(work, 'Dossier Jean Dupont é');
  fs.rmSync(project, { recursive: true, force: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'clerk.toml'), '[project]\nname = "prime"\n');
  fs.writeFileSync(path.join(project, 'prime.catala_fr'), PROGRAM);
  fs.writeFileSync(path.join(project, 'test_prime.catala_fr'), TESTS);
  tool('catala', ['typecheck', '--whole-program', '--check-invariants', 'prime.catala_fr'], project);
  results.typecheck = 'ok';
  results.interpret = tool('catala', ['interpret', '--whole-program', '-I', '.', 'test_prime.catala_fr', '-s', 'JeanDupont'], project).trim().split('\n').slice(-3).join(' ');
  if (!/300/.test(results.interpret)) throw new Error(`Interprétation inattendue : ${results.interpret}`);
  const report = path.join(project, 'tests.json');
  tool('clerk', ['runtest', '--whole-program', `--catala-opts=--stdlib=${env.CATALA_STDLIB}`, `--report=${report}`, '-I', '.', 'test_prime.catala_fr'], project);
  const passed = JSON.parse(tool('clerk', ['report', '--json', report], project))['test-results'].flatMap((entry) => entry.tests.scopes);
  if (!passed.length || passed.some((scope) => !scope.success)) throw new Error('Le scénario valide échoue.');
  fs.writeFileSync(path.join(project, 'test_prime.catala_fr'), TESTS.replace('300 €', '301 €'));
  tool('clerk', ['runtest', '--whole-program', `--catala-opts=--stdlib=${env.CATALA_STDLIB}`, `--report=${report}`, '-I', '.', 'test_prime.catala_fr'], project);
  const failed = spawnSync(pack.bin.clerk, ['report', '--json', report], { cwd: project, env, encoding: 'utf8', windowsHide: true });
  if (!JSON.parse(failed.stdout)['test-results'].some((entry) => entry.tests.scopes.some((scope) => !scope.success))) throw new Error('Une assertion fausse a été acceptée.');
  fs.writeFileSync(path.join(project, 'test_prime.catala_fr'), TESTS);
  results.clerkTest = 'assertion vraie acceptée, assertion fausse refusée';
  tool('clerk', ['run', '--backend=python', '--prepare-only', 'test_prime.catala_fr'], project);
  tool('catala', ['python', '--whole-program', '--autotest', '-I', '.', 'test_prime.catala_fr', '-o', 'test_prime.py'], project);
  if (!fs.readFileSync(path.join(project, 'test_prime.py'), 'utf8').includes('import')) throw new Error('Génération Python vide.');
  results.python = 'ok';
  const formatted = tool('catala-format', ['prime.catala_fr'], project);
  if (!formatted.includes('champ d\'application PrimeAnciennete')) throw new Error('catala-format n\'a pas reformaté le programme.');
  tool('catala-format', ['--in-place', 'prime.catala_fr'], project);
  tool('catala', ['typecheck', '--whole-program', 'prime.catala_fr'], project);
  results.format = 'ok';
  const conflict = path.join(work, 'Conflit');
  fs.rmSync(conflict, { recursive: true, force: true });
  fs.mkdirSync(conflict, { recursive: true });
  fs.writeFileSync(path.join(conflict, 'clerk.toml'), '[project]\nname = "conflit"\n');
  fs.writeFileSync(path.join(conflict, 'conflit.catala_fr'), CONFLICT);
  const proof = spawnSync(pack.bin.catala, ['proof', '--color=never', '-I', '.', 'conflit.catala_fr', '-s', 'Prime'], { cwd: conflict, env, encoding: 'utf8', windowsHide: true });
  const proofText = `${proof.stdout}${proof.stderr}`;
  const positiveRun = spawnSync(pack.bin.catala, ['proof', '--debug', '--color=never', 'prime.catala_fr', '-s', 'PrimeAnciennete'], { cwd: project, env, encoding: 'utf8', windowsHide: true });
  const positive = `${positiveRun.stdout}${positiveRun.stderr}`;
  if (positiveRun.error || positiveRun.status !== 0 || !positive.includes('This verification condition was generated') || !positive.includes('No errors found') || /\[WARNING\]|\[ERROR\]/.test(positive)) throw new Error(`Preuve positive invalide : ${positive.slice(-1500)}`);
  if (proof.error || proof.status !== 0 || !proofText.includes('At least two exceptions overlap') || proofText.includes('[ERROR]')) throw new Error(`La preuve n'a pas détecté le conflit : ${proofText.slice(-1500)}`);
  results.proof = 'programme valide et conflit détecté';
  const lsp = await talk(pack.bin['catala-lsp'], env, [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } }], /"capabilities"/);
  results.lsp = lsp.includes('"capabilities"') ? 'initialize ok' : lsp;
  const dap = await talk(pack.bin['catala-dap'], env, [{ seq: 1, type: 'request', command: 'initialize', arguments: { adapterID: 'catala', clientID: 'piecemaker' } }], /"command"\s*:\s*"initialize"/);
  if (!/"success"\s*:\s*true/.test(dap)) throw new Error(`Initialisation DAP refusée : ${dap.slice(-500)}`);
  results.dap = 'initialize ok';
  return results;
}

function options(argv) {
  const parsed = { dllDirectories: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index].replace(/^--/, '');
    const value = argv[index + 1];
    index += 1;
    if (key === 'dll-dir') parsed.dllDirectories.push(value);
    else parsed[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return parsed;
}

async function main([command, ...argv]) {
  const flags = options(argv);
  const platformKey = flags.platform || (process.platform === 'win32' ? 'windows' : 'macos');
  if (command === 'opam') {
    let topiary = flags.topiary && path.resolve(flags.topiary);
    if (platformKey === 'windows' && !topiary) {
      const source = catalaRecipe.build.topiaryWindows;
      const directory = fetchVerified(source.url, source.sha256, path.join(path.resolve(flags.out), 'topiary'));
      topiary = firstExisting(walk(directory).filter((file) => path.basename(file) === 'topiary.exe'), 'topiary.exe');
    }
    return opamInstall({ platformKey, topiary });
  }
  if (command === 'build') {
    const out = path.resolve(flags.out);
    const tools = path.join(out, 'outils');
    const ninjaSource = catalaRecipe.build.ninja[platformKey];
    const ninja = flags.ninja || path.join(fetchVerified(ninjaSource.url, ninjaSource.sha256, path.join(tools, 'ninja')), platformKey === 'windows' ? 'ninja.exe' : 'ninja');
    const prefix = flags.prefix || opamVar('prefix');
    const compilerEnv = {};
    const dllDirectories = [...flags.dllDirectories];
    if (platformKey === 'windows') {
      const cygwin = path.join(opamVar('root'), '.cygwin', 'root');
      dllDirectories.push(path.join(prefix, 'bin'), path.join(prefix, 'lib', 'stublibs'), path.join(cygwin, 'usr', 'x86_64-w64-mingw32', 'sys-root', 'mingw', 'bin'));
      Object.assign(compilerEnv, { CC: path.join(cygwin, 'bin', 'x86_64-w64-mingw32-gcc.exe'), CXX: path.join(cygwin, 'bin', 'x86_64-w64-mingw32-g++.exe'), PATH: [path.join(cygwin, 'bin'), process.env.PATH].join(path.delimiter) });
    }
    const result = buildCatalaArchive({ platformKey, prefix, out, ninja, topiary: flags.topiary, cache: flags.grammarCache || grammarCache(platformKey), dllDirectories, compilerEnv });
    console.log(JSON.stringify({ ...result, files: result.files.length }, null, 2));
    return;
  }
  if (command === 'verify') {
    const archive = path.resolve(flags.archive);
    const sha256 = sha256File(archive);
    const work = fs.mkdtempSync(path.join(path.resolve(flags.work || os.tmpdir()), 'catala-controle-'));
    const env = { PIECEMAKER_COMPONENTS_HOME: path.join(work, 'Installation Catala é'), PIECEMAKER_CATALA_ARCHIVE: archive, PIECEMAKER_CATALA_ARCHIVE_SHA256: sha256, PATH: systemPath().join(path.delimiter), SystemRoot: process.env.SystemRoot };
    const first = await installCatalaPack({ env });
    if (first.state !== 'pret') throw new Error(`Installation de l’archive : ${JSON.stringify(first)}`);
    const second = await installCatalaPack({ env });
    if (second.state !== 'pret' || second.id !== first.id) throw new Error('Installation non idempotente.');
    const checks = await smokeCatalaPack(path.join(env.PIECEMAKER_COMPONENTS_HOME, 'catala', 'pack.json'), work);
    const receipt = { platform: platformKey, sha256, buildFingerprint: catalaBuildFingerprint(), checks };
    fs.writeFileSync(path.resolve(flags.output), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt, null, 2));
    return;
  }
  if (command === 'smoke') {
    const work = fs.mkdtempSync(path.join(path.resolve(flags.work || os.tmpdir()), 'catala-essai-'));
    console.log(JSON.stringify(await smokeCatalaPack(path.resolve(flags.pack), work), null, 2));
    return;
  }
  if (command === 'pin') {
    const assets = JSON.parse(run('gh', ['release', 'view', flags.tag, '--repo', catalaRecipe.archive.repository, '--json', 'assets'])).assets;
    const recipeFile = fileURLToPath(new URL('./catala-pack.json', import.meta.url));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catala-receipts-'));
    run('gh', ['release', 'download', flags.tag, '--repo', catalaRecipe.archive.repository, '--pattern', 'piecemaker-catala-*.verification.json', '--dir', directory]);
    const receipts = Object.fromEntries(['macos', 'windows'].map((platform) => [platform, JSON.parse(fs.readFileSync(path.join(directory, `piecemaker-catala-${platform}.verification.json`), 'utf8'))]));
    fs.writeFileSync(recipeFile, `${JSON.stringify(pinArchive(catalaRecipe, flags.tag, assets, receipts), null, 2)}\n`);
    console.log(fs.readFileSync(recipeFile, 'utf8'));
    return;
  }
  throw new Error('Usage : catala-archive.mjs opam|build|verify|smoke|pin [options]');
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
