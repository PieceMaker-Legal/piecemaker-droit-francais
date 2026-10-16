import { createHash } from 'node:crypto';
import path from 'node:path';

import type Database from 'better-sqlite3';

import type { ReasoningLink, ReasoningNode, ReasoningProgram, ReasoningSnapshot, ReasoningSource } from '../../../shared/piecemaker-reasoning.js';

import { emptyProgram, evaluateProgram, validateProgram } from './engine.js';
import { resolveInputs } from './inputs.js';
import { detectConflicts } from './model.js';
import { assessTheories } from './theories.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const emptySnapshot = (): ReasoningSnapshot => ({ revision: 0, updatedAt: null, program: emptyProgram(), evaluations: [], changes: [], diagnostics: [] });

function changesSince(previous: ReasoningSnapshot, evaluations: ReasoningSnapshot['evaluations']): ReasoningSnapshot['changes'] {
  const old = new Map<string, ReasoningSnapshot['evaluations'][number]['results'][number]>(previous.evaluations.flatMap((evaluation) => evaluation.results.map((result) => [`${evaluation.scenario}:${result.id}`, result] as const)));
  const changes: ReasoningSnapshot['changes'] = [];
  for (const evaluation of evaluations) for (const result of evaluation.results) {
    const key = `${evaluation.scenario}:${result.id}`;
    const before = old.get(key);
    if (JSON.stringify(before) !== JSON.stringify(result)) changes.push({ id: result.id, scenario: evaluation.scenario, before: before ? JSON.stringify(before) : 'Absent', after: JSON.stringify(result) });
    old.delete(key);
  }
  for (const [key, result] of old) changes.push({ id: result.id, scenario: key.split(':')[0], before: JSON.stringify(result), after: 'Retiré' });
  return changes;
}

