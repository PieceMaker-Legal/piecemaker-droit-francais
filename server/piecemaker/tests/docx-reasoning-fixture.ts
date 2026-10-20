import JSZip from 'jszip';

import { captureDocxState, embedDocxReasoning } from '../docx-reasoning.js';
import type { DocxBinding } from '../docx-reasoning.js';

export const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const bindings: DocxBinding[] = [
  { tag: 'pm:prix', valeur: 'prix', type: 'nombre' },
  { tag: 'pm:taux', valeur: 'taux', type: 'pourcentage' },
  { tag: 'pm:plafond', valeur: 'plafond', type: 'pourcentage' },
  { tag: 'pm:jours', valeur: 'jours', type: 'nombre' },
];
export const clauses = ['pm:clause-prix', 'pm:clause-pénalité', 'pm:clause-retard'];
export const code = `{
  qualification: 'consultation',
  objectifs: [{ objectif: 'Calculer la pénalité du scénario fictif', réduire: 'pénalité' }],
  valeurs: {
    prix: { valeur: null }, taux: { valeur: null }, plafond: { valeur: null }, jours: { valeur: null },
    pénalité: { formule: { minimum: [{ produit: ['prix', 'taux', 'jours'] }, { produit: ['prix', 'plafond'] }] } },
  },
  hypotheses: [
    { nom: 'Trente jours sous le plafond', faits: { prix: 12000, taux: 0.001, plafond: 0.1, jours: 30 }, attendu: { pénalité: 360 } },
    { nom: 'Le plafond limite la pénalité', faits: { prix: 12000, taux: 0.001, plafond: 0.1, jours: 200 }, attendu: { pénalité: 1200 } },
  ],
}`;

const text = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const run = (value: string) => `<w:r><w:t xml:space="preserve">${text(value)}</w:t></w:r>`;
export const control = (tag: string, content: string, id: number) => `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/><w:id w:val="${id}"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
export const paragraph = (value: string) => `<w:p>${run(value)}</w:p>`;

export async function fixture(template = false, filler = 0) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  const value = (tag: string, literal: string, id: number) => control(`pm:${tag}`, run(template ? `{${tag}}` : literal), id);
  const body = [
    paragraph('Scénario arithmétique fictif de Société Exemple SAS'),
    control(clauses[0], `<w:p>${run('Le prix convenu est de ')}${value('prix', '12 000 EUR', 101)}${run(', payable après réception.')}</w:p>`, 1),
    control(clauses[1], `<w:p>${run('En cas de retard, une pénalité est due au taux journalier de ')}${value('taux', '0,1 %', 102)}${run(', dans la limite de ')}${value('plafond', '10 %', 103)}${run(' du prix convenu.')}</w:p>`, 2),
    control(clauses[2], `<w:p>${run('Le scénario retient ')}${value('jours', '30', 104)}${run(' jours de retard.')}</w:p>`, 3),
    ...Array.from({ length: filler }, (_, i) => paragraph(`Disposition fictive ${i + 1}. Les parties définissent par écrit les modalités de coopération, les livrables attendus et leurs échanges de suivi. Cette disposition est un texte de test sans portée juridique.`)),
  ].join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return template ? bytes : embedDocxReasoning(bytes, { code, bindings, clauses });
}

export async function mutate(input: Uint8Array, change: (xml: string) => string) {
  const zip = await JSZip.loadAsync(input);
  zip.file('word/document.xml', change(await zip.file('word/document.xml')!.async('string')));
  return zip.generateAsync({ type: 'uint8array' });
}

export const options = {
  cwd: '/dossier-fictif', reliability: new Map<string, boolean>(), nature: () => null,
  persons: [], dismissed: new Set<string>(), online: false,
  connectors: {
    source: async () => undefined,
    match: (source: string, quote: string) => source.includes(quote) ? quote : null,
    registry: async () => { throw new Error('Registre non utilisé dans le scénario arithmétique.'); },
    bodacc: async () => [],
  },
};

export async function state(input: Uint8Array) { return captureDocxState(input, bindings, clauses); }
