import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PM = path.resolve(HERE, '..', '..', '..', 'skills', 'Skill-PieceMaker', 'scripts', 'pm.mjs');
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const PANEL_NOTICE = /^(Visible|Déjà visible|Le volet)/;

const KINDS = {
  arborescence: {
    pattern: /(^|[\\/])\.piecemaker[\\/]arborescence\.json$/,
    label: 'l’arborescence',
    place: 'Index › Classement',
    list: (value) => (Array.isArray(value) ? value : value?.dossiers),
    stored: (proposal) => (Array.isArray(proposal?.dossiers) ? proposal.dossiers : undefined),
    key: (entry) => String(entry?.name ?? entry?.nom ?? ''),
    comparable: (entry) => JSON.stringify([String(entry?.name ?? entry?.nom ?? '').trim(), String(entry?.explanation ?? entry?.explication ?? '').trim()]),
  },
  ontologie: {
    pattern: /(^|[\\/])\.piecemaker[\\/]ontologie\.json$/,
    label: 'l’ontologie',
    place: 'Index › Ontologie',
    list: (value) => (Array.isArray(value) ? value : value?.relations),
    stored: (proposal, current) => (proposal?.relations || proposal?.documentTypes ? {
      relations: proposal.relations ?? current?.relations,
      ...(proposal.documentTypes ?? current?.documentTypes ? { documentTypes: proposal.documentTypes ?? current.documentTypes } : {}),
      ...(current?.sceau ? { sceau: current.sceau } : {}),
    } : undefined),
    key: (entry) => String(entry?.name ?? ''),
    comparable: (entry) => JSON.stringify(entry),
  },
};

const resolved = (filePath, cwd) => path.resolve(cwd || process.cwd(), String(filePath)).normalize('NFC');
const kindOf = (file) => Object.keys(KINDS).find((kind) => KINDS[kind].pattern.test(file)) || null;
const serialized = (value) => `${JSON.stringify(value, null, 2)}\n`;

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function replaced(text, before, after, all) {
  const old = String(before ?? '');
  if (!old) throw new Error('le texte à remplacer est vide');
  const count = text.split(old).length - 1;
  if (!count) throw new Error('le texte à remplacer est introuvable');
  if (count > 1 && !all) throw new Error('le texte à remplacer apparaît plusieurs fois');
  return all ? text.split(old).join(String(after ?? '')) : text.replace(old, () => String(after ?? ''));
}

function fileEdit(tool, input, cwd) {
  if (!EDIT_TOOLS.has(tool) || !input.file_path) return null;
  const file = resolved(input.file_path, cwd);
  const kind = kindOf(file);
  if (!kind) return null;
  if (tool === 'Write') return { kind, file, whole: true, apply: () => String(input.content ?? '') };
  const edits = tool === 'MultiEdit' ? input.edits : [input];
  if (!Array.isArray(edits) || !edits.length) return { kind, file, error: 'modification vide' };
  return { kind, file, apply: (text) => edits.reduce((current, edit) => replaced(current, edit?.old_string, edit?.new_string, edit?.replace_all === true), text) };
}

function hunksOf(lines) {
  const hunks = [[]];
  for (const line of lines) {
    if (line.startsWith('@@')) hunks.push([]);
    else if (line !== '*** End of File') hunks[hunks.length - 1].push(line);
  }
  return hunks.filter((hunk) => hunk.some((line) => /^[-+]/.test(line))).map((hunk) => ({
    before: hunk.filter((line) => !line.startsWith('+')).map((line) => line.slice(1)).join('\n'),
    after: hunk.filter((line) => !line.startsWith('-')).map((line) => line.slice(1)).join('\n'),
  }));
}

function patchEdit(patch, cwd) {
  const sections = [];
  let current = null;
  for (const line of String(patch).replace(/\r\n/g, '\n').split('\n')) {
    const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (header) {
      current = { action: header[1], file: resolved(header[2].trim(), cwd), lines: [] };
      sections.push(current);
    } else if (/^\*\*\* (Begin|End) Patch/.test(line)) current = null;
    else if (current) current.lines.push(line);
  }
  const touched = sections.filter((section) => kindOf(section.file));
  if (!touched.length) return null;
  const [section] = touched;
  const kind = kindOf(section.file);
  if (sections.length !== 1 || section.action === 'Delete' || section.lines.some((line) => line.startsWith('*** Move to:'))) {
    return { kind, file: section.file, error: `modifiez ${path.basename(section.file)} seul dans son patch, par Add File ou Update File` };
  }
  if (section.action === 'Add') {
    return { kind, file: section.file, whole: true, apply: () => `${section.lines.filter((line) => line.startsWith('+')).map((line) => line.slice(1)).join('\n')}\n` };
  }
  const hunks = hunksOf(section.lines);
  return { kind, file: section.file, apply: (text) => hunks.reduce((content, hunk) => replaced(content, hunk.before, hunk.after, false), text) };
}

