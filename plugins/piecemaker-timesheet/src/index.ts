import { authenticatedFetch } from '../../../src/shared/authToken.js';
import type { PluginAPI, PluginContext, TimesheetEntry, TimesheetScope } from './types.js';

const TIMESHEET_PATH = '/api/piecemaker/timesheet';

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

const getErrorMessage = (value: unknown, status: number): string => {
  if (isRecord(value)) {
    const message = value.error ?? value.message ?? value.details;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `Impossible de charger le timesheet (${status}).`;
};

const request = async (method: 'GET' | 'POST', url: string, body: unknown, signal?: AbortSignal): Promise<unknown> => {
  const response = await authenticatedFetch(url, {
    method,
    headers: { Accept: 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal,
  });
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
  entries: TimesheetEntry[];
  loaded: boolean;
  loading: boolean;
  refreshing: boolean;
  refreshedAt: Date | null;
  error: string | null;
  requestId: number;
  abortController: AbortController | null;
  unsubscribe: (() => void) | null;
  headerSlot: HTMLElement | null;
  filterButton: HTMLButtonElement | null;
  filterMenu: HTMLDivElement | null;
  headerCleanup: (() => void) | null;
  root: HTMLElement;
  style: HTMLStyleElement;
  disposed: boolean;
};

const STYLE_TEXT = `
  .pm-timesheet { --pm-timesheet-text: var(--piecemaker-text, #374151); --pm-timesheet-muted: var(--piecemaker-muted, #6b7280); height: 100%; overflow: auto; padding: 24px; box-sizing: border-box; color: var(--pm-timesheet-text); background: hsl(var(--background, 0 0% 100%)); font: 14px var(--piecemaker-font-ui, Inter, ui-sans-serif, system-ui, sans-serif); }
  .pm-timesheet[data-theme=dark] { --pm-timesheet-text: hsl(var(--foreground, 210 20% 96%)); --pm-timesheet-muted: hsl(210 16% 82%); }
  .pm-timesheet[data-theme=dark] .piecemaker-button--glass { color: var(--pm-timesheet-text); }
  .pm-timesheet * { box-sizing: border-box; }
  .pm-timesheet__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin: 0 0 20px; }
  .pm-timesheet__title { margin: 0 0 6px; font-family: var(--piecemaker-font-editorial, EB Garamond, Georgia, serif); font-size: 1.25rem; font-weight: 500; letter-spacing: -.02em; }
  .pm-timesheet__subtitle { margin: 4px 0; color: var(--pm-timesheet-muted); line-height: 1.5; }
  .pm-timesheet__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 20px 0; }
  .pm-timesheet__button:disabled { opacity: .4; cursor: not-allowed; }
  .pm-timesheet__button:focus-visible { outline: none; box-shadow: 0 0 0 2px rgb(0 136 255 / 40%), 0 0 0 4px hsl(var(--background, 0 0% 100%)); }
  .pm-timesheet__status { min-height: 24px; margin: 12px 0; color: var(--pm-timesheet-muted); }
  .pm-timesheet__status--error { color: #b91c1c; }
  .pm-timesheet__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .pm-timesheet__empty { padding: 16px 0; color: var(--pm-timesheet-muted); line-height: 1.5; }
  .pm-timesheet__table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .pm-timesheet__table { width: 100%; min-width: 760px; border-collapse: collapse; }
  .pm-timesheet__table th, .pm-timesheet__table td { padding: 16px 10px; border-bottom: 1px solid var(--piecemaker-border, #e5e7eb); text-align: left; vertical-align: top; }
  .pm-timesheet__table th:first-child, .pm-timesheet__table td:first-child { padding-left: 10px; }
  .pm-timesheet__table th:last-child, .pm-timesheet__table td:last-child { padding-right: 10px; }
  .pm-timesheet__table th { color: var(--pm-timesheet-muted); font-size: 12px; font-weight: 500; text-transform: none; letter-spacing: .04em; }
  .pm-timesheet__table td { line-height: 1.5; }
  .pm-timesheet__table tr:last-child td { border-bottom: 0; }
  .pm-timesheet__month td { padding: 10px 0; background: hsl(var(--muted, 0 0% 93%)); font-weight: 600; }
  .pm-timesheet__month:first-child td { border-top: 0; }
  .pm-timesheet__month-content { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .pm-timesheet__month-label { flex: 1; min-width: 0; }
  .pm-timesheet__month-total { margin-left: auto; color: var(--pm-timesheet-muted); font-weight: 400; white-space: nowrap; }
  .pm-timesheet__month-actions { display: inline-flex; gap: 6px; flex-shrink: 0; }
  .pm-timesheet__month-actions button:focus-visible { outline: none; box-shadow: 0 0 0 2px rgb(0 136 255 / 40%), 0 0 0 4px hsl(var(--background, 0 0% 100%)); }
  .pm-timesheet__folder { overflow-wrap: anywhere; }
  .pm-timesheet__folder-name { font-weight: 600; }
  .pm-timesheet__date { display: inline-block; margin-top: 4px; padding: 1px 8px; border-radius: 9999px; background: hsl(var(--muted, 0 0% 93%)); color: var(--pm-timesheet-muted); font-size: 11px; white-space: nowrap; }
  .pm-timesheet__session { max-width: 460px; }
  .pm-timesheet__session-name { font-weight: 600; overflow-wrap: anywhere; }
  .pm-timesheet__conclusion { white-space: pre-wrap; }
  .pm-timesheet__conclusion summary { cursor: pointer; color: inherit; }
  .pm-timesheet__conclusion summary:focus-visible { outline: none; box-shadow: 0 0 0 2px rgb(0 136 255 / 40%); }
  .pm-timesheet__conclusion p { margin: 4px 0; color: var(--pm-timesheet-muted); line-height: 1.5; }
  .pm-timesheet__muted { color: var(--pm-timesheet-muted); }
  .pm-timesheet__time { text-align: right; white-space: nowrap; }
  .piecemaker-workspace-panel-header .pm-timesheet-filter-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; display: flex; flex-direction: column; gap: 2px; min-width: 190px; padding: 4px; border: 1px solid var(--piecemaker-border, #e5e7eb); border-radius: 10px; background: hsl(var(--background, 0 0% 100%)); box-shadow: 0 10px 30px rgb(0 0 0 / 15%); }
  .piecemaker-workspace-panel-header .pm-timesheet-filter-menu button { width: auto; height: auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border-radius: 6px; font-size: 13px; text-align: left; white-space: nowrap; }
  .piecemaker-workspace-panel-header .pm-timesheet-filter-menu button:hover { background: hsl(var(--muted, 0 0% 93%)); }
  .piecemaker-workspace-panel-header .pm-timesheet-filter-menu button[aria-checked='true'] { background: hsl(var(--primary, 217 91% 60%) / 0.14); color: hsl(var(--primary, 217 91% 60%)); font-weight: 500; }
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

const csvValue = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const downloadFile = (filename: string, content: string | Uint8Array, type: string): void => {
  const link = document.createElement('a');
  const blobContent: BlobPart = typeof content === 'string'
    ? content
    : content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([blobContent], { type }));
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const exportMonthToExcel = (entries: TimesheetEntry[], key: string): void => {
  const rows = [
    ['Date', 'Dossier', 'Session', 'Temps actif', 'Temps écoulé', 'Conclusion'],
    ...entries.map((entry) => [
      formatDate(entry.startedAt),
      entry.projectName,
      entry.sessionName,
      formatDuration(entry.activeSeconds),
      formatDuration(entry.elapsedSeconds),
      entry.conclusion || 'Aucune conclusion',
    ]),
  ];
  const content = `\uFEFF${rows.map((row) => row.map(csvValue).join(';')).join('\r\n')}`;
  downloadFile(`timesheet-${key}.csv`, content, 'text/csv;charset=utf-8');
};

const WIN_ANSI_SPECIALS: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

const winAnsiByte = (character: string): number => {
  const code = character.charCodeAt(0);
  if (code >= 32 && code <= 126) return code;
  if (code >= 160 && code <= 255) return code;
  return WIN_ANSI_SPECIALS[character] ?? 0x3f;
};

const pdfText = (value: string): string => {
  const encoded = [...value].map((character) => String.fromCharCode(winAnsiByte(character))).join('');
  return `(${encoded.replace(/[\\()]/g, (character) => `\\${character}`)})`;
};

const pdfBytes = (value: string): Uint8Array => Uint8Array.from([...value].map((character) => character.charCodeAt(0) & 0xff));

const joinBytes = (parts: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const wrapPdfText = (value: string, width: number): string[] => {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const createPdf = (entries: TimesheetEntry[], label: string): Uint8Array => {
  const columnWidths = [108, 140, 180, 82, 268];
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
  const tableRows = [
    ['Date', 'Dossier', 'Session', 'Temps', 'Conclusion'],
    ...entries.map((entry) => [
      formatDate(entry.startedAt),
      entry.projectName,
      entry.sessionName,
      formatDuration(entry.activeSeconds),
      entry.conclusion || 'Aucune conclusion',
    ]),
  ];
  const wrappedRows = tableRows.map((row) => row.map((cell, index) => wrapPdfText(cell, Math.max(8, Math.floor((columnWidths[index] - 8) / 4.5)))));
  const rowHeights = wrappedRows.map((row) => 8 + Math.max(...row.map((cell) => cell.length)) * 10);
  const headerHeight = rowHeights[0] ?? 28;
  const tableTop = 475;
  const tableBottom = 38;
  const tableHeightLimit = tableTop - tableBottom;
  const pageRows: Array<number[]> = [];
  let currentRows: number[] = [];
  let currentHeight = headerHeight;
  for (let index = 1; index < wrappedRows.length; index += 1) {
    const nextHeight = rowHeights[index] ?? 18;
    if (currentRows.length > 0 && currentHeight + nextHeight > tableHeightLimit) {
      pageRows.push(currentRows);
      currentRows = [];
      currentHeight = headerHeight;
    }
    currentRows.push(index);
    currentHeight += nextHeight;
  }
  if (currentRows.length > 0 || pageRows.length === 0) pageRows.push(currentRows);
  const pageObjects = pageRows.map((rows, pageIndex) => {
    const contentObject = 5 + pageIndex * 2;
    const commands: string[] = [
      `BT /F1 18 Tf 32 555 Td ${pdfText('Timesheet')} Tj ET`,
      `BT /F1 11 Tf 32 536 Td ${pdfText(label)} Tj ET`,
      `BT /F1 9 Tf 32 520 Td ${pdfText(`${entries.length} session(s) - Total actif : ${formatDuration(totalSeconds(entries))}`)} Tj ET`,
    ];
    const tableRowsForPage = [0, ...rows];
    const tableHeightsForPage = tableRowsForPage.map((rowIndex) => rowHeights[rowIndex] ?? 18);
    const tableHeight = tableHeightsForPage.reduce((total, height) => total + height, 0);
    const tableBottomForPage = tableTop - tableHeight;
    commands.push(`0.94 0.94 0.94 rg 32 ${tableTop - headerHeight} ${tableWidth} ${headerHeight} re f`);
    commands.push('0 g');
    commands.push('0.82 0.82 0.82 RG 0.6 w');
    commands.push(`32 ${tableBottomForPage} ${tableWidth} ${tableHeight} re S`);
    let verticalX = 32;
    for (const width of columnWidths.slice(0, -1)) {
      verticalX += width;
      commands.push(`${verticalX} ${tableBottomForPage} m ${verticalX} ${tableTop} l S`);
    }
    let rowTop = tableTop;
    for (const [pageRowIndex, rowIndex] of tableRowsForPage.entries()) {
      const rowHeight = tableHeightsForPage[pageRowIndex] ?? 18;
      if (pageRowIndex > 0) commands.push(`32 ${rowTop} m ${32 + tableWidth} ${rowTop} l S`);
      let columnX = 32;
      for (const [columnIndex, cellLines] of wrappedRows[rowIndex].entries()) {
        cellLines.forEach((line, lineIndex) => {
          commands.push(`BT /F1 8 Tf ${columnX + 4} ${rowTop - 12 - lineIndex * 10} Td ${pdfText(line)} Tj ET`);
        });
        columnX += columnWidths[columnIndex];
      }
      rowTop -= rowHeight;
    }
    if (pageIndex < pageRows.length - 1) commands.push(`BT /F1 8 Tf 32 24 Td ${pdfText('Suite sur la page suivante')} Tj ET`);
    const commandText = commands.join('\n');
    return {
      page: pdfBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`),
      content: pdfBytes(`<< /Length ${pdfBytes(commandText).length} >>\nstream\n${commandText}\nendstream`),
    };
  });
  const objects: Uint8Array[] = [
    pdfBytes('<< /Type /Catalog /Pages 2 0 R >>'),
    pdfBytes(`<< /Type /Pages /Kids [${pageRows.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pageRows.length} >>`),
    pdfBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
  ];
  for (const pageObject of pageObjects) objects.push(pageObject.page, pageObject.content);
  const header = pdfBytes('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  const chunks: Uint8Array[] = [header];
  const offsets = [0];
  let offset = header.length;
  objects.forEach((object, index) => {
    const objectBytes = joinBytes([pdfBytes(`${index + 1} 0 obj\n`), object, pdfBytes('\nendobj\n')]);
    offsets.push(offset);
    chunks.push(objectBytes);
    offset += objectBytes.length;
  });
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((position) => `${String(position).padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join('\n');
  chunks.push(pdfBytes(xref));
  return joinBytes(chunks);
};

const exportMonthToPdf = (entries: TimesheetEntry[], label: string, key: string): void => {
  downloadFile(`timesheet-${key}.pdf`, createPdf(entries, label), 'application/pdf');
};

const projectLabel = (project: PluginContext['project']): string => {
  if (!project) return 'Dossier actuel';
  const trimmedPath = project.path.replace(/[\\/]+$/, '');
  const segments = trimmedPath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || project.path || 'Dossier actuel';
};

const SCOPE_FILTER_OPTIONS: Array<{ value: TimesheetScope; label: string }> = [
  { value: 'all', label: 'Tous les dossiers' },
  { value: 'project', label: 'Dossier ouvert' },
];

const FUNNEL_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-funnel h-[18px] w-[18px]" aria-hidden="true"><path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"></path></svg>';

const syncFilterControls = (state: ViewState): void => {
  state.filterButton?.setAttribute('aria-pressed', String(state.scope === 'project'));
  state.filterMenu?.querySelectorAll<HTMLButtonElement>('button[data-scope]').forEach((item) => {
    item.setAttribute('aria-checked', String(item.dataset.scope === state.scope));
  });
};

const closeFilterMenu = (state: ViewState): void => {
  state.filterMenu?.remove();
  state.filterMenu = null;
  state.filterButton?.setAttribute('aria-expanded', 'false');
};

const openFilterMenu = (state: ViewState): void => {
  if (!state.headerSlot || state.filterMenu) return;
  const menu = makeElement('div', 'pm-timesheet-filter-menu');
  menu.setAttribute('role', 'menu');
  for (const option of SCOPE_FILTER_OPTIONS) {
    const item = appendText(menu, 'button', option.label);
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.dataset.scope = option.value;
    item.addEventListener('click', () => {
      closeFilterMenu(state);
      if (state.scope === option.value) return;
      state.scope = option.value;
      syncFilterControls(state);
      void load(state, true);
    });
  }
  state.headerSlot.appendChild(menu);
  state.filterMenu = menu;
  state.filterButton?.setAttribute('aria-expanded', 'true');
  syncFilterControls(state);
};

const buildHeaderFilter = (state: ViewState): void => {
  const slot = state.root.closest('.piecemaker-workspace-panel')?.querySelector('.piecemaker-workspace-panel-header-slot') ?? null;
  state.headerSlot = slot as HTMLElement | null;
  if (!slot) return;
  const button = makeElement('button', 'pm-timesheet-filter');
  button.type = 'button';
  button.innerHTML = FUNNEL_ICON;
  button.setAttribute('aria-label', 'Filtrer le timesheet : tous les dossiers ou dossier ouvert');
  button.title = 'Filtrer : tous les dossiers ou dossier ouvert';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => {
    if (state.filterMenu) closeFilterMenu(state);
    else openFilterMenu(state);
  });
  slot.appendChild(button);
  state.filterButton = button;
  const onPointerDown = (event: MouseEvent): void => {
    if (!state.filterMenu) return;
    if (state.headerSlot?.contains(event.target as Node)) return;
    closeFilterMenu(state);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && state.filterMenu) closeFilterMenu(state);
  };
  document.addEventListener('mousedown', onPointerDown);
  document.addEventListener('keydown', onKeyDown);
  state.headerCleanup = () => {
    document.removeEventListener('mousedown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown);
  };
  syncFilterControls(state);
};

const disposeHeaderFilter = (state: ViewState): void => {
  state.headerCleanup?.();
  state.headerCleanup = null;
  state.filterMenu?.remove();
  state.filterMenu = null;
  state.filterButton?.remove();
  state.filterButton = null;
  state.headerSlot = null;
};

const buildTable = (entries: TimesheetEntry[]): HTMLDivElement => {
  const wrapper = makeElement('div', 'pm-timesheet__table-wrap');
  const table = makeElement('table', 'pm-timesheet__table');
  const caption = makeElement('caption', 'pm-timesheet__sr-only');
  caption.textContent = 'Sessions du timesheet';
  table.appendChild(caption);
  const head = makeElement('thead');
  const headerRow = makeElement('tr');
  for (const [label, className] of [['Dossier', ''], ['Session', ''], ['Temps', 'pm-timesheet__time']] as const) {
    const header = appendText(headerRow, 'th', label, className || undefined);
    header.scope = 'col';
  }
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = makeElement('tbody');
  const sortedEntries = sortEntries(entries);
  const entriesByMonth = new Map<string, TimesheetEntry[]>();
  for (const entry of sortedEntries) {
    const key = monthKey(entry.startedAt);
    const monthEntries = entriesByMonth.get(key) ?? [];
    monthEntries.push(entry);
    entriesByMonth.set(key, monthEntries);
  }
  let currentMonth = '';
  for (const entry of sortedEntries) {
    const key = monthKey(entry.startedAt);
    if (key !== currentMonth) {
      currentMonth = key;
      const monthRow = makeElement('tr', 'pm-timesheet__month');
      const monthCell = makeElement('td');
      monthCell.colSpan = 3;
      const monthContent = makeElement('div', 'pm-timesheet__month-content');
      appendText(monthContent, 'span', monthLabel(entry.startedAt), 'pm-timesheet__month-label');
      appendText(monthContent, 'span', formatDuration(totalSeconds(entriesByMonth.get(key) ?? [])), 'pm-timesheet__month-total');
      const monthActions = makeElement('span', 'pm-timesheet__month-actions');
      const pdfButton = appendText(monthActions, 'button', 'PDF', 'piecemaker-button piecemaker-button--xs piecemaker-button--glass');
      pdfButton.type = 'button';
      pdfButton.setAttribute('aria-label', `Exporter ${monthLabel(entry.startedAt)} en PDF`);
      pdfButton.addEventListener('click', () => exportMonthToPdf(entriesByMonth.get(key) ?? [], monthLabel(entry.startedAt), key));
      const excelButton = appendText(monthActions, 'button', 'Excel', 'piecemaker-button piecemaker-button--xs piecemaker-button--glass');
      excelButton.type = 'button';
      excelButton.setAttribute('aria-label', `Exporter ${monthLabel(entry.startedAt)} vers Excel`);
      excelButton.addEventListener('click', () => exportMonthToExcel(entriesByMonth.get(key) ?? [], key));
      monthContent.appendChild(monthActions);
      monthCell.appendChild(monthContent);
      monthRow.appendChild(monthCell);
      body.appendChild(monthRow);
    }
    const row = makeElement('tr');
    const folderCell = makeElement('td', 'pm-timesheet__folder');
    folderCell.title = entry.projectPath || entry.projectName;
    appendText(folderCell, 'div', entry.projectName, 'pm-timesheet__folder-name');
    appendText(folderCell, 'span', formatDate(entry.startedAt), 'pm-timesheet__date');
    row.appendChild(folderCell);
    const sessionCell = makeElement('td', 'pm-timesheet__session');
    appendText(sessionCell, 'div', entry.sessionName, 'pm-timesheet__session-name');
    if (entry.conclusion) {
      const details = makeElement('details', 'pm-timesheet__conclusion');
      const summary = makeElement('summary');
      const preview = entry.conclusion.replace(/\s+/g, ' ').trim();
      summary.textContent = preview.length > 110 ? `${preview.slice(0, 107)}…` : preview;
      const paragraph = makeElement('p');
      paragraph.textContent = entry.conclusion;
      details.append(summary, paragraph);
      sessionCell.appendChild(details);
    } else {
      appendText(sessionCell, 'p', 'Aucune conclusion', 'pm-timesheet__muted');
    }
    row.appendChild(sessionCell);
    const durationCell = appendText(row, 'td', formatDuration(entry.activeSeconds), 'pm-timesheet__time');
    durationCell.title = `Temps écoulé : ${formatDuration(entry.elapsedSeconds)}`;
    body.appendChild(row);
  }
  table.appendChild(body);
  wrapper.appendChild(table);
  return wrapper;
};

const paintStatus = (state: ViewState): void => {
  const status = state.root.querySelector<HTMLElement>('.pm-timesheet__status');
  if (!status) {
    render(state);
    return;
  }
  status.className = state.error ? 'pm-timesheet__status pm-timesheet__status--error' : 'pm-timesheet__status';
  if (state.error) status.setAttribute('role', 'alert');
  else status.removeAttribute('role');
  if (state.error) status.textContent = state.error;
  else if (state.refreshing) status.textContent = 'Actualisation des sessions…';
  else if (state.loading) status.textContent = 'Chargement des sessions…';
  else if (state.refreshedAt) status.textContent = `Actualisé à ${state.refreshedAt.toLocaleTimeString('fr-FR')}`;
  else status.textContent = '';
};

const render = (state: ViewState): void => {
  const { root, context } = state;
  const visibleEntries = state.entries;
  clearElement(root);
  const header = makeElement('header', 'pm-timesheet__header');
  const heading = makeElement('div');
  appendText(heading, 'p', state.scope === 'project' && context.project ? projectLabel(context.project) : 'Tous les dossiers', 'pm-timesheet__subtitle');
  if (state.loaded && visibleEntries.length > 0) {
    appendText(heading, 'p', `Total affiché : ${formatDuration(totalSeconds(visibleEntries))}`, 'pm-timesheet__subtitle');
  }
  header.appendChild(heading);
  const actions = makeElement('div', 'pm-timesheet__actions');
  const refreshButton = makeElement('button', 'pm-timesheet__button piecemaker-button piecemaker-button--sm piecemaker-button--glass');
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
  const table = buildTable(visibleEntries);
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
  if (state.loaded) paintStatus(state);
  else render(state);
  try {
    const cached = await fetchEntries(state.scope, projectId, controller.signal);
    if (state.disposed || state.requestId !== requestId) return;
    state.entries = cached;
    state.loaded = true;
    state.loading = false;
    render(state);
  } catch (error) {
    if (controller.signal.aborted || state.disposed || state.requestId !== requestId) return;
    state.loading = false;
    state.error = error instanceof Error ? error.message : 'Impossible de charger le timesheet.';
    if (state.loaded) paintStatus(state);
    else render(state);
  }
  if (!refresh || state.disposed || state.requestId !== requestId) return;
  state.refreshing = true;
  paintStatus(state);
  try {
    const refreshed = await refreshEntries(state.scope, projectId, controller.signal);
    if (state.disposed || state.requestId !== requestId) return;
    state.entries = refreshed.entries;
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
    disposeHeaderFilter(previous);
    previous.style.remove();
    previous.root.remove();
  }
  const style = makeElement('style');
  style.textContent = STYLE_TEXT;
  const root = makeElement('main', 'pm-timesheet piecemaker-ui');
  root.setAttribute('aria-label', 'Timesheet');
  root.dataset.theme = api.context.theme;
  container.append(style, root);
  const state: ViewState = {
    context: api.context,
    scope: 'project',
    entries: [],
    loaded: false,
    loading: false,
    refreshing: false,
    refreshedAt: null,
    error: null,
    requestId: 0,
    abortController: null,
    unsubscribe: null,
    headerSlot: null,
    filterButton: null,
    filterMenu: null,
    headerCleanup: null,
    root,
    style,
    disposed: false,
  };
  states.set(container, state);
  state.unsubscribe = api.onContextChange((context) => {
    if (state.disposed) return;
    const previousProject = state.context.project?.name ?? null;
    const nextProject = context.project?.name ?? null;
    state.context = context;
    state.root.dataset.theme = context.theme;
    if (previousProject === nextProject) return;
    void load(state, false);
  });
  buildHeaderFilter(state);
  render(state);
  void load(state, false);
}

export function unmount(container: HTMLElement): void {
  const state = states.get(container);
  if (!state) return;
  state.disposed = true;
  state.abortController?.abort();
  state.unsubscribe?.();
  disposeHeaderFilter(state);
  state.style.remove();
  state.root.remove();
  states.delete(container);
}
