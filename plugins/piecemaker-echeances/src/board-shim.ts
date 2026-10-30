const SHIM = `(() => {
  const API = location.origin + '/api/piecemaker/suivi/board';
  const POLL_MS = 2000;
  const clone = (v) => v === undefined ? v : JSON.parse(JSON.stringify(v));
  let docs = new Map(), rev = null;
  const subs = new Set();
  const idOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const meta = { fromCache: false, hasPendingWrites: false };
  const snapDoc = (p) => ({ id: idOf(p), exists: docs.has(p), data: () => docs.has(p) ? clone(docs.get(p)) : undefined, metadata: meta });
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const list = (p, q) => {
    const depth = p.split('/').length + 1;
    let paths = [...docs.keys()].filter((k) => k.startsWith(p + '/') && k.split('/').length === depth).sort();
    for (const [f, op, v] of q.where) paths = paths.filter((k) => { const x = docs.get(k)[f]; return op === '>' ? x > v : op === '==' ? x === v : true; });
    if (q.orderBy) { const [f, d] = q.orderBy, s = d === 'desc' ? -1 : 1; paths.sort((a, b) => { const x = docs.get(a)[f], y = docs.get(b)[f]; return x == null && y == null ? cmp(a, b) : x == null ? 1 : y == null ? -1 : cmp(x, y) * s || cmp(a, b); }); }
    return { docs: paths.slice(0, q.limit || 1000).map(snapDoc), metadata: meta };
  };
  const call = async (url, init = {}) => {
    const token = localStorage.getItem('auth-token');
    const response = await fetch(url, { ...init, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    const refreshed = response.headers.get('X-Refreshed-Token');
    if (refreshed) localStorage.setItem('auth-token', refreshed);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw { code: 'invalid_argument', message: data.error || ('Erreur ' + response.status) };
    return data;
  };
  const pull = async () => {
    const data = await call(API + (rev ? '?rev=' + rev : ''));
    if (data.docs) { rev = data.rev; docs = new Map(Object.entries(data.docs)); for (const s of subs) s(); }
  };
  const op = async (kind, path, data) => {
    const dates = docs.get(path)?.keyDates;
    await call(API, { method: 'POST', body: JSON.stringify({ op: kind, path, data, ...(Array.isArray(dates) ? { base: dates.map((date) => date.id) } : {}) }) });
    await pull();
  };
  const listen = (run) => { subs.add(run); setTimeout(run, 0); return () => subs.delete(run); };
  const doc = (p) => ({ id: idOf(p), path: p, get: async () => { await pull(); return snapDoc(p); }, set: (data) => op('set', p, data), update: (data) => op('update', p, data), delete: () => op('delete', p), onSnapshot: (next) => listen(() => next(snapDoc(p))), collection: (c) => col(p + '/' + c, { where: [] }) });
  const col = (p, q) => ({ path: p, where: (f, o, v) => col(p, { ...q, where: [...q.where, [f, o, v]] }), orderBy: (f, d) => col(p, { ...q, orderBy: [f, d] }), limit: (n) => col(p, { ...q, limit: n }), get: async () => { await pull(); return list(p, q); }, onSnapshot: (next) => listen(() => next(list(p, q))), doc: (id) => doc(p + '/' + id) });
  const db = { doc, collection: (p) => col(p, { where: [] }) };
  const ready = pull();
  setInterval(() => { if (document.visibilityState === 'visible') pull().catch(() => undefined); }, POLL_MS);
  window.claude = { use: async (name) => { if (name !== 'db') return null; await ready; return db; } };
})();`;

export const withBoardShim = (html: string) => html.replace('<script', () => `<script>${SHIM}</script><script`);
