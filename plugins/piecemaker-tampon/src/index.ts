import {
  DEFAULT_STAMP_CONFIG,
  renderStampDataUrl,
  type StampBorder,
  type StampConfig,
  type StampFont,
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
  message: string;
  results: StampingPieceResult[];
};

const AUTH_TOKEN_KEY = 'auth-token';
const PIECEMAKER_BASE = '/api/piecemaker';
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const SHAPE_OPTIONS: Array<{ id: StampShape; label: string }> = [
  { id: 'circle', label: 'Cercle' },
  { id: 'oval', label: 'Ovale' },
  { id: 'rounded', label: 'Rectangle arrondi' },
  { id: 'rect', label: 'Rectangle' },
];
const BORDER_OPTIONS: Array<{ id: StampBorder; label: string }> = [
  { id: 'double', label: 'Double' },
  { id: 'single', label: 'Simple' },
];
const FONT_OPTIONS: Array<{ id: StampFont; label: string }> = [
  { id: 'sans', label: 'Sans serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Machine à écrire' },
];
const STATUS_LABEL: Record<CaseOriginalPiece['status'], string> = {
  ready: 'Prête',
  'awaiting-scan': 'Non scannée',
  'not-converted': 'Non convertie',
};

const STYLE_TEXT = `
  .pm-tampon { position: absolute; inset: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; padding: clamp(12px, 3vw, 32px); box-sizing: border-box; color: hsl(var(--foreground, 222 47% 11%)); background: hsl(var(--background, 0 0% 100%)); font: 14px var(--piecemaker-font-ui, Inter, ui-sans-serif, system-ui, sans-serif); }
  .pm-tampon * { box-sizing: border-box; }
  .pm-tampon__stack { grid-row: 2; height: 100%; min-height: 0; width: 100%; max-width: 56rem; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; min-width: 0; }
  .pm-tampon__stack > .pm-tampon__pieces { height: 100%; display: flex; flex-direction: column; }
  .pm-tampon__stack > .pm-tampon__pieces > .pm-tampon__body { flex: 1; min-height: 0; overflow: hidden; }
  .pm-tampon__toolbar { grid-row: 1; width: 100%; max-width: 56rem; margin: 0 auto 12px; display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
  .pm-tampon__toolbar select { flex: 1 1 auto; width: auto; min-width: 0; }
  .pm-tampon__card { min-width: 0; border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: 1rem; background: hsl(var(--card, 0 0% 100%)); box-shadow: none; }
  .pm-tampon__header, .pm-tampon__footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px; min-width: 0; }
  .pm-tampon__footer { align-items: center; flex-wrap: wrap; justify-content: flex-start; border-top: 1px solid hsl(var(--border, 220 13% 91%)); }
  .pm-tampon__title { margin: 0; font-family: var(--piecemaker-font-editorial, EB Garamond, Georgia, serif); font-size: 1.25rem; font-weight: 500; letter-spacing: -.02em; }
  .pm-tampon__subtitle { margin: 6px 0 0; color: hsl(var(--muted-foreground, 220 9% 46%)); line-height: 1.5; }
  .pm-tampon__body { padding: 0 20px 20px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .pm-tampon__badge { flex: 0 0 auto; border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: 999px; padding: 3px 8px; font-size: 12px; }
  .pm-tampon__row { display: flex; align-items: flex-start; gap: 16px; min-width: 0; }
  .pm-tampon__preview-wrap { flex: 0 0 160px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .pm-tampon__preview { width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border: 1px dashed hsl(var(--border, 220 13% 91%)); border-radius: .75rem; background: hsl(var(--muted, 0 0% 93%)); overflow: hidden; }
  .pm-tampon__preview img { width: 100%; height: 100%; object-fit: contain; padding: 8px; }
  .pm-tampon__form { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 12px; border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: .75rem; background: hsl(var(--muted, 0 0% 93%)); }
  .pm-tampon label { min-width: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: hsl(var(--muted-foreground, 220 9% 46%)); }
  .pm-tampon input[type=text], .pm-tampon input[type=color], .pm-tampon input[type=range], .pm-tampon select { width: 100%; min-width: 0; font: inherit; color: hsl(var(--foreground, 222 47% 11%)); background: hsl(var(--card, 0 0% 100%)); border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: .75rem; padding: 7px 10px; box-shadow: none; }
  .pm-tampon input[type=color] { height: 36px; padding: 4px; cursor: pointer; }
  .pm-tampon__pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .pm-tampon button:not(.piecemaker-button) { min-width: 0; font: inherit; cursor: pointer; color: inherit; background: hsl(var(--card, 0 0% 100%)); border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: 9999px; padding: 7px 12px; }
  .pm-tampon button[aria-pressed=true] { box-shadow: inset 0 0 0 1px hsl(var(--foreground, 222 47% 11%) / 26%); font-weight: 600; }
  .pm-tampon button:disabled { opacity: .4; cursor: not-allowed; }
  .pm-tampon .pm-tampon__primary { background: hsl(var(--primary, 208 100% 50%)); color: hsl(var(--primary-foreground, 0 0% 100%)); border-color: transparent; box-shadow: none; backdrop-filter: none; }
  .pm-tampon__error { color: hsl(var(--destructive, 0 72% 51%)); margin: 0; }
  .pm-tampon__muted { color: hsl(var(--muted-foreground, 220 9% 46%)); margin: 0; }
  .pm-tampon__grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); grid-auto-rows: minmax(0, 1fr); gap: 12px; min-width: 0; }
  .pm-tampon__list-column { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .pm-tampon__list-column > .pm-tampon__muted { margin-bottom: 1.5px; }
  .pm-tampon__list { flex: 1; min-height: 0; min-width: 0; overflow: auto; border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: .75rem; padding: 6px; }
  .pm-tampon__item { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; margin-block: 1.5px; text-align: left; border: 1px solid transparent; border-radius: .5rem; padding: 6px 8px; background: transparent; height: auto; }
  .pm-tampon__item[aria-pressed=true] { border-color: #000; background: #000; color: #fff; }
  .dark .pm-tampon__item[aria-pressed=true] { border-color: #fff; background: #fff; color: #000; }
  .pm-tampon__item span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-tampon__hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
  .pm-tampon__overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgb(0 0 0 / 55%); }
  .pm-tampon__dialog { width: min(900px, 100%); max-height: calc(100dvh - 32px); overflow: auto; outline: none; box-shadow: 0 24px 80px rgb(0 0 0 / 35%); }
  .pm-tampon__close { flex: 0 0 auto; }
  .pm-tampon__stamp-trigger { width: 1.75rem; height: 1.75rem; color: hsl(var(--foreground, 222 47% 11%)); }
  .pm-tampon__stamp-trigger svg { width: 16px; height: 16px; }
  @media (max-width: 560px) {
    .pm-tampon__body { padding: 0 14px 14px; }
    .pm-tampon__header, .pm-tampon__footer { padding: 14px; }
    .pm-tampon__row { flex-direction: column; }
    .pm-tampon__preview-wrap { width: min(160px, 100%); flex-basis: auto; }
    .pm-tampon__dialog { max-height: calc(100dvh - 16px); }
    .pm-tampon__overlay { padding: 8px; }
  }
`;

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

