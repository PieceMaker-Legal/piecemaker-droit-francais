import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { findContentControls, parseDocx, repackDocx, setContentControlContent } from '@eigenpal/docx-editor-core/headless';
import { DOMParser } from '@xmldom/xmldom';
import Docxtemplater from 'docxtemplater';
import JSZip from 'jszip';
import PizZip from 'pizzip';

import { readDocxReasoning, verifyDocxReasoning } from '../../server/piecemaker/docx-reasoning.js';
import { code, fixture, mutate, options, paragraph, WORD } from '../../server/piecemaker/tests/docx-reasoning-fixture.js';

async function main() {
  const directory = path.resolve(process.argv[2] ?? '/tmp/piecemaker-docx-reasoning-benchmark');
  const cli = process.argv[3] ?? 'docx';
  await mkdir(directory, { recursive: true });
  const input = await fixture(false, 40);
  const file = path.join(directory, 'contrat-fictif.docx');
  await writeFile(file, input);
  const report: Record<string, unknown> = { date: '2026-10-20', llmCalls: 0, fixtures: 'arithmétique fictive, aucun droit applicable validé', comparisons: [] };
  const measurements: Array<Record<string, unknown>> = [];
  const measure = async (name: string, action: () => Promise<unknown>) => {
    const started = performance.now();
    try { measurements.push({ name, success: true, ms: Number((performance.now() - started).toFixed(2)), result: await action() }); }
    catch (error) { measurements.push({ name, success: false, ms: Number((performance.now() - started).toFixed(2)), error: error instanceof Error ? error.message : String(error) }); }
    measurements.at(-1)!.ms = Number((performance.now() - started).toFixed(2));
  };
  await measure('OOXML et moteur existant', async () => {
    const run = await verifyDocxReasoning(input, options);
    return { status: run.status, objectifs: run.verification?.annotated?.objectifs, hypotheses: (run.verification?.annotated?.bilan as any)?.hypotheses };
  });
  await measure('EigenPal 1.9 lecture des ancres', async () => findContentControls(await parseDocx(input, { preloadFonts: false })).map((item) => ({ tag: item.tag, text: item.text })));
  await measure('EigenPal 1.9 modification d’un champ imbriqué', async () => {
    const document = await parseDocx(input, { preloadFonts: false });
    const updated = setContentControlContent(document, { tag: 'pm:plafond' }, '20 %');
    const reopened = new Uint8Array(await repackDocx(updated));
    return { value: findContentControls(await parseDocx(reopened, { preloadFonts: false })).find((item) => item.tag === 'pm:plafond')?.text, status: (await verifyDocxReasoning(reopened, options)).status };
  });
  await measure('EigenPal 1.9 sauvegarde et relecture du modèle embarqué', async () => {
    const document = await parseDocx(input, { preloadFonts: false });
    return (await readDocxReasoning(new Uint8Array(await repackDocx(document)))).version;
  });
  await measure('docx-cli lecture et taille de contexte', async () => ({ version: execFileSync(cli, ['--version'], { encoding: 'utf8' }).trim(), text: execFileSync(cli, ['read', file], { encoding: 'utf8' }) }));
  await measure('docx-cli modification suivie d’un champ imbriqué', async () => {
    const edited = path.join(directory, 'edition-cli.docx');
    await writeFile(edited, input);
    execFileSync(cli, ['track-changes', edited, 'on']);
    execFileSync(cli, ['replace', edited, '10 %', '20 %']);
    return { metadata: (await readDocxReasoning(await readFile(edited))).version, status: (await verifyDocxReasoning(await readFile(edited), options)).status };
  });
  await measure('Docxtemplater génération et conservation d’une retouche', async () => {
    const source = await fixture(true);
    const render = () => new Docxtemplater(new PizZip(source)).render({ prix: '12 000 EUR', taux: '0,1 %', plafond: '10 %', jours: '30' }).getZip().generate({ type: 'uint8array' });
    const generated = render();
    const edited = await mutate(generated, (xml) => xml.replace('payable après réception.', 'payable après réception avec réserves conservées.'));
    await writeFile(path.join(directory, 'edition-templater.docx'), edited);
    const regenerated = await JSZip.loadAsync(render());
    return { generation: true, retoucheConservéeAprèsRegénération: (await regenerated.file('word/document.xml')!.async('string')).includes('réserves conservées') };
  });
  const cases = [
    ['inchangé', (xml: string) => xml],
    ['plafond', (xml: string) => xml.replace('10 %', '20 %')],
    ['durée', (xml: string) => xml.replace('>30<', '>200<')],
    ['prix', (xml: string) => xml.replace('12 000 EUR', '18 000 EUR')],
    ['taux', (xml: string) => xml.replace('0,1 %', '0,2 %')],
    ['mise en forme', (xml: string) => xml.replace('<w:r>', '<w:r><w:rPr><w:b/></w:rPr>')],
    ['négation', (xml: string) => xml.replace('une pénalité est due', 'aucune pénalité n’est due')],
    ['nouvelle clause', (xml: string) => xml.replace('<w:body>', `<w:body>${paragraph('Aucune pénalité ne peut être demandée avant accord écrit.')}`)],
    ['ancre supprimée', (xml: string) => xml.replace('w:tag w:val="pm:prix"', 'w:tag w:val="pm:supprimé"')],
    ['valeur ambiguë', (xml: string) => xml.replace('12 000 EUR', 'prix à convenir')],
  ] as const;
  const payloads = [];
  const results = [];
  for (const [name, change] of cases) {
    const bytes = await mutate(input, change);
    const documentXml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
    const fullDocument = Array.from(dom.getElementsByTagNameNS(WORD, 't')).map((node) => node.textContent).join(' ');
    const full = JSON.stringify({ demande: 'Vérifier le raisonnement au regard du document courant.', document: fullDocument, raisonnement: code });
    const started = performance.now();
    try {
      const result = await verifyDocxReasoning(bytes, options);
      const targeted = result.verification ? '' : JSON.stringify({ demande: 'Réexaminer les modifications et leurs effets avant de mettre à jour le modèle.', changements: result.changed, passages: result.context.length ? result.context : [{ document: fullDocument }], raisonnement: code });
      payloads.push({ name, full, targeted });
      results.push({ name, status: result.status, ms: Number((performance.now() - started).toFixed(2)), objectifs: result.verification?.annotated?.objectifs, changed: result.changed });
      if (name === 'négation') await writeFile(path.join(directory, 'clause-modifiee.docx'), bytes);
      if (name === 'durée') await writeFile(path.join(directory, 'duree-modifiee.docx'), bytes);
    } catch (error) {
      payloads.push({ name, full, targeted: '' });
      results.push({ name, status: 'refus explicite', ms: Number((performance.now() - started).toFixed(2)), error: String(error) });
    }
  }
  report.comparisons = measurements;
  report.edits = results;
  await writeFile(path.join(directory, 'payloads.json'), JSON.stringify(payloads, null, 2));
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ directory, comparisons: measurements.map(({ name, success, ms, result, error }) => ({ name, success, ms, error, ...(name.startsWith('Docxtemplater') ? { result } : {}) })), edits: results }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
