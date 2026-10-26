import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element, Node } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { captureDocxState, embedDocxReasoning, readDocxReasoning, UnlinkedDocxError } from './docx-reasoning.js';
import type { DocxBinding } from './docx-reasoning.js';
import { parseModel } from './docx-reasoning-reference.js';
import type { DocxModelReference } from './docx-reasoning-reference.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const normalize = (value: string) => value.replace(/\s+/gu, ' ').trim();
const children = (node: Node) => Array.from(node.childNodes);
const named = (node: Node, name: string): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === WORD && (node as Element).localName === name;
const textOf = (node: Node): string => named(node, 't') ? node.textContent ?? '' : named(node, 'tab') ? '\t' : named(node, 'br') ? '\n' : children(node).map(textOf).join('');

export type DocxLinks = {
  clauses: { tag: string; paragraphes: string[] }[];
  valeurs: (DocxBinding & { texte: string; clause: string })[];
};

function validateLinks(value: unknown): asserts value is DocxLinks {
  if (!value || typeof value !== 'object' || !('clauses' in value) || !('valeurs' in value) || !Array.isArray(value.clauses) || !value.clauses.length || !Array.isArray(value.valeurs)) throw new TypeError('Déclarer clauses et valeurs dans le fichier de liens.');
  const tags = new Set<string>();
  const variables = new Set<string>();
  for (const clause of value.clauses) {
    if (!clause || typeof clause.tag !== 'string' || !clause.tag.trim() || !Array.isArray(clause.paragraphes) || !clause.paragraphes.length || !clause.paragraphes.every((text: unknown) => typeof text === 'string' && normalize(text))) throw new TypeError('Chaque clause requiert un tag et des paragraphes non vides.');
    if (tags.has(clause.tag)) throw new TypeError('Tag déclaré plusieurs fois.');
    tags.add(clause.tag);
  }
  for (const binding of value.valeurs) {
    if (!binding || typeof binding.tag !== 'string' || !binding.tag.trim() || typeof binding.valeur !== 'string' || !binding.valeur.trim() || !['nombre', 'pourcentage', 'date'].includes(binding.type) || typeof binding.texte !== 'string' || !binding.texte.trim() || !value.clauses.some((clause) => clause.tag === binding.clause)) throw new TypeError('Liaison de valeur invalide ou clause inconnue.');
    if (tags.has(binding.tag) || variables.has(binding.valeur)) throw new TypeError('Tag ou variable déclaré plusieurs fois.');
    tags.add(binding.tag);
    variables.add(binding.valeur);
  }
  if ([...tags].some((tag) => tag.startsWith('pmr_'))) throw new TypeError('Le préfixe pmr_ est réservé aux repères internes.');
}

