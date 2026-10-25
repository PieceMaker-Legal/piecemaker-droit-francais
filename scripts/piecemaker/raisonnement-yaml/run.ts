import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describeReasoning, parseReasoningDocument, verifyReasoning } from '../../../server/modules/piecemaker-reasoning/index.js';
import type { ReasoningConnectors, SourceInfo } from '../../../server/modules/piecemaker-reasoning/index.js';
import { runActeAction } from '../../../server/piecemaker/acte-files.js';

const [folder, format, domain, command, ...options] = process.argv.slice(2);
if (!folder || !['js', 'yaml'].includes(format)) throw new TypeError('Dossier et format js ou yaml requis.');
const root = path.resolve(folder);
const selected = format as 'js' | 'yaml';
const file = path.join(root, '.piecemaker', `raisonnement.${selected}`);
const reports = path.join(root, '.piecemaker', 'observations');
const sources: Record<string, SourceInfo> = {};
const sourceText = await readFile(path.join(root, 'SOURCES.md'), 'utf8');
for (const line of sourceText.split('\n')) {
  const match = /^- (LEGIARTI\d+) — (.*?) — en vigueur depuis le ([\d-]+) : « (.*) »$/u.exec(line);
  if (match) sources[match[1]] = { kind: 'texte', title: match[2], text: match[4], validity: { from: match[3], to: null } };
}
const plain = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const connectors: ReasoningConnectors = {
  source: async (_cwd, id) => {
    if (sources[id]) return sources[id];
    if (id.startsWith('pieces/') && !id.split('/').includes('..')) {
      const text = await readFile(path.join(root, id), 'utf8').catch(() => null);
      return text === null ? null : { kind: 'piece', title: id, text };
    }
    return null;
  },
  match: (text, excerpt) => {
    if (text.includes(excerpt)) return excerpt;
    const pattern = plain(excerpt).split(' ').filter(Boolean).join('[^\\p{L}\\p{N}]+');
    return pattern ? new RegExp(pattern, 'iu').exec(text)?.[0] ?? null : null;
  },
  registry: async () => ({ found: true, status: 'active' }),
  bodacc: async () => [],
};
const verify = async () => {
  const code = await readFile(file, 'utf8');
  const started = new Date().toISOString();
  const result = await verifyReasoning({ code, format: selected, cwd: root, connectors, reliability: new Map(), nature: (piece) => piece.includes('contrat') ? 'contrat' : null, persons: [], dismissed: new Set() });
  await mkdir(reports, { recursive: true });
  const number = (await readdir(reports)).filter((name) => name.endsWith('.json')).length + 1;
  const prefix = path.join(reports, String(number).padStart(3, '0'));
  await writeFile(`${prefix}.${selected}`, code);
  await writeFile(`${prefix}.json`, JSON.stringify({ started, finished: new Date().toISOString(), domain, command, format: selected, result }, null, 2));
  await writeFile(file, `${result.code}\n`);
  return result;
};
if (domain === 'raisonnement' && command === 'verifier') {
  console.log(describeReasoning(await verify()));
} else if (domain === 'acte' && ['exporter', 'fusionner', 'importer'].includes(command)) {
  const option = (name: string) => { const at = options.indexOf(name); return at < 0 ? undefined : options[at + 1]; };
  console.log(JSON.stringify(await runActeAction({ cwd: root, commande: command, sortie: option('--sortie'), fichier: option('--fichier'), modele: option('--modele') }, verify), null, 2));
} else if (domain === 'raisonnement' && command === 'inspecter') {
  const document = parseReasoningDocument(await readFile(file, 'utf8'), selected);
  console.log(JSON.stringify(document.value, null, 2));
} else {
  throw new TypeError('pm raisonnement verifier ou pm acte exporter/fusionner/importer attendu.');
}
