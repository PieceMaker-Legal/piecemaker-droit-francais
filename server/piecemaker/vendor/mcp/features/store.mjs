import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { isView, viewGet, viewList, VIEW_WRITE_HINT } from './vue-dossier.mjs';

export const LIMITS = { bytes: 256 * 1024, depth: 32, documents: 25000, batch: 500, listDefault: 100, listMax: 1000 };
const FEATURE_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const SEGMENT = /^[\p{L}\p{N}_%][\p{L}\p{N}_.%\- ]{0,199}$/u;
const OPERATORS = ['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', 'array-contains-any'];
const LOCK_STALE_MS = 10000;
const LOCK_TIMEOUT_MS = 5000;

export class FeatureDataError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new FeatureDataError(code, message); };

function segmentsOf(feature, docPath, kind) {
  if (!FEATURE_NAME.test(String(feature || ''))) fail('invalid_argument', `invalid feature name "${feature}".`);
  const segments = String(docPath || '').normalize('NFC').split('/');
  for (const segment of segments) {
    if (!SEGMENT.test(segment) || segment === '.' || segment === '..') fail('invalid_argument', `invalid path segment "${segment}" in "${docPath}".`);
  }
  const even = segments.length % 2 === 0;
  if (kind === 'document' && !even) fail('invalid_argument', `"${docPath}" is a collection path: a document path has an even number of segments (collection/doc).`);
  if (kind === 'collection' && even) fail('invalid_argument', `"${docPath}" is a document path: a collection path has an odd number of segments.`);
  return segments;
}

function depthOf(value) {
  if (!value || typeof value !== 'object') return 0;
  return 1 + Math.max(0, ...Object.values(value).map(depthOf));
}

function checkData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('invalid_argument', 'data must be an object.');
  if (depthOf(data) > LIMITS.depth) fail('invalid_argument', `data is nested deeper than ${LIMITS.depth} levels.`);
  if (Buffer.byteLength(JSON.stringify(data)) > LIMITS.bytes) fail('invalid_argument', `a document is limited to ${LIMITS.bytes / 1024} KiB.`);
  return data;
}

const isDelete = (value) => value && typeof value === 'object' && !Array.isArray(value) && value.__delete__ === true && Object.keys(value).length === 1;

function stripDeletes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => !isDelete(item)).map(([key, item]) => [key, stripDeletes(item)]));
}

function applyUpdate(data, changes) {
  const next = structuredClone(data);
  for (const [field, value] of Object.entries(changes)) {
    const keys = field.split('.');
    let target = next;
    for (const key of keys.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        if (isDelete(value)) { target = null; break; }
        target[key] = {};
      }
      target = target[key];
    }
    if (!target) continue;
    const last = keys.at(-1);
    if (isDelete(value)) delete target[last];
    else target[last] = stripDeletes(value);
  }
  return next;
}

const fieldValue = (data, field) => field.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), data);

function compare(a, b) {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function matches(doc, [field, operator, expected]) {
  const value = fieldValue(doc.data, field);
  switch (operator) {
    case '==': return same(value, expected);
    case '!=': return value !== undefined && !same(value, expected);
    case '<': return value !== undefined && compare(value, expected) < 0;
    case '<=': return value !== undefined && compare(value, expected) <= 0;
    case '>': return value !== undefined && compare(value, expected) > 0;
    case '>=': return value !== undefined && compare(value, expected) >= 0;
    case 'in': return Array.isArray(expected) && expected.some((item) => same(item, value));
    case 'not-in': return value !== undefined && Array.isArray(expected) && !expected.some((item) => same(item, value));
    case 'array-contains': return Array.isArray(value) && value.some((item) => same(item, expected));
    case 'array-contains-any': return Array.isArray(value) && Array.isArray(expected) && value.some((item) => expected.some((wanted) => same(item, wanted)));
    default: return false;
  }
}

function runQuery(docs, { where = [], orderBy, limit } = {}) {
  for (const clause of where) {
    if (!Array.isArray(clause) || clause.length !== 3 || !OPERATORS.includes(clause[1])) fail('invalid_argument', `a where clause is [field, operator, value] with operator in ${OPERATORS.join(', ')}.`);
  }
  let result = docs.filter((doc) => where.every((clause) => matches(doc, clause)));
  if (orderBy) {
    const [field, direction = 'asc'] = Array.isArray(orderBy) ? orderBy : [orderBy];
    const sign = direction === 'desc' ? -1 : 1;
    result = result.sort((a, b) => sign * compare(fieldValue(a.data, field), fieldValue(b.data, field)));
  }
  return result.slice(0, Math.min(Number(limit) || LIMITS.listDefault, LIMITS.listMax));
}

async function locked(lockFile, work) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try { fs.closeSync(fs.openSync(lockFile, 'wx')); break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    try {
      if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) { fs.rmSync(lockFile, { force: true }); continue; }
    } catch { continue; }
    if (Date.now() > deadline) fail('unavailable', 'the feature data is locked by another write; try again.');
    await sleep(25);
  }
  try { return await work(); } finally { fs.rmSync(lockFile, { force: true }); }
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function countDocuments(folder) {
  if (!fs.existsSync(folder)) return 0;
  return fs.readdirSync(folder, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? countDocuments(path.join(folder, entry.name)) : entry.name.endsWith('.json') ? 1 : 0), 0);
}

