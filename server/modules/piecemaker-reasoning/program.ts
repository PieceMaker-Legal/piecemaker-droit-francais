import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningForce, ReasoningQuestion, ReasoningReview, ReasoningSnapshot, ReasoningSource, ReasoningTest, ReasoningTestRun, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import { parseCatala, printCatala, printValue } from './catala.js';
import type { CatalaProgram, DeclarationItem, Rule } from './catala.js';
import { evaluateReasoning } from './evaluate.js';
import type { ReasoningItem } from './evaluate.js';

export type TurnSource = ReasoningSource & { ref: number };
type Lock = { scope: string; declaration?: DeclarationItem; rules: Rule[] };
type TestRow = { test_id: string; label: string; scope: string; values_json: string; expected: ReasoningQuestion['status'] };
type ItemRow = { item_id: string; kind: string; status: string; value_json: string | null; force: string | null; appreciation: string | null; author: string; sources_json: string; locked_json: string | null; note: string | null; updated_at: string };

const MAX_CODE = 200_000;
const LEGACY_TABLES = ['pm_reasoning_results', 'pm_reasoning_nodes', 'pm_reasoning_relations', 'pm_reasoning_links', 'pm_reasoning_theories'];
const emptySnapshot = (): ReasoningSnapshot => ({ revision: 0, updatedAt: null, code: '', sources: [], questions: [], conditions: [], facts: [], tests: [], diagnostics: [] });

export function sourceId(document: string, excerpt: string) {
  return `s${createHash('sha256').update(`${document}\0${excerpt}`).digest('hex').slice(0, 8)}`;
}

function lawScopeOf(program: CatalaProgram, dossierScope: string, sub: string) {
  const item = program.declarations.find((declaration) => declaration.scope === dossierScope)?.items.find((entry) => entry.role === 'champ' && entry.name === sub);
  return item?.role === 'champ' ? item.scope : undefined;
}

function itemRules(program: CatalaProgram, id: string): Lock {
  const [scope, variable] = id.split('.');
  const declaration = program.declarations.find((entry) => entry.scope === scope)?.items.find((entry) => entry.name === variable);
  if (declaration?.role === 'entrée') {
    for (const body of program.bodies) {
      const rules = body.rules.filter((rule) => rule.target.length === 2 && rule.target[1] === variable && lawScopeOf(program, body.scope, rule.target[0]) === scope);
      if (rules.length) return { scope: body.scope, rules };
    }
    return { scope: '', rules: [] };
  }
  return { scope, declaration, rules: program.bodies.filter((body) => body.scope === scope).flatMap((body) => body.rules).filter((rule) => rule.target.length === 1 && rule.target[0] === variable) };
}

function applyLock(program: CatalaProgram, id: string, lock: Lock) {
  const current = itemRules(program, id);
  const same = JSON.stringify(current.rules) === JSON.stringify(lock.rules) && (!lock.declaration || JSON.stringify(current.declaration) === JSON.stringify(lock.declaration));
  if (same) return false;
  for (const body of program.bodies) body.rules = body.rules.filter((rule) => !current.rules.includes(rule));
  if (lock.declaration) {
    let declaration = program.declarations.find((entry) => entry.scope === lock.scope);
    if (!declaration) program.declarations.push(declaration = { scope: lock.scope, attrs: {}, items: [] });
    declaration.items = [...declaration.items.filter((item) => item.name !== lock.declaration!.name), lock.declaration];
  }
  let body = program.bodies.find((entry) => entry.scope === lock.scope);
  if (!body && lock.rules.length) program.bodies.push(body = { scope: lock.scope, rules: [] });
  body?.rules.push(...lock.rules);
  return true;
}

function referencedSources(program: CatalaProgram) {
  return new Set(program.bodies.flatMap((body) => body.rules.flatMap((rule) => rule.attrs.selon ?? [])));
}

