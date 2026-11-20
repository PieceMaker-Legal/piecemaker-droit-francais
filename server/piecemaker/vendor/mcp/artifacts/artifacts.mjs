import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Artifacts d'un dossier : pages HTML publiées par l'agent, avec leurs versions, leurs fichiers
 * annexes et leurs assets. Reprend le contrat de l'outil Artifact de Claude ; l'URL d'un artifact
 * est `piecemaker://artifact/<id>`.
 *
 *   .piecemaker/artifacts/items/<id>/artifact.json        fiche et historique des versions
 *   .piecemaker/artifacts/items/<id>/v/<n>/<chemin>       fichiers publiés de la version n
 *   .piecemaker/artifacts/items/<id>/assets/<asset>.<ext> assets téléversés (communs aux versions)
 */

export const LIMITS = {
  pageBytes: 16 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  binaryBytes: 15 * 1024 * 1024,
  publishFiles: 255,
  publishBytes: 64 * 1024 * 1024,
  versionFiles: 511,
  versionBytes: 256 * 1024 * 1024,
  edits: 64,
  description: 1000,
  label: 60,
  icon: 40,
  listDefault: 25,
  listMax: 200,
};

export const URL_PREFIX = 'piecemaker://artifact/';
export const ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
export const CUSTOM_VIEW_ID = 'vue-personnalisee';
const PUBLISHED_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9 _\-.~@+()/]{1,512}$/;
const ASSET_ID = /^[0-9a-f]{32}$/;
const RESERVED = new Set(['preflight.js']);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.xml': 'application/xml',
};
const TEXT = /^(text\/|application\/(json|xml|javascript))|image\/svg/;

export class ArtifactError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    if (details) this.details = details;
  }
}

const fail = (code, message, details) => { throw new ArtifactError(code, message, details); };

export const contentTypeOf = (file) => TYPES[path.extname(file).toLowerCase()] ?? null;
export const isText = (type) => TEXT.test(String(type || ''));
export const urlOf = (id) => `${URL_PREFIX}${id}`;

/** Un artifact s'adresse par son URL ou son identifiant seul. */
export function idOf(url) {
  const raw = String(url ?? '').trim();
  const id = raw.startsWith(URL_PREFIX) ? raw.slice(URL_PREFIX.length).replace(/\/+$/, '') : raw;
  if (!ID_PATTERN.test(id)) fail('invalid_argument', `"${raw}" is not an artifact link: expected ${URL_PREFIX}<id>.`);
  return id;
}