export async function prepareDocxReasoning(input: Uint8Array, code: string, links: unknown, reference?: DocxModelReference): Promise<Uint8Array> {
  validateLinks(links);
  try { await readDocxReasoning(input); throw new TypeError('Document déjà lié : conserver sa référence et ses repères existants.'); }
  catch (error) { if (!(error instanceof UnlinkedDocxError)) throw error; }
  const original = await captureDocxState(input, [], []);
  if (original.pending) throw new TypeError('Résoudre les révisions avant de préparer les liens.');
  const model = parseModel(code) as Record<string, unknown>;
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new TypeError('Le modèle doit être un objet déclaratif.');
  for (const binding of links.valeurs) {
    const values = model.valeurs as Record<string, unknown> | undefined;
    const value = values && Object.hasOwn(values, binding.valeur) ? values[binding.valeur] : undefined;
    if (!value || typeof value !== 'object' || 'formule' in value || 'selon' in value) throw new TypeError(`Variable absente, calculée ou fixée par un texte : ${binding.valeur}`);
  }
  const zip = await JSZip.loadAsync(input);
  const source = await zip.file('word/document.xml')!.async('string');
  const dom = new DOMParser({ onError: (_level, message) => { throw new TypeError(message); } }).parseFromString(source, 'application/xml');
  let id = Math.max(0, ...Array.from(dom.getElementsByTagNameNS(WORD, 'id')).map((node) => Number(node.getAttributeNS(WORD, 'val')) || 0));
  const makeControl = (tag: string) => {
    if (Array.from(dom.getElementsByTagNameNS(WORD, 'tag')).some((node) => node.getAttributeNS(WORD, 'val') === tag)) throw new TypeError(`Tag déjà présent : ${tag}`);
    const control = dom.createElementNS(WORD, 'w:sdt');
    const properties = dom.createElementNS(WORD, 'w:sdtPr');
    for (const [name, value] of [['tag', tag], ['id', String(++id)]]) {
      const property = dom.createElementNS(WORD, `w:${name}`);
      property.setAttributeNS(WORD, 'w:val', value);
      properties.appendChild(property);
    }
    const content = dom.createElementNS(WORD, 'w:sdtContent');
    control.appendChild(properties);
    control.appendChild(content);
    return { control, content };
  };
  const scopes = new Map<string, Element>();
  const used = new Set<Node>();
  for (const clause of links.clauses) {
    const paragraphs = Array.from(dom.getElementsByTagNameNS(WORD, 'p'));
    const matches = paragraphs.filter((paragraph) => normalize(textOf(paragraph)) === normalize(clause.paragraphes[0])).map((first) => {
      const selected: Element[] = [first];
      let cursor: Node | null = first;
      for (let index = 1; index < clause.paragraphes.length; index++) {
        do { cursor = cursor?.nextSibling ?? null; } while (cursor?.nodeType === 3 && !cursor.textContent?.trim());
        if (!cursor || !named(cursor, 'p') || normalize(textOf(cursor)) !== normalize(clause.paragraphes[index])) return null;
        selected.push(cursor);
      }
      return selected;
    }).filter((selected): selected is Element[] => selected !== null);
    if (matches.length !== 1) throw new TypeError(`Clause ${clause.tag} introuvable, non contiguë ou ambiguë.`);
    const selected = matches[0];
    if (selected.some((paragraph) => used.has(paragraph))) throw new TypeError('Les sélections de clauses se chevauchent.');
    const { control, content } = makeControl(clause.tag);
    selected[0].parentNode!.insertBefore(control, selected[0]);
    for (const paragraph of selected) { used.add(paragraph); content.appendChild(paragraph); }
    scopes.set(clause.tag, content);
  }
  for (const binding of links.valeurs) {
    const scope = scopes.get(binding.clause)!;
    const matches: { nodes: Element[]; from: number; to: number; paragraph: Element }[] = [];
    for (const paragraph of Array.from(scope.getElementsByTagNameNS(WORD, 'p'))) {
      const nodes = Array.from(paragraph.getElementsByTagNameNS(WORD, 't'));
      const text = textOf(paragraph);
      let from = text.indexOf(binding.texte);
      while (from !== -1) {
        const to = from + binding.texte.length;
        const partialStart = /^\d/u.test(binding.texte) && /(?:\d|\d[., \u00a0\u202f])$/u.test(text.slice(0, from));
        const partialEnd = /\d$/u.test(binding.texte) && /^(?:\d|[.,]\d|[ \u00a0\u202f]\d{3}(?:\D|$))/u.test(text.slice(to));
        if (!partialStart && !partialEnd) matches.push({ nodes, from, to, paragraph });
        from = text.indexOf(binding.texte, from + 1);
      }
    }
    if (matches.length !== 1) throw new TypeError(`Valeur ${binding.tag} introuvable ou ambiguë dans sa clause.`);
    const { nodes, from, to, paragraph } = matches[0];
    if (['fldSimple', 'fldChar', 'instrText', 'tab', 'br'].some((tag) => paragraph.getElementsByTagNameNS(WORD, tag).length)) throw new TypeError('Choisir une valeur en texte fixe, sans champ Word ni rupture dans son paragraphe.');
    let offset = 0;
    const selected = nodes.map((node) => { const start = offset; offset += node.textContent?.length ?? 0; return { node, start, end: offset }; }).filter((part) => part.end > from && part.start < to);
    const runs = [...new Set(selected.map((part) => part.node.parentNode!))];
    const parent = runs[0]?.parentNode;
    if (!parent || runs.some((run) => !named(run, 'r') || run.parentNode !== parent || children(run).some((child) => child.nodeType === 1 && !named(child, 'rPr') && !named(child, 't')))) throw new TypeError('La valeur traverse une structure non prise en charge.');
    const siblings = children(parent);
    if (siblings.slice(siblings.indexOf(runs[0]), siblings.indexOf(runs.at(-1)!) + 1).some((node) => !runs.includes(node) && !(node.nodeType === 3 && !node.textContent?.trim()))) throw new TypeError('La valeur traverse un repère ou un élément non textuel.');
    const slicedRun = (run: Node, start: number, end: number) => {
      const clone = run.cloneNode(true) as Element;
      let position = 0;
      for (const node of Array.from(clone.getElementsByTagNameNS(WORD, 't'))) {
        const value = node.textContent ?? '';
        const slice = value.slice(Math.max(0, start - position), Math.max(0, Math.min(value.length, end - position)));
        position += value.length;
        node.textContent = slice;
        if (/^\s|\s$/u.test(slice)) node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      }
      return clone;
    };
    const { control, content } = makeControl(binding.tag);
    parent.insertBefore(control, runs[0]);
    for (const run of runs) {
      const parts = nodes.filter((node) => node.parentNode === run);
      const start = selected.find((part) => part.node === parts[0])?.start ?? nodes.slice(0, nodes.indexOf(parts[0])).reduce((sum, node) => sum + (node.textContent?.length ?? 0), 0);
      const length = textOf(run).length;
      const left = Math.max(0, from - start);
      const right = Math.min(length, to - start);
      if (left > 0) parent.insertBefore(slicedRun(run, 0, left), control);
      content.appendChild(slicedRun(run, left, right));
      if (right < length) parent.insertBefore(slicedRun(run, right, length), control.nextSibling);
      parent.removeChild(run);
    }
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(dom));
  const output = await embedDocxReasoning(await zip.generateAsync({ type: 'uint8array' }), {
    code, reference, clauses: links.clauses.map((clause) => clause.tag),
    bindings: links.valeurs.map(({ tag, valeur, type }) => ({ tag, valeur, type })),
  });
  if ((await captureDocxState(output, [], [])).body !== original.body) throw new TypeError('Le texte a changé pendant la préparation ; aucun document ne doit être publié.');
  return output;
}
