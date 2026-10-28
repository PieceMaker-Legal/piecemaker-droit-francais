import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document as XmlDocument, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { markup, segments } from '@/modules/piecemaker-reasoning/acte.js';
import type { Segment } from '@/modules/piecemaker-reasoning/acte.js';

export type FlatSection = { id?: string; depth: number; intitule?: string; texte: string[] };
export type ActeDocx = { base: FlatSection[] | null; sections: FlatSection[]; remarques: string[] };

const PROPERTY = 'PieceMakerActe';
const TAG = /^pma:(s\d+)$/;
const BOOKMARK = /^pma_(s\d+)$/;
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CUSTOM = 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties';
const VALUE = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes';
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CUSTOM_PART = 'docProps/custom.xml';
const UNSUPPORTED: Record<string, string> = { tbl: 'un tableau', drawing: 'une image', pict: 'une image', object: 'un objet incorporé', footnoteReference: 'une note de bas de page', endnoteReference: 'une note de fin', txbxContent: 'une zone de texte' };
const REVISIONS = ['ins', 'del', 'moveFrom', 'moveTo'];

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
const parse = (text: string) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new TypeError('XML avec DTD non pris en charge.');
  const document = new DOMParser({ onError: (_level, message) => { throw new TypeError(message); } }).parseFromString(text, 'application/xml');
  if (!document.documentElement) throw new TypeError('XML sans élément racine.');
  return document as XmlDocument & { documentElement: XmlElement };
};
const element = (node: XmlNode): node is XmlElement => node.nodeType === 1;
const word = (node: XmlNode, name: string): node is XmlElement => element(node) && node.namespaceURI === WORD && node.localName === name;
const kids = (node: XmlNode) => Array.from(node.childNodes ?? []).filter(element);
const child = (node: XmlNode, name: string) => kids(node).find((entry) => word(entry, name));
const attribute = (node: XmlElement | undefined, name: string) => node?.getAttributeNS(WORD, name) ?? node?.getAttribute(`w:${name}`) ?? null;
const on = (node: XmlElement | undefined) => Boolean(node) && !['0', 'false', 'off'].includes(attribute(node, 'val') ?? '');

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[1, 2, 3, 4].map((level) => `<w:style w:type="paragraph" w:styleId="Titre${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/>${level === 1 ? '<w:caps/>' : ''}${level >= 3 ? '<w:i/>' : ''}<w:sz w:val="${[28, 26, 24, 24][level - 1]}"/></w:rPr></w:style>`).join('\n')}
</w:styles>`;

const freshPackage = () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CONTENT_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD}"><w:body><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip;
};

const headingStyles = (styles: XmlDocument | null) => {
  const levels = new Map<string, number>();
  if (!styles) return levels;
  for (const style of Array.from(styles.getElementsByTagNameNS(WORD, 'style'))) {
    if (attribute(style, 'type') !== 'paragraph') continue;
    const id = attribute(style, 'styleId');
    const name = attribute(child(style, 'name'), 'val') ?? '';
    const outline = attribute(child(child(style, 'pPr') ?? style, 'outlineLvl'), 'val');
    const named = /^(?:heading|titre)\s*(\d)$/i.exec(name.trim());
    const level = named ? Number(named[1]) : outline !== null && Number(outline) < 9 ? Number(outline) + 1 : null;
    if (id && level) levels.set(id, level);
  }
  return levels;
};

const ensureHeadingStyles = (styles: ReturnType<typeof parse>) => {
  const levels = headingStyles(styles);
  const ids: string[] = [];
  const fresh = parse(STYLES);
  for (const level of [1, 2, 3, 4]) {
    const found = [...levels].find(([, value]) => value === level)?.[0];
    if (found) { ids.push(found); continue; }
    const style = Array.from(fresh.getElementsByTagNameNS(WORD, 'style')).find((entry) => attribute(entry, 'styleId') === `Titre${level}`)!;
    styles.documentElement.appendChild(styles.importNode(style, true));
    ids.push(`Titre${level}`);
  }
  return ids;
};

const runs = (text: string) => segments(text).map((part) => {
  const properties = `${part.gras ? '<w:b/>' : ''}${part.italique ? '<w:i/>' : ''}`;
  const pieces = part.text.split('\t').map((chunk) => (chunk ? `<w:t xml:space="preserve">${escape(chunk)}</w:t>` : '')).join('<w:tab/>');
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${pieces}</w:r>`;
}).join('');