let cachedTampon: string | null | undefined;
const casesCache = new Map<string, { cases: DossierCase[]; selectedCaseId: string | null }>();
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

type ViewState = {
  api: PluginAPI;
  root: HTMLElement;
  style: HTMLStyleElement;
  disposed: boolean;
  unsubscribe: (() => void) | null;
  config: StampConfig;
  builderOpen: boolean;
  pendingImage: string | null;
  savedImage: string | null;
  loadingTampon: boolean;
  tamponError: string | null;
  saving: boolean;
  deleting: boolean;
  cases: DossierCase[];
  selectedCaseId: string | null;
  casesLoading: boolean;
  casesError: string | null;
  originals: CaseOriginalPiece[] | null;
  originalsLoading: boolean;
  originalsError: string | null;
  selectedOrder: string[];
  running: boolean;
  runError: string | null;
  runResult: StampingResponse | null;
  revealing: boolean;
  revealError: string | null;
};

const mounted = new WeakMap<HTMLElement, ViewState>();

const projectPathOf = (api: PluginAPI): string | null => api.context.project?.path || null;

const selectedCase = (state: ViewState): DossierCase | null =>
  state.cases.find((entry) => entry.path === state.selectedCaseId) ?? null;

const displayedImage = (state: ViewState): string | null => state.pendingImage ?? state.savedImage;

