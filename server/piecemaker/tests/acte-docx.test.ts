import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { verifyReasoning } from '../../modules/piecemaker-reasoning/program.js';
import { parseLiteral, printLiteral } from '../../modules/piecemaker-reasoning/format.js';
import { exportActeDocx, readActeDocx } from '../acte-docx.js';
import type { FlatSection } from '../acte-docx.js';
import { alreadyMerged, mergeActe, mergeParagraphs } from '../acte-merge.js';
import { runActeAction as runAction } from '../acte-files.js';

const runActeAction = (...args: Parameters<typeof runAction>) => runAction(...args) as Promise<Record<string, any>>;

const SECTIONS: FlatSection[] = [
  { id: 's1', depth: 0, intitule: 'Faits', texte: ['Société Exemple SAS a commandé des machines le 2 mai 2025.', 'La livraison est intervenue le *14 juin 2025*.'] },
  { id: 's2', depth: 0, intitule: 'Discussion', texte: [] },
  { id: 's3', depth: 1, intitule: 'Sur la pénalité', texte: ['Premier argument.', 'Deuxième argument.', '**Troisième argument.**'] },
];

const editDocument = async (bytes: Uint8Array, edit: (xml: string) => string) => {
  const zip = await JSZip.loadAsync(bytes);
  zip.file('word/document.xml', edit(await zip.file('word/document.xml')!.async('string')));
  return zip.generateAsync({ type: 'uint8array' });
};
const paragraph = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

test('l’export garde la structure, le gras, l’italique et la base de fusion', async () => {
  const bytes = await exportActeDocx(SECTIONS);
  const read = await readActeDocx(bytes, 'fusion');
  assert.deepEqual(read.base, SECTIONS);
  assert.deepEqual(read.sections, SECTIONS.map((section) => ({ ...section })));
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
  assert.match(xml, /<w:tag w:val="pma:s3"\/><w:lock w:val="sdtLocked"\/>/);
  assert.match(xml, /<w:pStyle w:val="Titre2"\/>/);
});

test('les retouches de l’avocat et du modèle se fusionnent paragraphe par paragraphe', async () => {
  const exported = await exportActeDocx(SECTIONS);
  const edited = await editDocument(exported, (xml) => xml
    .replace('Premier argument.', 'Premier argument, précisé par l’avocat.')
    .replace(/(<w:tag w:val="pma:s3"\/>[\s\S]*?<\/w:sdt>)/, `$1${paragraph('Paragraphe ajouté après la section.')}${paragraph('Sur les intérêts', 'Titre2')}${paragraph('Les intérêts courent depuis la mise en demeure.')}`));
  const read = await readActeDocx(edited, 'fusion');
  const model = [
    { id: 's1', intitule: 'Faits', texte: SECTIONS[0].texte },
    { id: 's2', intitule: 'Discussion', traite: 'pénalité_encourue', sections: [{ id: 's3', intitule: 'Sur la pénalité', texte: ['Premier argument.', 'Deuxième argument, réécrit par l’agent.', '**Troisième argument.**'] }] },
  ];
  const { acte, rapport } = await mergeActe(model, read.base!, read.sections);
  const discussion = acte[1] as Record<string, any>;
  assert.equal(discussion.traite, 'pénalité_encourue');
  assert.deepEqual(discussion.sections[0].texte, ['Premier argument, précisé par l’avocat.', 'Deuxième argument, réécrit par l’agent.', '**Troisième argument.**', 'Paragraphe ajouté après la section.']);
  assert.deepEqual(discussion.sections[1], { intitule: 'Sur les intérêts', texte: ['Les intérêts courent depuis la mise en demeure.'] });
  assert.equal(rapport.conflits.length, 0);
  assert.deepEqual(rapport.ajoutees, ['« Sur les intérêts »']);
});

