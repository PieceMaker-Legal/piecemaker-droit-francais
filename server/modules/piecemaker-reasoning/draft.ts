import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';

import type { ReasoningDraftCheck, ReasoningDraftFinding, ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';

import { isLegalDate } from './model.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const AMOUNT = /(\d{1,3}(?:[\s  .]\d{3})+|\d+)(?:,(\d{1,2}))?\s?(?:€|euros?\b)/gi;
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const WRITTEN_DATE = new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${MONTHS.join('|')})\\s+(\\d{4})\\b`, 'gi');

async function draftText(file: string): Promise<string> {
  if (!file.toLowerCase().endsWith('.docx')) return readFile(file, 'utf8');
  const zip = await JSZip.loadAsync(await readFile(file));
  const parts = await Promise.all(['word/document.xml', 'word/footnotes.xml'].map((name) => zip.file(name)?.async('string') ?? ''));
  return parts.join('\n').replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export async function checkDraft(projectPath: string, relative: string, snapshot: ReasoningSnapshot): Promise<ReasoningDraftCheck> {
  if (!/\.(docx|md|txt)$/i.test(relative)) throw new TypeError('Projet d’acte .docx, .md ou .txt attendu.');
  const root = await realpath(projectPath);
  const file = await realpath(path.resolve(root, relative));
  if (!file.startsWith(`${root}${path.sep}`)) throw new TypeError('Le projet d’acte doit se trouver dans le dossier.');
  const text = await draftText(file);
  const base = snapshot.evaluations.find((evaluation) => evaluation.scenario === 'base')?.results ?? [];
  const nodes = snapshot.program.nodes;
  const cents = new Set<number>();
  const dates = new Set<string>();
  for (const node of nodes) {
    const unit = node.relation?.unit?.toLowerCase() ?? '';
    const result = base.find((entry) => entry.id === node.id);
    const value = result?.status === 'known' ? result.value : node.value;
    if (typeof value === 'number' && /centime/.test(`${unit} ${node.label.toLowerCase()}`)) cents.add(Math.round(value));
    if (typeof value === 'number' && /^euros?$/.test(unit)) cents.add(Math.round(value * 100));
    for (const date of [node.relation?.eventDate, node.relation?.documentDate, value]) if (isLegalDate(date)) dates.add(date);
  }
  const findings: ReasoningDraftFinding[] = [];
  let checkedAmounts = 0;
  for (const match of text.matchAll(AMOUNT)) {
    checkedAmounts++;
    const amount = Number(match[1].replace(/[\s  .]/g, '')) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
    if (!cents.has(amount)) findings.push({ kind: 'amount', text: match[0].trim(), message: 'Montant absent du raisonnement : le rattacher à un fait sourcé ou le corriger.' });
  }
  let checkedDates = 0;
  const pad = (value: string | number) => String(value).padStart(2, '0');
  for (const match of [...text.matchAll(NUMERIC_DATE), ...text.matchAll(WRITTEN_DATE)]) {
    const month = /^\d+$/.test(match[2]) ? Number(match[2]) : MONTHS.indexOf(match[2].toLowerCase()) + 1;
    const iso = `${match[3]}-${pad(month)}-${pad(match[1])}`;
    if (!isLegalDate(iso)) continue;
    checkedDates++;
    if (!dates.has(iso)) findings.push({ kind: 'date', text: match[0], message: 'Date absente du raisonnement : vérifier l’événement ou la pièce correspondante.' });
  }
  for (const result of base) {
    const node = nodes.find((entry) => entry.id === result.id);
    if (node?.kind === 'fact' && (result.proof === 'unestablished' || result.proof === 'disputed' || result.proof === 'to_examine')) findings.push({ kind: 'reserve', text: node.label, message: result.proof === 'disputed' ? 'Fait contesté : ne pas le présenter comme acquis.' : result.proof === 'to_examine' ? 'Preuve à examiner : ne pas présenter le fait comme établi.' : 'Fait non établi : ne pas le présenter comme acquis.' });
  }
  return { file: relative, findings, checkedAmounts, checkedDates };
}