async function loadTampon(state: ViewState): Promise<void> {
  if (cachedTampon !== undefined) {
    state.savedImage = cachedTampon;
    state.loadingTampon = false;
    render(state);
  } else {
    state.loadingTampon = true;
    render(state);
  }
  try {
    const response = await request<TamponLoadResponse>('GET', '/tampon/load');
    if (state.disposed) return;
    cachedTampon = response.tamponImage;
    state.savedImage = response.tamponImage;
    state.tamponError = null;
  } catch (cause) {
    if (state.disposed) return;
    const status = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : 0;
    if (status === 404) {
      cachedTampon = null;
      state.savedImage = null;
      state.tamponError = null;
    } else {
      state.tamponError = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    if (!state.disposed) {
      state.loadingTampon = false;
      render(state);
    }
  }
}

async function loadCases(state: ViewState): Promise<void> {
  const projectPath = projectPathOf(state.api);
  if (!projectPath) {
    state.cases = [];
    state.selectedCaseId = null;
    state.originals = null;
    state.casesLoading = false;
    render(state);
    return;
  }
  const cached = casesCache.get(projectPath);
  if (cached) {
    state.cases = cached.cases;
    state.selectedCaseId = cached.selectedCaseId;
    state.casesLoading = false;
    render(state);
    void loadOriginals(state);
  } else {
    state.casesLoading = true;
    render(state);
  }
  try {
    const overview = await request<{ folders?: DossierCase[] }>('GET', '/repository');
    if (state.disposed) return;
    const cases = overview.folders ?? [];
    const existing = cases.find((entry) => entry.location === projectPath);
    const selected = existing ?? (await request<{ folder: DossierCase }>('POST', '/repository/cases/selected', { folder: projectPath })).folder;
    const nextCases = existing ? cases : [...cases.filter((entry) => entry.path !== selected.path), selected];
    casesCache.set(projectPath, { cases: nextCases, selectedCaseId: selected.path });
    state.cases = nextCases;
    state.selectedCaseId = selected.path;
    state.casesError = null;
  } catch (cause) {
    if (state.disposed) return;
    state.cases = [];
    state.selectedCaseId = null;
    state.casesError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (!state.disposed) {
      state.casesLoading = false;
      render(state);
      void loadOriginals(state);
    }
  }
}

async function loadOriginals(state: ViewState): Promise<void> {
  const caseId = state.selectedCaseId;
  if (!caseId) {
    state.originals = null;
    render(state);
    return;
  }
  const cached = originalsCache.get(caseId);
  if (cached) {
    state.originals = cached;
    state.originalsLoading = false;
    render(state);
  } else {
    state.originalsLoading = true;
    render(state);
  }
  try {
    const response = await request<{ folder: { originals?: CaseOriginalPiece[] } }>('GET', `/repository/case?case=${encodeURIComponent(caseId)}`);
    if (state.disposed || state.selectedCaseId !== caseId) return;
    const originals = response.folder.originals ?? [];
    originalsCache.set(caseId, originals);
    state.originals = originals;
    state.originalsError = null;
  } catch (cause) {
    if (state.disposed || state.selectedCaseId !== caseId) return;
    state.originals = null;
    state.originalsError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (!state.disposed && state.selectedCaseId === caseId) {
      state.originalsLoading = false;
      render(state);
    }
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stampIcon(): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.66 0-3 1-3 3s1 2 1 3.5V13"/>';
  return icon;
}

function button(label: string, action: () => void, className = '', disabled = false): HTMLButtonElement {
  const isItem = className.includes('pm-tampon__item');
  const isPrimary = className.includes('pm-tampon__primary');
  const isDanger = className.includes('piecemaker-button--danger');
  const isIcon = label === '↑' || label === '↓' || label === '×';
  const variant = className.includes('piecemaker-button') || isItem
    ? ''
    : isPrimary
      ? 'piecemaker-button piecemaker-button--sm piecemaker-button--black'
      : isDanger
        ? 'piecemaker-button piecemaker-button--sm piecemaker-button--danger'
        : isIcon
          ? 'piecemaker-button piecemaker-button--icon'
          : 'piecemaker-button piecemaker-button--sm piecemaker-button--glass';
  const node = element('button', [variant, className].filter(Boolean).join(' '), label);
  node.type = 'button';
  node.disabled = disabled;
  node.addEventListener('click', action);
  return node;
}

function renderBuilder(state: ViewState): HTMLElement {
  const card = element('section', 'pm-tampon__card');
  card.classList.add('pm-tampon__dialog');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'pm-tampon-dialog-title');
  card.tabIndex = -1;
  const header = element('div', 'pm-tampon__header');
  const heading = element('div');
  const title = element('h2', 'pm-tampon__title piecemaker-display', 'Tampon du cabinet');
  title.id = 'pm-tampon-dialog-title';
  heading.append(title, element('p', 'pm-tampon__subtitle', 'Une seule image pour tout le cabinet, apposée sur chaque pièce tamponnée.'));
  header.append(heading);
  if (!state.loadingTampon && !state.tamponError) {
    const badge = element('span', 'pm-tampon__badge', state.pendingImage ? 'Non enregistré' : displayedImage(state) ? 'Enregistré' : 'Aucun tampon');
    header.append(badge);
  }
  const closeButton = button('×', () => {
    state.builderOpen = false;
    render(state);
  }, 'piecemaker-button piecemaker-button--icon pm-tampon__close');
  closeButton.setAttribute('aria-label', 'Fermer la configuration du tampon');
  header.append(closeButton);
  card.append(header);
  const body = element('div', 'pm-tampon__body');
  if (state.loadingTampon) body.append(element('p', 'pm-tampon__muted', 'Chargement du tampon…'));
  else if (state.tamponError) body.append(element('p', 'pm-tampon__error', state.tamponError));
  else {
    const row = element('div', 'pm-tampon__row');
    const previewWrap = element('div', 'pm-tampon__preview-wrap');
    const preview = element('div', 'pm-tampon__preview');
    const image = displayedImage(state);
    if (image) {
      const img = element('img');
      img.src = image;
      img.alt = 'Aperçu du tampon';
      preview.append(img);
    } else {
      preview.append(element('span', 'pm-tampon__muted', 'Aucun tampon configuré'));
    }
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
        state.tamponError = cause instanceof Error ? cause.message : String(cause);
        render(state);
      });
    });
    previewWrap.append(preview, fileInput, button('Importer', () => fileInput.click()));
    const form = element('div', 'pm-tampon__form');
    const texts = element('div', 'pm-tampon__grid');
    const top = element('label', undefined, 'Mention haute');
    const topInput = element('input');
    topInput.type = 'text';
    topInput.maxLength = 40;
    topInput.value = state.config.topText;
    topInput.addEventListener('input', () => { state.config = { ...state.config, topText: topInput.value }; });
    top.append(topInput);
    const bottom = element('label', undefined, 'Mention basse');
    const bottomInput = element('input');
    bottomInput.type = 'text';
    bottomInput.maxLength = 40;
    bottomInput.value = state.config.bottomText;
    bottomInput.addEventListener('input', () => { state.config = { ...state.config, bottomText: bottomInput.value }; });
    bottom.append(bottomInput);
    texts.append(top, bottom);
    form.append(texts);
    const addPills = (label: string, options: Array<{ id: string; label: string }>, current: string, assign: (id: string) => void) => {
      const group = element('div');
      group.append(element('span', 'pm-tampon__muted', label));
      const pills = element('div', 'pm-tampon__pills');
      for (const option of options) {
        const pill = button(option.label, () => {
          assign(option.id);
          render(state);
        });
        pill.setAttribute('aria-pressed', String(option.id === current));
        pills.append(pill);
      }
      group.append(pills);
      form.append(group);
    };
    addPills('Forme', SHAPE_OPTIONS, state.config.shape, (id) => { state.config = { ...state.config, shape: id as StampShape }; });
    addPills('Contour', BORDER_OPTIONS, state.config.border, (id) => { state.config = { ...state.config, border: id as StampBorder }; });
    addPills('Police', FONT_OPTIONS, state.config.font, (id) => { state.config = { ...state.config, font: id as StampFont }; });
    const extras = element('div', 'pm-tampon__grid');
    const color = element('label', undefined, 'Couleur');
    const colorInput = element('input');
    colorInput.type = 'color';
    colorInput.value = state.config.color;
    colorInput.addEventListener('input', () => { state.config = { ...state.config, color: colorInput.value }; });
    color.append(colorInput);
    const width = element('label');
    const widthLabel = element('span', undefined, `Épaisseur (${state.config.lineWidth}px)`);
    const widthInput = element('input');
    widthInput.type = 'range';
    widthInput.min = '4';
    widthInput.max = '20';
    widthInput.value = String(state.config.lineWidth);
    widthInput.addEventListener('input', () => {
      state.config = { ...state.config, lineWidth: Number(widthInput.value) };
      widthLabel.textContent = `Épaisseur (${state.config.lineWidth}px)`;
    });
    width.append(widthLabel, widthInput);
    extras.append(color, width);
    form.append(extras, button('Générer le tampon', () => {
      try {
        state.pendingImage = renderStampDataUrl(state.config);
        state.tamponError = null;
      } catch (cause) {
        state.tamponError = cause instanceof Error ? cause.message : String(cause);
      }
      render(state);
    }));
    row.append(previewWrap, form);
    body.append(row);
  }
  card.append(body);
  if (!state.loadingTampon && !state.tamponError) {
    const footer = element('div', 'pm-tampon__footer');
    footer.append(button('Enregistrer le tampon', () => {
      if (!state.pendingImage) return;
      state.saving = true;
      render(state);
      void request('POST', '/tampon/save', { tamponImage: state.pendingImage }).then(() => {
        if (state.disposed) return;
        cachedTampon = state.pendingImage;
        state.savedImage = state.pendingImage;
        state.pendingImage = null;
        state.tamponError = null;
      }).catch((cause) => {
        state.tamponError = cause instanceof Error ? cause.message : String(cause);
      }).finally(() => {
        state.saving = false;
        if (!state.disposed) render(state);
      });
    }, 'pm-tampon__primary', !state.pendingImage || state.saving));
    if (state.pendingImage) {
      footer.append(button('Annuler', () => {
        state.pendingImage = null;
        render(state);
      }, '', state.saving));
    }
    if (state.savedImage && !state.pendingImage) {
      footer.append(button('Supprimer le tampon', () => {
        state.deleting = true;
        render(state);
        void request('DELETE', '/tampon/delete').then(() => {
          if (state.disposed) return;
          cachedTampon = null;
          state.savedImage = null;
          state.pendingImage = null;
        }).catch((cause) => {
          state.tamponError = cause instanceof Error ? cause.message : String(cause);
        }).finally(() => {
          state.deleting = false;
          if (!state.disposed) render(state);
        });
      }, 'piecemaker-button piecemaker-button--sm piecemaker-button--danger', state.deleting));
    }
    card.append(footer);
  }
  return card;
}