const sectionXml = (section: FlatSection, headings: string[], index: number) => {
  const mark = `<w:bookmarkStart w:id="${90000 + index}" w:name="pma_${section.id}"/><w:bookmarkEnd w:id="${90000 + index}"/>`;
  const paragraphs = [
    ...(section.intitule ? [{ style: `<w:pPr><w:pStyle w:val="${headings[Math.min(section.depth, headings.length - 1)]}"/></w:pPr>`, text: section.intitule }] : []),
    ...section.texte.map((text) => ({ style: '', text })),
  ];
  const body = (paragraphs.length ? paragraphs : [{ style: '', text: '' }]).map((paragraph, position) => `<w:p>${paragraph.style}${position ? '' : mark}${runs(paragraph.text)}</w:p>`).join('');
  return `<w:sdt><w:sdtPr><w:alias w:val="PieceMaker ${section.id}"/><w:tag w:val="pma:${section.id}"/><w:lock w:val="sdtLocked"/></w:sdtPr><w:sdtContent>${body}</w:sdtContent></w:sdt>`;
};

const writeProperty = async (zip: JSZip, value: string) => {
  const dom = parse(await zip.file(CUSTOM_PART)?.async('string') ?? `<Properties xmlns="${CUSTOM}" xmlns:vt="${VALUE}"/>`);
  const properties = Array.from(dom.getElementsByTagNameNS(CUSTOM, 'property'));
  const property = properties.find((entry) => entry.getAttribute('name') === PROPERTY) ?? dom.createElementNS(CUSTOM, 'property');
  if (!property.parentNode) {
    property.setAttribute('fmtid', '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}');
    property.setAttribute('pid', String(Math.max(1, ...properties.map((entry) => Number(entry.getAttribute('pid')) || 1)) + 1));
    property.setAttribute('name', PROPERTY);
    dom.documentElement.appendChild(property);
  }
  while (property.firstChild) property.removeChild(property.firstChild);
  const payload = dom.createElementNS(VALUE, 'vt:lpwstr');
  payload.appendChild(dom.createTextNode(value));
  property.appendChild(payload);
  zip.file(CUSTOM_PART, new XMLSerializer().serializeToString(dom));
  const types = parse(await zip.file('[Content_Types].xml')!.async('string'));
  if (!Array.from(types.getElementsByTagNameNS(CONTENT_TYPES, 'Override')).some((entry) => entry.getAttribute('PartName') === `/${CUSTOM_PART}`)) {
    const type = types.createElementNS(CONTENT_TYPES, 'Override');
    type.setAttribute('PartName', `/${CUSTOM_PART}`);
    type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.custom-properties+xml');
    types.documentElement.appendChild(type);
    zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(types));
  }
  const relationships = parse(await zip.file('_rels/.rels')!.async('string'));
  const existing = Array.from(relationships.getElementsByTagNameNS(REL, 'Relationship'));
  if (!existing.some((entry) => entry.getAttribute('Target')?.replace(/^\//, '') === CUSTOM_PART)) {
    const relation = relationships.createElementNS(REL, 'Relationship');
    const used = new Set(existing.map((entry) => entry.getAttribute('Id')));
    let index = 1;
    while (used.has(`rId${index}`)) index += 1;
    relation.setAttribute('Id', `rId${index}`);
    relation.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties');
    relation.setAttribute('Target', CUSTOM_PART);
    relationships.documentElement.appendChild(relation);
    zip.file('_rels/.rels', new XMLSerializer().serializeToString(relationships));
  }
};

const readProperty = async (zip: JSZip): Promise<FlatSection[] | null> => {
  const text = await zip.file(CUSTOM_PART)?.async('string');
  if (!text) return null;
  const property = Array.from(parse(text).getElementsByTagNameNS(CUSTOM, 'property')).find((entry) => entry.getAttribute('name') === PROPERTY);
  const payload = property?.getElementsByTagNameNS(VALUE, 'lpwstr')[0]?.textContent;
  if (!payload) return null;
  const value = JSON.parse(payload) as { sections?: FlatSection[] };
  if (!Array.isArray(value.sections)) throw new TypeError('Base de l’acte illisible dans le DOCX.');
  return value.sections;
};

export async function rebaseActeDocx(input: Uint8Array, sections: FlatSection[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(input);
  await writeProperty(zip, JSON.stringify({ sections }));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function exportActeDocx(sections: FlatSection[], template?: Uint8Array): Promise<Uint8Array> {
  const zip = template ? await JSZip.loadAsync(template) : freshPackage();
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new TypeError('Modèle DOCX sans word/document.xml.');
  const stylesPart = zip.file('word/styles.xml');
  if (!stylesPart) throw new TypeError('Modèle DOCX sans styles : ouvrez-le et enregistrez-le dans Word.');
  const styles = parse(await stylesPart.async('string'));
  const headings = ensureHeadingStyles(styles);
  zip.file('word/styles.xml', new XMLSerializer().serializeToString(styles));
  const dom = parse(await documentPart.async('string'));
  const body = dom.getElementsByTagNameNS(WORD, 'body')[0];
  if (!body) throw new TypeError('Modèle DOCX sans corps de document.');
  const ending = kids(body).filter((node) => word(node, 'sectPr')).pop();
  for (const node of Array.from(body.childNodes)) if (node !== ending) body.removeChild(node);
  const fragment = parse(`<w:body xmlns:w="${WORD}">${sections.map((section, index) => sectionXml(section, headings, index)).join('')}</w:body>`);
  for (const node of kids(fragment.documentElement)) body.insertBefore(dom.importNode(node, true), ending ?? null);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(dom));
  await writeProperty(zip, JSON.stringify({ sections }));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

const paragraphText = (paragraph: XmlElement, problems: Set<string>) => {
  const parts: Segment[] = [];
  const visit = (node: XmlElement, gras: boolean, italique: boolean) => {
    for (const entry of kids(node)) {
      if (entry.namespaceURI !== WORD) continue;
      const name = entry.localName ?? '';
      if (UNSUPPORTED[name]) { problems.add(UNSUPPORTED[name]); continue; }
      if (['pPr', 'rPr', 'del', 'delText', 'instrText', 'sdtPr', 'sdtEndPr', 'commentReference'].includes(name)) continue;
      if (name === 'r') {
        const properties = child(entry, 'rPr');
        visit(entry, properties && child(properties, 'b') ? on(child(properties, 'b')) : gras, properties && child(properties, 'i') ? on(child(properties, 'i')) : italique);
      } else if (name === 't') parts.push({ text: entry.textContent ?? '', gras, italique });
      else if (name === 'tab') parts.push({ text: '\t', gras, italique });
      else if (name === 'br' || name === 'cr') parts.push({ text: ' ', gras, italique });
      else if (name === 'noBreakHyphen') parts.push({ text: '-', gras, italique });
      else visit(entry, gras, italique);
    }
  };
  visit(paragraph, false, false);
  return markup(parts).replace(/\s+$/u, '').replace(/^\s+/u, '');
};

const numberedHeading = (paragraph: XmlElement, text: string) => {
  if (text.length > 200) return null;
  const bold = Array.from(paragraph.getElementsByTagNameNS(WORD, 'r')).filter((run) => (run.textContent ?? '').trim()).every((run) => on(child(child(run, 'rPr') ?? run, 'b')));
  const plainText = text.replace(/\*/g, '');
  if (/^(?:[IVXLC]{2,}|[IVX])[.)°-]\s/.test(plainText)) return 1;
  if (!bold) return null;
  if (/^[A-H][.)°-]\s/.test(plainText)) return 2;
  if (/^\d+[.)°-]\s/.test(plainText)) return 3;
  if (/^[a-h][.)°-]\s/.test(plainText)) return 4;
  if (plainText === plainText.toUpperCase() && /\p{Lu}{3}/u.test(plainText)) return 1;
  return null;
};