test('deux retouches du même paragraphe produisent un conflit qui garde la version du modèle', async () => {
  const merged = await mergeParagraphs(['A.', 'B.', 'C.'], ['A.', 'B selon le modèle.', 'C.'], ['A.', 'B selon l’avocat.', 'C.']);
  assert.deepEqual(merged.texte, ['A.', 'B selon le modèle.', 'C.']);
  assert.deepEqual(merged.conflits, [{ modele: ['B selon le modèle.'], avocat: ['B selon l’avocat.'] }]);
});

test('une section supprimée par l’avocat disparaît si le modèle ne l’a pas changée', async () => {
  const exported = await exportActeDocx(SECTIONS);
  const edited = await editDocument(exported, (xml) => xml.replace(/<w:sdt><w:sdtPr><w:alias w:val="PieceMaker s1"\/>[\s\S]*?<\/w:sdt>/, ''));
  const read = await readActeDocx(edited, 'fusion');
  const { acte, rapport } = await mergeActe([{ id: 's1', intitule: 'Faits', texte: SECTIONS[0].texte }, { id: 's2', intitule: 'Discussion', sections: [{ id: 's3', intitule: 'Sur la pénalité', texte: SECTIONS[2].texte }] }], read.base!, read.sections);
  assert.deepEqual(acte.map((section) => section.id), ['s2']);
  assert.deepEqual(rapport.supprimees, ['s1 « Faits »']);
});

test('suivi des modifications, tableau ou note de bas de page bloquent la reprise', async () => {
  const exported = await exportActeDocx(SECTIONS);
  const tracked = await editDocument(exported, (xml) => xml.replace('<w:r><w:t xml:space="preserve">Premier argument.</w:t></w:r>', '<w:ins w:id="1" w:author="A"><w:r><w:t>Premier argument.</w:t></w:r></w:ins>'));
  await assert.rejects(readActeDocx(tracked, 'fusion'), /modifications suivies/);
  const table = await editDocument(exported, (xml) => xml.replace('</w:sdtContent></w:sdt><w:sdt>', '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:sdtContent></w:sdt><w:sdt>'));
  await assert.rejects(readActeDocx(table, 'fusion'), /un tableau/);
  const note = await editDocument(exported, (xml) => xml.replace('<w:t xml:space="preserve">Deuxième argument.</w:t>', '<w:t xml:space="preserve">Deuxième argument.</w:t><w:footnoteReference w:id="2"/>'));
  await assert.rejects(readActeDocx(note, 'fusion'), /section s3 : une note de bas de page/);
});

test('un DOCX déjà fusionné peut être remplacé, pas un DOCX retouché', async () => {
  const exported = await exportActeDocx(SECTIONS);
  const edited = await editDocument(exported, (xml) => xml.replace('Premier argument.', 'Premier argument modifié.'));
  const read = await readActeDocx(edited, 'fusion');
  assert.equal(alreadyMerged(SECTIONS, read.base!, read.sections), false);
  const merged = SECTIONS.map((section) => (section.id === 's3' ? { ...section, texte: ['Premier argument modifié.', ...section.texte.slice(1)] } : section));
  assert.equal(alreadyMerged(merged, read.base!, read.sections), true);
});

test('un modèle de cabinet fournit styles, en-tête et mise en page', async () => {
  const template = await exportActeDocx([{ id: 's1', depth: 0, texte: ['Cabinet fictif'] }]);
  const zip = await JSZip.loadAsync(template);
  zip.file('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Cabinet Exemple</w:t></w:r></w:p></w:hdr>');
  zip.file('word/styles.xml', (await zip.file('word/styles.xml')!.async('string')).replace(/w:styleId="Titre1"/, 'w:styleId="TitreCabinet"'));
  const bytes = await exportActeDocx(SECTIONS, await zip.generateAsync({ type: 'uint8array' }));
  const result = await JSZip.loadAsync(bytes);
  assert.ok(result.file('word/header1.xml'));
  const xml = await result.file('word/document.xml')!.async('string');
  assert.ok(!xml.includes('Cabinet fictif'));
  assert.match(xml, /<w:pStyle w:val="TitreCabinet"\/>/);
});

