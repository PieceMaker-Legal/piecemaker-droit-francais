import { createHash } from 'node:crypto';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { printReasoningDocument } from '../modules/piecemaker-reasoning/document.js';
import { parseLiteral } from '../modules/piecemaker-reasoning/format.js';
import { verifyReasoning } from '../modules/piecemaker-reasoning/program.js';
import { isLegalDate } from '../modules/piecemaker-reasoning/legal-period.js';

import { modelHash, resolveReferencedModel, validateModelReference } from './docx-reasoning-reference.js';
import type { DocxModelReference } from './docx-reasoning-reference.js';

export const DOCX_REASONING_PART = 'docProps/custom.xml';
export class UnlinkedDocxError extends TypeError {}
const PROPERTY = 'PieceMakerReasoning';
const CUSTOM = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
const VALUE = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
const hash = (text: string) => createHash('sha256').update(normalize(text)).digest('hex');
const bookmarkName = (tag: string) => `pmr_${hash(tag).slice(0, 24)}`;
const endTag = (tag: string) => `pmr_end_${hash(tag).slice(0, 24)}`;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const xml = (text: string) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new TypeError('XML avec DTD non pris en charge.');
  const document = new DOMParser({ onError: (_level, message) => { throw new TypeError(message); } }).parseFromString(text, 'application/xml');
  if (!document.documentElement) throw new TypeError('XML sans élément racine.');
  return document as typeof document & { documentElement: XmlElement };
};
const named = (node: XmlNode, name: string): node is XmlElement => node.nodeType === 1 && (node as XmlElement).namespaceURI === WORD && (node as XmlElement).localName === name;
const children = (node: XmlNode) => Array.from(node.childNodes ?? []);
const wordText = (node: XmlNode): string => {
  if (named(node, 'sdt')) {
    const properties = children(node).find((child): child is XmlElement => named(child, 'sdtPr'));
    const tag = properties?.getElementsByTagNameNS(WORD, 'tag')[0]?.getAttributeNS(WORD, 'val');
    if (tag && /^pmr_end_[a-f0-9]{24}$/.test(tag)) {
      const content = children(node).find((child): child is XmlElement => named(child, 'sdtContent'));
      if (!content || children(content).map(wordText).join('') !== '\u2060') throw new TypeError(`Repère de fin ${tag} modifié.`);
      return '';
    }
  }
  return named(node, 't') ? node.textContent ?? '' : named(node, 'instrText') ? `«champ:${node.textContent}»` : named(node, 'tab') || named(node, 'br') ? ' ' : (named(node, 'fldSimple') ? `«champ:${node.getAttributeNS(WORD, 'instr')}»` : '') + children(node).map(wordText).join('') + (named(node, 'p') ? '\n' : '');
};
const controls = (dom: ReturnType<typeof xml>) => Array.from(dom.getElementsByTagNameNS(WORD, 'sdt')).map((node) => {
  const properties = children(node).find((child): child is XmlElement => named(child, 'sdtPr'));
  return {
    node,
    properties,
    tag: properties?.getElementsByTagNameNS(WORD, 'tag')[0]?.getAttributeNS(WORD, 'val'),
    placeholder: Boolean(properties?.getElementsByTagNameNS(WORD, 'showingPlcHdr').length),
    content: children(node).find((child): child is XmlElement => named(child, 'sdtContent')),
  };
});
const clauseText = (dom: ReturnType<typeof xml>, tag: string, fallback: XmlElement, requireEnd: boolean) => {
  const markers = controls(dom).filter((control) => control.tag === endTag(tag));
  if (requireEnd && markers.length !== 1) throw new TypeError(`Repère de fin ${tag} absent ou dupliqué.`);
  if (markers.length > 1) throw new TypeError(`Repère de fin ${tag} dupliqué.`);
  const starts: XmlNode[] = Array.from(dom.getElementsByTagNameNS(WORD, 'bookmarkStart')).filter((node) => node.getAttributeNS(WORD, 'name') === bookmarkName(tag));
  if (starts.length > 1) throw new TypeError(`Signet ${tag} dupliqué ou incomplet.`);
  const bookmarkEnds = starts.length ? Array.from(dom.getElementsByTagNameNS(WORD, 'bookmarkEnd')).filter((node) => node.getAttributeNS(WORD, 'id') === (starts[0] as XmlElement).getAttributeNS(WORD, 'id')) : [];
  if (starts.length && bookmarkEnds.length !== 1) throw new TypeError(`Signet ${tag} dupliqué ou incomplet.`);
  if (markers.length) {
    wordText(markers[0].node);
    starts.splice(0, starts.length, fallback);
  }
  if (!starts.length) return wordText(fallback);
  const end = markers[0]?.node ?? bookmarkEnds[0];
  let active = false;
  let closed = false;
  const visit = (node: XmlNode): string => {
    if (node === starts[0]) active = true;
    if (node === end) { if (!active) throw new TypeError(`Repères ${tag} inversés.`); active = false; closed = true; return ''; }
    if (named(node, 't') || named(node, 'instrText') || named(node, 'tab') || named(node, 'br')) return active ? wordText(node) : '';
    return (active && named(node, 'fldSimple') ? `«champ:${node.getAttributeNS(WORD, 'instr')}»` : '') + children(node).map(visit).join('') + (active && named(node, 'p') ? '\n' : '');
  };
  const text = visit(dom.documentElement);
  if (!closed) throw new TypeError(`Signet ${tag} incomplet.`);
  return text;
};