export function openStore(root) {
  const base = path.join(root, '.piecemaker', 'features');
  const dataFolder = (feature) => path.join(base, 'data', feature);
  const docFile = (feature, segments) => `${path.join(dataFolder(feature), ...segments)}.json`;

  function readDoc(feature, segments) {
    if (isView(feature, segments)) return viewGet(root, segments);
    const file = docFile(feature, segments);
    if (!fs.existsSync(file)) return null;
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { id: segments.at(-1), path: segments.join('/'), ...stored };
  }

  function listDocs(feature, segments) {
    if (isView(feature, segments)) return viewList(root, segments);
    const folder = path.join(dataFolder(feature), ...segments);
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).filter((name) => name.endsWith('.json')).sort()
      .map((name) => readDoc(feature, [...segments, name.slice(0, -5)]));
  }

  function guardWrite(feature, segments) {
    if (isView(feature, segments)) fail('permission_denied', `case/${segments[0]} is read-only here. ${VIEW_WRITE_HINT[segments[0]]}`);
  }

  function checkVersion(current, ifVersion) {
    if (ifVersion === undefined || ifVersion === null) return;
    const actual = current?.version ?? 0;
    if (actual !== ifVersion) fail('conflict', `version mismatch: expected ${ifVersion}, found ${actual}. Read the document again before writing.`);
  }

  function plan(feature, operation) {
    const { op, path: docPath, data, if_version: ifVersion } = operation;
    const segments = segmentsOf(feature, docPath, 'document');
    guardWrite(feature, segments);
    const current = readDoc(feature, segments);
    checkVersion(current, ifVersion);
    const now = new Date().toISOString();
    const write = (next) => ({ file: docFile(feature, segments), segments, previous: current, next: { data: checkData(next), version: (current?.version ?? 0) + 1, updatedAt: now } });
    if (op === 'set') return write(stripDeletes(checkData(data)));
    if (op === 'update') {
      if (!current) fail('invalid_argument', `update needs an existing document: "${docPath}" does not exist. Use set to create it.`);
      return write(applyUpdate(current.data, checkData(data)));
    }
    if (op === 'str_replace') {
      if (!current) fail('not_found', `"${docPath}" does not exist.`);
      const { field, old_str: oldText, new_str: newText } = operation;
      const text = fieldValue(current.data, String(field || ''));
      if (typeof text !== 'string') fail('invalid_argument', `field "${field}" is not a string.`);
      const count = text.split(String(oldText ?? '')).length - 1;
      if (!oldText || count !== 1) fail('invalid_argument', `old_str must occur exactly once in "${field}" (found ${count}).`);
      return write(applyUpdate(current.data, { [field]: text.replace(oldText, () => String(newText ?? '')) }));
    }
    if (op === 'delete') {
      if (!current) fail('not_found', `"${docPath}" does not exist.`);
      return { file: docFile(feature, segments), segments, previous: current, next: null };
    }
    return fail('invalid_argument', `unknown operation "${op}". Use set, update, str_replace or delete.`);
  }

  async function commit(feature, operations) {
    if (!Array.isArray(operations) || !operations.length) fail('invalid_argument', 'no operation given.');
    if (operations.length > LIMITS.batch) fail('invalid_argument', `a batch is limited to ${LIMITS.batch} operations.`);
    segmentsOf(feature, 'x/x', 'document');
    return locked(path.join(base, 'data', `${feature}.lock`), async () => {
      const writes = [];
      const pending = new Map();
      for (const operation of operations) {
        const key = segmentsOf(feature, operation?.path, 'document').join('/');
        if (pending.has(key)) fail('invalid_argument', `"${key}" appears twice in the batch.`);
        const write = plan(feature, operation);
        pending.set(key, write);
        writes.push(write);
      }
      const created = writes.filter((write) => write.next && !write.previous).length;
      if (created && countDocuments(dataFolder(feature)) + created > LIMITS.documents) fail('resource_exhausted', `a feature holds at most ${LIMITS.documents} documents.`);
      const done = [];
      try {
        for (const write of writes) {
          if (write.next) writeAtomic(write.file, `${JSON.stringify(write.next, null, 2)}\n`);
          else fs.rmSync(write.file, { force: true });
          done.push(write);
        }
      } catch (error) {
        for (const write of done.reverse()) {
          if (write.previous) writeAtomic(write.file, `${JSON.stringify({ data: write.previous.data, version: write.previous.version, updatedAt: write.previous.updatedAt }, null, 2)}\n`);
          else fs.rmSync(write.file, { force: true });
        }
        throw error;
      }
      return writes.map((write) => (write.next ? { path: write.segments.join('/'), version: write.next.version } : { path: write.segments.join('/'), deleted: true }));
    });
  }

  return {
    get(feature, docPath) {
      const doc = readDoc(feature, segmentsOf(feature, docPath, 'document'));
      if (!doc) fail('not_found', `"${docPath}" does not exist.`);
      return doc;
    },
    list(feature, collection, { limit, after } = {}) {
      const docs = listDocs(feature, segmentsOf(feature, collection, 'collection'));
      const start = after ? docs.findIndex((doc) => doc.id === after) + 1 : 0;
      const size = Math.min(Number(limit) || LIMITS.listDefault, LIMITS.listMax);
      const page = docs.slice(start, start + size);
      return { documents: page, next: start + size < docs.length ? page.at(-1)?.id : null };
    },
    query(feature, collection, options = {}) {
      return { documents: runQuery(listDocs(feature, segmentsOf(feature, collection, 'collection')), options) };
    },
    async set(feature, docPath, data, options = {}) { return (await commit(feature, [{ op: 'set', path: docPath, data, ...options }]))[0]; },
    async update(feature, docPath, data, options = {}) { return (await commit(feature, [{ op: 'update', path: docPath, data, ...options }]))[0]; },
    async strReplace(feature, docPath, field, oldText, newText, options = {}) { return (await commit(feature, [{ op: 'str_replace', path: docPath, field, old_str: oldText, new_str: newText, ...options }]))[0]; },
    async delete(feature, docPath, options = {}) { return (await commit(feature, [{ op: 'delete', path: docPath, ...options }]))[0]; },
    batch: commit,
  };
}