export function titleOf(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html));
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function slug(text) {
  const base = String(text || 'artifact').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'artifact';
  return /^[a-z]/.test(base) ? base : `a-${base}`;
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function checkPublishedPath(published) {
  if (!PUBLISHED_PATH.test(published) || published.includes('\\')) fail('invalid_argument', `"${published}" is not a valid published path: relative, no leading slash, no "..".`);
  if (RESERVED.has(published)) fail('invalid_argument', `"${published}" is reserved.`);
  if (published === 'index.html') fail('invalid_argument', '"index.html" is the page itself: pass it as file_path.');
  return published;
}

/** Les sources se trouvent dans le dossier, ou dans le dossier temporaire de la machine. */
export function sourceFile(root, source) {
  const resolved = path.resolve(root, String(source));
  const allowed = [path.resolve(root), fs.realpathSync(os.tmpdir()), path.resolve(os.tmpdir())];
  if (!allowed.some((base) => resolved === base || resolved.startsWith(`${base}${path.sep}`))) fail('permission_denied', `"${source}" is outside the case folder.`);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail('not_found', `"${source}" does not exist or is not a file.`);
  if (fs.lstatSync(resolved).isSymbolicLink()) fail('invalid_argument', `"${source}" is a symbolic link.`);
  return resolved;
}

export function artifactProjectFile(root, source) {
  const file = sourceFile(root, source);
  const relative = path.relative(path.resolve(root), file);
  const realRelative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
  const outside = (target) => target === '..' || target.startsWith(`..${path.sep}`) || path.isAbsolute(target);
  if (outside(relative) || outside(realRelative)) fail('permission_denied', 'The artifact source must be inside the project.');
  return relative;
}

/** Applique des remplacements exacts (chacun présent une seule fois), tout ou rien. */
export function applyEdits(content, edits) {
  if (!Array.isArray(edits) || !edits.length) return content;
  if (edits.length > LIMITS.edits) fail('invalid_argument', `at most ${LIMITS.edits} edits.`);
  let next = content;
  edits.forEach(({ old_str: oldText, new_str: newText }, index) => {
    if (typeof oldText !== 'string' || !oldText) fail('invalid_argument', `edit ${index + 1}: old_str is empty.`);
    const count = next.split(oldText).length - 1;
    if (count === 0) fail('invalid_argument', `edit ${index + 1}: old_str is absent from the file. Nothing was changed or published.`);
    if (count > 1) fail('invalid_argument', `edit ${index + 1}: old_str occurs ${count} times; it must occur exactly once. Nothing was changed or published.`);
    next = next.replace(oldText, () => String(newText ?? ''));
  });
  return next;
}

export function openArtifacts(root, { now = () => new Date().toISOString() } = {}) {
  const base = path.join(root, '.piecemaker', 'artifacts', 'items');
  const folder = (id) => path.join(base, id);
  const metaFile = (id) => path.join(folder(id), 'artifact.json');
  const versionFolder = (id, version) => path.join(folder(id), 'v', String(version));
  /** Artifacts lus ou publiés par cette session : une publication ne peut écraser que ceux-là. */
  const seen = new Map();

  function load(id) {
    const file = metaFile(idOf(id));
    if (!fs.existsSync(file)) fail('not_found', `no artifact ${urlOf(id)}.`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  const save = (meta) => writeAtomic(metaFile(meta.id), `${JSON.stringify(meta, null, 2)}\n`);

  function versionOf(meta, ver) {
    if (ver === undefined || ver === null || ver === '') return meta.versions.at(-1);
    const wanted = Number(String(ver).replace(/^v/, ''));
    return meta.versions.find((entry) => entry.version === wanted) ?? fail('not_found', `${urlOf(meta.id)} has no version ${ver}.`);
  }

  function summary(meta) {
    const current = meta.versions.at(-1);
    return {
      url: urlOf(meta.id), id: meta.id, title: meta.title, description: meta.description ?? '', icon: meta.icon ?? null,
      type: meta.type ?? null, pinned: Boolean(meta.pinned), version: current?.version ?? 0, versions: meta.versions.length,
      created_at: meta.created_at, updated_at: meta.updated_at, capabilities: meta.capabilities ?? {},
      ...(meta.document && { format: 'docx' }),
    };
  }

  function ids() {
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).filter((name) => ID_PATTERN.test(name) && fs.existsSync(metaFile(name)));
  }

  function newId(title) {
    for (;;) {
      const id = `${slug(title)}-${randomBytes(3).toString('hex')}`;
      if (!fs.existsSync(folder(id))) return id;
    }
  }

  /** Construit la liste des fichiers de la nouvelle version, sans rien écrire. */
  function stage({ page, files, previous, previousFolder }) {
    const staged = new Map();
    if (previous) for (const file of previous.files) staged.set(file, { from: path.join(previousFolder, file) });
    staged.set('index.html', { content: page });
    let sent = 0;
    for (const [published, source] of Object.entries(files ?? {})) {
      checkPublishedPath(published);
      if (source === null) { staged.delete(published); continue; }
      const from = typeof source === 'string' ? source : source?.from;
      if (typeof from !== 'string') fail('invalid_argument', `files["${published}"]: expected a source path, {from} or null.`);
      const resolved = sourceFile(root, from);
      const type = (typeof source === 'object' && source.contentType) || contentTypeOf(published);
      if (!type) fail('invalid_argument', `files["${published}"]: unknown media type; pass contentType.`);
      if (published.endsWith('.html') && !fs.readFileSync(resolved, 'utf8').trimStart().toLowerCase().startsWith('<!doctype')) {
        fail('invalid_argument', `files["${published}"]: another page is served as is; start it with <!doctype html>.`);
      }
      const size = fs.statSync(resolved).size;
      if (size > (isText(type) ? LIMITS.fileBytes : LIMITS.binaryBytes)) fail('resource_exhausted', `files["${published}"] is over the size limit.`);
      sent += 1;
      staged.set(published, { from: resolved, type });
    }
    if (sent > LIMITS.publishFiles) fail('resource_exhausted', `one publish sends at most ${LIMITS.publishFiles} files.`);
    if (staged.size > LIMITS.versionFiles) fail('resource_exhausted', `a version holds at most ${LIMITS.versionFiles} files; publish the rest in several publishes to the same url.`);
    const total = [...staged.values()].reduce((sum, entry) => sum + (entry.content !== undefined ? Buffer.byteLength(entry.content) : fs.statSync(entry.from).size), 0);
    if (total > LIMITS.versionBytes) fail('resource_exhausted', `a version holds at most ${LIMITS.versionBytes / 1024 / 1024} MB.`);
    return staged;
  }

  function writeVersion(id, version, staged) {
    const target = versionFolder(id, version);
    const temporary = `${target}.tmp-${randomBytes(4).toString('hex')}`;
    try {
      for (const [published, entry] of staged) {
        const file = path.join(temporary, published);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (entry.content !== undefined) fs.writeFileSync(file, entry.content);
        else fs.copyFileSync(entry.from, file);
      }
      fs.renameSync(temporary, target);
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
    const hash = createHash('sha256');
    for (const published of [...staged.keys()].sort()) hash.update(published).update(fs.readFileSync(path.join(target, published)));
    return hash.digest('hex').slice(0, 16);
  }

  function checkText(name, value, max) {
    if (value !== undefined && (typeof value !== 'string' || value.length > max)) fail('invalid_argument', `${name} is a text of at most ${max} characters.`);
  }

  function editableSource(url, expectedVersion, prepare) {
    const id = idOf(url);
    const meta = load(id);
    const current = meta.versions.at(-1);
    if (meta.document) fail('invalid_argument', 'This artifact is a Word document.');
    if (current?.version !== expectedVersion) fail('conflict', 'A newer artifact version is available. Reopen it before editing.');
    if (current.source && /\.html?$/i.test(current.source)) {
      try { return artifactProjectFile(root, current.source); } catch (error) {
        if (!(error instanceof ArtifactError)) throw error;
      }
    }
    const directory = path.resolve(root, 'Artifacts');
    if (prepare && !fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(directory) && fs.realpathSync(directory) !== path.join(fs.realpathSync(root), 'Artifacts')) {
      fail('permission_denied', 'The artifact draft directory must be inside the project.');
    }
    const draft = path.join(directory, `${id}-v${expectedVersion}.html`);
    if (prepare) {
      try {
        fs.copyFileSync(path.join(versionFolder(id, expectedVersion), 'index.html'), draft, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    return artifactProjectFile(root, draft);
  }

  return {
    root,
    folder,
    versionFolder,
    load,
    summary,
    hasDocument(relativePath) {
      return ids().some((id) => {
        try {
          const { document } = load(id);
          return typeof document === 'string' && path.normalize(document) === relativePath;
        } catch {
          return false;
        }
      });
    },
    editableSource,
    updateFromSource(url, expectedVersion) {
      const id = idOf(url);
      const sourcePath = editableSource(id, expectedVersion, false);
      const page = fs.readFileSync(path.resolve(root, sourcePath), 'utf8');
      if (page === fs.readFileSync(path.join(versionFolder(id, expectedVersion), 'index.html'), 'utf8')) return summary(load(id));
      seen.set(id, expectedVersion);
      return this.publish({ url: id, page, sourcePath });
    },
    markSeen(id) { seen.set(id, load(id).versions.at(-1)?.version ?? 0); },

    publishDocument({ filePath, title, description, icon, pin }) {
      const document = artifactProjectFile(root, filePath);
      if (!/\.docx$/i.test(document)) fail('invalid_argument', 'Expected a .docx document.');
      checkText('description', description, LIMITS.description);
      checkText('icon', icon, LIMITS.icon);
      const resolvedTitle = title || path.basename(document, path.extname(document));
      const at = now();
      const meta = {
        id: newId(resolvedTitle), title: resolvedTitle, description, icon, document, pinned: Boolean(pin),
        created_at: at, updated_at: at, versions: [{ version: 1, label: null, published_at: at, files: [] }],
      };
      save(meta);
      return { ...summary(meta), created: true, published_files: [document] };
    },

    /**
     * publish : crée un artifact (sans `url`) ou ajoute une version (avec `url`). `page` est le HTML
     * déjà lu, `edits` appliqués compris ; `files` reprend la carte de l'outil Artifact.
     */
    /** @param {Record<string, any>} options */
    publish({ url, customView, page, files, title, description, icon, label, capabilities, pin, type, force, sourcePath }) {
      checkText('description', description, LIMITS.description);
      checkText('label', label, LIMITS.label);
      checkText('icon', icon, LIMITS.icon);
      if (page !== undefined && Buffer.byteLength(page) > LIMITS.pageBytes) fail('resource_exhausted', `the page is over ${LIMITS.pageBytes / 1024 / 1024} MB.`);
      const at = now();
      if (customView && fs.existsSync(metaFile(CUSTOM_VIEW_ID))) url = CUSTOM_VIEW_ID;
      let meta;
      if (url) {
        const id = idOf(url);
        meta = load(id);
        if (meta.document) fail('invalid_argument', 'Edit this Word artifact in the document editor.');
        const live = meta.versions.at(-1)?.version ?? 0;
        if (!seen.has(id)) {
          seen.set(id, live);
          fail('conflict', `${urlOf(id)} was neither read nor published in this session. Its live version (${live}) is now marked read: build on it (Artifact read url=${urlOf(id)}), merge your changes and publish again.`, { url: urlOf(id), version: live });
        }
        if (seen.get(id) !== live && !force) {
          seen.set(id, live);
          fail('conflict', `${urlOf(id)} changed since you read it: version ${live} is newer. Read it again, merge your changes onto it and publish again (force discards version ${live}, only if the lawyer said so).`, { url: urlOf(id), version: live });
        }
      } else {
        const resolvedTitle = titleOf(page) || title || (sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : '') || 'Artifact';
        meta = { id: customView ? CUSTOM_VIEW_ID : newId(resolvedTitle), title: resolvedTitle, description: '', icon: icon ?? null, type: type ?? null, pinned: false, created_at: at, updated_at: at, capabilities: {}, versions: [] };
      }
      if (page === undefined) {
        if (meta.versions.length) page = fs.readFileSync(path.join(versionFolder(meta.id, meta.versions.at(-1).version), 'index.html'), 'utf8');
        else fail('invalid_argument', 'a first publish needs file_path.');
      }
      const previous = meta.versions.at(-1);
      const staged = stage({ page, files, previous, previousFolder: previous ? versionFolder(meta.id, previous.version) : null });
      const version = (previous?.version ?? 0) + 1;
      const digest = writeVersion(meta.id, version, staged);
      meta.versions.push({ version, label: label ?? null, published_at: at, files: [...staged.keys()].filter((file) => file !== 'index.html').sort(), digest, source: sourcePath ?? null });
      meta.title = titleOf(page) || meta.title || title;
      if (description !== undefined) meta.description = description;
      if (icon !== undefined && (!url || icon)) meta.icon = icon;
      if (capabilities !== undefined) meta.capabilities = capabilities;
      if (pin) meta.pinned = true;
      meta.updated_at = at;
      save(meta);
      seen.set(meta.id, version);
      return { ...summary(meta), created: !url, published_files: ['index.html', ...meta.versions.at(-1).files] };
    },

    /** @param {{ url: string, path?: string, ver?: string | number }} options */
    read({ url, path: published, ver }) {
      const meta = load(idOf(url));
      seen.set(meta.id, meta.versions.at(-1)?.version ?? 0);
      const version = versionOf(meta, ver);
      if (meta.document && (!published || published === meta.document)) {
        const document = artifactProjectFile(root, meta.document);
        return { meta: summary(meta), version: version.version, path: document, file: path.resolve(root, document), type: contentTypeOf(document) };
      }
      if (meta.document) fail('not_found', `No file ${published} in this Word artifact.`);
      if (published && ASSET_ID.test(published)) {
        const asset = (meta.assets ?? []).find((entry) => entry.id === published) ?? fail('not_found', `no asset ${published}.`);
        return { meta: summary(meta), version: version.version, path: published, file: path.join(folder(meta.id), 'assets', asset.file), type: asset.type };
      }
      const file = published && published !== 'index.html' ? checkPublishedPath(published) : 'index.html';
      if (file !== 'index.html' && !version.files.includes(file)) fail('not_found', `${urlOf(meta.id)} has no published file "${file}" in version ${version.version}.`);
      return { meta: summary(meta), version: version.version, label: version.label, path: file, file: path.join(versionFolder(meta.id, version.version), file), type: contentTypeOf(file) ?? 'application/octet-stream' };
    },

    /** @param {{ scope?: string, limit?: number, url?: string, type?: string }} [options] */
    list({ scope = 'mine', limit, url, type } = {}) {
      const max = Math.min(Number(limit) || LIMITS.listDefault, LIMITS.listMax);
      if (scope === 'files' || scope === 'assets' || scope === 'versions') {
        const meta = load(idOf(required(url, 'url', `list scope ${scope}`)));
        if (scope === 'files') return (meta.document ? [meta.document] : ['index.html', ...meta.versions.at(-1).files]).map((file) => ({ path: file, type: contentTypeOf(file) }));
        if (scope === 'assets') return (meta.assets ?? []).map(({ id, file, type: assetType, size }) => ({ id, url: `assets/${file}`, type: assetType, size }));
        return meta.versions.map(({ version, label, published_at: at, files: published, digest }) => ({ version, label, published_at: at, files: published.length + 1, digest })).reverse();
      }
      let items = ids().map(load);
      if (scope === 'pinned') items = items.filter((meta) => meta.pinned);
      if (type) items = items.filter((meta) => meta.type === type);
      return items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, max).map(summary);
    },

    /** @param {{ url: string, path?: string }} options */
    remove({ url, path: assetId }) {
      const meta = load(idOf(url));
      if (assetId) {
        if (!ASSET_ID.test(assetId)) fail('invalid_argument', 'path is an asset id (32 hex characters).');
        const asset = (meta.assets ?? []).find((entry) => entry.id === assetId) ?? fail('not_found', `no asset ${assetId}.`);
        fs.rmSync(path.join(folder(meta.id), 'assets', asset.file), { force: true });
        meta.assets = meta.assets.filter((entry) => entry.id !== assetId);
        meta.updated_at = now();
        save(meta);
        return { url: urlOf(meta.id), deleted_asset: assetId };
      }
      fs.rmSync(folder(meta.id), { recursive: true, force: true });
      seen.delete(meta.id);
      return { url: urlOf(meta.id), deleted: true };
    },

    pin(url, pinned) {
      const meta = load(idOf(url));
      meta.pinned = pinned;
      save(meta);
      return summary(meta);
    },

    uploadAsset(url, source) {
      const meta = load(idOf(url));
      if (meta.document) fail('invalid_argument', 'A Word artifact has no published assets.');
      const resolved = sourceFile(root, source);
      const type = contentTypeOf(resolved);
      if (!type) fail('invalid_argument', `"${source}": not a standard web media type.`);
      if (fs.statSync(resolved).size > (isText(type) ? LIMITS.fileBytes : LIMITS.binaryBytes)) fail('resource_exhausted', `"${source}" is over the size limit.`);
      const id = randomBytes(16).toString('hex');
      const file = `${id}${path.extname(resolved).toLowerCase()}`;
      fs.mkdirSync(path.join(folder(meta.id), 'assets'), { recursive: true });
      fs.copyFileSync(resolved, path.join(folder(meta.id), 'assets', file));
      meta.assets = [...(meta.assets ?? []), { id, file, type, size: fs.statSync(resolved).size, name: path.basename(resolved), at: now() }];
      save(meta);
      return { id, url: `assets/${file}`, type };
    },

    /** Fichier servi pour l'affichage : `assets/<fichier>` ou un fichier publié de la version. */
    servedFile(id, version, published) {
      const meta = load(idOf(id));
      if (meta.document) return null;
      if (published.startsWith('assets/')) {
        const asset = (meta.assets ?? []).find((entry) => `assets/${entry.file}` === published);
        return asset ? { file: path.join(folder(meta.id), 'assets', asset.file), type: asset.type } : null;
      }
      const entry = versionOf(meta, version);
      const name = published || 'index.html';
      if (name !== 'index.html' && !entry.files.includes(name)) return null;
      return { file: path.join(versionFolder(meta.id, entry.version), name), type: contentTypeOf(name) ?? 'application/octet-stream' };
    },
  };
}

export function required(value, name, action) {
  if (value === undefined || value === null || value === '') fail('invalid_argument', `${action} needs "${name}".`);
  return value;
}
