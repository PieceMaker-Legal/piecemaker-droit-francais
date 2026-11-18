import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Bibliothèque de templates d'artifacts (les « Artifact types » de Claude). Deux sources, la
 * seconde l'emporte à nom égal :
 *   1. les templates embarqués (`templates/` à côté de ce fichier), toujours présents ;
 *   2. le clone local du dépôt de templates (`~/.piecemaker/artifacts-templates/`).
 *
 * Un template est un dossier `<nom>/` : `template.json`, la page `index.html`, et les pages à lire
 * d'abord (`read_first`, `README.md` par défaut). Son lien est `piecemaker://template/<nom>`.
 */

export const TEMPLATE_PREFIX = 'piecemaker://template/';
/** Ancien dépôt PieceMaker_Electron, vidé pour servir de bibliothèque ; GitHub redirige après un renommage. */
export const DEFAULT_REPOSITORY = 'https://github.com/PieceMaker-Legal/PieceMaker_Electron.git';
export const INTENTS = ['document', 'slides', 'design', 'other'];
const NAME = /^[a-z][a-z0-9-]{1,63}$/;
const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const GIT_TIMEOUT_MS = 120000;

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export function templateName(link) {
  const raw = String(link ?? '').trim();
  const name = raw.startsWith(TEMPLATE_PREFIX) ? raw.slice(TEMPLATE_PREFIX.length).replace(/\/+$/, '') : raw;
  if (!NAME.test(name)) fail('invalid_argument', `"${raw}" is not a template link: expected ${TEMPLATE_PREFIX}<name>.`);
  return name;
}

function runGit(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout).trim(), stderr: String(stderr || error?.message || '').trim() });
    });
  });
}

