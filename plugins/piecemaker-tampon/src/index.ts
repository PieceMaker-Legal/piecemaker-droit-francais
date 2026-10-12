import {
  DEFAULT_STAMP_CONFIG,
  renderStampDataUrl,
  type StampConfig,
  type StampShape,
} from './StampingCanvas.js';

type PluginContext = {
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
};

type PluginAPI = {
  readonly context: PluginContext;
  onContextChange(callback: (context: PluginContext) => void): () => void;
};

type TamponFormat = 'png' | 'jpeg';
type TamponLoadResponse = { success: true; tamponImage: string; filename: string; format: TamponFormat };
type DossierCase = { path: string; name: string; location: string; registered: boolean };
type CaseOriginalPiece = {
  name: string;
  path: string;
  status: 'ready' | 'awaiting-scan' | 'not-converted';
};
type StampingPieceResult = {
  pieceNumber: number;
  id: string;
  filename: string;
  success: boolean;
  error?: string;
};
type StampingResponse = {
  success: true;
  legacy?: boolean;
  message: string;
  results: StampingPieceResult[];
};

const AUTH_TOKEN_KEY = 'auth-token';
const PIECEMAKER_BASE = '/api/piecemaker';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const SHAPE_OPTIONS: Array<{ id: StampShape; label: string }> = [
  { id: 'circle', label: 'Rond' },
  { id: 'oval', label: 'Ovale' },
  { id: 'rect', label: 'Rectangle' },
];
const STATUS_LABEL: Record<CaseOriginalPiece['status'], string> = {
  ready: '',
  'awaiting-scan': 'Non scannée',
  'not-converted': 'Non convertie',
};

