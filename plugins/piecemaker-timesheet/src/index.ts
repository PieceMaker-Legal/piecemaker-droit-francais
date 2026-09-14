import type { PluginAPI, PluginContext, TimesheetEntry, TimesheetScope } from './types.js';

const AUTH_TOKEN_KEY = 'auth-token';
const TIMESHEET_PATH = '/api/piecemaker/timesheet';
const TOKEN_EXPIRY_SKEW_MS = 60_000;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const numberValue = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const tokenExpiry = (token: string): number | null => {
  try {
    const payloadPart = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = payloadPart.padEnd(payloadPart.length + ((4 - (payloadPart.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(paddedPayload)) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
};

const isExpiredToken = (token: string): boolean => {
  const expiresAt = tokenExpiry(token);
  return expiresAt !== null && Date.now() >= expiresAt - TOKEN_EXPIRY_SKEW_MS;
};

const nullableText = (value: unknown): string | null => {
  const text = textValue(value);
  return text ? text : null;
};

const normalizeEntry = (value: unknown): TimesheetEntry | null => {
  if (!isRecord(value)) return null;
  const sessionId = textValue(value.sessionId ?? value.session_id);
  if (!sessionId) return null;
  return {
    sessionId,
    provider: textValue(value.provider, 'unknown'),
    projectId: nullableText(value.projectId ?? value.project_id),
    projectName: textValue(value.projectName ?? value.project_name, 'Dossier sans nom'),
    projectPath: textValue(value.projectPath ?? value.project_path),
    sessionName: textValue(value.sessionName ?? value.session_name, sessionId),
    startedAt: nullableText(value.startedAt ?? value.started_at),
    endedAt: nullableText(value.endedAt ?? value.ended_at),
    activeSeconds: Math.max(0, numberValue(value.activeSeconds ?? value.active_seconds)),
    elapsedSeconds: Math.max(0, numberValue(value.elapsedSeconds ?? value.elapsed_seconds)),
    conclusion: textValue(value.conclusion),
    conclusionAt: nullableText(value.conclusionAt ?? value.conclusion_at),
  };
};

const unwrapEntries = (value: unknown): TimesheetEntry[] => {
  if (Array.isArray(value)) return value.map(normalizeEntry).filter((entry): entry is TimesheetEntry => entry !== null);
  if (!isRecord(value)) return [];
  const candidates = [value.entries, value.data, value.result, value.items];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return unwrapEntries(candidate);
    if (isRecord(candidate)) {
      const nested = unwrapEntries(candidate);
      if (nested.length > 0) return nested;
    }
  }
  return [];
};

const readToken = (): string | null => {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token && isExpiredToken(token)) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
};

const storeRefreshedToken = (value: string | null): void => {
  if (!value || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return;
  if (isExpiredToken(value)) return;
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, value);
  } catch {
    return;
  }
};

const expireToken = (): void => {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    return;
  }
};

const getErrorMessage = (value: unknown, status: number): string => {
  if (isRecord(value)) {
    const message = value.error ?? value.message ?? value.details;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `Impossible de charger le timesheet (${status}).`;
};

const request = async (method: 'GET' | 'POST', url: string, body: unknown, signal?: AbortSignal): Promise<unknown> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method === 'POST') headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal,
  });
  storeRefreshedToken(response.headers.get('X-Refreshed-Token'));
  if (response.headers.get('X-Auth-Error')) expireToken();
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(getErrorMessage(payload, response.status));
  if (isRecord(payload) && payload.success === false) throw new Error(getErrorMessage(payload, response.status));
  return payload;
};

const entriesUrl = (scope: TimesheetScope, projectId: string | null): string => {
  const query = new URLSearchParams({ scope });
  if (scope === 'project' && projectId) query.set('projectId', projectId);
  return `${TIMESHEET_PATH}/entries?${query.toString()}`;
};

const fetchEntries = async (scope: TimesheetScope, projectId: string | null, signal?: AbortSignal): Promise<TimesheetEntry[]> =>
  unwrapEntries(await request('GET', entriesUrl(scope, projectId), undefined, signal));

type TimesheetRefreshResult = { entries: TimesheetEntry[]; errors: Array<{ sessionId: string; code: string }> };

