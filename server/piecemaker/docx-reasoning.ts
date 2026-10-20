import { createHash } from 'node:crypto';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { parseLiteral, printLiteral } from '../modules/piecemaker-reasoning/format.js';
import { verifyReasoning } from '../modules/piecemaker-reasoning/program.js';
import { isLegalDate } from '../modules/piecemaker-reasoning/legal-period.js';

export const DOCX_REASONING_PART = 'docProps/custom.xml';
const PROPERTY = 'PieceMakerReasoning';
const CUSTOM = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
const VALUE = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
const hash = (text: string) => createHash('sha256').update(normalize(text)).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const xml = (text: string) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new TypeError('XML avec DTD non pris en charge.');
  const document = new DOMParser({ onError: (_level, message) => { throw new TypeError(message); } }).parseFromString(text, 'application/xml');
  if (!document.documentElement) throw new TypeError('XML sans élément racine.');
  return document as typeof document & { documentElement: XmlElement };
};
const named = (node: XmlNode, name: string): node is XmlElement => node.nodeType === 1 && (node as XmlElement).namespaceURI === WORD && (node as XmlElement).localName === name;
const children = (node: XmlNode) => Array.from(node.childNodes ?? []);
const wordText = (node: XmlNode): string => named(node, 't') ? node.textContent ?? '' : named(node, 'instrText') ? `«champ:${node.textContent}»` : named(node, 'tab') || named(node, 'br') ? ' ' : children(node).map(wordText).join('') + (named(node, 'p') ? '\n' : '');
const controls = (dom: ReturnType<typeof xml>) => Array.from(dom.getElementsByTagNameNS(WORD, 'sdt')).map((node) => {
  const properties = children(node).find((child): child is XmlElement => named(child, 'sdtPr'));
  return {
    tag: properties?.getElementsByTagNameNS(WORD, 'tag')[0]?.getAttributeNS(WORD, 'val'),
    placeholder: Boolean(properties?.getElementsByTagNameNS(WORD, 'showingPlcHdr').length),
    content: children(node).find((child): child is XmlElement => named(child, 'sdtContent')),
  };
});

export type DocxBinding = { tag: string; valeur: string; type: 'nombre' | 'pourcentage' | 'date' };
export type DocxState = { body: string; clauses: Record<string, string>; text: Record<string, string>; values: Record<string, string | number>; pending: boolean };
export type DocxReasoning = { version: 1; code: string; bindings: DocxBinding[]; clauses: string[]; baseline: Pick<DocxState, 'body' | 'clauses'> };

function bindingValue(text: string, type: DocxBinding['type']): string | number {
  const raw = text.trim();
  if (type === 'date') {
    if (!isLegalDate(raw)) throw new TypeError(`Date ISO invalide : ${raw}`);
    return raw;
  }
  const match = /^(\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?)\s*(%|EUR|€)?$/u.exec(raw);
  if (!match || (type === 'pourcentage' ? match[2] !== '%' : match[2] === '%')) throw new TypeError(`Valeur ${type} invalide : ${raw}`);
  const value = Number(match[1].replace(/[ \u00a0\u202f]/gu, '').replace(',', '.'));
  if (!Number.isFinite(value)) throw new TypeError('Valeur non finie.');
  return type === 'pourcentage' ? value / 100 : value;
}

