import { requestJson } from '../../../src/shared/authToken.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void; openFileInEditor(filePath: string): void };

type Summary = {
  url: string; id: string; title: string; description: string; icon: string | null; type: string | null;
  pinned: boolean; version: number; versions: number; created_at: string; updated_at: string; capabilities: Record<string, unknown>;
};
type Version = { version: number; label: string | null; published_at: string; files: number };
type Detail = Summary & { versions: Version[]; data_stamp: number; format?: 'docx'; document_path?: string | null };
type Thread = { id: string; anchor: Record<string, unknown> | null; resolved: boolean; messages: Array<{ author: string; text: string; at: string }> };
type Bridge = { channel?: string; id?: string; op?: string; args?: Record<string, unknown> };

const TAB = 'plugin:piecemaker-artifacts';
const SHOW_EVENT = 'piecemaker:artifacts-show';
const SHOW_KEY = '__piecemakerArtifactsShow';
const POLL_MS = 3000;
const ICONS: Record<string, string> = { chart: '📊', dashboard: '📊', calendar: '📅', document: '📄', page: '🗒️', slides: '🖥️', checklist: '✅', tracker: '✅', map: '🗺️', table: '▦', code: '⌨️', timeline: '⏱️' };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const date = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};
const cleanups = new WeakMap<HTMLElement, () => void>();

