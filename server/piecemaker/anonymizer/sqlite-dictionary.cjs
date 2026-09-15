const path = require('node:path');

const Database = require('better-sqlite3');

const { buildDictionary, EMPTY_DICTIONARY } = require('./dictionary.cjs');

function codePrefix(code) {
  const match = /^(.*?)_(\d+)$/.exec(code);
  return match ? match[1] : code || 'ENTITE';
}

function codeNumber(code) {
  const match = /_(\d+)$/.exec(code);
  return match ? Number(match[1]) : 0;
}

function allocateCode(localCode, counters, used) {
  const prefix = codePrefix(localCode);
  let index = counters.get(prefix) || 0;
  let candidate;
  do {
    index += 1;
    candidate = `${prefix}_${String(index).padStart(2, '0')}`;
  } while (used.has(candidate));
  counters.set(prefix, index);
  return candidate;
}

function buildMappingDocument(rows) {
  const grouped = new Map();
  let updatedAt = null;
  for (const row of rows) {
    const key = `${row.project_id}\u0000${row.node_id}\u0000${row.masked_value}`;
    const group = grouped.get(key) || { localCode: row.masked_value, label: row.label, variants: [] };
    if (!group.variants.includes(row.real_value)) group.variants.push(row.real_value);
    grouped.set(key, group);
    if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at;
  }

  const used = new Set();
  const counters = new Map();
  const mapping = {};
  const reverse_mapping = {};
  for (const group of grouped.values()) {
    const desired = group.localCode;
    const globalCode = used.has(desired) ? allocateCode(desired, counters, used) : desired;
    used.add(globalCode);
    const prefix = codePrefix(globalCode);
    counters.set(prefix, Math.max(counters.get(prefix) || 0, codeNumber(globalCode)));
    const canonical = group.variants.includes(group.label) ? group.label : group.variants[0];
    const variants = [canonical, ...group.variants.filter((value) => value !== canonical)];
    reverse_mapping[globalCode] = variants;
    for (const variant of variants) if (!mapping[variant]) mapping[variant] = globalCode;
  }
  return { mapping, reverse_mapping, updated_at: updatedAt };
}

function createSqliteDictionaryLoader({ databasePath }) {
  const file = path.resolve(databasePath);
  let database = null;
  let dataVersion = null;
  let mappingSignature = null;
  let generation = 0;
  let current = EMPTY_DICTIONARY;

  function connection() {
    if (!database) {
      database = new Database(file, { readonly: true, fileMustExist: true });
      database.pragma('busy_timeout = 1000');
    }
    return database;
  }

  function hasTable(target) {
    return Boolean(target.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='piecemaker_mappings'").get());
  }

  function load(force = false) {
    try {
      const target = connection();
      const nextDataVersion = target.pragma('data_version', { simple: true });
      if (!force && nextDataVersion === dataVersion) return current;
      if (!hasTable(target)) {
        dataVersion = nextDataVersion;
        mappingSignature = null;
        current = EMPTY_DICTIONARY;
        return current;
      }
      const stamp = target.prepare('SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at, TOTAL(rowid) AS rowids FROM piecemaker_mappings').get();
      const nextSignature = `${stamp.count}:${stamp.updated_at || ''}:${stamp.rowids}`;
      if (!force && nextSignature === mappingSignature) {
        dataVersion = nextDataVersion;
        return current;
      }
      mappingSignature = nextSignature;
      const rows = target.prepare('SELECT m.project_id,m.node_id,m.real_value,m.masked_value,m.updated_at,n.label FROM piecemaker_mappings m JOIN piecemaker_nodes n ON n.project_id=m.project_id AND n.id=m.node_id ORDER BY m.project_id,m.masked_value,m.node_id,LENGTH(m.real_value) DESC,m.real_value').all();
      generation += 1;
      current = buildDictionary(buildMappingDocument(rows), generation);
      dataVersion = nextDataVersion;
      return current;
    } catch {
      return current;
    }
  }

  return {
    file,
    get: () => load(false),
    refresh: () => load(true),
    exists: () => !load(false).empty,
    close: () => {
      if (database) database.close();
      database = null;
    },
  };
}

module.exports = {
  buildMappingDocument,
  createSqliteDictionaryLoader,
};