export async function captureDocxState(input: Uint8Array, bindings: DocxBinding[], clauses: string[]): Promise<DocxState> {
  const zip = await JSZip.loadAsync(input);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new TypeError('word/document.xml absent.');
  const dom = xml(documentXml);
  const pending = ['ins', 'del', 'moveFrom', 'moveTo'].some((tag) => dom.getElementsByTagNameNS(WORD, tag).length > 0);
  if (pending) return { body: hash(documentXml), clauses: {}, text: {}, values: {}, pending };
  const foundControls = controls(dom);
  const text: Record<string, string> = {};
  const values: Record<string, string | number> = {};
  const tags = [...bindings.map((binding) => binding.tag), ...clauses];
  if (new Set(tags).size !== tags.length || new Set(bindings.map((binding) => binding.valeur)).size !== bindings.length) throw new TypeError('Ancres ou valeurs déclarées deux fois.');
  for (const tag of tags) {
    const found = foundControls.filter((control) => control.tag === tag);
    if (found.length !== 1 || found[0].placeholder || !found[0].content) throw new TypeError(`Ancre ${tag} absente, dupliquée ou non renseignée.`);
    text[tag] = wordText(found[0].content);
  }
  for (const binding of bindings) {
    values[binding.valeur] = bindingValue(text[binding.tag], binding.type);
    const content = foundControls.find((control) => control.tag === binding.tag)!.content!;
    while (content.firstChild) content.removeChild(content.firstChild);
    const run = dom.createElementNS(WORD, 'w:r');
    const value = dom.createElementNS(WORD, 'w:t');
    value.appendChild(dom.createTextNode(`«${binding.tag}»`));
    run.appendChild(value);
    content.appendChild(run);
  }
  const otherParts = await Promise.all(Object.keys(zip.files).filter((name) => /^word\/(?:header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)).sort().map(async (name) => `${name}: ${wordText(xml(await zip.file(name)!.async('string')).documentElement)}`));
  return {
    body: hash([wordText(dom.documentElement), ...otherParts].join('\n')),
    clauses: Object.fromEntries(clauses.map((tag) => [tag, hash(wordText(foundControls.find((control) => control.tag === tag)!.content!))])),
    text, values, pending,
  };
}

export async function embedDocxReasoning(input: Uint8Array, model: Omit<DocxReasoning, 'version' | 'baseline'>): Promise<Uint8Array> {
  const state = await captureDocxState(input, model.bindings, model.clauses);
  if (state.pending) throw new TypeError('Résoudre les révisions avant de rattacher le raisonnement.');
  parseLiteral(model.code);
  const zip = await JSZip.loadAsync(input);
  const dom = xml(await zip.file(DOCX_REASONING_PART)?.async('string') ?? `<Properties xmlns="${CUSTOM}" xmlns:vt="${VALUE}"/>`);
  const properties = Array.from(dom.getElementsByTagNameNS(CUSTOM, 'property'));
  const existing = properties.filter((entry) => entry.getAttribute('name') === PROPERTY);
  if (existing.length > 1) throw new TypeError('Modèle déclaré plusieurs fois.');
  const property = existing[0] ?? dom.createElementNS(CUSTOM, 'property');
  if (!existing.length) {
    property.setAttribute('fmtid', '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}');
    property.setAttribute('pid', String(Math.max(1, ...properties.map((entry) => Number(entry.getAttribute('pid')) || 1)) + 1));
    property.setAttribute('name', PROPERTY);
    dom.documentElement.appendChild(property);
  }
  while (property.firstChild) property.removeChild(property.firstChild);
  const payload = dom.createElementNS(VALUE, 'vt:lpwstr');
  payload.appendChild(dom.createTextNode(JSON.stringify({ version: 1, ...model, baseline: { body: state.body, clauses: state.clauses } })));
  property.appendChild(payload);
  zip.file(DOCX_REASONING_PART, new XMLSerializer().serializeToString(dom));
  const types = xml(await zip.file('[Content_Types].xml')!.async('string'));
  if (!Array.from(types.getElementsByTagNameNS(CONTENT_TYPES, 'Override')).some((entry) => entry.getAttribute('PartName') === `/${DOCX_REASONING_PART}`)) {
    const type = types.createElementNS(CONTENT_TYPES, 'Override');
    type.setAttribute('PartName', `/${DOCX_REASONING_PART}`);
    type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.custom-properties+xml');
    types.documentElement.appendChild(type);
    zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(types));
  }
  const relationshipPath = '_rels/.rels';
  const relationships = xml(await zip.file(relationshipPath)?.async('string') ?? `<Relationships xmlns="${REL}"/>`);
  const entries = Array.from(relationships.documentElement.childNodes).filter((entry): entry is XmlElement => entry.nodeType === 1);
  if (!entries.some((entry) => entry.getAttribute('Target') === DOCX_REASONING_PART)) {
    const relation = relationships.createElementNS(REL, 'Relationship');
    relation.setAttribute('Id', `pmReasoning${entries.length}`);
    relation.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties');
    relation.setAttribute('Target', DOCX_REASONING_PART);
    relationships.documentElement.appendChild(relation);
    zip.file(relationshipPath, new XMLSerializer().serializeToString(relationships));
  }
  return zip.generateAsync({ type: 'uint8array' });
}