export function createReasoningService(getDatabase: () => Database.Database) {
  let initialized = false;
  const database = () => {
    const db = getDatabase();
    if (!initialized) {
      for (const table of LEGACY_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
      const columns = db.prepare("SELECT name FROM pragma_table_info('pm_reasoning_programs')").all() as Array<{ name: string }>;
      if (columns.length && !columns.some((column) => column.name === 'code')) db.exec('DROP TABLE pm_reasoning_programs; DROP TABLE IF EXISTS pm_reasoning_turns;');
      db.exec(`
        CREATE TABLE IF NOT EXISTS pm_reasoning_programs (
          project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
          revision INTEGER NOT NULL, code TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_items (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          item_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('proposé','validé','écarté')),
          value_json TEXT, force TEXT, appreciation TEXT,
          author TEXT NOT NULL CHECK(author IN ('ia','avocat')),
          sources_json TEXT NOT NULL, locked_json TEXT, note TEXT, updated_at TEXT NOT NULL,
          PRIMARY KEY(project_id, item_id)
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_tests (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          test_id TEXT NOT NULL, label TEXT NOT NULL, scope TEXT NOT NULL,
          values_json TEXT NOT NULL CHECK(json_valid(values_json)), expected TEXT NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY(project_id, test_id)
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_turns (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(project_id, turn_id)
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

  const rows = (id: string) => database().prepare('SELECT * FROM pm_reasoning_items WHERE project_id=?').all(id) as ItemRow[];
  const items = (id: string) => new Map(rows(id).map((row): [string, ReasoningItem] => {
    const review: ReasoningReview | undefined = row.status === 'proposé' ? undefined : { status: row.status as 'validé' | 'écarté', at: row.updated_at, ...(row.note ? { note: row.note } : {}) };
    const lawyer = row.author === 'avocat' && row.kind === 'fait';
    return [row.item_id, { ...(review ? { review } : {}), ...(lawyer ? { value: JSON.parse(row.value_json ?? 'null') as ReasoningValue, force: row.force as ReasoningForce | null, appreciation: row.appreciation ?? '', sources: JSON.parse(row.sources_json) as string[] } : {}) }];
  }));

  const read = (cwd: string): ReasoningSnapshot => {
    const row = database().prepare('SELECT snapshot_json FROM pm_reasoning_programs WHERE project_id=?').get(projectId(cwd)) as { snapshot_json: string } | undefined;
    return row ? { ...emptySnapshot(), ...JSON.parse(row.snapshot_json) as Partial<ReasoningSnapshot> } : emptySnapshot();
  };

  const simulate = (id: string, program: CatalaProgram, sources: ReasoningSource[], scope: string, values: Record<string, ReasoningValue>): ReasoningTestRun => {
    const evaluation = evaluateReasoning(program, new Map(sources.map((source) => [source.id, source])), items(id), new Map(Object.entries(values)));
    const question = evaluation.questions.find((entry) => entry.scope === scope);
    if (!question) throw new TypeError(`Question inconnue : ${scope}.`);
    return { question, conditions: evaluation.conditions.filter((condition) => condition.scope === scope), facts: evaluation.facts.filter((fact) => fact.scope === scope) };
  };

  const runTests = (id: string, program: CatalaProgram, sources: ReasoningSource[]): ReasoningTest[] => (database().prepare('SELECT * FROM pm_reasoning_tests WHERE project_id=? ORDER BY created_at').all(id) as TestRow[]).map((row) => {
    const values = JSON.parse(row.values_json) as Record<string, ReasoningValue>;
    let actual: ReasoningQuestion['status'] | null = null;
    try { actual = simulate(id, program, sources, row.scope, values).question.status; } catch { actual = null; }
    return { id: row.test_id, label: row.label, scope: row.scope, values, expected: row.expected, actual, passed: actual === row.expected };
  });

  const checkValues = (snapshot: ReasoningSnapshot, scope: string, values: unknown): Record<string, ReasoningValue> => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Valeurs attendues : objet { fait: valeur }.');
    for (const key of Object.keys(values)) if (!snapshot.facts.some((fact) => fact.id === key && fact.scope === scope)) throw new TypeError(`Entrée inconnue : ${key}.`);
    return values as Record<string, ReasoningValue>;
  };

  const commit = (id: string, previous: ReasoningSnapshot, program: CatalaProgram, sources: ReasoningSource[], notes: string[], turnId?: string): ReasoningSnapshot => {
    const db = database();
    const used = referencedSources(program);
    const kept = sources.filter((source) => used.has(source.id));
    const evaluation = evaluateReasoning(program, new Map(kept.map((source) => [source.id, source])), items(id));
    const snapshot: ReasoningSnapshot = {
      revision: previous.revision + 1, updatedAt: new Date().toISOString(), code: printCatala(program), sources: kept,
      questions: evaluation.questions, conditions: evaluation.conditions, facts: evaluation.facts,
      tests: runTests(id, program, kept),
      diagnostics: [...notes, ...evaluation.diagnostics],
    };
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision, code=excluded.code, snapshot_json=excluded.snapshot_json').run(id, snapshot.revision, snapshot.code, JSON.stringify(snapshot));
      const live = new Set([...snapshot.conditions.map((condition) => condition.id), ...snapshot.facts.map((fact) => fact.id)]);
      for (const row of rows(id)) if (row.status === 'proposé' && !live.has(row.item_id)) db.prepare('DELETE FROM pm_reasoning_items WHERE project_id=? AND item_id=?').run(id, row.item_id);
      const upsert = db.prepare(`INSERT INTO pm_reasoning_items(project_id,item_id,kind,label,status,value_json,force,appreciation,author,sources_json,locked_json,note,updated_at) VALUES(?,?,?,?,'proposé',?,?,?,'ia',?,NULL,NULL,?)
        ON CONFLICT(project_id,item_id) DO UPDATE SET label=excluded.label, value_json=CASE WHEN author='avocat' THEN value_json ELSE excluded.value_json END, force=CASE WHEN author='avocat' THEN force ELSE excluded.force END, appreciation=CASE WHEN author='avocat' THEN appreciation ELSE excluded.appreciation END, sources_json=CASE WHEN author='avocat' THEN sources_json ELSE excluded.sources_json END`);
      for (const condition of snapshot.conditions) upsert.run(id, condition.id, 'condition', condition.label, JSON.stringify(condition.value), null, null, JSON.stringify(condition.sources), now);
      for (const fact of snapshot.facts) upsert.run(id, fact.id, 'fait', fact.variable, JSON.stringify(fact.value), fact.force, fact.appreciation, JSON.stringify(fact.sources), now);
      if (turnId) db.prepare('INSERT INTO pm_reasoning_turns VALUES(?,?,?)').run(id, turnId, snapshot.revision);
    })();
    return snapshot;
  };

  const locks = (id: string) => rows(id).filter((row) => row.locked_json).map((row) => [row.item_id, JSON.parse(row.locked_json!) as Lock] as const);

  const reload = (id: string, cwd: string, note: string) => {
    const previous = read(cwd);
    const program = parseCatala(previous.code);
    for (const [item, lock] of locks(id)) applyLock(program, item, lock);
    return commit(id, previous, program, previous.sources, [note]);
  };

  const summary = (snapshot: ReasoningSnapshot) => {
    const toReview = [...snapshot.conditions, ...snapshot.facts].filter((item) => !item.review).length;
    const missing = snapshot.facts.filter((fact) => !fact.sources.length).length;
    const failing = snapshot.tests.filter((entry) => !entry.passed).length;
    const answers = snapshot.questions.map((question) => `${question.scope} : ${question.status}${question.objectiveStatus ? `, objectif ${question.objectiveStatus}` : ''}${question.valid ? '' : ' (incomplet)'}`).join(' ; ');
    return `Raisonnement · révision ${snapshot.revision} · ${answers || 'aucune question'} · ${snapshot.conditions.length} conditions · ${snapshot.facts.length} faits${missing ? ` dont ${missing} sans pièce` : ''} · ${toReview} élément(s) à valider${snapshot.tests.length ? ` · tests ${snapshot.tests.length - failing}/${snapshot.tests.length} réussis` : ''} dans le volet Raisonnement.`;
  };

  database();
  return {
    read,
    runTest(cwd: string, scope: string, values: unknown): ReasoningTestRun {
      const id = projectId(cwd);
      const snapshot = read(cwd);
      return simulate(id, parseCatala(snapshot.code), snapshot.sources, scope, checkValues(snapshot, scope, values));
    },
    saveTest(cwd: string, input: { label: unknown; scope: string; values: unknown; expected: unknown }): ReasoningSnapshot {
      const id = projectId(cwd);
      const snapshot = read(cwd);
      const values = checkValues(snapshot, input.scope, input.values);
      if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 300) throw new TypeError('Intitulé du test requis.');
      if (!['remplie', 'non remplie', 'indéterminée', 'bloquée'].includes(input.expected as string)) throw new TypeError('Résultat attendu invalide.');
      database().prepare('INSERT INTO pm_reasoning_tests VALUES(?,?,?,?,?,?,?)').run(id, randomUUID(), input.label.trim(), input.scope, JSON.stringify(values), input.expected, new Date().toISOString());
      return reload(id, cwd, `Avocat · test enregistré : ${input.label.trim()}.`);
    },
    deleteTest(cwd: string, testId: string): ReasoningSnapshot {
      const id = projectId(cwd);
      database().prepare('DELETE FROM pm_reasoning_tests WHERE project_id=? AND test_id=?').run(id, testId);
      return reload(id, cwd, 'Avocat · test supprimé.');
    },
    review(cwd: string, target: string, status: 'validé' | 'écarté' | null, note?: string): ReasoningSnapshot {
      const id = projectId(cwd);
      if (![null, 'validé', 'écarté'].includes(status)) throw new TypeError('Décision attendue : validé, écarté ou null.');
      if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) throw new TypeError('Note trop longue.');
      const row = rows(id).find((entry) => entry.item_id === target);
      if (!row) throw new TypeError('Élément introuvable.');
      const lock = status ? JSON.stringify(itemRules(parseCatala(read(cwd).code), target)) : null;
      const reset = status === null && row.kind === 'fait';
      database().prepare(`UPDATE pm_reasoning_items SET status=?, locked_json=?, note=?, updated_at=?${reset ? ", author='ia'" : ''} WHERE project_id=? AND item_id=?`).run(status ?? 'proposé', lock, note?.trim() || null, new Date().toISOString(), id, target);
      return reload(id, cwd, `Avocat · ${target} : ${status ?? 'décision annulée'}${note?.trim() ? ` (${note.trim()})` : ''}.`);
    },
    appreciate(cwd: string, target: string, input: { value: ReasoningValue; force: string | null; appreciation: string; note?: string }): ReasoningSnapshot {
      const id = projectId(cwd);
      const row = rows(id).find((entry) => entry.item_id === target && entry.kind === 'fait');
      if (!row) throw new TypeError('Fait introuvable.');
      if (input.force !== null && !REASONING_FORCES.includes(input.force as ReasoningForce)) throw new TypeError('Force probante inconnue.');
      if (typeof input.appreciation !== 'string' || input.appreciation.length > 2000) throw new TypeError('Appréciation invalide.');
      if (input.value === null || input.value === undefined) throw new TypeError('Valeur requise.');
      const program = parseCatala(read(cwd).code);
      const lock = itemRules(program, target);
      const [scope, variable] = target.split('.');
      if (!lock.rules.length) {
        const dossier = program.declarations.find((declaration) => declaration.items.some((item) => item.role === 'champ' && item.scope === scope));
        const sub = dossier?.items.find((item) => item.role === 'champ' && item.scope === scope);
        if (!dossier || !sub) throw new TypeError('Aucun champ d’application Dossier ne reçoit ce fait.');
        Object.assign(lock, { scope: dossier.scope, rules: [{ kind: 'définition', target: [sub.name, variable], consequence: { t: 'lit', v: null }, attrs: {} }] });
      }
      lock.rules = lock.rules.map((rule) => ({ ...rule, condition: undefined, consequence: { t: 'lit', v: input.value }, attrs: { ...rule.attrs, force: input.force ? [input.force] : [], 'appréciation': input.appreciation.trim() ? [input.appreciation.trim()] : [] } }));
      for (const rule of lock.rules) for (const key of ['force', 'appréciation']) if (!rule.attrs[key].length) delete rule.attrs[key];
      database().prepare("UPDATE pm_reasoning_items SET status='validé', author='avocat', value_json=?, force=?, appreciation=?, locked_json=?, note=?, updated_at=? WHERE project_id=? AND item_id=?")
        .run(JSON.stringify(input.value), input.force, input.appreciation.trim(), JSON.stringify(lock), input.note?.trim() || null, new Date().toISOString(), id, target);
      return reload(id, cwd, `Avocat · ${target} = ${printValue(input.value)}${input.force ? ` (${input.force})` : ''}.`);
    },
    context(cwd: string) {
      try {
        const snapshot = read(cwd);
        if (!snapshot.revision) return '';
        const locked = [...snapshot.conditions, ...snapshot.facts].filter((item) => item.review).map((item) => `${item.id} (${item.review!.status})`);
        const todo = [
          ...snapshot.diagnostics,
          ...snapshot.questions.flatMap((question) => question.issues.map((issue) => `${question.scope} : ${issue}`)),
          ...snapshot.conditions.flatMap((condition) => condition.issues.map((issue) => `${condition.id} : ${issue}`)),
          ...snapshot.facts.flatMap((fact) => fact.issues.map((issue) => `${fact.id} : ${issue}`)),
        ];
        const sources = snapshot.sources.map((source) => `${source.id} = ${source.title} « ${source.excerpt.slice(0, 160)} »`);
        const text = [
          `Raisonnement enregistré (révision ${snapshot.revision}) : réécris-le en entier en le complétant.`,
          '<RAISONNEMENT_ACTUEL>', snapshot.code, '</RAISONNEMENT_ACTUEL>',
          sources.length ? `Sources enregistrées (réutilisables par leur identifiant) :\n${sources.join('\n')}` : '',
          locked.length ? `Verrouillé par l'avocat, à recopier à l'identique : ${locked.join(', ')}.` : '',
          todo.length ? `À traiter :\n- ${todo.join('\n- ')}` : '',
        ].filter(Boolean).join('\n');
        return text.length <= 40_000 ? text : `${text.slice(0, 40_000)}\n… (suite : SELECT code, snapshot_json FROM pm_reasoning_programs WHERE project_id=dossier();)`;
      } catch { return ''; }
    },
    ingest(input: { cwd: string; sessionId: string; turnId: string; code: string; sources: TurnSource[] }): string {
      const id = projectId(input.cwd);
      const db = database();
      const turnId = createHash('sha256').update(`${input.sessionId}\0${input.turnId}`).digest('hex');
      if (db.prepare('SELECT 1 FROM pm_reasoning_turns WHERE project_id=? AND turn_id=?').get(id, turnId)) return '';
      const previous = read(input.cwd);
      if (!input.code.trim()) return '';
      let program: CatalaProgram;
      try {
        if (input.code.length > MAX_CODE) throw new SyntaxError('Code trop long.');
        program = parseCatala(input.code);
      } catch (error) {
        const message = `Raisonnement non appliqué : ${error instanceof Error ? error.message : 'code illisible'} Le raisonnement précédent est conservé.`;
        db.prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET snapshot_json=excluded.snapshot_json').run(id, previous.revision, previous.code, JSON.stringify({ ...previous, diagnostics: [message] }));
        return message;
      }
      const notes: string[] = [];
      const known = new Map(previous.sources.map((source) => [source.id, source]));
      for (const { ref: _ref, ...source } of input.sources) known.set(source.id, source);
      for (const body of program.bodies) for (const rule of body.rules) if (rule.attrs.selon) {
        rule.attrs.selon = [...new Set(rule.attrs.selon.flatMap((value) => {
          if (!/^\d+$/.test(value)) return [value];
          const matches = input.sources.filter((source) => source.ref === Number(value)).map((source) => source.id);
          if (!matches.length) notes.push(`Source [${value}] absente du bloc CITATIONS.`);
          return matches.length ? matches : [`ref${value}`];
        }))];
      }
      for (const [item, lock] of locks(id)) if (applyLock(program, item, lock)) notes.push(`Modification ignorée : ${item} est verrouillé par l'avocat.`);
      const snapshot = commit(id, previous, program, [...known.values()], notes, turnId);
      return [...notes, summary(snapshot)].join(' ');
    },
  };
}

export function reasoningExample(): ReasoningSnapshot {
  const article: ReasoningSource = { id: 'sdemo0001', kind: 'article', document: 'article:LEGIARTI000000000001', title: 'Code fictif, article 1', excerpt: 'Les indemnités de départ des dirigeants de sociétés cotées sont soumises à l’approbation préalable de l’assemblée générale.', token: '', verified: true, repaired: false, validity: { from: '2019-05-24', to: null } };
  const piece: ReasoningSource = { id: 'sdemo0002', kind: 'document', document: 'document:pieces/pv-ag-exemple.md', title: 'Procès-verbal fictif d’assemblée générale', excerpt: 'L’assemblée générale approuve l’indemnité de départ du directeur général.', token: '', verified: true, repaired: false };
  const date: ReasoningSource = { id: 'sdemo0003', kind: 'document', document: 'document:pieces/courrier-exemple.md', title: 'Courrier fictif de révocation', excerpt: 'Le versement est demandé le 1er mars 2024.', token: '', verified: true, repaired: false };
  const code = `#[question = "Le dirigeant d'une société cotée peut-il obtenir le versement de son indemnité de départ ?"]
#[objectif = rempli]
#[date_de_référence = date_versement]
déclaration champ d'application Indemnite:
  entrée date_versement contenu date
  entrée societe_cotee contenu booléen
  entrée vote_ex_ante contenu booléen
  entrée vote_ex_post contenu booléen
  interne personne condition
  interne approbation_ex_ante condition
  interne approbation_ex_post condition
  résultat versement condition

champ d'application Indemnite:
  #[libellé = "Société dont les titres sont admis sur un marché réglementé"]
  #[selon = sdemo0001]
  règle personne sous condition societe_cotee conséquence rempli
  #[libellé = "Approbation préalable par l'assemblée générale"]
  #[selon = sdemo0001]
  règle approbation_ex_ante sous condition vote_ex_ante conséquence rempli
  #[libellé = "Approbation a posteriori du versement"]
  règle approbation_ex_post sous condition vote_ex_post conséquence rempli
  #[selon = sdemo0001]
  règle versement sous condition personne et approbation_ex_ante et approbation_ex_post conséquence rempli

déclaration champ d'application Dossier:
  indemnite champ Indemnite

champ d'application Dossier:
  #[selon = sdemo0003] #[force = acte_sous_seing_privé] #[appréciation = "Date de la demande de versement"]
  définition indemnite.date_versement égal à |2024-03-01|
  #[selon = sdemo0002] #[force = acte_sous_seing_privé] #[appréciation = "Procès-verbal signé par le bureau"]
  définition indemnite.vote_ex_ante égal à vrai
`;
  const program = parseCatala(code);
  const sources = [article, piece, date];
  const evaluation = evaluateReasoning(program, new Map(sources.map((source) => [source.id, source])), new Map());
  return { revision: 0, updatedAt: null, code: printCatala(program), sources, ...evaluation, tests: [], demo: true };
}