export function openTemplates({ home = path.join(os.homedir(), '.piecemaker'), bundled = BUNDLED, git = runGit, env = process.env } = {}) {
  const clone = path.join(home, 'artifacts-templates');
  const configFile = path.join(home, 'artifacts-templates.json');

  function config() {
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch {}
    return {
      repository: env.PIECEMAKER_ARTIFACT_TEMPLATES_REPO || stored.repository || DEFAULT_REPOSITORY,
      branch: env.PIECEMAKER_ARTIFACT_TEMPLATES_BRANCH || stored.branch || 'main',
      last_sync: stored.last_sync ?? null,
    };
  }

  const writeConfig = (changes) => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify({ ...config(), ...changes }, null, 2)}\n`);
  };

  function readFolder(folder, source) {
    const manifest = path.join(folder, 'template.json');
    if (!fs.existsSync(manifest)) return null;
    let data;
    try { data = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { return null; }
    const name = path.basename(folder);
    if (!NAME.test(name) || !fs.existsSync(path.join(folder, data.entry || 'index.html'))) return null;
    return {
      type_url: `${TEMPLATE_PREFIX}${name}`,
      name,
      title: String(data.title || name),
      description: String(data.description || ''),
      intent: INTENTS.includes(data.intent) ? data.intent : 'other',
      icon: data.icon ?? null,
      capabilities: data.capabilities ?? {},
      read_first: Array.isArray(data.read_first) ? data.read_first : fs.existsSync(path.join(folder, 'README.md')) ? ['README.md'] : [],
      entry: data.entry || 'index.html',
      data_files: Array.isArray(data.data_files) ? data.data_files : [],
      source,
      folder,
    };
  }

  function scan(base, source) {
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => readFolder(path.join(base, entry.name), source)).filter(Boolean);
  }

  function all() {
    const byName = new Map();
    for (const template of [...scan(bundled, 'bundled'), ...scan(clone, 'repository')]) byName.set(template.name, template);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const strip = ({ folder, ...template }) => template;

  function find(link) {
    const name = templateName(link);
    return all().find((template) => template.name === name) ?? fail('not_found', `no template ${TEMPLATE_PREFIX}${name}. List them with ArtifactTemplates list.`);
  }

  function fileOf(template, relative) {
    const file = path.resolve(template.folder, String(relative));
    if (!file.startsWith(`${path.resolve(template.folder)}${path.sep}`)) fail('invalid_argument', `"${relative}" is outside the template.`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail('not_found', `${template.type_url} has no file "${relative}".`);
    return file;
  }

  /** Fichiers du template à copier dans un nouvel artifact (tout sauf template.json et les pages à lire). */
  function files(template) {
    const skip = new Set(['template.json', template.entry, ...template.read_first]);
    const walk = (folder) => fs.readdirSync(path.join(template.folder, folder), { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .flatMap((entry) => {
        const relative = folder ? `${folder}/${entry.name}` : entry.name;
        return entry.isDirectory() ? walk(relative) : skip.has(relative) ? [] : [relative];
      });
    return walk('');
  }

  return {
    clone,
    config,
    list({ intent, query } = {}) {
      const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
      return all()
        .filter((template) => !intent || template.intent === intent)
        .filter((template) => words.every((word) => `${template.name} ${template.title} ${template.description}`.toLowerCase().includes(word)))
        .map(strip);
    },
    get(link) { return find(link); },
    describe(link) { return strip(find(link)); },
    read(link, relative) {
      const template = find(link);
      return fs.readFileSync(fileOf(template, relative || template.entry), 'utf8');
    },
    entryFile(link) {
      const template = find(link);
      return fileOf(template, template.entry);
    },
    files,
    fileOf,

    async status() {
      const settings = config();
      const present = fs.existsSync(path.join(clone, '.git'));
      const changes = present ? (await git(['status', '--porcelain'], clone)).stdout : '';
      const head = present ? (await git(['log', '-1', '--format=%h %cs %s'], clone)).stdout : null;
      return { ...settings, clone, cloned: present, head, local_changes: changes ? changes.split('\n') : [], templates: all().map(({ name, source }) => `${name} (${source})`) };
    },

    /** Clone le dépôt, ou le met à jour en avance rapide. Ne touche jamais une modification locale. */
    async sync({ repository, branch } = {}) {
      if (repository) writeConfig({ repository, ...(branch ? { branch } : {}) });
      const settings = config();
      if (!fs.existsSync(path.join(clone, '.git'))) {
        fs.mkdirSync(path.dirname(clone), { recursive: true });
        const result = await git(['clone', '--branch', settings.branch, settings.repository, clone], home);
        if (result.code !== 0) fail('unavailable', `clone of ${settings.repository} failed: ${result.stderr}. Check that the repository exists and that git can reach it (the bundled templates stay available).`);
      } else {
        const result = await git(['pull', '--ff-only', 'origin', settings.branch], clone);
        if (result.code !== 0) fail('unavailable', `update of ${settings.repository} failed: ${result.stderr}`);
      }
      writeConfig({ last_sync: new Date().toISOString() });
      return this.status();
    },

    /**
     * Enregistre un dossier comme template dans le clone local et le commite. Rien ne part : le push
     * est une action à part, à la demande de l'avocat.
     */
    async save({ name, title, description, intent = 'other', icon, from, files: extra = [], readme }) {
      if (!NAME.test(String(name || ''))) fail('invalid_argument', `invalid template name "${name}": lowercase letters, digits and "-".`);
      if (!INTENTS.includes(intent)) fail('invalid_argument', `intent is one of ${INTENTS.join(', ')}.`);
      if (!fs.existsSync(path.join(clone, '.git'))) fail('failed_precondition', 'the templates repository is not cloned yet: run ArtifactTemplates sync first.');
      const target = path.join(clone, name);
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(from.page, path.join(target, 'index.html'));
      for (const { published, file } of extra) {
        fs.mkdirSync(path.dirname(path.join(target, published)), { recursive: true });
        fs.copyFileSync(file, path.join(target, published));
      }
      fs.writeFileSync(path.join(target, 'template.json'), `${JSON.stringify({ title: title || name, description: description || '', intent, icon: icon ?? null, entry: 'index.html', read_first: ['README.md'] }, null, 2)}\n`);
      if (readme || !fs.existsSync(path.join(target, 'README.md'))) fs.writeFileSync(path.join(target, 'README.md'), readme || `# ${title || name}\n\n${description || ''}\n`);
      await git(['add', '--', name], clone);
      const commit = await git(['commit', '-m', `template ${name}`], clone);
      if (commit.code !== 0 && !/nothing to commit/.test(commit.stdout + commit.stderr)) fail('unavailable', `commit failed: ${commit.stderr}`);
      return { ...this.describe(name), committed: commit.code === 0 };
    },

    async push() {
      const settings = config();
      if (!fs.existsSync(path.join(clone, '.git'))) fail('failed_precondition', 'the templates repository is not cloned yet.');
      const result = await git(['push', 'origin', `HEAD:${settings.branch}`], clone);
      if (result.code !== 0) fail('unavailable', `push failed: ${result.stderr}`);
      return { pushed: true, repository: settings.repository, branch: settings.branch, output: result.stderr || result.stdout };
    },
  };
}