const STYLE_TEXT = `
  .pm-tampon { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: hsl(var(--foreground, 222 47% 11%)); background: hsl(var(--background, 0 0% 100%)); font: 15px/1.4 var(--piecemaker-font-ui, Inter, ui-sans-serif, system-ui, sans-serif); }
  .pm-tampon * { box-sizing: border-box; }
  .pm-tampon__head { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; width: 100%; max-width: 48rem; margin: 0 auto; padding: 16px 16px 12px; }
  .pm-tampon__head-text { flex: 1; min-width: 0; }
  .pm-tampon__title { margin: 0; font-family: var(--piecemaker-font-editorial, EB Garamond, Georgia, serif); font-size: 1.4rem; font-weight: 500; letter-spacing: -.02em; }
  .pm-tampon__muted { margin: 0; color: hsl(var(--muted-foreground, 220 9% 46%)); font-size: 13px; }
  .pm-tampon__error { margin: 0; color: hsl(var(--destructive, 0 72% 51%)); font-size: 13px; }
  .pm-tampon__stamp { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 4px 12px 4px 4px; border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: 999px; background: hsl(var(--card, 0 0% 100%)); color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
  .pm-tampon__stamp img { width: 36px; height: 36px; object-fit: contain; border-radius: 999px; background: #fff; }
  .pm-tampon__stamp--missing { border-color: hsl(var(--destructive, 0 72% 51%)); color: hsl(var(--destructive, 0 72% 51%)); padding-left: 12px; }
  .pm-tampon__scroll { flex: 1; min-height: 0; overflow: auto; -webkit-overflow-scrolling: touch; }
  .pm-tampon__content { width: 100%; max-width: 48rem; margin: 0 auto; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 8px; }
  .pm-tampon__section { margin: 12px 0 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: hsl(var(--muted-foreground, 220 9% 46%)); }
  .pm-tampon__list { display: flex; flex-direction: column; border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: .75rem; overflow: hidden; background: hsl(var(--card, 0 0% 100%)); }
  .pm-tampon__row { display: flex; align-items: center; min-height: 52px; border-top: 1px solid hsl(var(--border, 220 13% 91%)); }
  .pm-tampon__row:first-child { border-top: 0; }
  .pm-tampon__toggle { flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .pm-tampon__number { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 999px; border: 1.5px solid hsl(var(--border, 220 13% 91%)); font-size: 13px; font-weight: 600; }
  .pm-tampon__row--selected .pm-tampon__number { border-color: hsl(var(--foreground, 222 47% 11%)); background: hsl(var(--foreground, 222 47% 11%)); color: hsl(var(--background, 0 0% 100%)); }
  .pm-tampon__name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pm-tampon__name strong { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-tampon__name small { color: hsl(var(--muted-foreground, 220 9% 46%)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-tampon__tag { flex: 0 0 auto; font-size: 11px; color: hsl(var(--muted-foreground, 220 9% 46%)); }
  .pm-tampon__move { flex: 0 0 auto; width: 44px; height: 52px; border: 0; background: transparent; color: inherit; font-size: 18px; cursor: pointer; }
  .pm-tampon__move:disabled { opacity: .25; cursor: default; }
  .pm-tampon__foot { flex: 0 0 auto; border-top: 1px solid hsl(var(--border, 220 13% 91%)); background: hsl(var(--background, 0 0% 100%)); padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); }
  .pm-tampon__foot-inner { max-width: 48rem; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; }
  .pm-tampon__foot .piecemaker-button { width: 100%; min-height: 48px; justify-content: center; font-size: 15px; }
  .pm-tampon__result { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  .pm-tampon__link { border: 0; background: transparent; padding: 4px 0; color: inherit; font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; }
  @media (hover: none) { .pm-tampon__reveal { display: none; } }
  .pm-tampon__overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgb(0 0 0 / 55%); }
  .pm-tampon__dialog { width: min(420px, 100%); max-height: calc(100dvh - 32px); overflow: auto; display: flex; flex-direction: column; gap: 16px; padding: 20px; border-radius: 1rem; background: hsl(var(--card, 0 0% 100%)); box-shadow: 0 24px 80px rgb(0 0 0 / 35%); outline: none; }
  .pm-tampon__preview { align-self: center; width: 180px; height: 180px; display: flex; align-items: center; justify-content: center; padding: 8px; border-radius: 1rem; background: #fff; color: #6b7280; }
  .pm-tampon__preview img { width: 100%; height: 100%; object-fit: contain; }
  .pm-tampon__field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: hsl(var(--muted-foreground, 220 9% 46%)); }
  .pm-tampon__field input { width: 100%; min-height: 44px; padding: 8px 12px; font: inherit; font-size: 16px; color: hsl(var(--foreground, 222 47% 11%)); background: hsl(var(--background, 0 0% 100%)); border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: .75rem; }
  .pm-tampon__segments { display: flex; gap: 6px; }
  .pm-tampon__segments button { flex: 1; min-height: 40px; border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: .75rem; background: transparent; color: inherit; font: inherit; font-size: 14px; cursor: pointer; }
  .pm-tampon__segments button[aria-pressed=true] { border-color: hsl(var(--foreground, 222 47% 11%)); font-weight: 600; }
  .pm-tampon__actions { display: flex; gap: 8px; }
  .pm-tampon__actions .piecemaker-button { flex: 1; min-height: 44px; justify-content: center; }
  .pm-tampon__hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
  @media (max-width: 560px) {
    .pm-tampon__overlay { padding: 0; align-items: flex-end; }
    .pm-tampon__dialog { width: 100%; max-height: 100dvh; border-radius: 1rem 1rem 0 0; padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px)); }
  }
`;

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

let cachedTampon: string | null | undefined;
const caseCache = new Map<string, DossierCase>();
const originalsCache = new Map<string, CaseOriginalPiece[]>();

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

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${PIECEMAKER_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) localStorage.setItem(AUTH_TOKEN_KEY, refreshed);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : `Erreur ${response.status}`;
    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
};

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible.'));
  reader.readAsDataURL(file);
});

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
const statusOf = (cause: unknown): number => (cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0);

type ViewState = {
  api: PluginAPI;
  root: HTMLElement;
  style: HTMLStyleElement;
  disposed: boolean;
  unsubscribe: (() => void) | null;
  config: StampConfig;
  editorOpen: boolean;
  pendingImage: string | null;
  savedImage: string | null;
  loadingTampon: boolean;
  tamponError: string | null;
  saving: boolean;
  legalCase: DossierCase | null;
  caseLoading: boolean;
  caseError: string | null;
  originals: CaseOriginalPiece[] | null;
  originalsError: string | null;
  selectedOrder: string[];
  running: boolean;
  runError: string | null;
  runResult: StampingResponse | null;
  revealError: string | null;
};

