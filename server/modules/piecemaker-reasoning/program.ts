import { createHash } from 'node:crypto';
import path from 'node:path';

import type Database from 'better-sqlite3';

import type { ReasoningNode, ReasoningProgram, ReasoningSnapshot, ReasoningSource } from '../../../shared/piecemaker-reasoning.js';

import { emptyProgram, evaluateProgram, validateProgram } from './engine.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const emptySnapshot = (): ReasoningSnapshot => ({ revision: 0, updatedAt: null, program: emptyProgram(), evaluations: [], changes: [], diagnostics: [] });

function mergeProgram(previous: ReasoningProgram, block: string, incoming: ReasoningSource[]): ReasoningProgram {
  const match = block.match(/<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/);
  if (!match) throw new TypeError('Bloc CITATIONS incomplet.');
  const entries: unknown = JSON.parse(match[1]);
  if (!Array.isArray(entries)) throw new TypeError('CITATIONS doit contenir un tableau.');
  const patches = entries.filter((entry) => entry && typeof entry === 'object' && entry.kind === 'program');
  if (patches.length > 1) throw new TypeError('Un seul objet kind:program est accepté par tour.');
  const patch = patches[0];
  if (patch && patch.version !== 1) throw new TypeError('Version de programme non prise en charge.');
  const sources = new Map(previous.sources.map((source) => [source.id, { ...source }]));
  for (const source of incoming) {
    for (const old of sources.values()) if (old.document === source.document && old.hash !== source.hash) old.stale = true;
    sources.set(source.id, { ...source, stale: false });
  }
  const nodes = new Map(previous.nodes.map((node) => [node.id, node]));
  if (patch?.remove !== undefined && (!Array.isArray(patch.remove) || patch.remove.some((id: unknown) => typeof id !== 'string'))) throw new TypeError('remove doit être une liste d’identifiants.');
  for (const id of patch?.remove ?? []) nodes.delete(id);
  if (patch?.nodes !== undefined && !Array.isArray(patch.nodes)) throw new TypeError('nodes doit être une liste.');
  if (patch?.nodes?.length > 200) throw new TypeError('Trop de nœuds dans ce tour.');
  const ids = new Set<string>();
  for (const proposed of patch?.nodes ?? []) {
    if (!proposed || typeof proposed !== 'object' || typeof proposed.id !== 'string' || ids.has(proposed.id)) throw new TypeError('Nœud invalide ou dupliqué dans ce tour.');
    ids.add(proposed.id);
    if (proposed.citations !== undefined && (!Array.isArray(proposed.citations) || proposed.citations.some((ref: unknown) => !Number.isSafeInteger(ref)))) throw new TypeError('citations doit contenir les numéros de références du tour.');
    const old = nodes.get(proposed.id);
    const linked = proposed.citations === undefined ? old?.sources ?? [] : proposed.citations.flatMap((ref: number) => {
      const matches = incoming.filter((source) => source.ref === ref);
      return matches.length ? matches.map((source) => source.id) : [`missing:${ref}`];
    });
    const node: ReasoningNode = {
      id: proposed.id, kind: proposed.kind, label: proposed.label,
      sources: [...new Set(linked)] as string[],
      requiresReview: proposed.citations === undefined ? old?.requiresReview ?? false : linked.some((id: string) => sources.get(id)?.repaired === true),
      ...(proposed.state !== undefined ? { state: proposed.state } : {}),
      ...(Object.hasOwn(proposed, 'value') ? { value: proposed.value } : {}),
      ...(proposed.expression !== undefined ? { expression: proposed.expression } : {}),
      ...(typeof proposed.rationale === 'string' ? { rationale: proposed.rationale.slice(0, 8000) } : {}),
    };
    nodes.set(node.id, node);
  }
  const mergeList = <T extends { id: string }>(old: T[], updates: unknown): T[] => {
    if (updates === undefined) return old;
    if (!Array.isArray(updates) || updates.some((item) => !item || typeof item.id !== 'string')) throw new TypeError('Liste de scénarios ou tests invalide.');
    const combined = new Map(old.map((item) => [item.id, item]));
    for (const item of updates) combined.set(item.id, item);
    return [...combined.values()];
  };
  const program: ReasoningProgram = {
    version: 1, nodes: [...nodes.values()], sources: [...sources.values()],
    scenarios: mergeList(previous.scenarios.filter((item) => !patch?.remove?.includes(item.id)), patch?.scenarios),
    tests: mergeList(previous.tests.filter((item) => !patch?.remove?.includes(item.id)), patch?.tests),
  };
  if (program.scenarios.some((scenario) => scenario.id === 'base')) throw new TypeError('Le scénario base est réservé au dossier sans hypothèses.');
  validateProgram(program);
  return program;
}