const PIECE = 'Contrat. En cas de retard de livraison, une pénalité de mille euros est due au client. Fait le 15/01/2024.';
const MODEL = `{
  qualification: 'contentieux',
  objectifs: [{ objectif: \`Obtenir la pénalité de Société Exemple SAS\`, obtenir: 'pénalité_due' }],
  pénalité_due: { si: [{ retard_de_livraison: true, selon: [{ source: 'pieces/01_contrat.md', citation: \`En cas de retard de livraison, une pénalité de mille euros est due\` }] }] },
  retard_de_livraison: { true: [{ preuve: [{ piece: 'pieces/02_livraison.md', citation: \`Livré avec trois semaines de retard\` }] }] },
}
`;

const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pm-acte-'));
  await mkdir(path.join(root, 'pieces'));
  await mkdir(path.join(root, '.piecemaker'));
  await writeFile(path.join(root, 'pieces/01_contrat.md'), PIECE);
  await writeFile(path.join(root, 'pieces/02_livraison.md'), 'Bon de livraison. Livré avec trois semaines de retard.');
  const verify = async (cwd: string) => {
    const file = path.join(cwd, '.piecemaker/raisonnement.js');
    const result = await verifyReasoning({
      code: await readFile(file, 'utf8'), cwd,
      connectors: { source: async (_cwd, id) => (id.includes('/') ? { kind: 'piece', title: id, text: await readFile(path.join(cwd, id), 'utf8') } : undefined), match: (text, excerpt) => (text.includes(excerpt) ? excerpt : null), registry: async () => ({ found: true, status: '' }), bodacc: async () => [] },
      reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(),
    });
    await writeFile(file, result.code);
    return { issues: result.issues, code: result.code };
  };
  return { root, verify };
};

test('importer, exporter, retoucher, fusionner : le raisonnement reste la seule source', async () => {
  const { root, verify } = await fixture();
  await writeFile(path.join(root, '.piecemaker/raisonnement.js'), MODEL);
  const source = await exportActeDocx([]);
  const existing = await editDocument(source, (xml) => xml.replace('<w:body>', `<w:body>${paragraph('CONCLUSIONS')}${paragraph('I. Sur la pénalité')}${paragraph('Le contrat stipule que « En cas de retard de livraison, une pénalité de mille euros est due ».')}${paragraph('Le juge allouera « une indemnité de deux mille euros ».')}`));
  const zip = await JSZip.loadAsync(existing);
  zip.remove('docProps/custom.xml');
  await writeFile(path.join(root, 'existant.docx'), await zip.generateAsync({ type: 'uint8array' }));

  const imported = await runActeAction({ commande: 'importer', cwd: root, fichier: 'existant.docx' }, verify);
  assert.equal(imported.sections, 2);
  assert.match(imported.verification, /citation absente du raisonnement : « une indemnité de deux mille euros »/);
  await assert.rejects(runActeAction({ commande: 'exporter', cwd: root, sortie: 'acte.docx' }, verify), /pas imprimable/);

  const code = await readFile(path.join(root, '.piecemaker/raisonnement.js'), 'utf8');
  await writeFile(path.join(root, '.piecemaker/raisonnement.js'), code.replace('Le juge allouera « une indemnité de deux mille euros ».', 'Le juge allouera la pénalité.').replace("intitule: 'I. Sur la pénalité',", "intitule: 'I. Sur la pénalité',\n      traite: 'pénalité_due',"));
  const exported = await runActeAction({ commande: 'exporter', cwd: root, sortie: 'acte.docx' }, verify);
  assert.equal(exported.fichier, 'acte.docx');

  const edited = await editDocument(await readFile(path.join(root, 'acte.docx')), (xml) => xml.replace('Le juge allouera la pénalité.', 'Le tribunal condamnera la défenderesse au paiement de la pénalité.'));
  await writeFile(path.join(root, 'acte.docx'), edited);
  await assert.rejects(runActeAction({ commande: 'exporter', cwd: root, sortie: 'acte.docx' }, verify), /fusionner/);
  const merged = await runActeAction({ commande: 'fusionner', cwd: root, fichier: 'acte.docx' }, verify);
  assert.equal(merged.rapport.reprises.length, 1);
  const value = parseLiteral(await readFile(path.join(root, '.piecemaker/raisonnement.js'), 'utf8')).value as Record<string, any>;
  assert.equal(value.pénalité_due.si[0].retard_de_livraison, true);
  assert.deepEqual(value.acte[1].texte.at(-1), 'Le tribunal condamnera la défenderesse au paiement de la pénalité.');
  const again = await runActeAction({ commande: 'exporter', cwd: root, sortie: 'acte.docx' }, verify);
  assert.equal(again.mise_en_page, 'celle du DOCX remplacé');
});