export function editOf(payload) {
  const tool = String(payload?.tool_name || '');
  const input = payload?.tool_input || {};
  if (tool === 'apply_patch') return patchEdit(Array.isArray(input.command) ? input.command.join('\n') : input.command || input.patch || input.input || '', payload.cwd);
  return fileEdit(tool, input, payload?.cwd);
}

function bases(kind, file) {
  const current = readText(file);
  const stored = KINDS[kind].stored(readJson(file.replace(/\.json$/, '.proposition.json')), readJson(file));
  const list = [];
  if (stored) list.push({ origin: 'proposition', text: serialized(stored) });
  if (current !== null) list.push({ origin: 'actuel', text: current });
  return list;
}

function edited(edit) {
  if (edit.whole) return { text: edit.apply(''), origin: 'nouveau', pending: false };
  const candidates = bases(edit.kind, edit.file);
  if (!candidates.length) throw new Error(`${path.basename(edit.file)} n’existe pas encore : écrivez-le en entier`);
  let failure;
  for (const base of candidates) {
    try {
      return { text: edit.apply(base.text), origin: base.origin, pending: candidates[0].origin === 'proposition' };
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function changes(kind, before, after) {
  const { key, comparable } = KINDS[kind];
  if (!Array.isArray(before)) before = [];
  if (!Array.isArray(after)) return 'aucun changement';
  const old = new Map(before.map((entry) => [key(entry), comparable(entry)]));
  const next = new Map(after.map((entry) => [key(entry), comparable(entry)]));
  const parts = [
    ['ajout', [...next.keys()].filter((name) => !old.has(name))],
    ['suppression', [...old.keys()].filter((name) => !next.has(name))],
    ['modification', [...next.keys()].filter((name) => old.has(name) && old.get(name) !== next.get(name))],
  ].filter(([, names]) => names.length);
  return parts.length ? parts.map(([label, names]) => `${label}${names.length > 1 ? 's' : ''} : ${names.join(', ')}`).join(' ; ') : 'aucun changement';
}

export function runPm(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [PM, ...args], { cwd, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: String(error ? (stderr || error.message) : stdout).trim() });
    });
  });
}

function pmArguments(kind, value, file, cwd) {
  if (kind === 'arborescence') {
    const dossiers = KINDS.arborescence.list(value).map((entry) => ({ nom: entry?.name ?? entry?.nom, explication: entry?.explanation ?? entry?.explication ?? '' }));
    const project = path.dirname(path.dirname(file));
    return { cwd: project, args: ['dossier', 'arborescence', '--dossier', project, '--dossiers', JSON.stringify(dossiers), ...(typeof value?.motif === 'string' ? ['--motif', value.motif] : [])] };
  }
  const { sceau, ...proposed } = Array.isArray(value) ? { relations: value } : value;
  return { cwd, args: ['okf', 'ontologie', 'proposer', '--dossier', cwd, '--json', JSON.stringify(proposed)] };
}

export async function proposalMessage(payload, run = runPm) {
  const edit = editOf(payload);
  if (!edit) return null;
  const { kind, file } = edit;
  const { label, place, list } = KINDS[kind];
  const name = path.basename(file);
  const refused = (reason) => `Proposition non enregistrée, rien n’a changé : ${reason}. Corrigez puis modifiez de nouveau ${name}.`;
  if (edit.error) return refused(edit.error);
  let result;
  try { result = edited(edit); } catch (error) { return refused(error.message); }
  let value;
  try { value = JSON.parse(result.text); } catch (error) { return refused(`JSON illisible après la modification (${error.message})`); }
  if (!Array.isArray(list(value))) return refused(kind === 'arborescence' ? 'le fichier doit contenir la liste des dossiers' : 'le fichier doit contenir « relations », la liste des relations');
  const { cwd, args } = pmArguments(kind, value, file, payload?.cwd || process.cwd());
  const answer = await run(args, cwd);
  if (!answer.ok) return refused(/ECONNREFUSED/.test(answer.output) ? 'PieceMaker n’est pas lancé, la proposition ne peut pas être vérifiée ; demandez à l’avocat de lancer PieceMaker' : answer.output.split('\n').filter(Boolean).pop() || 'pm a échoué');
  const notice = answer.output.split('\n').filter((line) => PANEL_NOTICE.test(line)).pop();
  const current = readJson(file);
  const summary = kind === 'arborescence' ? changes(kind, list(current), list(value)) : `relations — ${changes(kind, current?.relations, list(value))} ; types de documents — ${changes(kind, current?.documentTypes, value.documentTypes ?? current?.documentTypes)}`;
  return [
    `Modification enregistrée comme proposition dans ${name.replace(/\.json$/, '.proposition.json')}. ${name} ne change pas, c’est normal : l’avocat accepte, refuse ou modifie chaque changement dans l’onglet ${place}.`,
    `Par rapport à ${label} actuelle : ${summary}.`,
    result.pending && result.origin === 'actuel' ? 'La proposition en attente ne contenait pas le texte remplacé : la nouvelle proposition part du fichier actuel et remplace l’ancienne.' : `Pour la compléter, modifiez encore ${name} : chaque modification s’ajoute à la proposition en attente.`,
    ...(notice ? [notice] : []),
  ].join('\n');
}