function mergeProgram(previous: ReasoningProgram, block: string, incoming: ReasoningSource[]): ReasoningProgram {
  const match = block.match(/<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/);
  if (!match) throw new TypeError('Bloc CITATIONS incomplet.');
  const entries: unknown = JSON.parse(match[1]);
  if (!Array.isArray(entries)) throw new TypeError('CITATIONS doit contenir un tableau.');
  const patches = entries.filter((entry) => entry && typeof entry === 'object' && ['program', 'reasoning'].includes(entry.kind));
  if (patches.length > 1) throw new TypeError('Un seul objet reasoning ou program est accepté par tour.');
  const annotation = patches[0];
  const patch = annotation?.kind === 'reasoning' ? { ...annotation, nodes: ['law', 'facts', 'theories'].flatMap((key) => {
    if (annotation[key] !== undefined && !Array.isArray(annotation[key])) throw new TypeError(`${key} doit être une liste.`);
    return (annotation[key] ?? []).map((node: ReasoningNode) => ({ ...node, layer: key === 'law' ? 'law' : key === 'facts' ? 'fact' : 'theory', kind: key === 'law' ? 'rule' : key === 'facts' ? 'fact' : node.kind ?? 'conclusion' }));
  }) } : annotation;
  if (patch && patch.version !== 1) throw new TypeError('Version de programme non prise en charge.');
  const sources = new Map(previous.sources.map((source) => [source.id, { ...source }]));
  for (const source of incoming) {
    for (const old of sources.values()) if (old.document === source.document && old.hash !== source.hash) old.stale = true;
    sources.set(source.id, { ...source, stale: false });
  }
  const nodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const links = new Map((previous.links ?? []).map((link) => [link.id, link]));
  if (patch?.remove !== undefined && (!Array.isArray(patch.remove) || patch.remove.some((id: unknown) => typeof id !== 'string'))) throw new TypeError('remove doit être une liste d’identifiants.');
  for (const id of patch?.remove ?? []) { nodes.delete(id); links.delete(id); }
  const evidence = new Map<string, string[]>();
  const reported = new Set<string>();
  const supported = new Set<string>();
  for (const entry of entries as Array<{ ref?: number; links?: Array<{ target: string; relation: ReasoningLink['relation'] }> }>) {
    if (!entry || entry.links === undefined || !Object.hasOwn(entry, 'ref')) continue;
    if (!Array.isArray(entry.links) || entry.links.length > 200) throw new TypeError('Annotations de citation invalides.');
    for (const link of entry.links) {
      if (!link || typeof link.target !== 'string' || !['supports', 'contradicts', 'reports', 'qualifies'].includes(link.relation)) throw new TypeError('Lien de citation invalide.');
      const matching = incoming.filter((source) => source.ref === entry.ref);
      if (!matching.length) throw new TypeError(`Citation annotée introuvable : ${entry.ref}.`);
      if (link.relation === 'reports') reported.add(link.target);
      if (link.relation === 'supports') supported.add(link.target);
      for (const source of matching) {
        const id = `e_${digest(`${source.id}:${link.target}:${link.relation}`).slice(0, 40)}`;
        links.set(id, { id, from: source.id, to: link.target, relation: link.relation });
        if (link.relation === 'supports' || link.relation === 'reports') evidence.set(link.target, [...(evidence.get(link.target) ?? []), source.id]);
      }
    }
  }
  if (patch?.nodes !== undefined && !Array.isArray(patch.nodes)) throw new TypeError('nodes doit être une liste.');
  if (patch?.nodes?.length > 200) throw new TypeError('Trop de nœuds dans ce tour.');
  const ids = new Set<string>();
  for (const proposed of patch?.nodes ?? []) {
    if (!proposed || typeof proposed !== 'object' || typeof proposed.id !== 'string' || ids.has(proposed.id)) throw new TypeError('Nœud invalide ou dupliqué dans ce tour.');
    ids.add(proposed.id);
    if (proposed.citations !== undefined && (!Array.isArray(proposed.citations) || proposed.citations.some((ref: unknown) => !Number.isSafeInteger(ref)))) throw new TypeError('citations doit contenir les numéros de références du tour.');
    const old = nodes.get(proposed.id);
    const linked = proposed.citations === undefined ? evidence.get(proposed.id) ?? old?.sources ?? [] : proposed.citations.flatMap((ref: number) => {
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
      ...(proposed.layer !== undefined ? { layer: proposed.layer } : {}),
      ...(proposed.parameters !== undefined ? { parameters: proposed.parameters } : {}),
      ...(proposed.validity !== undefined ? { validity: proposed.validity } : {}),
      ...(proposed.relation !== undefined ? { relation: proposed.relation } : {}),
      ...(proposed.input !== undefined ? { input: proposed.input } : {}),
    };
    if (node.kind === 'fact' && reported.has(node.id) && !supported.has(node.id)) node.state = 'reported';
    if (proposed.citations !== undefined || evidence.has(node.id)) for (const [id, link] of links) {
      if (link.to === node.id && sources.has(link.from) && ['supports', 'reports', 'qualifies'].includes(link.relation) && !linked.includes(link.from)) links.delete(id);
    }
    nodes.set(node.id, node);
  }
  for (const [id, linked] of evidence) {
    if (ids.has(id)) continue;
    const old = nodes.get(id);
    if (!old) throw new TypeError(`Proposition annotée absente : ${id}.`);
    nodes.set(id, { ...old, ...(old.kind === 'fact' && reported.has(id) && !supported.has(id) ? { state: 'reported' as const } : {}), sources: [...new Set([...old.sources, ...linked])], requiresReview: old.requiresReview || linked.some((sourceId) => sources.get(sourceId)?.repaired) });
  }
  if (patch?.links !== undefined && !Array.isArray(patch.links)) throw new TypeError('links doit être une liste.');
  for (const link of patch?.links ?? []) links.set(link.id, link);
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
    links: [...links.values()].filter((link) => !(patch?.remove ?? []).includes(link.from) && !(patch?.remove ?? []).includes(link.to)),
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
        CREATE TABLE IF NOT EXISTS pm_reasoning_nodes (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          node_id TEXT NOT NULL, layer TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
          definition_json TEXT NOT NULL, valid_from TEXT, valid_to TEXT, revision INTEGER NOT NULL,
          PRIMARY KEY(project_id,node_id)
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_relations (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          node_id TEXT NOT NULL, subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
          context TEXT NOT NULL, unit TEXT, event_date TEXT, document_date TEXT,
          value_json TEXT NOT NULL, state TEXT NOT NULL, sources_json TEXT NOT NULL, revision INTEGER NOT NULL,
          PRIMARY KEY(project_id,node_id)
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_links (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          link_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL,
          rationale TEXT, revision INTEGER NOT NULL, PRIMARY KEY(project_id,link_id)
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_theories (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          theory_id TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL,
          facts_json TEXT NOT NULL, laws_json TEXT NOT NULL, tests_json TEXT NOT NULL,
          issues_json TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(project_id,theory_id)
        );
      `);
      initialized = true;
    }
    return db;
  };
  const persist = (id: string, snapshot: ReasoningSnapshot, turnId: string) => {
    const db = database();
    db.transaction(() => {
      db.prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,snapshot_json=excluded.snapshot_json').run(id, snapshot.revision, JSON.stringify(snapshot));
      for (const table of ['pm_reasoning_results', 'pm_reasoning_nodes', 'pm_reasoning_relations', 'pm_reasoning_links', 'pm_reasoning_theories']) db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id);
      const result = db.prepare('INSERT INTO pm_reasoning_results VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (const evaluation of snapshot.evaluations) for (const row of evaluation.results) result.run(id, evaluation.scenario, row.id, row.status, JSON.stringify(row.value), JSON.stringify(row.dependencies), JSON.stringify(row.missing), JSON.stringify(row.assumptions), JSON.stringify(row.issues), snapshot.revision);
      const node = db.prepare('INSERT INTO pm_reasoning_nodes VALUES(?,?,?,?,?,?,?,?,?)');
      const relation = db.prepare('INSERT INTO pm_reasoning_relations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const row of snapshot.program.nodes) {
        node.run(id, row.id, row.layer ?? (row.kind === 'fact' ? 'fact' : 'theory'), row.kind, row.label, JSON.stringify(row), row.validity?.from ?? null, row.validity?.to ?? null, snapshot.revision);
        if (row.relation) {
          const value = row.relation;
          relation.run(id, row.id, value.subject, value.predicate, value.object, value.context, value.unit ?? null, value.eventDate ?? null, value.documentDate ?? null, JSON.stringify(row.value ?? null), row.state ?? 'asserted', JSON.stringify(row.sources), snapshot.revision);
        }
      }
      const link = db.prepare('INSERT INTO pm_reasoning_links VALUES(?,?,?,?,?,?,?)');
      for (const row of snapshot.program.links ?? []) link.run(id, row.id, row.from, row.to, row.relation, row.rationale ?? null, snapshot.revision);
      const theory = db.prepare('INSERT INTO pm_reasoning_theories VALUES(?,?,?,?,?,?,?,?,?)');
      for (const row of snapshot.theories ?? []) theory.run(id, row.id, row.label, row.status, JSON.stringify(row.facts), JSON.stringify(row.laws), JSON.stringify(row.tests), JSON.stringify(row.issues), snapshot.revision);
      db.prepare('INSERT INTO pm_reasoning_turns VALUES(?,?,?,?)').run(id, turnId, snapshot.revision, JSON.stringify(snapshot));
    })();
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
    if (!row) return emptySnapshot();
    const snapshot = JSON.parse(row.snapshot_json) as ReasoningSnapshot;
    const program = resolveInputs(database(), id, snapshot.program);
    const conflicts = detectConflicts(program);
    if (JSON.stringify(program) === JSON.stringify(snapshot.program)) return { ...snapshot, conflicts, theories: assessTheories(program, snapshot.evaluations) };
    const evaluations = evaluateProgram(program);
    const refreshed = { ...snapshot, program, evaluations, conflicts, theories: assessTheories(program, evaluations), revision: snapshot.revision + 1, updatedAt: new Date().toISOString(), changes: changesSince(snapshot, evaluations) };
    persist(id, refreshed, `sql_${digest(JSON.stringify(refreshed))}`);
    return refreshed;
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
      program = resolveInputs(db, id, program);
      const evaluations = evaluateProgram(program);
      const changes = changesSince(previous, evaluations);
      const conflicts = detectConflicts(program);
      const theories = assessTheories(program, evaluations);
      const snapshot: ReasoningSnapshot = { revision: previous.revision + 1, updatedAt: new Date().toISOString(), program, evaluations, changes, conflicts, theories, diagnostics: program.nodes.length ? theories.flatMap((theory) => theory.issues.map((issue) => `${theory.id} : ${issue}`)) : ['Sources collectées : raisonnement non formalisé. Aucun résultat exécuté.'] };
      persist(id, snapshot, turnId);
      const tests = evaluations.flatMap((evaluation) => evaluation.tests);
      if (!program.nodes.length) return `\n\nSources collectées · ${program.sources.length} extraits · raisonnement non formalisé. Aucun résultat exécuté, aucun test. Formalisation attendue au prochain tour pour une analyse de fond.`;
      const base = evaluations[0].results;
      return `\n\nProgramme du dossier · révision ${snapshot.revision} · ${program.nodes.filter((node) => node.layer === 'law').length} règles de droit · ${program.nodes.filter((node) => node.kind === 'fact').length} faits · ${program.nodes.filter((node) => node.layer === 'theory').length} propositions de théorie · ${base.filter((result) => result.status === 'blocked').length} bloqués · ${base.filter((result) => result.status === 'unknown').length} indéterminés · ${conflicts.length} conflits potentiels · ${tests.length ? `${tests.filter((test) => test.passed).length}/${tests.length} tests du modèle réussis` : 'aucun test formalisé'}. État et modifications disponibles dans le volet Raisonnement et par SQL.`;
    },
  };
}

export function reasoningExample(): ReasoningSnapshot {
  const program: ReasoningProgram = {
    version: 1,
    sources: [
      { id: 'src_invoice', nature: 'simulation', ref: 1, quoteIndex: 0, token: '', document: 'exemple_facture', title: 'Facture fictive', excerpt: 'La facture du 15 juin 2024 indique un montant de 12 000 euros.', hash: 'demo1', verified: true, repaired: false },
      { id: 'src_payment', nature: 'simulation', ref: 2, quoteIndex: 0, token: '', document: 'exemple_versement', title: 'Déclaration fictive', excerpt: 'La déclaration du 16 juin 2024 rapporte un versement contesté de 4 000 euros du 15 juin 2024.', hash: 'demo2', verified: true, repaired: false },
      { id: 'src_rule', nature: 'simulation', ref: 3, quoteIndex: 0, token: '', document: 'exemple_regle', title: 'Règle fictive datée', excerpt: 'Pour cette simulation, comparer le solde au seuil de 10 000 euros pendant l’année 2024.', hash: 'demo3', verified: true, repaired: false, validity: { from: '2024-01-01', to: '2025-01-01' } },
    ],
    nodes: [
      { id: 'F_date', kind: 'fact', layer: 'fact', label: 'Date pertinente fictive', value: '2024-06-15', sources: ['src_invoice'] },
      { id: 'R_seuil', kind: 'rule', layer: 'law', label: 'Règle fictive : comparer au seuil', sources: ['src_rule'], parameters: ['montant'], validity: { from: '2024-01-01', to: '2025-01-01' }, expression: { op: 'greater', args: [{ ref: 'montant' }, 1000000] }, rationale: 'Règle entièrement fictive pour démontrer une application datée ; aucune disposition de droit réel.' },
      { id: 'F_facture', kind: 'fact', label: 'Montant facturé (centimes)', layer: 'fact', value: 1200000, relation: { subject: 'entite_exemple_a', predicate: 'montant_facture', object: 'entite_exemple_b', context: 'facture_exemple', unit: 'centime', eventDate: '2024-06-15', documentDate: '2024-06-15' }, sources: ['src_invoice'] },
      { id: 'F_versement', kind: 'fact', label: 'Versement contesté (centimes)', layer: 'fact', value: 400000, relation: { subject: 'entite_exemple_b', predicate: 'versement_allegue', object: 'entite_exemple_a', context: 'versement_exemple', unit: 'centime', eventDate: '2024-06-15', documentDate: '2024-06-16' }, state: 'disputed', sources: ['src_payment'] },
      { id: 'C_solde', kind: 'calculation', layer: 'theory', rationale: 'Solde arithmétique sous réserve du versement contesté.', label: 'Solde documentaire (centimes)', expression: { op: 'subtract', args: [{ ref: 'F_facture' }, { ref: 'F_versement' }] }, sources: [] },
      { id: 'K_seuil', kind: 'conclusion', label: 'Le solde dépasse 10 000 €', expression: { apply: 'R_seuil', bindings: { montant: { ref: 'C_solde' } }, at: { ref: 'F_date' } }, layer: 'theory', sources: [], rationale: 'Application de la règle fictive pendant sa période de validité, sans qualification juridique réelle.' },
    ],
    scenarios: [
      { id: 'versement_retenu', label: 'Hypothèse : versement de 4 000 €', assumptions: { F_versement: 400000 } },
      { id: 'aucun_versement', label: 'Hypothèse : aucun versement', assumptions: { F_versement: 0 } },
      { id: 'hors_periode', label: 'Hypothèse : règle expirée', assumptions: { F_date: '2025-01-01', F_versement: 0 } },
    ],
    links: [{ id: 'L_chronologie', from: 'F_facture', to: 'F_versement', relation: 'precedes', rationale: 'Ordre attendu des événements fictifs.' }],
    tests: [
      { id: 'T_conclusion_base', label: 'Versement contesté : conclusion indéterminée', target: 'K_seuil', expected: { status: 'unknown' }, rationale: 'Le solde dépend du fait contesté ; la règle ne permet pas de trancher sans hypothèse.' },
      { id: 'T_conclusion_versement', label: 'Avec versement : seuil non dépassé', target: 'K_seuil', scenario: 'versement_retenu', expected: { status: 'known', value: false }, rationale: '12 000 moins 4 000 donne 8 000, inférieur au seuil fictif de 10 000.' },
      { id: 'T_conclusion_zero', label: 'Sans versement : seuil dépassé', target: 'K_seuil', scenario: 'aucun_versement', expected: { status: 'known', value: true }, rationale: '12 000 dépasse le seuil fictif de 10 000 pendant la validité de la règle.' },
      { id: 'T_conclusion_periode', label: 'Fin de validité : application bloquée', target: 'K_seuil', scenario: 'hors_periode', expected: { status: 'blocked' }, rationale: 'Le premier jour hors de la période ne permet pas d’appliquer cette version de la règle, même si le montant dépasse le seuil.' },
      { id: 'T_inconnu', label: 'Le dossier seul ne fixe pas le solde', target: 'C_solde', expected: { status: 'unknown' } },
      { id: 'T_retenu', label: 'Avec versement : 8 000 €', target: 'C_solde', scenario: 'versement_retenu', expected: { status: 'known', value: 800000 } },
      { id: 'T_sans', label: 'Sans versement : 12 000 €', target: 'C_solde', scenario: 'aucun_versement', expected: { status: 'known', value: 1200000 } },
    ],
  };
  const evaluations = evaluateProgram(program);
  return { revision: 0, updatedAt: null, program, evaluations, theories: assessTheories(program, evaluations), conflicts: detectConflicts(program), changes: [], diagnostics: [], demo: true };
}
