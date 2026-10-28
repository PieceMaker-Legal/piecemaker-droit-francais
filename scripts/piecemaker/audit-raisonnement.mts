import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyReasoning, describeReasoning, createReasoningService } from '../../server/modules/piecemaker-reasoning/program.ts';
import { evaluate } from '../../server/modules/piecemaker-reasoning/engine.ts';
import { parseLiteral } from '../../server/modules/piecemaker-reasoning/format.ts';

async function main() {
  const report: Record<string, unknown> = {};
  const outputDirectory = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(tmpdir(), 'audit-raisonnement-'));
  await fs.mkdir(outputDirectory, { recursive: true });
  const computedRate = evaluate({ operation: 'produit', termes: [10000, { operation: 'quotient', termes: [128, 1000] }] }, () => null);
  assert.equal(computedRate, 1300);
  report.rounding = { expected: 1280, actual: computedRate, reproduced: true };
  const code = `{ qualification: 'consultation', objectifs: [{ objectif: 'Obtenir le paiement fictif', obtenir: 'paiement' }], paiement: { si: [{ condition: 'prestation', selon: [{ source: 'audit:regle', citation: 'règle de test' }], preuve: [{ piece: 'pieces/constat.md', citation: 'prestation réalisée' }] }] } }`;
  const connectors = {
    source: async (_cwd: string, id: string) => id === 'audit:regle' ? { kind: 'decision' as const, title: 'Source simulée sans portée juridique', text: 'règle de test' } : { kind: 'piece' as const, title: 'Constat fictif', text: 'prestation réalisée' },
    match: (text: string, excerpt: string) => text.includes(excerpt) ? excerpt : null,
    registry: async () => { throw new Error('registre simulé indisponible'); },
    bodacc: async () => [],
  };
  const options = { cwd: '/audit-fictif', connectors, reliability: new Map(), nature: () => null, persons: [{ label: 'Société Exemple SAS', kind: 'company', siren: null, name: null, side: 'client' }], dismissed: new Set(), online: true };
  const registry = await verifyReasoning({ ...options, code });
  assert.equal(registry.issues.length, 0);
  assert.match(describeReasoning(registry), /^Aucune erreur, aucun manque/);
  report.registry = { issues: registry.issues, agentOutput: describeReasoning(registry), bilan: (registry.annotated as any)?.bilan, reproduced: true };
  const { nearestPassage } = await import('../../server/piecemaker/harness/source-passages.ts');
  const localRequire = createRequire(import.meta.url);
  const { verifyQuoteAgainstSource } = localRequire('../../server/piecemaker/vendor/piecemaker-plugin/scripts/lib/verify-citations.cjs');
  const words = (value: string) => (value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');
  const productionMatch = (text: string, excerpt: string) => {
    if (verifyQuoteAgainstSource(text, excerpt).verified) return excerpt;
    const nearest = nearestPassage(text, excerpt);
    return nearest && words(nearest) === words(excerpt) ? nearest : null;
  };
  const typoCode = code.replace('règle de test', 'l obligation etablie est due');
  const typo = await verifyReasoning({ ...options, code: typoCode, persons: [], connectors: {
    ...connectors,
    source: async (_cwd: string, id: string) => id === 'audit:regle' ? { kind: 'decision' as const, title: 'Source simulée', text: "l'obligation établie est due" } : { kind: 'piece' as const, title: 'Constat fictif', text: 'prestation réalisée' },
    match: productionMatch,
  } });
  assert.equal(typo.issues.filter((issue) => issue.kind === 'erreur').length, 0);
  let syntaxError = '';
  try { parseLiteral(typo.code); } catch (error) { syntaxError = String(error); }
  assert.ok(syntaxError);
  report.quoteRewrite = { firstErrors: 0, nextParseError: syntaxError, code: typo.code, reproduced: true };
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const cwd = path.join(outputDirectory, 'concurrent');
  await fs.mkdir(path.join(cwd, '.piecemaker'), { recursive: true });
  const file = path.join(cwd, '.piecemaker/raisonnement.js');
  await fs.writeFile(file, code);
  db.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('audit-fictif', cwd);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const service = createReasoningService(() => db, { ...connectors, source: async (root: string, id: string) => { entered(); await blocked; return connectors.source(root, id); } });
  const verifying = service.verify(cwd, false);
  await ready;
  const edited = code.replace('Obtenir le paiement fictif', 'Modification avocat à préserver');
  await fs.writeFile(file, edited);
  release();
  await verifying;
  const after = await fs.readFile(file, 'utf8');
  assert.ok(!after.includes('Modification avocat à préserver'));
  report.concurrentRewrite = { externalEditLost: true, reproduced: true };
  const invalidCode = code.replace('règle de test', 'citation inventée absente de la source');
  await fs.writeFile(file, invalidCode);
  const invalid = await service.verify(cwd, false);
  assert.ok(invalid.issues.some((issue) => issue.kind === 'erreur'));
  const simulation = await service.simulate(cwd, { prestation: true });
  assert.equal(simulation.objectifs[0].statut, 'acquis');
  report.simulationDespiteErrors = { errorsBeforeSimulation: invalid.issues.filter((issue) => issue.kind === 'erreur'), simulation, reproduced: true };
  db.close();
  const output = JSON.stringify(report, null, 2);
  await fs.writeFile(path.join(outputDirectory, 'reproductions.json'), output);
  console.log(output);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