test('l’import reconnaît les titres numérotés en gras quand le DOCX n’a pas de styles de titre', async () => {
  const bold = (text: string) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const bytes = await editDocument(await exportActeDocx([]), (xml) => xml.replace('<w:body>', `<w:body>${bold('II. DISCUSSION')}${bold('C. Sur l’indemnité')}${paragraph('Texte.')}${bold('PAR CES MOTIFS')}`));
  const read = await readActeDocx(bytes, 'import');
  assert.deepEqual(read.sections, [
    { depth: 0, intitule: 'II. DISCUSSION', texte: [] },
    { depth: 1, intitule: 'C. Sur l’indemnité', texte: ['Texte.'] },
    { depth: 0, intitule: 'PAR CES MOTIFS', texte: [] },
  ]);
});

test('sans contrôles de contenu, les signets suffisent ; sans aucun repère, la fusion est refusée', async () => {
  const exported = await exportActeDocx(SECTIONS);
  const unwrapped = await editDocument(exported, (xml) => xml.replace(/<w:sdt><w:sdtPr>.*?<\/w:sdtPr><w:sdtContent>/g, '').replace(/<\/w:sdtContent><\/w:sdt>/g, ''));
  const read = await readActeDocx(unwrapped, 'fusion');
  assert.deepEqual(read.sections, SECTIONS);
  const bare = await editDocument(unwrapped, (xml) => xml.replace(/<w:bookmarkStart[^>]*\/><w:bookmarkEnd[^>]*\/>/g, ''));
  await assert.rejects(readActeDocx(bare, 'fusion'), /repères des sections ont disparu/);
});

test('une retouche écartée après fusion ne revient pas et n’empêche pas la réimpression', async () => {
  const { root, verify } = await fixture();
  const model = MODEL.replace(/\}\n$/, "  acte: [{ intitule: 'Sur la pénalité', traite: 'pénalité_due', texte: ['Le retard est établi.'] }],\n}\n");
  await writeFile(path.join(root, '.piecemaker/raisonnement.js'), model);
  await runActeAction({ commande: 'exporter', cwd: root, sortie: 'acte.docx' }, verify);
  const edited = await editDocument(await readFile(path.join(root, 'acte.docx')), (xml) => xml.replace('</w:sdt>', `</w:sdt>${paragraph('Sur l’aveu', 'Titre1')}${paragraph('Un aveu non prouvé.')}`));
  await writeFile(path.join(root, 'acte.docx'), edited);
  const first = await runActeAction({ commande: 'fusionner', cwd: root, fichier: 'acte.docx' }, verify);
  assert.equal(first.rapport.ajoutees.length, 1);
  const file = path.join(root, '.piecemaker/raisonnement.js');
  const value = parseLiteral(await readFile(file, 'utf8')).value as Record<string, any>;
  value.acte = value.acte.filter((section: { id: string }) => section.id !== 's2');
  await writeFile(file, printLiteral(value));
  const second = await runActeAction({ commande: 'fusionner', cwd: root, fichier: 'acte.docx' }, verify);
  assert.deepEqual(second.rapport, { reprises: [], ajoutees: [], supprimees: [], conflits: [] });
  assert.equal((await runActeAction({ commande: 'exporter', cwd: root, sortie: 'acte.docx' }, verify)).fichier, 'acte.docx');
  assert.equal((await readActeDocx(await readFile(path.join(root, 'acte.docx')), 'fusion')).sections.length, 1);
});
