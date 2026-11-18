/*
 * Runtime d'un artifact affiché dans l'onglet Artifacts, injecté en tête de sa page. La page tourne
 * dans une iframe isolée (sandbox sans allow-same-origin) : elle ne parle qu'à l'onglet, par
 * postMessage, et l'onglet seul atteint le serveur.
 *
 *   window.artifact.db       get, list, query, set, update, strReplace, delete, batch (capability db)
 *   window.artifact.theme    'light' | 'dark', suivi de l'événement « artifact:theme »
 *   window.artifact.download(nom, contenu, type)   donne un fichier à enregistrer
 *   événement « artifact:data »   la base a changé (écriture de l'agent ou d'un autre onglet)
 */
(() => {
  if (window.artifact) return;
  const pending = new Map();
  let next = 0;
  const call = (op, args) => new Promise((resolve, reject) => {
    const id = `${Date.now().toString(36)}-${next += 1}`;
    pending.set(id, { resolve, reject });
    parent.postMessage({ channel: 'piecemaker-artifact', id, op, args }, '*');
  });
  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || event.data.channel !== 'piecemaker-artifact') return;
    const { id, result, error, kind, theme } = event.data;
    if (kind === 'theme') {
      document.documentElement.dataset.theme = theme;
      window.artifact.theme = theme;
      window.dispatchEvent(new CustomEvent('artifact:theme', { detail: theme }));
      return;
    }
    if (kind === 'data') { window.dispatchEvent(new Event('artifact:data')); return; }
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    if (error) waiting.reject(Object.assign(new Error(error.message), { code: error.code }));
    else waiting.resolve(result);
  });
  const write = (op) => (collection, docId, data, options = {}) => call(op, { collection, doc_id: docId, data, if_version: options.ifVersion });
  window.artifact = {
    theme: document.documentElement.dataset.theme || null,
    db: {
      get: (collection, docId) => call('get', { collection, doc_id: docId }),
      list: (collection, query = {}) => call('list', { collection, query }),
      query: (collection, query = {}) => call('query', { collection, query }),
      set: write('set'),
      update: write('update'),
      strReplace: (collection, docId, field, oldStr, newStr, options = {}) => call('str_replace', { collection, doc_id: docId, field, old_str: oldStr, new_str: newStr, replace_all: options.replaceAll, if_version: options.ifVersion }),
      delete: (collection, docId, options = {}) => call('delete', { collection, doc_id: docId, if_version: options.ifVersion }),
      batch: (writes) => call('batch', { writes: writes.map(({ ifVersion, docId, ...write }) => ({ ...write, doc_id: write.doc_id ?? docId, if_version: write.if_version ?? ifVersion })) }),
    },
    download: (name, content, type = 'application/octet-stream') => call('download', { name: String(name), content: String(content), type: String(type) }),
  };
  parent.postMessage({ channel: 'piecemaker-artifact', op: 'ready' }, '*');
})();