export async function readActeDocx(input: Uint8Array, mode: 'fusion' | 'import'): Promise<ActeDocx> {
  const zip = await JSZip.loadAsync(input);
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw new TypeError('DOCX sans word/document.xml.');
  const dom = parse(await documentPart.async('string'));
  if (REVISIONS.some((name) => dom.getElementsByTagNameNS(WORD, name).length)) throw new TypeError('Le DOCX contient des modifications suivies : acceptez-les ou refusez-les dans Word avant de reprendre le texte.');
  const stylesText = await zip.file('word/styles.xml')?.async('string');
  const levels = headingStyles(stylesText ? parse(stylesText) : null);
  const base = mode === 'fusion' ? await readProperty(zip) : null;
  const baseDepth = new Map((base ?? []).map((section) => [section.id, section.depth]));
  const sections: FlatSection[] = [];
  const remarques: string[] = [];
  const problems = new Map<string, Set<string>>();
  const body = dom.getElementsByTagNameNS(WORD, 'body')[0];
  if (!body) throw new TypeError('DOCX sans corps de document.');
  const paragraphs: Array<{ paragraph: XmlElement; id?: string }> = [];
  const walk = (node: XmlElement, id?: string) => {
    for (const entry of kids(node)) {
      const marked = mode === 'fusion' ? [entry, ...(word(entry, 'p') ? kids(entry) : [])].map((node) => (word(node, 'bookmarkStart') ? BOOKMARK.exec(attribute(node, 'name') ?? '')?.[1] : undefined)).find(Boolean) : undefined;
      if (marked && marked !== id) paragraphs.push({ paragraph: entry, id: `${marked}\0start` });
      if (word(entry, 'p')) paragraphs.push({ paragraph: entry, id: marked ?? id });
      else if (word(entry, 'sdt')) {
        const tag = attribute(child(child(entry, 'sdtPr') ?? entry, 'tag'), 'val') ?? '';
        const own = mode === 'fusion' ? TAG.exec(tag)?.[1] : undefined;
        if (own) paragraphs.push({ paragraph: entry, id: `${own}\0start` });
        walk(child(entry, 'sdtContent') ?? entry, own ?? id);
      } else if (word(entry, 'tbl')) problems.set(id ?? '', (problems.get(id ?? '') ?? new Set()).add('un tableau'));
      else if (word(entry, 'customXml') || word(entry, 'smartTag')) walk(entry, id);
    }
  };
  walk(body);
  const styled = paragraphs.some(({ paragraph }) => word(paragraph, 'p') && (levels.has(attribute(child(child(paragraph, 'pPr') ?? paragraph, 'pStyle'), 'val') ?? '') || child(child(paragraph, 'pPr') ?? paragraph, 'outlineLvl')));
  let current = null as FlatSection | null;
  let currentId: string | undefined;
  for (const { paragraph, id } of paragraphs) {
    if (id?.endsWith('\0start')) {
      const own = id.slice(0, -6);
      if (current?.id === own) continue;
      current = { id: own, depth: baseDepth.get(own) ?? 0, texte: [] };
      currentId = own;
      sections.push(current);
      continue;
    }
    const issues = new Set<string>();
    const text = paragraphText(paragraph, issues);
    if (issues.size) problems.set(id ?? currentId ?? '', new Set([...(problems.get(id ?? currentId ?? '') ?? []), ...issues]));
    if (paragraph.getElementsByTagNameNS(WORD, 'commentRangeStart').length) remarques.push('Des commentaires Word ne sont pas repris dans le raisonnement.');
    if (!text.replace(/\*/g, '').trim()) continue;
    const properties = child(paragraph, 'pPr');
    const outline = attribute(child(properties ?? paragraph, 'outlineLvl'), 'val');
    const level = levels.get(attribute(child(properties ?? paragraph, 'pStyle'), 'val') ?? '') ?? (outline !== null && Number(outline) < 9 ? Number(outline) + 1 : null) ?? (mode === 'import' && !styled ? numberedHeading(paragraph, text) : null);
    const inside = mode === 'fusion' && id !== undefined && current?.id === id;
    if (level && inside && current && !current.intitule && !current.texte.length) { current.intitule = text.replace(/^\*\*(.*)\*\*$/, '$1'); if (!baseDepth.has(id)) current.depth = level - 1; continue; }
    if (level) { current = { depth: level - 1, intitule: text.replace(/^\*\*(.*)\*\*$/, '$1'), texte: [] }; sections.push(current); continue; }
    if (!current) { current = { depth: 0, texte: [] }; sections.push(current); }
    current.texte.push(text);
  }
  if (base?.length && !sections.some((section) => section.id)) throw new TypeError('Les repères des sections ont disparu du DOCX (enregistré par un logiciel qui les retire ?) : la fusion est refusée pour ne rien dupliquer. Reprenez les retouches à la main dans le raisonnement, puis réexportez.');
  const blocked = [...problems].map(([id, found]) => `${id ? `section ${id}` : 'hors section'} : ${[...found].join(', ')}`);
  if (blocked.length) throw new TypeError(`Éléments non repris dans le raisonnement (ils seraient perdus à la prochaine édition) — ${blocked.join(' ; ')}. Retirez-les du DOCX ou ajoutez-les au raisonnement.`);
  return { base, sections, remarques: [...new Set(remarques)] };
}