function renderPieces(state: ViewState): HTMLElement {
  const card = element('section', 'pm-tampon__pieces');
  const body = element('div', 'pm-tampon__body');
  if (state.casesLoading) body.append(element('p', 'pm-tampon__muted', 'Chargement des dossiers…'));
  else if (state.casesError) body.append(element('p', 'pm-tampon__error', state.casesError));
  else if (state.cases.length === 0) body.append(element('p', 'pm-tampon__muted', 'Aucun dossier enregistré.'));
  else if (!selectedCase(state)) body.append(element('p', 'pm-tampon__muted', 'Sélectionnez un dossier ci-dessus.'));
  else {
    if (state.originalsLoading) body.append(element('p', 'pm-tampon__muted', 'Chargement des pièces…'));
    else if (state.originalsError) body.append(element('p', 'pm-tampon__error', state.originalsError));
    else if (state.originals && state.originals.length === 0) body.append(element('p', 'pm-tampon__muted', 'Ce dossier ne contient aucune pièce originale.'));
    else if (state.originals) {
      const grid = element('div', 'pm-tampon__grid');
      const available = element('div', 'pm-tampon__list-column');
      available.append(element('p', 'pm-tampon__muted', 'Pièces du dossier — cliquer pour ajouter au bordereau'));
      const availableList = element('div', 'pm-tampon__list');
      for (const piece of state.originals) {
        const orderIndex = state.selectedOrder.indexOf(piece.path);
        const item = button('', () => {
          state.selectedOrder = orderIndex === -1
            ? [...state.selectedOrder, piece.path]
            : state.selectedOrder.filter((entry) => entry !== piece.path);
          render(state);
        }, 'pm-tampon__item');
        item.setAttribute('aria-pressed', String(orderIndex !== -1));
        if (orderIndex !== -1) item.append(element('strong', undefined, String(orderIndex + 1)));
        item.append(element('span', undefined, piece.path));
        if (piece.status !== 'ready') item.append(element('em', undefined, STATUS_LABEL[piece.status]));
        availableList.append(item);
      }
      available.append(availableList);
      const bordereau = element('div', 'pm-tampon__list-column');
      const bordereauList = element('div', 'pm-tampon__list');
      if (state.selectedOrder.length === 0) bordereauList.append(element('p', 'pm-tampon__muted', 'Aucune pièce sélectionnée.'));
      state.selectedOrder.forEach((path, index) => {
        const piece = state.originals?.find((entry) => entry.path === path);
        const row = element('div', 'pm-tampon__item');
        row.append(element('strong', undefined, `Pièce n°${index + 1}`), element('span', undefined, piece?.name ?? path));
        row.append(button('↑', () => {
          if (index === 0) return;
          const next = [...state.selectedOrder];
          [next[index - 1], next[index]] = [next[index], next[index - 1]];
          state.selectedOrder = next;
          render(state);
        }, '', index === 0));
        row.append(button('↓', () => {
          if (index === state.selectedOrder.length - 1) return;
          const next = [...state.selectedOrder];
          [next[index + 1], next[index]] = [next[index], next[index + 1]];
          state.selectedOrder = next;
          render(state);
        }, '', index === state.selectedOrder.length - 1));
        row.append(button('×', () => {
          state.selectedOrder = state.selectedOrder.filter((entry) => entry !== path);
          render(state);
        }));
        bordereauList.append(row);
      });
      bordereau.append(bordereauList);
      grid.append(available, bordereau);
      body.append(grid);
    }
    if (state.runError) body.append(element('p', 'pm-tampon__error', state.runError));
    if (state.runResult) {
      const result = element('div');
      result.append(element('p', undefined, state.runResult.message));
      result.append(button(state.revealing ? 'Ouverture…' : 'Ouvrir « Pièces tamponnées »', () => {
        const current = selectedCase(state);
        if (!current) return;
        state.revealing = true;
        render(state);
        void request('POST', '/reveal', { target: 'files', case: current.path, path: 'Pièces tamponnées' }).catch((cause) => {
          state.revealError = cause instanceof Error ? cause.message : String(cause);
        }).finally(() => {
          state.revealing = false;
          if (!state.disposed) render(state);
        });
      }, '', state.revealing));
      if (state.revealError) result.append(element('p', 'pm-tampon__error', state.revealError));
      const list = element('ul');
      for (const entry of state.runResult.results) {
        const item = element('li', undefined, `Pièce n°${entry.pieceNumber} — ${entry.filename}${entry.success ? '' : ` (${entry.error || 'échec'})`}`);
        list.append(item);
      }
      result.append(list);
      body.append(result);
    }
  }
  card.append(body);
  const current = selectedCase(state);
  if (current && state.originals && state.originals.length > 0) {
    const footer = element('div', 'pm-tampon__footer');
    const count = state.selectedOrder.length;
    footer.append(button(
      state.running ? 'Tamponnage en cours…' : `Tamponner ${count || ''} pièce${count > 1 ? 's' : ''}`.trim(),
      () => {
        if (!count) return;
        state.running = true;
        state.runError = null;
        state.runResult = null;
        render(state);
        void request<StampingResponse>('POST', '/stamping', {
          pieces: state.selectedOrder,
          documentId: current.path,
          folder: current.location,
        }).then((response) => {
          state.runResult = response;
        }).catch((cause) => {
          state.runError = cause instanceof Error ? cause.message : String(cause);
        }).finally(() => {
          state.running = false;
          if (!state.disposed) render(state);
        });
      },
      'pm-tampon__primary',
      count === 0 || state.running,
    ));
    card.append(footer);
  }
  return card;
}