export function createReasoningService(getDatabase: () => Database.Database) {
  let initialized = false;
  const database = () => {
    const db = getDatabase();
    if (!initialized) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pm_reasoning_programs (
          project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
          revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_results (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          scenario TEXT NOT NULL, node_id TEXT NOT NULL, status TEXT NOT NULL,
          value_json TEXT NOT NULL, dependencies_json TEXT NOT NULL, missing_json TEXT NOT NULL,
          assumptions_json TEXT NOT NULL, issues_json TEXT NOT NULL, revision INTEGER NOT NULL,
          PRIMARY KEY(project_id, scenario, node_id)
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_turns (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
          PRIMARY KEY(project_id, turn_id)
        );
      `);
      initialized = true;
    }
    return db;
  };
  const projectId = (cwd: string) => {
    if (!cwd) throw new TypeError('Dossier requis.');
    const projects = database().prepare('SELECT project_id, project_path FROM projects').all() as Array<{ project_id: string; project_path: string }>;
    const resolved = path.resolve(cwd);
    const project = projects.filter((entry) => resolved === path.resolve(entry.project_path) || resolved.startsWith(`${path.resolve(entry.project_path)}${path.sep}`)).sort((a, b) => b.project_path.length - a.project_path.length)[0];
    if (!project) throw new TypeError('Dossier non enregistré.');
    return project.project_id;
  };
  const read = (cwd: string): ReasoningSnapshot => {
    const id = projectId(cwd);
    const row = database().prepare('SELECT snapshot_json FROM pm_reasoning_programs WHERE project_id=?').get(id) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) as ReasoningSnapshot : emptySnapshot();
  };
  database();
  return {
    read,
    context(cwd: string) {
      try {
        const snapshot = read(cwd);
        if (!snapshot.revision && !snapshot.diagnostics.length) return '';
        const state = JSON.stringify(snapshot);
        return `État du programme après les tours précédents (les valeurs connues sont déduites du modèle, pas des faits judiciairement établis) :\n${state.length <= 48000 ? state : JSON.stringify({ revision: snapshot.revision, diagnostics: snapshot.diagnostics, changes: snapshot.changes, note: 'État complet à récupérer par SQL.' })}\nSQL état complet : SELECT snapshot_json FROM pm_reasoning_programs WHERE project_id=dossier();\nSQL résultats : SELECT * FROM pm_reasoning_results WHERE project_id=dossier();`;
      } catch { return ''; }
    },
    ingest(input: { cwd: string; sessionId: string; turnId?: string; block: string; sources: ReasoningSource[] }): string {
      const id = projectId(input.cwd);
      const db = database();
      const turnId = digest(`${input.sessionId}\0${input.turnId ?? JSON.stringify([input.block, input.sources])}`);
      if (db.prepare('SELECT 1 FROM pm_reasoning_turns WHERE project_id=? AND turn_id=?').get(id, turnId)) return '';
      const previous = read(input.cwd);
      let program: ReasoningProgram;
      try { program = mergeProgram(previous.program, input.block, input.sources); }
      catch (error) {
        const diagnostic = error instanceof Error ? error.message : 'Programme invalide.';
        const rejected = { ...previous, diagnostics: [diagnostic] };
        db.prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(id, previous.revision, JSON.stringify(rejected));
        return `\n\nProgramme non appliqué : ${diagnostic} Le programme précédent est conservé.`;
      }
      if (!previous.revision && !program.sources.length && !program.nodes.length) return '';
      const evaluations = evaluateProgram(program);
      const oldResults = new Map(previous.evaluations.flatMap((evaluation) => evaluation.results.map((result) => [`${evaluation.scenario}:${result.id}`, result] as const)));
      const changes: ReasoningSnapshot['changes'] = [];
      for (const evaluation of evaluations) for (const result of evaluation.results) {
        const old = oldResults.get(`${evaluation.scenario}:${result.id}`);
        const describe = (value: typeof result) => JSON.stringify({ status: value.status, value: value.value, assumptions: value.assumptions, missing: value.missing });
        if (old && describe(old) !== describe(result)) changes.push({ id: result.id, scenario: evaluation.scenario, before: describe(old), after: describe(result) });
      }
      const snapshot: ReasoningSnapshot = { revision: previous.revision + 1, updatedAt: new Date().toISOString(), program, evaluations, changes, diagnostics: [] };
      db.transaction(() => {
        db.prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,snapshot_json=excluded.snapshot_json').run(id, snapshot.revision, JSON.stringify(snapshot));
        db.prepare('DELETE FROM pm_reasoning_results WHERE project_id=?').run(id);
        const insert = db.prepare('INSERT INTO pm_reasoning_results VALUES(?,?,?,?,?,?,?,?,?,?)');
        for (const evaluation of evaluations) for (const result of evaluation.results) insert.run(id, evaluation.scenario, result.id, result.status, JSON.stringify(result.value), JSON.stringify(result.dependencies), JSON.stringify(result.missing), JSON.stringify(result.assumptions), JSON.stringify(result.issues), snapshot.revision);
        db.prepare('INSERT INTO pm_reasoning_turns VALUES(?,?,?,?)').run(id, turnId, snapshot.revision, JSON.stringify(snapshot));
      })();
      const tests = evaluations.flatMap((evaluation) => evaluation.tests);
      return `\n\nProgramme du dossier · révision ${snapshot.revision} · ${program.nodes.length} nœuds · ${tests.filter((test) => test.passed).length}/${tests.length} tests réussis · ${changes.length} résultat(s) modifié(s). État disponible dans le volet Raisonnement et par SQL.`;
    },
  };
}

export function reasoningExample(): ReasoningSnapshot {
  const program: ReasoningProgram = {
    version: 1,
    sources: [
      { id: 'src_invoice', ref: 1, quoteIndex: 0, token: '', document: 'exemple_facture', title: 'Facture fictive', excerpt: 'Le montant facturé est de 12 000 euros.', hash: 'demo1', verified: true, repaired: false },
      { id: 'src_payment', ref: 2, quoteIndex: 0, token: '', document: 'exemple_versement', title: 'Déclaration fictive', excerpt: 'Un versement de 4 000 euros est déclaré et contesté.', hash: 'demo2', verified: true, repaired: false },
    ],
    nodes: [
      { id: 'F_facture', kind: 'fact', label: 'Montant facturé (centimes)', value: 1200000, sources: ['src_invoice'] },
      { id: 'F_versement', kind: 'fact', label: 'Versement contesté (centimes)', value: 400000, state: 'disputed', sources: ['src_payment'] },
      { id: 'C_solde', kind: 'calculation', label: 'Solde documentaire (centimes)', expression: { op: 'subtract', args: [{ ref: 'F_facture' }, { ref: 'F_versement' }] }, sources: [] },
      { id: 'K_seuil', kind: 'conclusion', label: 'Le solde dépasse 10 000 €', expression: { op: 'greater', args: [{ ref: 'C_solde' }, 1000000] }, sources: [], rationale: 'Question comptable fictive, sans qualification juridique.' },
    ],
    scenarios: [
      { id: 'versement_retenu', label: 'Hypothèse : versement de 4 000 €', assumptions: { F_versement: 400000 } },
      { id: 'aucun_versement', label: 'Hypothèse : aucun versement', assumptions: { F_versement: 0 } },
    ],
    tests: [
      { id: 'T_inconnu', label: 'Le dossier seul ne fixe pas le solde', target: 'C_solde', expected: { status: 'unknown' } },
      { id: 'T_retenu', label: 'Avec versement : 8 000 €', target: 'C_solde', scenario: 'versement_retenu', expected: { status: 'known', value: 800000 } },
      { id: 'T_sans', label: 'Sans versement : 12 000 €', target: 'C_solde', scenario: 'aucun_versement', expected: { status: 'known', value: 1200000 } },
    ],
  };
  return { revision: 0, updatedAt: null, program, evaluations: evaluateProgram(program), changes: [], diagnostics: [], demo: true };
}