export function mount(container: HTMLElement, api: Host) {
  unmount(container);
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pma piecemaker-ui';
  root.setAttribute('aria-label', 'Artifacts du dossier');
  container.replaceChildren(style, root);

  let context = api.context;
  let items: Summary[] = [];
  let filter: 'all' | 'pinned' = 'all';
  let current: Detail | null = null;
  let shownVersion: number | null = null;
  let frame: HTMLIFrameElement | null = null;
  let threads: Thread[] = [];
  let commentsOpen = false;
  let dataStamp = 0;
  let confirmDelete = false;
  let error = '';
  let stopped = false;
  let serialized = '';

  const project = () => context.project?.path ?? '';
  const query = (extra = '') => `projectPath=${encodeURIComponent(project())}${extra}`;
  const call = <T>(route: string, body?: unknown, method?: string) => requestJson<T>(`/api/piecemaker/${route}`, body, method);
  const focus = () => window.dispatchEvent(new CustomEvent('piecemaker:panel-focus', { detail: { tab: TAB, ...(current ? { file: current.id } : {}) } }));

  async function loadList() {
    if (!project()) { items = []; return; }
    items = await call<Summary[]>(`artifacts?${query()}`);
  }

  async function open(id: string, version: number | null = null) {
    const path = project();
    const detail = await call<Detail>(`artifacts/${id}?${query()}`);
    if (stopped || project() !== path) return;
    if (detail.format === 'docx') {
      if (!detail.document_path) throw new Error('Le fichier Word est introuvable dans ce dossier.');
      api.openFileInEditor(detail.document_path);
      return;
    }
    current = detail;
    shownVersion = version;
    if (version !== null) commentsOpen = true;
    dataStamp = current.data_stamp;
    confirmDelete = false;
    threads = await call<Thread[]>(`artifacts/${id}/comments?${query()}`).catch(() => []);
    render();
    await loadFrame();
    focus();
  }

  async function loadFrame() {
    if (!current || !frame) return;
    const { src } = await call<{ src: string }>(`artifacts/${current.id}/frame?${query(shownVersion ? `&ver=${shownVersion}` : '')}`, {});
    frame.src = src;
  }

  function postToFrame(message: Record<string, unknown>) {
    frame?.contentWindow?.postMessage({ channel: 'piecemaker-artifact', ...message }, '*');
  }

  const onMessage = async (event: MessageEvent) => {
    const message = event.data as Bridge;
    if (!frame || event.source !== frame.contentWindow || message?.channel !== 'piecemaker-artifact' || !current) return;
    if (message.op === 'ready') { postToFrame({ kind: 'theme', theme: context.theme }); return; }
    const reply = (result: unknown, failure?: { message: string; code?: string }) => postToFrame({ id: message.id, result, error: failure });
    try {
      if (message.op === 'download') {
        const { name, content, type } = message.args as { name: string; content: string; type: string };
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type })), download: name });
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        reply({ saved: name });
        return;
      }
      const result = await call(`artifacts/${current.id}/data?${query()}`, { op: message.op, args: message.args });
      if (message.op && !['get', 'list', 'query'].includes(message.op)) dataStamp = Date.now();
      reply(result);
    } catch (failure) {
      reply(null, { message: (failure as Error).message });
    }
  };
  window.addEventListener('message', onMessage);

  function galleryHtml() {
    const shown = filter === 'pinned' ? items.filter((item) => item.pinned) : items;
    const cards = shown.map((item) => `
      <article class="pma-card" data-open="${escape(item.id)}" tabindex="0">
        <div class="pma-card-icon" aria-hidden="true">${ICONS[item.icon ?? ''] ?? '◫'}</div>
        <div class="pma-card-body">
          <h3>${escape(item.title)}</h3>
          ${item.description ? `<p>${escape(item.description)}</p>` : ''}
          <span class="pma-muted">v${item.version} · ${escape(date(item.updated_at))}${item.type ? ` · ${escape(item.type.replace('piecemaker://template/', ''))}` : ''}</span>
        </div>
        <button class="pma-pin${item.pinned ? ' on' : ''}" data-pin="${escape(item.id)}" title="${item.pinned ? 'Désépingler' : 'Épingler'}" aria-pressed="${item.pinned}">📌</button>
      </article>`).join('');
    return `
      <header class="pma-bar">
        <h2>Artifacts</h2>
        <div class="pma-tabs" role="tablist">
          <button role="tab" aria-selected="${filter === 'all'}" data-filter="all">Tous</button>
          <button role="tab" aria-selected="${filter === 'pinned'}" data-filter="pinned">Épinglés</button>
        </div>
      </header>
      ${error ? `<p class="pma-error">${escape(error)}</p>` : ''}
      ${!project() ? '<p class="pma-empty">Ouvrez un dossier.</p>' : shown.length ? `<div class="pma-grid">${cards}</div>` : `<p class="pma-empty">${filter === 'pinned' ? 'Aucun artifact épinglé.' : 'Aucun artifact. Demandez à l’assistant une page, un tableau de bord, un suivi ou une présentation : il la publie ici.'}</p>`}`;
  }

  function threadsHtml() {
    const open = threads.filter((thread) => !thread.resolved);
    const done = threads.filter((thread) => thread.resolved);
    const one = (thread: Thread) => `
      <li class="pma-thread${thread.resolved ? ' resolved' : ''}">
        ${thread.anchor?.source === 'plannotator' ? `<span class="pma-tag">Plannotator · v${escape(thread.anchor.version)}</span>` : ''}
        ${thread.messages.map((entry) => `<p><b>${entry.author === 'lawyer' ? 'Vous' : 'Assistant'}</b> ${escape(entry.text)}</p>`).join('')}
        ${thread.resolved ? '<span class="pma-muted">Résolu</span>' : ''}
      </li>`;
    return `
      <aside class="pma-comments">
        <h3>Commentaires</h3>
        <form data-comment><textarea name="text" rows="3" placeholder="Un commentaire pour l’assistant" aria-label="Commentaire" required></textarea><button>Envoyer</button></form>
        <ul>${open.map(one).join('') || '<li class="pma-muted">Aucun fil ouvert.</li>'}</ul>
        ${done.length ? `<details><summary>${done.length} résolu(s)</summary><ul>${done.map(one).join('')}</ul></details>` : ''}
      </aside>`;
  }

  function viewerHead(detail: Detail) {
    const options = detail.versions.map((entry) => `<option value="${entry.version}"${(shownVersion ?? detail.version) === entry.version ? ' selected' : ''}>v${entry.version}${entry.label ? ` · ${escape(entry.label)}` : ''} · ${escape(date(entry.published_at))}</option>`).join('');
    const open = threads.filter((thread) => !thread.resolved).length;
    return `
      <header class="pma-bar">
        <button class="pma-back" data-back aria-label="Retour à la galerie">←</button>
        <h2 title="${escape(detail.url)}">${escape(detail.title)}</h2>
        <select data-version aria-label="Version">${options}</select>
        <button class="pma-pin${detail.pinned ? ' on' : ''}" data-pin="${escape(detail.id)}" aria-pressed="${detail.pinned}" title="${detail.pinned ? 'Désépingler' : 'Épingler'}">📌</button>
        <button data-comments aria-pressed="${commentsOpen}">Commentaires${open ? ` (${open})` : ''}</button>
        <button data-copy title="Copier le lien">Lien</button>
        <button class="pma-danger" data-delete>${confirmDelete ? 'Confirmer la suppression' : 'Supprimer'}</button>
      </header>
      ${error ? `<p class="pma-error">${escape(error)}</p>` : ''}`;
  }

  let viewing: string | null = null;
  const parts = { head: '', side: '' };
  function render() {
    root.dataset.theme = context.theme;
    if (!current) {
      viewing = null;
      frame = null;
      const html = galleryHtml();
      if (html === serialized) return;
      serialized = html;
      root.innerHTML = html;
      return;
    }
    if (viewing !== current.id || !frame || !root.contains(frame)) {
      viewing = current.id;
      serialized = '';
      parts.head = parts.side = '';
      root.innerHTML = `<div data-head></div><div class="pma-view"><iframe title="${escape(current.title)}" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads" referrerpolicy="no-referrer"></iframe><div data-side></div></div>`;
      frame = root.querySelector('iframe');
    }
    const head = viewerHead(current);
    if (head !== parts.head) { parts.head = head; root.querySelector('[data-head]')!.innerHTML = head; }
    const side = commentsOpen ? threadsHtml() : '';
    if (side !== parts.side) { parts.side = side; root.querySelector('[data-side]')!.innerHTML = side; }
    root.querySelector('.pma-view')!.classList.toggle('with-comments', commentsOpen);
  }

  const act = async (work: () => Promise<void>) => {
    error = '';
    try { await work(); } catch (failure) { error = (failure as Error).message; }
    serialized = '';
    parts.head = '';
    render();
  };

  root.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button, [data-open]');
    if (!target) return;
    const pin = target.dataset.pin;
    if (pin) {
      event.stopPropagation();
      const pinned = !(current?.id === pin ? current.pinned : items.find((item) => item.id === pin)?.pinned);
      void act(async () => {
        await call(`artifacts/${pin}/pin?${query()}`, { pinned });
        await loadList();
        if (current) current = { ...current, pinned };
      });
      return;
    }
    if (target.dataset.filter) { filter = target.dataset.filter as typeof filter; render(); return; }
    if (target.dataset.open) { void act(() => open(target.dataset.open!)); return; }
    if (target.hasAttribute('data-back')) { current = null; commentsOpen = false; void act(loadList).then(focus); return; }
    if (!current) return;
    const id = current.id;
    if (target.hasAttribute('data-comments')) { commentsOpen = !commentsOpen; render(); return; }
    if (target.hasAttribute('data-copy')) { void navigator.clipboard?.writeText(current.url); return; }
    if (target.hasAttribute('data-delete')) {
      if (!confirmDelete) { confirmDelete = true; render(); return; }
      void act(async () => {
        await call(`artifacts/${id}?${query()}`, undefined, 'DELETE');
        current = null;
        await loadList();
      });
    }
  });

  root.addEventListener('change', (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-version]');
    if (!select || !current) return;
    const wanted = Number(select.value);
    shownVersion = wanted === current.version ? null : wanted;
    void act(loadFrame);
  });

  root.addEventListener('submit', (event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-comment]');
    if (!form || !current) return;
    event.preventDefault();
    const text = String(new FormData(form).get('text') ?? '').trim();
    if (!text) return;
    const id = current.id;
    void act(async () => {
      await call(`artifacts/${id}/comments?${query()}`, { text, anchor: { tab: TAB, version: shownVersion ?? current?.version } });
      threads = await call<Thread[]>(`artifacts/${id}/comments?${query()}`);
    });
  });

  const takeShow = () => {
    const holder = window as unknown as Record<string, { project?: string | null; artifact?: string | null } | undefined>;
    const request = holder[SHOW_KEY];
    if (!request || (request.project && request.project !== project())) return;
    delete holder[SHOW_KEY];
    const target = request.artifact?.replace(/^piecemaker:\/\/artifact\//, '');
    const match = target?.match(/^([a-z][a-z0-9-]{2,63})(?:@v([1-9]\d*))?$/);
    if (match) void act(() => open(match[1], match[2] ? Number(match[2]) : null));
  };
  window.addEventListener(SHOW_EVENT, takeShow);

  async function poll() {
    if (stopped || document.hidden) return;
    try {
      if (!current) { await loadList(); render(); return; }
      const fresh = await call<Detail>(`artifacts/${current.id}?${query()}`);
      const newVersion = fresh.version !== current.version;
      const newData = fresh.data_stamp > dataStamp;
      dataStamp = Math.max(dataStamp, fresh.data_stamp);
      threads = await call<Thread[]>(`artifacts/${current.id}/comments?${query()}`).catch(() => threads);
      current = fresh;
      render();
      if (newVersion && shownVersion === null) await loadFrame();
      else if (newData) postToFrame({ kind: 'data' });
    } catch {
      if (current) { current = null; await loadList().catch(() => {}); render(); }
    }
  }
  const timer = window.setInterval(() => void poll(), POLL_MS);

  const stopContext = api.onContextChange((next) => {
    const moved = next.project?.path !== context.project?.path;
    context = next;
    root.dataset.theme = next.theme;
    postToFrame({ kind: 'theme', theme: next.theme });
    if (moved) { current = null; commentsOpen = false; void act(loadList).then(takeShow); }
  });

  void act(loadList).then(() => { takeShow(); focus(); });

  cleanups.set(container, () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('message', onMessage);
    window.removeEventListener(SHOW_EVENT, takeShow);
    stopContext();
  });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
  container.replaceChildren();
}