const mounted = new WeakMap<HTMLElement, ViewState>();

const projectPathOf = (api: PluginAPI): string | null => api.context.project?.path || null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, action: () => void, className = '', disabled = false): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.disabled = disabled;
  node.addEventListener('click', action);
  return node;
}

async function loadTampon(state: ViewState): Promise<void> {
  try {
    const response = await request<TamponLoadResponse>('GET', '/tampon/load');
    if (state.disposed) return;
    cachedTampon = response.tamponImage;
    state.savedImage = response.tamponImage;
    state.tamponError = null;
  } catch (cause) {
    if (state.disposed) return;
    if (statusOf(cause) === 404) {
      cachedTampon = null;
      state.savedImage = null;
    } else {
      state.tamponError = messageOf(cause);
    }
  } finally {
    if (!state.disposed) {
      state.loadingTampon = false;
      render(state);
    }
  }
}

async function loadCase(state: ViewState): Promise<void> {
  const projectPath = projectPathOf(state.api);
  state.selectedOrder = [];
  state.runResult = null;
  state.runError = null;
  state.originals = null;
  state.originalsError = null;
  state.legalCase = projectPath ? caseCache.get(projectPath) ?? null : null;
  state.caseLoading = Boolean(projectPath && !state.legalCase);
  render(state);
  if (!projectPath) return;
  if (state.legalCase) void loadPieces(state, state.legalCase);
  try {
    const overview = await request<{ folders?: DossierCase[] }>('GET', '/repository');
    if (state.disposed || projectPathOf(state.api) !== projectPath) return;
    const legalCase = (overview.folders ?? []).find((entry) => entry.location === projectPath)
      ?? (await request<{ folder: DossierCase }>('POST', '/repository/cases/selected', { folder: projectPath })).folder;
    if (state.disposed || projectPathOf(state.api) !== projectPath) return;
    caseCache.set(projectPath, legalCase);
    const changed = state.legalCase?.path !== legalCase.path;
    state.legalCase = legalCase;
    state.caseError = null;
    if (changed) void loadPieces(state, legalCase);
  } catch (cause) {
    if (state.disposed || projectPathOf(state.api) !== projectPath) return;
    state.caseError = messageOf(cause);
  } finally {
    if (!state.disposed && projectPathOf(state.api) === projectPath) {
      state.caseLoading = false;
      render(state);
    }
  }
}

async function loadPieces(state: ViewState, legalCase: DossierCase): Promise<void> {
  const isCurrent = () => !state.disposed && state.legalCase?.path === legalCase.path;
  state.originals = originalsCache.get(legalCase.path) ?? null;
  render(state);
  const [originals, last] = await Promise.allSettled([
    request<{ folder: { originals?: CaseOriginalPiece[] } }>('GET', `/repository/case?case=${encodeURIComponent(legalCase.path)}`),
    request<StampingResponse>('GET', `/stamping/last?documentId=${encodeURIComponent(legalCase.path)}&folder=${encodeURIComponent(legalCase.location)}`),
  ]);
  if (!isCurrent()) return;
  if (originals.status === 'fulfilled') {
    const pieces = originals.value.folder.originals ?? [];
    originalsCache.set(legalCase.path, pieces);
    state.originals = pieces;
    state.originalsError = null;
  } else {
    state.originalsError = messageOf(originals.reason);
  }
  if (last.status === 'fulfilled' && !last.value.legacy && state.selectedOrder.length === 0) {
    const known = new Set((state.originals ?? []).map((piece) => piece.path));
    state.selectedOrder = last.value.results.map((entry) => entry.id).filter((id) => known.has(id));
  } else if (last.status === 'rejected' && statusOf(last.reason) !== 404) {
    state.runError = messageOf(last.reason);
  }
  render(state);
}

function stampPieces(state: ViewState): void {
  const legalCase = state.legalCase;
  if (!legalCase || state.selectedOrder.length === 0) return;
  state.running = true;
  state.runError = null;
  state.runResult = null;
  state.revealError = null;
  render(state);
  void request<StampingResponse>('POST', '/stamping', {
    pieces: state.selectedOrder,
    documentId: legalCase.path,
    folder: legalCase.location,
  }).then((response) => {
    state.runResult = response;
  }).catch((cause) => {
    state.runError = messageOf(cause);
  }).finally(() => {
    state.running = false;
    if (!state.disposed) render(state);
  });
}