function render(state: ViewState): void {
  const { root } = state;
  root.replaceChildren();
  const toolbar = element('header', 'pm-tampon__toolbar');
  if (state.cases.length > 0) {
    const select = element('select');
    select.setAttribute('aria-label', 'Dossier à tamponner');
    for (const entry of state.cases) {
      const option = element('option');
      option.value = entry.path;
      option.textContent = entry.name;
      option.selected = entry.path === state.selectedCaseId;
      select.append(option);
    }
    select.addEventListener('change', () => {
      state.selectedCaseId = select.value || null;
      const projectPath = projectPathOf(state.api);
      if (projectPath) casesCache.set(projectPath, { cases: state.cases, selectedCaseId: state.selectedCaseId });
      state.selectedOrder = [];
      state.runResult = null;
      state.runError = null;
      void loadOriginals(state);
    });
    toolbar.append(select);
  }
  const stampButton = button('', () => {
    state.builderOpen = true;
    render(state);
    requestAnimationFrame(() => root.querySelector<HTMLElement>('.pm-tampon__dialog')?.focus());
  }, 'piecemaker-button piecemaker-button--glass piecemaker-button--icon pm-tampon__stamp-trigger');
  stampButton.setAttribute('aria-label', 'Configurer le tampon du cabinet');
  stampButton.title = 'Configurer le tampon du cabinet';
  stampButton.append(stampIcon());
  toolbar.append(stampButton);
  const stack = element('div', 'pm-tampon__stack');
  stack.append(renderPieces(state));
  root.append(toolbar, stack);
  if (state.builderOpen) {
    const overlay = element('div', 'pm-tampon__overlay');
    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) return;
      state.builderOpen = false;
      render(state);
    });
    overlay.append(renderBuilder(state));
    root.append(overlay);
  }
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
    builderOpen: false,
    pendingImage: null,
    savedImage: cachedTampon ?? null,
    loadingTampon: cachedTampon === undefined,
    tamponError: null,
    saving: false,
    deleting: false,
    cases: [],
    selectedCaseId: null,
    casesLoading: true,
    casesError: null,
    originals: null,
    originalsLoading: false,
    originalsError: null,
    selectedOrder: [],
    running: false,
    runError: null,
    runResult: null,
    revealing: false,
    revealError: null,
  };
  const cachedCases = casesCache.get(projectPathOf(api) || '');
  if (cachedCases) {
    state.cases = cachedCases.cases;
    state.selectedCaseId = cachedCases.selectedCaseId;
    state.casesLoading = false;
  }
  mounted.set(container, state);
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !state.builderOpen) return;
    state.builderOpen = false;
    render(state);
  });
  let currentProjectPath = projectPathOf(api);
  state.unsubscribe = api.onContextChange((context) => {
    if (state.disposed) return;
    const nextPath = context.project?.path || null;
    if (nextPath === currentProjectPath) return;
    currentProjectPath = nextPath;
    state.selectedOrder = [];
    state.runResult = null;
    void loadCases(state);
  });
  render(state);
  void loadTampon(state);
  void loadCases(state);
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