export type DocxBinding = { tag: string; valeur: string; type: 'nombre' | 'pourcentage' | 'date' };
export type DocxState = { body: string; clauses: Record<string, string>; text: Record<string, string>; values: Record<string, string | number>; pending: boolean };
export type DocxReasoning = { bindings: DocxBinding[]; clauses: string[]; anchors?: 'sdt-end'; baseline: Pick<DocxState, 'body' | 'clauses'> } & ({ version: 1; code: string; reference?: never } | { version: 2; code?: never; reference: DocxModelReference });

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

export async function captureDocxState(input: Uint8Array, bindings: DocxBinding[], clauses: string[], requireEnd = false): Promise<DocxState> {
  const zip = await JSZip.loadAsync(input);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new TypeError('word/document.xml absent.');
  const dom = xml(documentXml);
  const otherParts = await Promise.all(Object.keys(zip.files).filter((name) => /^word\/(?:header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)).sort().map(async (name) => ({ name, dom: xml(await zip.file(name)!.async('string')) })));
  const pending = [dom, ...otherParts.map((part) => part.dom)].some((part) => ['ins', 'del', 'moveFrom', 'moveTo'].some((tag) => part.getElementsByTagNameNS(WORD, tag).length > 0));
  if (pending) return { body: hash(documentXml), clauses: {}, text: {}, values: {}, pending };
  const foundControls = controls(dom);
  const text: Record<string, string> = {};
  const values: Record<string, string | number> = {};
  const tags = [...bindings.map((binding) => binding.tag), ...clauses];
  if (new Set(tags).size !== tags.length || new Set(bindings.map((binding) => binding.valeur)).size !== bindings.length) throw new TypeError('Ancres ou valeurs déclarées deux fois.');
  for (const tag of tags) {
    const found = foundControls.filter((control) => control.tag === tag);
    if (found.length !== 1 || found[0].placeholder || !found[0].content) throw new TypeError(`Ancre ${tag} absente, dupliquée ou non renseignée.`);
    text[tag] = clauses.includes(tag) ? clauseText(dom, tag, found[0].content, requireEnd) : wordText(found[0].content);
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
  return {
    body: hash([wordText(dom.documentElement), ...otherParts.map((part) => `${part.name}: ${wordText(part.dom.documentElement)}`)].join('\n')),
    clauses: Object.fromEntries(clauses.map((tag) => [tag, hash(clauseText(dom, tag, foundControls.find((control) => control.tag === tag)!.content!, requireEnd))])),
    text, values, pending,
  };
}

export async function embedDocxReasoning(input: Uint8Array, model: { code: string; bindings: DocxBinding[]; clauses: string[]; reference?: DocxModelReference }): Promise<Uint8Array> {
  const state = await captureDocxState(input, model.bindings, model.clauses);
  if (state.pending) throw new TypeError('Résoudre les révisions avant de rattacher le raisonnement.');
  parseLiteral(model.code);
  if (model.reference) {
    validateModelReference(model.reference);
    if (model.reference.sha256 !== modelHash(model.code)) throw new TypeError('Empreinte du modèle incohérente.');
  }
  const zip = await JSZip.loadAsync(input);
  const document = xml(await zip.file('word/document.xml')!.async('string'));
  const linkedTags = new Set([...model.bindings.map((binding) => binding.tag), ...model.clauses]);
  let bookmarkId = Math.max(0, ...Array.from(document.getElementsByTagNameNS(WORD, 'bookmarkStart')).map((node) => Number(node.getAttributeNS(WORD, 'id')) || 0));
  let controlId = Math.max(0, ...Array.from(document.getElementsByTagNameNS(WORD, 'id')).map((node) => Number(node.getAttributeNS(WORD, 'val')) || 0));
  for (const control of controls(document)) {
    if (!control.tag || !linkedTags.has(control.tag)) continue;
    const properties = control.properties!;
    for (const entry of children(properties)) if (named(entry, 'lock') || named(entry, 'temporary')) properties.removeChild(entry);
    const lock = document.createElementNS(WORD, 'w:lock');
    lock.setAttributeNS(WORD, 'w:val', 'sdtLocked');
    properties.appendChild(lock);
    if (model.clauses.includes(control.tag) && !Array.from(document.getElementsByTagNameNS(WORD, 'bookmarkStart')).some((node) => node.getAttributeNS(WORD, 'name') === bookmarkName(control.tag!))) {
      const start = document.createElementNS(WORD, 'w:bookmarkStart');
      const end = document.createElementNS(WORD, 'w:bookmarkEnd');
      const id = String(++bookmarkId);
      start.setAttributeNS(WORD, 'w:id', id);
      start.setAttributeNS(WORD, 'w:name', bookmarkName(control.tag));
      end.setAttributeNS(WORD, 'w:id', id);
      control.content!.insertBefore(start, control.content!.firstChild);
      control.content!.appendChild(end);
    }
    if (model.clauses.includes(control.tag) && !controls(document).some((entry) => entry.tag === endTag(control.tag!))) {
      const marker = document.createElementNS(WORD, 'w:sdt');
      const properties = document.createElementNS(WORD, 'w:sdtPr');
      for (const [name, value] of [['tag', endTag(control.tag)], ['id', String(++controlId)], ['lock', 'sdtContentLocked']]) {
        const property = document.createElementNS(WORD, `w:${name}`);
        property.setAttributeNS(WORD, 'w:val', value);
        properties.appendChild(property);
      }
      const content = document.createElementNS(WORD, 'w:sdtContent');
      const run = document.createElementNS(WORD, 'w:r');
      const text = document.createElementNS(WORD, 'w:t');
      text.appendChild(document.createTextNode('\u2060'));
      run.appendChild(text);
      content.appendChild(run);
      marker.appendChild(properties);
      marker.appendChild(content);
      (Array.from(control.content!.getElementsByTagNameNS(WORD, 'p')).at(-1) ?? control.content!).appendChild(marker);
    }
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
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
  payload.appendChild(dom.createTextNode(JSON.stringify({ ...(model.reference ? { version: 2, reference: model.reference } : { version: 1, code: model.code }), bindings: model.bindings, clauses: model.clauses, anchors: 'sdt-end', baseline: { body: state.body, clauses: state.clauses } })));
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
  if (!text) throw new UnlinkedDocxError('Ce DOCX ne contient pas de modèle de raisonnement lié.');
  const dom = xml(text);
  const properties = Array.from(dom.getElementsByTagNameNS(CUSTOM, 'property')).filter((entry) => entry.getAttribute('name') === PROPERTY);
  if (!properties.length) throw new UnlinkedDocxError('Ce DOCX ne contient pas de modèle de raisonnement lié.');
  if (properties.length !== 1) throw new TypeError('Propriété de raisonnement absente ou dupliquée.');
  const payload = properties[0].getElementsByTagNameNS(VALUE, 'lpwstr');
  if (payload.length !== 1) throw new TypeError('Propriété de raisonnement illisible.');
  const model: unknown = JSON.parse(payload[0].textContent ?? '');
  if (!object(model) || !((model.version === 1 && typeof model.code === 'string' && model.reference === undefined) || (model.version === 2 && model.code === undefined && object(model.reference))) || !Array.isArray(model.bindings) || !Array.isArray(model.clauses) || !model.clauses.every((tag) => typeof tag === 'string') || !object(model.baseline) || typeof model.baseline.body !== 'string' || !object(model.baseline.clauses)) throw new TypeError('Modèle DOCX invalide.');
  if (model.version === 2) validateModelReference(model.reference);
  for (const binding of model.bindings) if (!object(binding) || typeof binding.tag !== 'string' || typeof binding.valeur !== 'string' || !['nombre', 'pourcentage', 'date'].includes(String(binding.type))) throw new TypeError('Liaison DOCX invalide.');
  if (model.anchors !== undefined && model.anchors !== 'sdt-end') throw new TypeError('Format des repères DOCX invalide.');
  return model as DocxReasoning;
}

export async function verifyDocxReasoning(input: Uint8Array, options: Omit<Parameters<typeof verifyReasoning>[0], 'code' | 'simulation'>) {
  const model = await readDocxReasoning(input);
  const code = model.version === 1 ? model.code : await resolveReferencedModel(options.cwd, model.reference);
  const state = await captureDocxState(input, model.bindings, model.clauses, model.anchors === 'sdt-end');
  const changed = model.clauses.filter((tag) => state.clauses[tag] !== model.baseline.clauses[tag]);
  if (state.pending || state.body !== model.baseline.body || changed.length > 0) return {
    status: 'à revoir' as const,
    changed: state.pending ? ['révisions en attente', ...changed] : changed.length ? changed : ['texte hors clauses ou ordre du document'],
    context: changed.filter((tag) => tag in state.text).map((tag) => ({ tag, text: state.text[tag] })), verification: null,
  };
  const parsed = parseLiteral(code).value;
  if (!object(parsed) || (model.bindings.length > 0 && !object(parsed.valeurs))) throw new TypeError('Le modèle doit déclarer ses valeurs liées.');
  for (const binding of model.bindings) {
    const values = parsed.valeurs as Record<string, unknown>;
    const value = Object.hasOwn(values, binding.valeur) ? values[binding.valeur] : undefined;
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
  const verification = await verifyReasoning({ ...options, connectors, code: printReasoningDocument(parsed) });
  if (model.version === 2) await resolveReferencedModel(options.cwd, model.reference);
  return { status: 'testé' as const, changed: [], context: [], verification };
}
