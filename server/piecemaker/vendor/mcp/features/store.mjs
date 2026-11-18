import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { isView as isCaseView, viewGet, viewList, VIEW_WRITE_HINT } from './vue-dossier.mjs';

export const LIMITS = { bytes: 256 * 1024, depth: 32, documents: 25000, batch: 50, where: 10, segments: 16, listDefault: 100, listMax: 1000, reply: 4096 };
const FEATURE_NAME = /^[a-z][a-z0-9_]{0,63}$/;
export const SEGMENT = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const ALIASES = { eq: '==', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' };
const OPERATORS = ['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains', ...Object.keys(ALIASES)];
const LOCK_STALE_MS = 10000;
const LOCK_TIMEOUT_MS = 5000;

export class FeatureDataError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new FeatureDataError(code, message); };

function checkedSegments(feature, docPath, kind, namePattern = FEATURE_NAME) {
  if (!namePattern.test(String(feature || ''))) fail('invalid_argument', `invalid name "${feature}".`);
  const segments = String(docPath || '').split('/');
  if (segments.length > LIMITS.segments) fail('invalid_argument', `"${docPath}" has more than ${LIMITS.segments} segments.`);
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

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isDelete = (value) => isObject(value) && value.__delete__ === true && Object.keys(value).length === 1;

function findDelete(value, inArray = false) {
  if (isDelete(value)) return inArray ? 'array' : 'object';
  if (Array.isArray(value)) return value.map((item) => findDelete(item, true)).find(Boolean);
  if (isObject(value)) return Object.values(value).map((item) => findDelete(item, inArray)).find(Boolean);
  return undefined;
}

function checkDeletes(data, op) {
  const found = findDelete(data);
  if (found && op === 'set') fail('invalid_argument', 'set rejects {"__delete__": true}: use update to remove a field.');
  if (found === 'array') fail('invalid_argument', '{"__delete__": true} is rejected inside arrays.');
  return data;
}

function merge(target, changes) {
  const next = { ...target };
  for (const [key, value] of Object.entries(changes)) {
    if (isDelete(value)) delete next[key];
    else next[key] = isObject(value) && isObject(next[key]) ? merge(next[key], value) : isObject(value) ? merge({}, value) : value;
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
    default: return false;
  }
}

function page(docs, { limit, cursor } = {}) {
  const start = cursor ? docs.findIndex((doc) => doc.id === cursor) + 1 : 0;
  const size = Math.min(Number(limit) || LIMITS.listDefault, LIMITS.listMax);
  const documents = docs.slice(start, start + size);
  return { documents, next_cursor: start + size < docs.length ? documents.at(-1)?.id : null };
}

function runQuery(docs, { where = [], order_by: orderBy, limit, cursor } = {}) {
  if (where.length > LIMITS.where) fail('invalid_argument', `a query has at most ${LIMITS.where} where clauses.`);
  for (const clause of where) {
    if (!Array.isArray(clause) || clause.length !== 3 || !OPERATORS.includes(clause[1])) fail('invalid_argument', `a where clause is [field, operator, value] with operator in ${OPERATORS.join(', ')}.`);
  }
  const result = docs.filter((doc) => where.every(([field, operator, value]) => matches(doc, [field, ALIASES[operator] ?? operator, value])));
  if (!orderBy) return page(result, { limit, cursor });
  const sign = orderBy.direction === 'desc' ? -1 : 1;
  result.sort((a, b) => sign * compare(fieldValue(a.data, orderBy.field), fieldValue(b.data, orderBy.field)));
  return { documents: result.slice(0, Math.min(Number(limit) || LIMITS.listDefault, LIMITS.listMax)) };
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

/**
 * `options` sert au MCP artifacts : `base` (dossier sous la racine), `namePattern` (nom du
 * propriétaire des données), `views` (collections de lecture du dossier, propres à features).
 */
export function openStore(root, { base: baseParts = ['.piecemaker', 'features'], namePattern = FEATURE_NAME, views = true } = {}) {
  const base = path.join(root, ...baseParts);
  const dataFolder = (feature) => path.join(base, 'data', feature);
  const isView = (feature, segments) => views && isCaseView(feature, segments);
  const segmentsOf = (feature, docPath, kind) => checkedSegments(feature, docPath, kind, namePattern);
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

  function checkVersion(docPath, current, ifVersion) {
    if (ifVersion === undefined || ifVersion === null) {
      if (current) fail('conflict', `"${docPath}" exists at version ${current.version}: a write to an existing document needs if_version. Read it, then write.`);
      return;
    }
    if (!Number.isInteger(ifVersion) || ifVersion < 1) fail('invalid_argument', 'if_version is an integer from 1.');
    if (!current) fail('conflict', `"${docPath}" does not exist: omit if_version to create it.`);
    if (current.version !== ifVersion) fail('conflict', `"${docPath}" is at version ${current.version}, not ${ifVersion}. Read it again and redo the write.`);
  }

  function plan(feature, operation) {
    const { op, path: docPath, data, if_version: ifVersion } = operation;
    const segments = segmentsOf(feature, docPath, 'document');
    guardWrite(feature, segments);
    const current = readDoc(feature, segments);
    checkVersion(docPath, current, ifVersion);
    const now = new Date().toISOString();
    const write = (next) => ({ file: docFile(feature, segments), segments, previous: current, next: { data: checkData(next), version: (current?.version ?? 0) + 1, updatedAt: now } });
    if (op === 'set') return write(checkDeletes(checkData(data), op));
    if (op === 'update') {
      if (!current) fail('invalid_argument', `update needs an existing document: "${docPath}" does not exist. Use set to create it.`);
      return write(merge(current.data, checkDeletes(checkData(data), op)));
    }
    if (op === 'str_replace') {
      if (!current) fail('not_found', `"${docPath}" does not exist.`);
      const { field, old_str: oldText, new_str: newText, replace_all: replaceAll } = operation;
      const text = Object.hasOwn(current.data, String(field)) ? current.data[field] : undefined;
      if (typeof text !== 'string') fail('invalid_argument', `"${field}" is not a top-level string field.`);
      const count = oldText ? text.split(oldText).length - 1 : 0;
      if (!count) fail('invalid_argument', `old_str is absent from "${field}".`);
      if (count > 1 && !replaceAll) fail('invalid_argument', `old_str is not unique in "${field}" (${count} times): give more context or replace_all.`);
      return write({ ...current.data, [field]: replaceAll ? text.split(oldText).join(String(newText ?? '')) : text.replace(oldText, () => String(newText ?? '')) });
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
    list(feature, collection, query = {}) {
      return page(listDocs(feature, segmentsOf(feature, collection, 'collection')), query);
    },
    query(feature, collection, query = {}) {
      return runQuery(listDocs(feature, segmentsOf(feature, collection, 'collection')), query);
    },
    async set(feature, docPath, data, options = {}) { return (await commit(feature, [{ op: 'set', path: docPath, data, ...options }]))[0]; },
    async update(feature, docPath, data, options = {}) { return (await commit(feature, [{ op: 'update', path: docPath, data, ...options }]))[0]; },
    async strReplace(feature, docPath, field, oldText, newText, options = {}) { return (await commit(feature, [{ op: 'str_replace', path: docPath, field, old_str: oldText, new_str: newText, ...options }]))[0]; },
    async delete(feature, docPath, options = {}) { return (await commit(feature, [{ op: 'delete', path: docPath, ...options }]))[0]; },
    async batch(feature, writes) {
      if (Array.isArray(writes) && writes.some((write) => !['set', 'update', 'delete'].includes(write?.op))) fail('invalid_argument', 'a batch entry is set, update or delete.');
      return commit(feature, writes);
    },
  };
}

export function openComments(root, { base = ['.piecemaker', 'features'], namePattern = FEATURE_NAME } = {}) {
  const fileOf = (feature) => {
    if (!namePattern.test(String(feature || ''))) fail('invalid_argument', `invalid name "${feature}".`);
    return path.join(root, ...base, 'comments', `${feature}.json`);
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
    read(feature, threadId) {
      const { threads } = load(fileOf(feature));
      return threadId === undefined ? threads : [find({ threads }, threadId)];
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
        if (Buffer.byteLength(String(text ?? '')) > LIMITS.reply) fail('invalid_argument', `a reply is at most ${LIMITS.reply} bytes.`);
        const thread = find(state, id);
        thread.messages.push(message(author, text));
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
