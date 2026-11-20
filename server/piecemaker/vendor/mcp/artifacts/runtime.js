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
  let reviewing = false;
  let highlights = [];
  let previousSelection = '';
  let selectionTimer;
  let paintTimer;
  const layer = 'piecemaker-review';
  const painter = new MutationObserver(() => {
    clearTimeout(paintTimer);
    paintTimer = setTimeout(() => paint(), 100);
  });

  function readPassages() {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest('script, style, noscript, textarea, [hidden]')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.length) continue;
      nodes.push({ node, start: text.length, end: text.length + node.length });
      text += node.data;
    }
    return { nodes, text };
  }

  function sendSelection() {
    const selection = getSelection();
    if (!reviewing || !document.body || !selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!document.body.contains(range.commonAncestorContainer)) return;
    const { nodes, text } = readPassages();
    const selected = nodes.filter(({ node }) => range.intersectsNode(node));
    if (!selected.length) return;
    const first = selected[0];
    const last = selected.at(-1);
    const start = first.start + (range.startContainer === first.node ? range.startOffset : 0);
    const end = last.start + (range.endContainer === last.node ? range.endOffset : last.node.length);
    const quote = text.slice(start, end);
    if (!quote.trim() || quote.length > 4000) return;
    const passage = { quote, start, before: text.slice(Math.max(0, start - 48), start), after: text.slice(end, end + 48) };
    const serialized = JSON.stringify(passage);
    if (serialized === previousSelection) return;
    previousSelection = serialized;
    parent.postMessage({ channel: 'piecemaker-artifact', op: 'selection', args: passage }, '*');
  }

  function locate({ quote, start, before, after }, { nodes, text }) {
    if (!quote) return null;
    const matches = (index) => text.startsWith(quote, index)
      && text.slice(Math.max(0, index - before.length), index) === before
      && text.startsWith(after, index + quote.length);
    let offset = start;
    if (!matches(offset)) {
      offset = text.indexOf(quote);
      while (offset >= 0 && !matches(offset)) offset = text.indexOf(quote, offset + 1);
      if (offset < 0) return null;
      for (let other = text.indexOf(quote, offset + 1); other >= 0; other = text.indexOf(quote, other + 1)) {
        if (matches(other)) return null;
      }
    }
    const end = offset + quote.length;
    const first = nodes.find((entry) => entry.end > offset);
    const last = nodes.find((entry) => entry.end >= end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, offset - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }

  function paint(focus) {
    if (!document.body) return;
    if (!highlights.length) { CSS.highlights?.delete(layer); return; }
    const snapshot = readPassages();
    const ranges = [];
    for (const { id, passage } of highlights) {
      const range = locate(passage, snapshot);
      if (id === focus) {
        range?.startContainer.parentElement?.scrollIntoView({ block: 'center' });
        parent.postMessage({ channel: 'piecemaker-artifact', op: 'passage-status', args: { id, found: Boolean(range) } }, '*');
      }
      if (range) ranges.push(range);
    }
    if (CSS.highlights) CSS.highlights.set(layer, new Highlight(...ranges));
  }

  function schedulePaint() {
    if (!document.body) return;
    painter.disconnect();
    if (highlights.length) painter.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    paint();
  }

  const style = document.createElement('style');
  style.textContent = '::highlight(piecemaker-review) { background-color: Mark; color: MarkText; }';
  document.head.append(style);
  document.addEventListener('DOMContentLoaded', schedulePaint, { once: true });
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    if (reviewing) selectionTimer = setTimeout(sendSelection, 80);
  });

  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || event.data.channel !== 'piecemaker-artifact') return;
    const { id, result, error, kind, theme } = event.data;
    if (kind === 'review') {
      reviewing = event.data.enabled;
      highlights = event.data.highlights;
      if (!reviewing) previousSelection = '';
      schedulePaint();
      return;
    }
    if (kind === 'clear-selection') {
      previousSelection = '';
      getSelection()?.removeAllRanges();
      return;
    }
    if (kind === 'focus-passage') { paint(id); return; }
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