function revealStampedPieces(state: ViewState): void {
  if (!state.legalCase) return;
  void request('POST', '/reveal', { target: 'files', case: state.legalCase.path, path: 'Pièces tamponnées' }).catch((cause) => {
    state.revealError = messageOf(cause);
    if (!state.disposed) render(state);
  });
}

function openEditor(state: ViewState): void {
  state.editorOpen = true;
  state.pendingImage = null;
  state.tamponError = null;
  render(state);
  requestAnimationFrame(() => state.root.querySelector<HTMLElement>('.pm-tampon__dialog')?.focus());
}

function closeEditor(state: ViewState): void {
  state.editorOpen = false;
  state.pendingImage = null;
  render(state);
}

function saveTampon(state: ViewState): void {
  const image = state.pendingImage;
  if (!image) return;
  state.saving = true;
  render(state);
  void request('POST', '/tampon/save', { tamponImage: image }).then(() => {
    if (state.disposed) return;
    cachedTampon = image;
    state.savedImage = image;
    state.editorOpen = false;
    state.pendingImage = null;
    state.tamponError = null;
  }).catch((cause) => {
    state.tamponError = messageOf(cause);
  }).finally(() => {
    state.saving = false;
    if (!state.disposed) render(state);
  });
}

function renderEditor(state: ViewState): HTMLElement {
  const overlay = element('div', 'pm-tampon__overlay');
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeEditor(state);
  });
  const dialog = element('section', 'pm-tampon__dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Tampon du cabinet');
  dialog.tabIndex = -1;
  dialog.append(element('h2', 'pm-tampon__title piecemaker-display', 'Tampon du cabinet'));

  const preview = element('div', 'pm-tampon__preview');
  const previewImage = element('img');
  previewImage.alt = 'Aperçu du tampon';
  const shown = state.pendingImage ?? state.savedImage;
  if (shown) {
    previewImage.src = shown;
    preview.append(previewImage);
  } else {
    preview.append(element('p', 'pm-tampon__muted', 'Aucun tampon'));
  }
  dialog.append(preview);

  const regenerate = () => {
    state.pendingImage = renderStampDataUrl(state.config);
    previewImage.src = state.pendingImage;
    if (!previewImage.isConnected) preview.replaceChildren(previewImage);
    saveButton.disabled = false;
  };
  const textField = (label: string, key: 'topText' | 'bottomText') => {
    const field = element('label', 'pm-tampon__field', label);
    const input = element('input');
    input.type = 'text';
    input.maxLength = 40;
    input.value = state.config[key];
    input.addEventListener('input', () => {
      state.config = { ...state.config, [key]: input.value };
      regenerate();
    });
    field.append(input);
    return field;
  };
  dialog.append(textField('Texte du haut', 'topText'), textField('Texte du bas', 'bottomText'));

  const shapes = element('div', 'pm-tampon__segments');
  shapes.setAttribute('role', 'group');
  shapes.setAttribute('aria-label', 'Forme');
  for (const option of SHAPE_OPTIONS) {
    const shape = button(option.label, () => {
      state.config = { ...state.config, shape: option.id };
      state.pendingImage = renderStampDataUrl(state.config);
      render(state);
    });
    shape.setAttribute('aria-pressed', String(state.config.shape === option.id));
    shapes.append(shape);
  }
  dialog.append(shapes);

  const fileInput = element('input', 'pm-tampon__hidden');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      state.tamponError = 'Format non supporté. Utilisez une image PNG ou JPEG.';
      render(state);
      return;
    }
    void readFileAsDataUrl(file).then((dataUrl) => {
      if (state.disposed) return;
      state.pendingImage = dataUrl;
      state.tamponError = null;
      render(state);
    }).catch((cause) => {
      state.tamponError = messageOf(cause);
      render(state);
    });
  });
  dialog.append(fileInput, button('Importer une image du tampon…', () => fileInput.click(), 'pm-tampon__link'));
  if (state.tamponError) dialog.append(element('p', 'pm-tampon__error', state.tamponError));

  const actions = element('div', 'pm-tampon__actions');
  const saveButton = button(
    state.saving ? 'Enregistrement…' : 'Enregistrer',
    () => saveTampon(state),
    'piecemaker-button piecemaker-button--normal piecemaker-button--black',
    !state.pendingImage || state.saving,
  );
  actions.append(button('Fermer', () => closeEditor(state), 'piecemaker-button piecemaker-button--normal piecemaker-button--glass'), saveButton);
  dialog.append(actions);
  overlay.append(dialog);
  return overlay;
}

