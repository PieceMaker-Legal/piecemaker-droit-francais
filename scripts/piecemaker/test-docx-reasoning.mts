import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { verifyDocxReasoning } from '../../server/piecemaker/docx-reasoning.js';

async function main() {
  const file = process.argv[2];
  if (!file || !file.toLowerCase().endsWith('.docx')) throw new TypeError('Usage : test-docx-reasoning.mts fichier.docx [--offline]');
  const offline = process.argv.includes('--offline');
  const connectors = offline ? {
    source: async () => undefined,
    match: (source: string, quote: string) => source.includes(quote) ? quote : null,
    registry: async () => { throw new Error('Registre hors ligne.'); },
    bodacc: async () => [],
  } : (await import('../../server/piecemaker/reasoning-connectors.js')).createReasoningConnectors();
  const result = await verifyDocxReasoning(await readFile(file), {
    cwd: path.dirname(path.resolve(file)), connectors, reliability: new Map(),
    nature: () => null, persons: [], dismissed: new Set(), online: false,
  });
  if (!result.verification) {
    console.log(JSON.stringify({ statut: result.status, lecture_seule: true, à_revoir: result.changed, passages: result.context }, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({
    statut: result.status, lecture_seule: true,
    sources_externes: offline ? 'non relues' : 'connecteurs activés',
    parties_et_fiabilité: 'non chargées hors session du dossier',
    objectifs: result.verification.annotated?.objectifs, bilan: result.verification.annotated?.bilan,
    alertes: result.verification.issues.map(({ kind, path, text }) => ({ type: kind, emplacement: path, texte: text })),
  }, null, 2));
  process.exitCode = result.verification.issues.some((issue) => issue.kind === 'erreur') ? 1 : 0;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