const refreshEntries = async (scope: TimesheetScope, projectId: string | null, signal?: AbortSignal): Promise<TimesheetRefreshResult> => {
  const payload = await request('POST', `${TIMESHEET_PATH}/refresh`, {
    scope,
    ...(scope === 'project' && projectId ? { projectId } : {}),
  }, signal);
  const errors = isRecord(payload) && Array.isArray(payload.errors)
    ? payload.errors.filter(isRecord).map((error) => ({
        sessionId: textValue(error.sessionId ?? error.session_id),
        code: textValue(error.code, 'EXTRACTION_FAILED'),
      })).filter((error) => error.sessionId)
    : [];
  return { entries: unwrapEntries(payload), errors };
};

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min ${String(remainingSeconds).padStart(2, '0')} s`;
  return `${remainingSeconds} s`;
}

type ViewState = {
  context: PluginContext;
  scope: TimesheetScope;
  folder: string;
  entries: TimesheetEntry[];
  loaded: boolean;
  loading: boolean;
  refreshing: boolean;
  refreshedAt: Date | null;
  error: string | null;
  requestId: number;
  abortController: AbortController | null;
  unsubscribe: (() => void) | null;
  root: HTMLElement;
  style: HTMLStyleElement;
  disposed: boolean;
};

const STYLE_TEXT = `
  .pm-timesheet { height: 100%; overflow: auto; padding: 24px; box-sizing: border-box; color: hsl(var(--foreground, 0 0% 12%)); background: hsl(var(--background, 0 0% 100%)); font: 14px system-ui, sans-serif; }
  .pm-timesheet * { box-sizing: border-box; }
  .pm-timesheet__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin: 0 0 20px; }
  .pm-timesheet__title { margin: 0 0 6px; font-size: 20px; }
  .pm-timesheet__subtitle { margin: 4px 0; color: hsl(var(--muted-foreground, 0 0% 45%)); line-height: 1.5; }
  .pm-timesheet__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 20px 0; }
  .pm-timesheet__select, .pm-timesheet__button { font: inherit; cursor: pointer; color: inherit; background: transparent; border: 1px solid hsl(var(--border, 0 0% 87%)); border-radius: 6px; padding: 7px 12px; }
  .pm-timesheet__button:disabled { opacity: .45; cursor: default; }
  .pm-timesheet__button:hover, .pm-timesheet__button:focus-visible, .pm-timesheet__select:focus-visible { outline: 2px solid #6366f1; outline-offset: 3px; }
  .pm-timesheet__status { min-height: 24px; margin: 12px 0; color: hsl(var(--muted-foreground, 0 0% 45%)); }
  .pm-timesheet__status--error { color: #b91c1c; }
  .pm-timesheet__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .pm-timesheet__empty { padding: 16px 0; color: hsl(var(--muted-foreground, 0 0% 45%)); line-height: 1.5; }
  .pm-timesheet__table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .pm-timesheet__table { width: 100%; min-width: 760px; border-collapse: collapse; }
  .pm-timesheet__table th, .pm-timesheet__table td { padding: 16px 10px; border-bottom: 1px solid hsl(var(--border, 0 0% 87%)); text-align: left; vertical-align: top; }
  .pm-timesheet__table th:first-child, .pm-timesheet__table td:first-child { padding-left: 0; }
  .pm-timesheet__table th:last-child, .pm-timesheet__table td:last-child { padding-right: 0; }
  .pm-timesheet__table th { color: hsl(var(--muted-foreground, 0 0% 45%)); font-size: 12px; font-weight: 600; }
  .pm-timesheet__table td { line-height: 1.5; }
  .pm-timesheet__table tr:last-child td { border-bottom: 0; }
  .pm-timesheet__month td { padding: 10px 0; background: hsl(var(--muted, 0 0% 93%)); font-weight: 600; }
  .pm-timesheet__month:first-child td { border-top: 0; }
  .pm-timesheet__month-total { float: right; color: hsl(var(--muted-foreground, 0 0% 45%)); font-weight: 400; }
  .pm-timesheet__date { white-space: nowrap; }
  .pm-timesheet__folder { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-timesheet__session { max-width: 260px; overflow-wrap: anywhere; }
  .pm-timesheet__conclusion { max-width: 420px; white-space: pre-wrap; }
  .pm-timesheet__conclusion summary { cursor: pointer; color: inherit; }
  .pm-timesheet__conclusion summary:focus-visible { outline: 2px solid #6366f1; outline-offset: 3px; }
  .pm-timesheet__conclusion p { margin: 4px 0; color: hsl(var(--muted-foreground, 0 0% 45%)); line-height: 1.5; }
  .pm-timesheet__muted { color: hsl(var(--muted-foreground, 0 0% 45%)); }
  @media (max-width: 600px) {
    .pm-timesheet { padding: 16px; }
    .pm-timesheet__header { display: block; }
    .pm-timesheet__actions { margin-top: 14px; }
  }
`;

const makeElement = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
};

const appendText = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text: string, className?: string): HTMLElementTagNameMap[K] => {
  const element = makeElement(tag, className);
  element.textContent = text;
  parent.appendChild(element);
  return element;
};

const clearElement = (element: HTMLElement): void => {
  while (element.firstChild) element.removeChild(element.firstChild);
};

const validDate = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value: string | null): string => {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Date inconnue';
};

const monthLabel = (value: string | null): string => {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date) : 'Date inconnue';
};

const monthKey = (value: string | null): string => {
  const date = validDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : 'unknown';
};

const sortEntries = (entries: TimesheetEntry[]): TimesheetEntry[] => [...entries].sort((left, right) => {
  const leftTime = validDate(left.startedAt)?.getTime() ?? 0;
  const rightTime = validDate(right.startedAt)?.getTime() ?? 0;
  return rightTime - leftTime || left.sessionName.localeCompare(right.sessionName, 'fr');
});

const totalSeconds = (entries: TimesheetEntry[]): number => entries.reduce((total, entry) => total + entry.activeSeconds, 0);

type FolderOption = { key: string; label: string };

const folderOptions = (entries: TimesheetEntry[]): FolderOption[] => {
  const options = new Map<string, FolderOption>();
  for (const entry of entries) {
    const key = entry.projectId ?? entry.projectName;
    if (!key || options.has(key)) continue;
    options.set(key, { key, label: entry.projectName || key });
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label, 'fr') || left.key.localeCompare(right.key, 'fr'));
};

const entryFolderKey = (entry: TimesheetEntry): string => entry.projectId ?? entry.projectName;

const projectLabel = (project: PluginContext['project']): string => {
  if (!project) return 'Dossier actuel';
  const trimmedPath = project.path.replace(/[\\/]+$/, '');
  const segments = trimmedPath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || project.path || 'Dossier actuel';
};

const buildTable = (entries: TimesheetEntry[]): HTMLDivElement => {
  const wrapper = makeElement('div', 'pm-timesheet__table-wrap');
  const table = makeElement('table', 'pm-timesheet__table');
  const caption = makeElement('caption', 'pm-timesheet__sr-only');
  caption.textContent = 'Sessions du timesheet';
  table.appendChild(caption);
  const head = makeElement('thead');
  const headerRow = makeElement('tr');
  for (const label of ['Date', 'Dossier', 'Session', 'Temps', 'Conclusion']) {
    const header = appendText(headerRow, 'th', label);
    header.scope = 'col';
  }
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = makeElement('tbody');
  let currentMonth = '';
  for (const entry of sortEntries(entries)) {
    const key = monthKey(entry.startedAt);
    if (key !== currentMonth) {
      currentMonth = key;
      const monthRow = makeElement('tr', 'pm-timesheet__month');
      const monthCell = makeElement('td');
      monthCell.colSpan = 5;
      appendText(monthCell, 'span', monthLabel(entry.startedAt));
      monthRow.appendChild(monthCell);
      body.appendChild(monthRow);
    }
    const row = makeElement('tr');
    appendText(row, 'td', formatDate(entry.startedAt), 'pm-timesheet__date');
    const folderCell = makeElement('td', 'pm-timesheet__folder');
    folderCell.title = entry.projectPath || entry.projectName;
    folderCell.textContent = entry.projectName;
    row.appendChild(folderCell);
    appendText(row, 'td', entry.sessionName, 'pm-timesheet__session');
    const durationCell = appendText(row, 'td', formatDuration(entry.activeSeconds));
    durationCell.title = `Temps écoulé : ${formatDuration(entry.elapsedSeconds)}`;
    const conclusionCell = makeElement('td', 'pm-timesheet__conclusion');
    if (entry.conclusion) {
      const details = makeElement('details');
      const summary = makeElement('summary');
      const preview = entry.conclusion.replace(/\s+/g, ' ').trim();
      summary.textContent = preview.length > 110 ? `${preview.slice(0, 107)}…` : preview;
      const paragraph = makeElement('p');
      paragraph.textContent = entry.conclusion;
      details.append(summary, paragraph);
      conclusionCell.appendChild(details);
    } else {
      conclusionCell.textContent = 'Aucune conclusion';
      conclusionCell.classList.add('pm-timesheet__muted');
    }
    row.appendChild(conclusionCell);
    body.appendChild(row);
  }
  table.appendChild(body);
  wrapper.appendChild(table);
  return wrapper;
};

const render = (state: ViewState): void => {
  const { root, context } = state;
  const visibleEntries = state.scope === 'all' && state.folder ? state.entries.filter((entry) => entryFolderKey(entry) === state.folder) : state.entries;
  clearElement(root);
  const header = makeElement('header', 'pm-timesheet__header');
  const heading = makeElement('div');
  appendText(heading, 'h1', 'Timesheet', 'pm-timesheet__title');
  appendText(heading, 'p', state.scope === 'project' && context.project ? projectLabel(context.project) : 'Tous les dossiers', 'pm-timesheet__subtitle');
  if (state.loaded && visibleEntries.length > 0) {
    appendText(heading, 'p', `Total affiché : ${formatDuration(totalSeconds(visibleEntries))}`, 'pm-timesheet__subtitle');
  }
  header.appendChild(heading);
  const actions = makeElement('div', 'pm-timesheet__actions');
  const scopeSelect = makeElement('select', 'pm-timesheet__select');
  scopeSelect.setAttribute('aria-label', 'Périmètre du timesheet');
  for (const option of [['all', 'Tous les dossiers'], ['project', 'Dossier actuel']] as const) {
    const item = makeElement('option');
    item.value = option[0];
    item.textContent = option[1];
    item.selected = state.scope === option[0];
    scopeSelect.appendChild(item);
  }
  scopeSelect.addEventListener('change', () => {
    state.scope = scopeSelect.value as TimesheetScope;
    state.folder = '';
    void load(state, true);
  });
  actions.appendChild(scopeSelect);
  if (state.scope === 'all') {
    const folderSelect = makeElement('select', 'pm-timesheet__select');
    folderSelect.setAttribute('aria-label', 'Filtrer par dossier');
    const allOption = makeElement('option');
    allOption.value = '';
    allOption.textContent = 'Tous les dossiers';
    folderSelect.appendChild(allOption);
    for (const folder of folderOptions(state.entries)) {
      const option = makeElement('option');
      option.value = folder.key;
      option.textContent = folder.label;
      folderSelect.appendChild(option);
    }
    folderSelect.value = state.folder;
    folderSelect.addEventListener('change', () => {
      state.folder = folderSelect.value;
      render(state);
    });
    actions.appendChild(folderSelect);
  }
  const refreshButton = makeElement('button', 'pm-timesheet__button');
  refreshButton.type = 'button';
  refreshButton.textContent = state.refreshing ? 'Actualisation…' : 'Actualiser';
  refreshButton.disabled = state.loading || state.refreshing;
  refreshButton.addEventListener('click', () => void load(state, true));
  actions.appendChild(refreshButton);
  header.appendChild(actions);
  root.appendChild(header);
  const status = makeElement('div', state.error ? 'pm-timesheet__status pm-timesheet__status--error' : 'pm-timesheet__status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  if (state.error) status.setAttribute('role', 'alert');
  if (state.error) status.textContent = state.error;
  else if (state.refreshing) status.textContent = 'Actualisation des sessions…';
  else if (state.loading) status.textContent = 'Chargement des sessions…';
  else if (state.refreshedAt) status.textContent = `Actualisé à ${state.refreshedAt.toLocaleTimeString('fr-FR')}`;
  root.appendChild(status);
  if (!context.project && state.scope === 'project') {
    appendText(root, 'p', 'Sélectionnez un dossier pour afficher son timesheet.', 'pm-timesheet__empty');
    return;
  }
  if (state.loading && !state.loaded) {
    appendText(root, 'p', 'Chargement des sessions…', 'pm-timesheet__empty');
    return;
  }
  if (visibleEntries.length === 0) {
    appendText(root, 'p', 'Aucune session enregistrée pour ce périmètre.', 'pm-timesheet__empty');
    return;
  }
  const grouped = new Map<string, TimesheetEntry[]>();
  for (const entry of sortEntries(visibleEntries)) {
    const key = monthKey(entry.startedAt);
    const group = grouped.get(key) ?? [];
    group.push(entry);
    grouped.set(key, group);
  }
  const table = buildTable(visibleEntries);
  for (const group of grouped.values()) {
    const monthRow = Array.from(table.querySelectorAll('.pm-timesheet__month')).find((row) => row.textContent?.startsWith(monthLabel(group[0]?.startedAt ?? null)));
    if (monthRow) {
      const total = makeElement('span', 'pm-timesheet__month-total');
      total.textContent = formatDuration(totalSeconds(group));
      monthRow.querySelector('td')?.appendChild(total);
    }
  }
  root.appendChild(table);
};

async function load(state: ViewState, refresh: boolean): Promise<void> {
  if (state.disposed) return;
  state.abortController?.abort();
  const controller = new AbortController();
  state.abortController = controller;
  const requestId = ++state.requestId;
  const projectId = state.context.project?.name ?? null;
  if (state.scope === 'project' && !projectId) {
    state.entries = [];
    state.loaded = true;
    state.loading = false;
    state.refreshing = false;
    state.error = null;
    render(state);
    return;
  }
  state.loading = true;
  state.error = null;
  render(state);
  try {
    const cached = await fetchEntries(state.scope, projectId, controller.signal);
    if (state.disposed || state.requestId !== requestId) return;
    state.entries = cached;
    if (state.folder && !state.entries.some((entry) => entryFolderKey(entry) === state.folder)) state.folder = '';
    state.loaded = true;
    state.loading = false;
    render(state);
  } catch (error) {
    if (controller.signal.aborted || state.disposed || state.requestId !== requestId) return;
    state.loading = false;
    state.error = error instanceof Error ? error.message : 'Impossible de charger le timesheet.';
    render(state);
  }
  if (!refresh || state.disposed || state.requestId !== requestId) return;
  state.refreshing = true;
  render(state);
  try {
    const refreshed = await refreshEntries(state.scope, projectId, controller.signal);
    if (state.disposed || state.requestId !== requestId) return;
    state.entries = refreshed.entries;
    if (state.folder && !state.entries.some((entry) => entryFolderKey(entry) === state.folder)) state.folder = '';
    state.refreshedAt = new Date();
    state.error = refreshed.errors.length > 0
      ? `Actualisation partielle : ${refreshed.errors.length} session(s) non actualisée(s).`
      : null;
  } catch (error) {
    if (controller.signal.aborted || state.disposed || state.requestId !== requestId) return;
    state.error = error instanceof Error ? `Actualisation incomplète : ${error.message}` : 'Actualisation incomplète.';
  } finally {
    if (!state.disposed && state.requestId === requestId) {
      state.loading = false;
      state.refreshing = false;
      render(state);
    }
  }
}

const states = new WeakMap<HTMLElement, ViewState>();

export function mount(container: HTMLElement, api: PluginAPI): void {
  const previous = states.get(container);
  if (previous) {
    previous.disposed = true;
    previous.abortController?.abort();
    previous.unsubscribe?.();
    previous.style.remove();
    previous.root.remove();
  }
  const style = makeElement('style');
  style.textContent = STYLE_TEXT;
  const root = makeElement('main', 'pm-timesheet');
  root.setAttribute('aria-label', 'Timesheet');
  container.append(style, root);
  const state: ViewState = {
    context: api.context,
    scope: 'all',
    folder: '',
    entries: [],
    loaded: false,
    loading: false,
    refreshing: false,
    refreshedAt: null,
    error: null,
    requestId: 0,
    abortController: null,
    unsubscribe: null,
    root,
    style,
    disposed: false,
  };
  states.set(container, state);
  state.unsubscribe = api.onContextChange((context) => {
    if (state.disposed) return;
    state.context = context;
    if (state.scope === 'project') state.folder = '';
    void load(state, true);
  });
  render(state);
  void load(state, true);
}

export function unmount(container: HTMLElement): void {
  const state = states.get(container);
  if (!state) return;
  state.disposed = true;
  state.abortController?.abort();
  state.unsubscribe?.();
  state.style.remove();
  state.root.remove();
  states.delete(container);
}