function renderRow(state: ViewState, piece: CaseOriginalPiece): HTMLElement {
  const index = state.selectedOrder.indexOf(piece.path);
  const selected = index !== -1;
  const row = element('div', selected ? 'pm-tampon__row pm-tampon__row--selected' : 'pm-tampon__row');
  const toggle = button('', () => {
    state.selectedOrder = selected
      ? state.selectedOrder.filter((entry) => entry !== piece.path)
      : [...state.selectedOrder, piece.path];
    render(state);
  }, 'pm-tampon__toggle');
  toggle.setAttribute('aria-pressed', String(selected));
  const name = element('span', 'pm-tampon__name');
  name.append(element('strong', undefined, piece.name));
  const folder = piece.path.slice(0, Math.max(0, piece.path.length - piece.name.length)).replace(/\/$/, '');
  if (folder) name.append(element('small', undefined, folder));
  toggle.append(element('span', 'pm-tampon__number', selected ? String(index + 1) : ''), name);
  if (STATUS_LABEL[piece.status]) toggle.append(element('span', 'pm-tampon__tag', STATUS_LABEL[piece.status]));
  row.append(toggle);
  if (selected) {
    const move = (offset: -1 | 1) => {
      const next = [...state.selectedOrder];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      state.selectedOrder = next;
      render(state);
    };
    const up = button('↑', () => move(-1), 'pm-tampon__move', index === 0);
    up.setAttribute('aria-label', `Monter la pièce n°${index + 1}`);
    const down = button('↓', () => move(1), 'pm-tampon__move', index === state.selectedOrder.length - 1);
    down.setAttribute('aria-label', `Descendre la pièce n°${index + 1}`);
    row.append(up, down);
  }
  return row;
}

function renderPieces(state: ViewState): HTMLElement {
  const content = element('div', 'pm-tampon__content');
  if (!projectPathOf(state.api)) content.append(element('p', 'pm-tampon__muted', 'Ouvrez un dossier pour préparer son bordereau.'));
  else if (state.caseError) content.append(element('p', 'pm-tampon__error', state.caseError));
  else if (state.originalsError) content.append(element('p', 'pm-tampon__error', state.originalsError));
  else if (state.caseLoading || !state.originals) content.append(element('p', 'pm-tampon__muted', 'Chargement des pièces…'));
  else if (state.originals.length === 0) content.append(element('p', 'pm-tampon__muted', 'Ce dossier ne contient aucune pièce.'));
  else {
    const byPath = new Map(state.originals.map((piece) => [piece.path, piece]));
    const chosen = state.selectedOrder.map((path) => byPath.get(path)).filter((piece): piece is CaseOriginalPiece => Boolean(piece));
    const others = state.originals.filter((piece) => !state.selectedOrder.includes(piece.path));
    if (chosen.length > 0) {
      content.append(element('h3', 'pm-tampon__section', 'Bordereau'));
      const list = element('div', 'pm-tampon__list');
      list.append(...chosen.map((piece) => renderRow(state, piece)));
      content.append(list);
    }
    if (others.length > 0) {
      content.append(element('h3', 'pm-tampon__section', chosen.length > 0 ? 'Autres pièces' : 'Touchez les pièces dans l’ordre du bordereau'));
      const list = element('div', 'pm-tampon__list');
      list.append(...others.map((piece) => renderRow(state, piece)));
      content.append(list);
    }
  }
  return content;
}

