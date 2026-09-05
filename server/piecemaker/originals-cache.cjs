const fs = require('node:fs');

const { listOriginals } = require('./vendor/websocket-server/originals-pipeline.cjs');

const ORIGINALS_CACHE_TTL_MS = 5_000;
const ORIGINALS_CACHE_MAX_ENTRIES = 8;

function createOriginalsCache({
  list = listOriginals,
  realpath = fs.realpathSync.native,
  now = Date.now,
  ttlMs = ORIGINALS_CACHE_TTL_MS,
  maxEntries = ORIGINALS_CACHE_MAX_ENTRIES,
} = {}) {
  const entries = new Map();

  function evictLastEntry() {
    const keys = [...entries.keys()];
    const lastKey = keys[keys.length - 1];
    if (lastKey !== undefined) entries.delete(lastKey);
  }

  function listOriginalsCached(caseRoot) {
    const realCaseRoot = realpath(caseRoot);
    const currentTime = now();
    const entry = entries.get(realCaseRoot);
    if (entry && entry.expiresAt > currentTime) return entry.promise;
    if (entry) entries.delete(realCaseRoot);
    if (entries.size >= maxEntries) evictLastEntry();

    const promise = Promise.resolve().then(() => list(realCaseRoot));
    const nextEntry = { promise, expiresAt: currentTime + ttlMs };
    entries.set(realCaseRoot, nextEntry);
    promise.catch(() => {
      if (entries.get(realCaseRoot) === nextEntry) entries.delete(realCaseRoot);
    });
    return promise;
  }

  function invalidateOriginals(caseRoot) {
    const realCaseRoot = realpath(caseRoot);
    entries.delete(realCaseRoot);
  }

  return { invalidateOriginals, listOriginalsCached };
}

const cache = createOriginalsCache();

module.exports = {
  createOriginalsCache,
  invalidateOriginals: cache.invalidateOriginals,
  listOriginalsCached: cache.listOriginalsCached,
};
