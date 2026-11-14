import JSZip from 'jszip';
import type { Rule } from '../shared.js';
import type { PlaybookStore } from '../server/store.js';

export async function completed(store: PlaybookStore, key: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (store.run(key).status === 'running') {
    if (Date.now() > deadline) throw new Error('Le traitement fictif ne se termine pas.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export const CONTRACT = 'La responsabilité est illimitée.';
export const REPLACEMENT = 'La responsabilité est plafonnée à douze mois de rémunération.';

export const RULE: Rule = {
  id: 'liability', name: 'Responsabilité', concept: 'Contrôler le plafond de responsabilité', required: true,
  standard: 'Douze mois de rémunération', fallbacks: ['Vingt-quatre mois'], unacceptable: ['Responsabilité illimitée'],
  conditions: [], guidance: '', suggestedClause: REPLACEMENT, sourceRefs: [],
};

export async function docx(text = CONTRACT): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body><w:p w14:paraId="12345678"><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

export function reviewOutput(ruleId = RULE.id): string {
  return JSON.stringify({ summary: 'Le plafond doit être revu.', findings: [{ ruleId, status: 'unacceptable', quote: CONTRACT,
    location: 'Article 1', analysis: 'La clause ne respecte pas le plafond choisi.', suggestedText: REPLACEMENT }] });
}