function renderFooter(state: ViewState): HTMLElement {
  const footer = element('footer', 'pm-tampon__foot');
  const inner = element('div', 'pm-tampon__foot-inner');
  if (state.runError) inner.append(element('p', 'pm-tampon__error', state.runError));
  if (state.runResult) {
    const failures = state.runResult.results.filter((entry) => !entry.success);
    const done = state.runResult.results.length - failures.length;
    const result = element('div', 'pm-tampon__result');
    result.append(element('p', 'pm-tampon__muted', `${done} pièce${done > 1 ? 's' : ''} tamponnée${done > 1 ? 's' : ''} dans « Pièces tamponnées ».`));
    result.append(button('Ouvrir le dossier', () => revealStampedPieces(state), 'pm-tampon__link pm-tampon__reveal'));
    inner.append(result);
    for (const failure of failures) inner.append(element('p', 'pm-tampon__error', `Pièce n°${failure.pieceNumber} : ${failure.error || 'échec'}`));
    if (state.revealError) inner.append(element('p', 'pm-tampon__error', state.revealError));
  }
  const count = state.selectedOrder.length;
  if (!state.loadingTampon && !state.savedImage) {
    inner.append(button('Créer le tampon du cabinet', () => openEditor(state), 'piecemaker-button piecemaker-button--normal piecemaker-button--black'));
  } else {
    inner.append(button(
      state.running ? 'Tamponnage…' : count === 0 ? 'Choisissez des pièces' : `Tamponner ${count} pièce${count > 1 ? 's' : ''}`,
      () => stampPieces(state),
      'piecemaker-button piecemaker-button--normal piecemaker-button--black',
      count === 0 || state.running || state.loadingTampon,
    ));
  }
  footer.append(inner);
  return footer;
}

function render(state: ViewState): void {
  const { root } = state;
  const scrollTop = root.querySelector('.pm-tampon__scroll')?.scrollTop ?? 0;
  root.replaceChildren();

  const head = element('header', 'pm-tampon__head');
  const headText = element('div', 'pm-tampon__head-text');
  if (state.originals && state.originals.length > 0) {
    headText.append(element('p', 'pm-tampon__muted', `${state.selectedOrder.length} pièce${state.selectedOrder.length > 1 ? 's' : ''} sur ${state.originals.length} au bordereau`));
  }
  head.append(headText);
  if (!state.loadingTampon) {
    const stamp = button('', () => openEditor(state), state.savedImage ? 'pm-tampon__stamp' : 'pm-tampon__stamp pm-tampon__stamp--missing');
    if (state.savedImage) {
      const thumbnail = element('img');
      thumbnail.src = state.savedImage;
      thumbnail.alt = '';
      stamp.append(thumbnail, element('span', undefined, 'Tampon'));
    } else {
      stamp.append(element('span', undefined, 'Aucun tampon'));
    }
    stamp.setAttribute('aria-label', 'Modifier le tampon du cabinet');
    head.append(stamp);
  }

  const scroll = element('div', 'pm-tampon__scroll');
  scroll.append(renderPieces(state));
  root.append(head, scroll, renderFooter(state));
  if (state.editorOpen) root.append(renderEditor(state));
  scroll.scrollTop = scrollTop;
}

export function mount(container: HTMLElement, api: PluginAPI): void {
  unmount(container);
  const style = element('style');
  style.textContent = STYLE_TEXT;
  const root = element('main', 'pm-tampon piecemaker-ui');
  root.setAttribute('aria-label', 'Bordereau');
  container.append(style, root);
  const state: ViewState = {
    api,
    root,
    style,
    disposed: false,
    unsubscribe: null,
    config: { ...DEFAULT_STAMP_CONFIG },
    editorOpen: false,
    pendingImage: null,
    savedImage: cachedTampon ?? null,
    loadingTampon: cachedTampon === undefined,
    tamponError: null,
    saving: false,
    legalCase: null,
    caseLoading: false,
    caseError: null,
    originals: null,
    originalsError: null,
    selectedOrder: [],
    running: false,
    runError: null,
    runResult: null,
    revealError: null,
  };
  mounted.set(container, state);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.editorOpen) closeEditor(state);
  });
  let currentProjectPath = projectPathOf(api);
  state.unsubscribe = api.onContextChange((context) => {
    if (state.disposed) return;
    const nextPath = context.project?.path || null;
    if (nextPath === currentProjectPath) return;
    currentProjectPath = nextPath;
    void loadCase(state);
  });
  void loadTampon(state);
  void loadCase(state);
}

export function unmount(container: HTMLElement): void {
  const state = mounted.get(container);
  if (!state) return;
  state.disposed = true;
  state.unsubscribe?.();
  state.style.remove();
  state.root.remove();
  mounted.delete(container);
}
