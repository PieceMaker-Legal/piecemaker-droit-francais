import { requestJson } from '../../../src/shared/authToken.js';
import { requestWorkspacePanel } from '../../../src/modules/piecemaker-workspace-tabs/requestWorkspacePanel.js';
import type { PluginApi } from '../../piecemaker-tabular-review/src/client/host.js';
import { PLUGIN_STYLES } from '../../piecemaker-tabular-review/src/client/styles.js';
import { messageCard } from './chat.js';
import { settingsPage } from './settings.js';
import { STYLES } from './styles.js';
import { button, el, overview, type Actions, type State } from './ui.js';

const base = '/api/piecemaker/orchestrateur/';
const cleanups = new WeakMap<HTMLElement, () => void>();
const tabs = ['Chat du projet', 'Vue d’ensemble', 'Paramètres'] as const;
type Tab = typeof tabs[number];

function projectView(root: HTMLElement, project: string, api: PluginApi) {
  let state: State | undefined;
  let tab: Tab = tabs[0];
  let filter = '';
  let ticket = 0;
  let fetching = false;
  let saving = false;
  let disposed = false;
  const error = el('p');
  error.className = 'pmp-error';
  error.setAttribute('role', 'alert');
  const main = el('main');
  main.className = 'pmp-main';
  const log = el('div');
  log.className = 'pmp-log';
  const cards = new Map<string, {key: string; node: HTMLElement}>();
  const input = el('textarea');
  input.placeholder = 'Écrire à l’orchestrateur…';
  input.setAttribute('aria-label', 'Message du projet');
  input.rows = 2;
  const submit = el('button', 'Envoyer');
  submit.className = 'ptr-button ptr-button-primary';
  const composer = el('form', input, submit);
  composer.className = 'pmp-composer';
  const hidden = () => document.hidden || Boolean(root.closest('[hidden]'));
  const actions: Actions = {
    async save(path, body, method) {
      if (disposed || saving) return false;
      saving = true;
      main.inert = true;
      submit.disabled = true;
      ++ticket;
      fetching = false;
      try {
        await requestJson(base + path, {project, ...body}, method);
        if (disposed) return false;
        error.textContent = '';
        await refresh();
        return !disposed;
      } catch (cause) {
        if (!disposed) error.textContent = String(cause);
        return false;
      } finally {
        saving = false;
        main.inert = false;
        submit.disabled = false;
      }
    },
    open(output) {
      if (output.kind === 'file') {
        const absolute = /^(?:[a-z]:[\\/]|[\\/])/i.test(output.ref);
        api.openFileInEditor?.(absolute ? output.ref : project.replace(/[\\/]$/, '') + '/' + output.ref);
      } else if (output.kind === 'artifact') {
        const artifact = output.ref.replace(/^piecemaker:\/\/artifact\/|^\/artifacts\//, '').split(/[/?#]/)[0];
        Object.assign(window, {__piecemakerArtifactsShow: {project, artifact}});
        requestWorkspacePanel('plugin:piecemaker-artifacts');
        window.dispatchEvent(new Event('piecemaker:artifacts-show'));
      } else if (/^https?:\/\//i.test(output.ref)) window.open(output.ref, '_blank', 'noopener,noreferrer');
      else error.textContent = 'Ce lien exige une adresse HTTP ou HTTPS.';
    },
  };
  const settings = settingsPage(actions);
  const nav = el('nav', ...tabs.map(name => button(name, () => {
    tab = name;
    render();
  })));
  nav.setAttribute('aria-label', 'Vues du projet');
  function render() {
    composer.hidden = tab !== tabs[0] || !state;
    for (const control of nav.querySelectorAll('button')) control.setAttribute('aria-pressed', String(tab === control.textContent));
    if (!state) return;
    if (tab === tabs[2]) {
      settings.update(state);
      if (main.firstChild !== settings.page) main.replaceChildren(settings.page);
    } else if (tab === tabs[1]) {
      main.replaceChildren(overview(state, filter, value => { filter = value; render(); }, actions));
    } else {
      const atEnd = main.firstChild !== log || main.scrollHeight - main.scrollTop - main.clientHeight < 50;
      if (main.firstChild !== log) main.replaceChildren(log);
      for (const m of state.messages) {
        const thread = state.threads.find(t => t.id === m.threadId);
        const key = JSON.stringify([m, thread?.state, thread?.sessionId, thread?.title, thread?.provider,
          m.decisionIds.map(id => state!.decisions.find(d => d.id === id))]);
        const old = cards.get(m.id);
        if (old?.key === key) continue;
        const node = messageCard(m, state, actions);
        if (old) {
          const draft = old.node.querySelector('textarea');
          const next = node.querySelector('textarea');
          if (draft && next && draft.value !== draft.defaultValue) next.value = draft.value;
          old.node.replaceWith(node);
        } else log.append(node);
        cards.set(m.id, {key, node});
      }
      if (atEnd) main.scrollTop = main.scrollHeight;
    }
  }
  async function refresh() {
    const current = ++ticket;
    fetching = true;
    try {
      const next = await requestJson<State>(base + 'state?' + new URLSearchParams({project}));
      if (disposed || current !== ticket) return;
      if (state && hidden() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const previous = new Set(state.messages.map(m => m.id));
        for (const m of next.messages) if (m.notify && !previous.has(m.id)) new Notification('Projet', {body: m.text, tag: m.id});
      }
      const changed = !state || state.revision !== next.revision || state.memory.revision !== next.memory.revision ||
        JSON.stringify([state.files, state.providers]) !== JSON.stringify([next.files, next.providers]);
      state = next;
      if (changed) render();
    } catch (cause) {
      if (!disposed && current === ticket) error.textContent = String(cause);
    } finally {
      if (current === ticket) fetching = false;
    }
  }
  function poll() {
    if (!disposed && !hidden() && !saving && !fetching) void refresh();
  }
  composer.onsubmit = async event => {
    event.preventDefault();
    const text = input.value;
    if (text.trim() && await actions.save('message', {text}) && input.value === text) input.value = '';
  };
  input.onkeydown = event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!submit.disabled) composer.requestSubmit();
    }
  };
  main.textContent = 'Chargement du projet…';
  root.replaceChildren(nav, error, main, composer);
  render();
  poll();
  const interval = window.setInterval(poll, 2000);
  document.addEventListener('visibilitychange', poll);
  return () => {
    disposed = true;
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', poll);
  };
}

export function mount(container: HTMLElement, api: PluginApi) {
  unmount(container);
  const style = el('style', PLUGIN_STYLES + STYLES);
  const root = el('section');
  root.className = 'pmp-root ptr-root piecemaker-ui';
  root.setAttribute('aria-label', 'Projet');
  container.replaceChildren(style, root);
  let project: string | null | undefined;
  let dispose: (() => void) | undefined;
  function context(ctx: PluginApi['context']) {
    root.dataset.theme = ctx.theme;
    const path = ctx.project?.path ?? null;
    if (project === path) return;
    dispose?.();
    project = path;
    if (path) dispose = projectView(root, path, api);
    else root.textContent = 'Ouvrez un dossier.';
  }
  context(api.context);
  const unsubscribe = api.onContextChange(context);
  cleanups.set(container, () => { dispose?.(); unsubscribe(); container.replaceChildren(); });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
