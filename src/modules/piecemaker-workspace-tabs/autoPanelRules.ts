import { planCall } from '@/piecemaker/editor-tabs/planCalls';
import type { PlanCall } from '@/piecemaker/editor-tabs/planCalls';

export type DossierView = 'general' | 'chronology';

export type AutoPanelTarget =
  | { kind: 'file'; path: string }
  | { kind: 'plan'; plan: PlanCall }
  | { kind: 'dossier'; view: DossierView }
  | { kind: 'tabular-review'; review: string | null; draft?: string; awaitDraft?: true }
  | { kind: 'tampon' };

export type PanelSnapshot = {
  panels: readonly string[];
  document: string | null;
  focus: Readonly<Record<string, { view?: string; file?: string | null }>>;
};

type Input = Record<string, unknown>;

const PIECEMAKER_TOOL = /(?:^|[_.:])piecemaker(?:__|[.:/])([a-z_]+)$/i;
const DOCX_PATH = /"([^"]+\.docx)"|'([^']+\.docx)'|((?:\\ |[^\s;&|<>"'])+\.docx)(?![\w.])/i;
const DOCX_READ = new Set(['read', 'find', 'wc', 'outline', 'render', 'validate', 'info']);
const DOCX_WRITE = new Set(['create', 'edit', 'insert', 'delete', 'replace', 'sections', 'raw']);
const DOCX_FAMILY = new Set(['comments', 'footnotes', 'endnotes', 'headers', 'footers', 'images', 'hyperlinks', 'tables', 'lists', 'styles', 'track-changes']);
const DOCX_FAMILY_READ = new Set(['list', 'extract', 'get']);
const NODE_WRITE = /\b(?:update|insert(?:\s+or\s+\w+)?\s+into|replace\s+into|delete\s+from)\s+(?:main\.)?piecemaker_nodes\b/i;
const DOCUMENT_COLUMNS = /\bdoc_date\b|'document'/i;
const WRITE_TOOLS = new Set(['Write', 'write_file']);
const EDIT_TOOLS = new Set(['Edit', 'edit']);

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function commandText(input: Input): string {
  const value = input.command ?? input.cmd;
  if (Array.isArray(value)) {
    return value.map((part) => typeof part === 'string' ? part : '').filter(Boolean).join(' ');
  }
  return text(value);
}

const baseName = (value: string): string => value.split(/[\\/]/).pop() ?? value;