export async function readDocxReasoning(input: Uint8Array): Promise<DocxReasoning> {
  const zip = await JSZip.loadAsync(input);
  const text = await zip.file(DOCX_REASONING_PART)?.async('string');
  if (!text) throw new TypeError('Ce DOCX ne contient pas de modèle de raisonnement lié.');
  const dom = xml(text);
  const properties = Array.from(dom.getElementsByTagNameNS(CUSTOM, 'property')).filter((entry) => entry.getAttribute('name') === PROPERTY);
  if (properties.length !== 1) throw new TypeError('Propriété de raisonnement absente ou dupliquée.');
  const payload = properties[0].getElementsByTagNameNS(VALUE, 'lpwstr');
  if (payload.length !== 1) throw new TypeError('Propriété de raisonnement illisible.');
  const model: unknown = JSON.parse(payload[0].textContent ?? '');
  if (!object(model) || model.version !== 1 || typeof model.code !== 'string' || !Array.isArray(model.bindings) || !Array.isArray(model.clauses) || !model.clauses.every((tag) => typeof tag === 'string') || !object(model.baseline) || typeof model.baseline.body !== 'string' || !object(model.baseline.clauses)) throw new TypeError('Modèle DOCX invalide.');
  for (const binding of model.bindings) if (!object(binding) || typeof binding.tag !== 'string' || typeof binding.valeur !== 'string' || !['nombre', 'pourcentage', 'date'].includes(String(binding.type))) throw new TypeError('Liaison DOCX invalide.');
  return model as DocxReasoning;
}

export async function verifyDocxReasoning(input: Uint8Array, options: Omit<Parameters<typeof verifyReasoning>[0], 'code' | 'simulation'>) {
  const model = await readDocxReasoning(input);
  const state = await captureDocxState(input, model.bindings, model.clauses);
  const changed = model.clauses.filter((tag) => state.clauses[tag] !== model.baseline.clauses[tag]);
  if (state.pending || state.body !== model.baseline.body) return {
    status: 'à revoir' as const,
    changed: state.pending ? ['révisions en attente', ...changed] : changed.length ? changed : ['texte hors clauses ou ordre du document'],
    context: changed.filter((tag) => tag in state.text).map((tag) => ({ tag, text: state.text[tag] })), verification: null,
  };
  const parsed = parseLiteral(model.code).value;
  if (!object(parsed) || !object(parsed.valeurs)) throw new TypeError('Le modèle doit déclarer ses valeurs.');
  for (const binding of model.bindings) {
    const value = parsed.valeurs[binding.valeur];
    if (!object(value) || value.formule !== undefined || value.selon !== undefined) throw new TypeError(`Liaison vers une valeur absente, calculée ou fixée par un texte : ${binding.valeur}`);
    value.valeur = state.values[binding.valeur];
    value.preuve = [{ piece: `docx#${binding.tag}`, citation: state.text[binding.tag] }];
  }
  const connectors = {
    ...options.connectors,
    source: async (cwd: string, id: string) => {
      if (!id.startsWith('docx#')) return options.connectors.source(cwd, id);
      const tag = id.slice(5);
      return tag in state.text ? { kind: 'piece' as const, title: tag, text: state.text[tag] } : null;
    },
  };
  const verification = await verifyReasoning({ ...options, connectors, code: printLiteral(parsed) });
  return { status: 'testé' as const, changed: [], context: [], verification };
}