export function openComments(root) {
  const fileOf = (feature) => {
    if (!FEATURE_NAME.test(String(feature || ''))) fail('invalid_argument', `invalid feature name "${feature}".`);
    return path.join(root, '.piecemaker', 'features', 'comments', `${feature}.json`);
  };
  const load = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { threads: [] });
  const mutate = (feature, change) => {
    const file = fileOf(feature);
    return locked(`${file}.lock`, async () => {
      const state = load(file);
      const result = change(state);
      writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
      return result;
    });
  };
  const find = (state, id) => state.threads.find((thread) => thread.id === id) ?? fail('not_found', `no comment thread "${id}".`);
  const message = (author, text) => {
    if (!String(text || '').trim()) fail('invalid_argument', 'a comment needs a text.');
    return { author, text: String(text), at: new Date().toISOString() };
  };
  return {
    read(feature, { resolved = false } = {}) {
      return load(fileOf(feature)).threads.filter((thread) => resolved || !thread.resolved);
    },
    open(feature, anchor, text, author = 'lawyer', id = randomUUID().slice(0, 8)) {
      return mutate(feature, (state) => {
        if (!/^[a-z0-9-]{1,40}$/.test(String(id))) fail('invalid_argument', `invalid thread id "${id}".`);
        if (state.threads.some((thread) => thread.id === id)) fail('conflict', `thread "${id}" already exists.`);
        const thread = { id, anchor: anchor ?? null, messages: [message(author, text)], resolved: false };
        state.threads.push(thread);
        return thread;
      });
    },
    reply(feature, id, text, author = 'assistant') {
      return mutate(feature, (state) => {
        const thread = find(state, id);
        thread.messages.push(message(author, text));
        thread.resolved = false;
        return thread;
      });
    },
    resolve(feature, id) {
      return mutate(feature, (state) => {
        const thread = find(state, id);
        thread.resolved = true;
        return thread;
      });
    },
  };
}