function samePanelPath(left: string, right: string): boolean {
  const a = left.replace(/\\/g, '/');
  const b = right.replace(/\\/g, '/');
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export function panelShowDecision(target: AutoPanelTarget, snapshot: PanelSnapshot): 'apply' | 'skip' {
  if (target.kind === 'file') {
    return snapshot.document && samePanelPath(snapshot.document, target.path) ? 'skip' : 'apply';
  }
  if (target.kind === 'plan') return 'apply';
  if (target.kind === 'tampon') {
    return snapshot.panels.includes('plugin:piecemaker-tampon') ? 'skip' : 'apply';
  }
  if (target.kind === 'dossier') {
    if (!snapshot.panels.includes('plugin:piecemaker-dossier')) return 'apply';
    return snapshot.focus['plugin:piecemaker-dossier']?.view === target.view ? 'skip' : 'apply';
  }
  const tab = 'plugin:piecemaker-tabular-review';
  const open = snapshot.panels.includes(tab);
  const current = snapshot.focus[tab]?.file;
  const wanted = target.review || target.draft || '';
  if (wanted) {
    if (open && current && (samePanelPath(current, wanted) || baseName(current) === baseName(wanted))) return 'skip';
    return 'apply';
  }
  return open ? 'skip' : 'apply';
}

function docxWrite(command: string): boolean {
  const argv = tokens(command);
  const index = argv.findIndex((token) => /(?:^|[/\\])docx$/.test(token));
  if (index < 0) return false;
  const verb = argv[index + 1];
  if (!verb || verb.startsWith('-') || DOCX_READ.has(verb)) return false;
  if (DOCX_FAMILY.has(verb)) {
    const sub = argv[index + 2];
    return Boolean(sub) && !sub.startsWith('-') && !/\.docx$/i.test(sub) && !DOCX_FAMILY_READ.has(sub);
  }
  return DOCX_WRITE.has(verb);
}

function docxTarget(command: string): AutoPanelTarget | null {
  if (!docxWrite(command)) return null;
  const match = DOCX_PATH.exec(command);
  const path = match?.[1] ?? match?.[2] ?? match?.[3]?.replace(/\\ /g, ' ');
  return path ? { kind: 'file', path } : null;
}

function sqlTarget(query: string): AutoPanelTarget | null {
  if (!NODE_WRITE.test(query)) return null;
  return { kind: 'dossier', view: DOCUMENT_COLUMNS.test(query) ? 'chronology' : 'general' };
}

function showTarget(input: Input): AutoPanelTarget | null {
  if (input.fermer === true || input.fermer === 'true') return null;
  const file = text(input.fichier);
  if (file) return { kind: 'file', path: file };
  if (input.volet === 'chronologie') return { kind: 'dossier', view: 'chronology' };
  if (input.volet === 'dossier') return { kind: 'dossier', view: 'general' };
  if (input.volet === 'tampon') return { kind: 'tampon' };
  if (input.volet === 'tabular-review') return { kind: 'tabular-review', review: text(input.review) ? baseName(text(input.review)) : null };
  return null;
}

function writeDocxTarget(toolName: string, input: Input): AutoPanelTarget | null {
  if (!WRITE_TOOLS.has(toolName) && !EDIT_TOOLS.has(toolName)) return null;
  const file = text(input.file_path) || text(input.path);
  return /\.docx$/i.test(file) ? { kind: 'file', path: file } : null;
}

const DRAFT_ID = /"projet":"([\w-]{1,80})"/;

export function draftFromResult(content: unknown): string | null {
  const value = Array.isArray(content) ? content.map((entry) => text((entry as Input | null)?.text)).join('\n') : text(content);
  return DRAFT_ID.exec(value)?.[1] ?? null;
}

function tabularReviewTarget(input: Input): AutoPanelTarget | null {
  const draft = text(input.projet);
  if (input.action === 'ouvrir') return draft ? { kind: 'tabular-review', review: null, draft } : { kind: 'tabular-review', review: text(input.fichier) ? baseName(text(input.fichier)) : null };
  if (input.action === 'preparer') return draft ? { kind: 'tabular-review', review: null, draft } : { kind: 'tabular-review', review: null, awaitDraft: true };
  if (input.action === 'lister' || input.action === 'lancer') return { kind: 'tabular-review', review: null };
  return null;
}

function pieceMakerTarget(tool: string, input: Input): AutoPanelTarget | null {
  if (tool === 'afficher') return showTarget(input);
  if (tool === 'chronologie') return { kind: 'dossier', view: 'chronology' };
  if (tool === 'tabular_review') return tabularReviewTarget(input);
  if (tool === 'sql') return sqlTarget(text(input.requete));
  return null;
}

function tokens(command: string): string[] {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(pattern)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return out;
}

function flagMap(argv: string[]): { flags: Input; rest: string[] } {
  const flags: Input = {};
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('--')) {
      rest.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const key = (eq === -1 ? token.slice(2) : token.slice(2, eq)).replace(/-/g, '_');
    if (eq !== -1) flags[key] = token.slice(eq + 1);
    else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('-')) {
      index += 1;
      flags[key] = argv[index];
    } else flags[key] = true;
  }
  return { flags, rest };
}

function pieceMakerCliTarget(command: string): AutoPanelTarget | null {
  const argv = tokens(command);
  const script = argv.findIndex((token) => /(?:^|[/\\])pm(?:\.mjs)?$/.test(token));
  if (script < 0) {
    const nested = argv.find((token) => token !== command && /(?:^|[/\\])pm(?:\.mjs)?(?:\s|$)/.test(token));
    return nested ? pieceMakerCliTarget(nested) : null;
  }
  const { flags, rest } = flagMap(argv.slice(script + 1));
  const tool = rest[0];
  if (tool === 'afficher') return showTarget(flags);
  if (tool === 'chronologie') return { kind: 'dossier', view: 'chronology' };
  if (tool === 'tabular_review') return tabularReviewTarget({ ...flags, action: rest[1] });
  if (tool === 'sql') return sqlTarget(text(flags.requete) || rest.slice(1).join(' '));
  return null;
}

export function autoPanelTarget(toolName: string, toolInput: unknown): AutoPanelTarget | null {
  const parsed = typeof toolInput === 'string' ? (() => { try { return JSON.parse(toolInput) as unknown; } catch { return {}; } })() : toolInput;
  const input = parsed && typeof parsed === 'object' ? parsed as Input : {};
  const command = commandText(input);
  if (command) {
    const cli = pieceMakerCliTarget(command);
    if (cli) return cli;
    const fromDocx = docxTarget(command);
    if (fromDocx) return fromDocx;
  }
  const plan = planCall(toolName, toolInput);
  if (plan) return { kind: 'plan', plan };
  const written = writeDocxTarget(toolName, input);
  if (written) return written;
  const pieceMakerTool = PIECEMAKER_TOOL.exec(toolName)?.[1]?.toLowerCase();
  return pieceMakerTool ? pieceMakerTarget(pieceMakerTool, input) : null;
}
