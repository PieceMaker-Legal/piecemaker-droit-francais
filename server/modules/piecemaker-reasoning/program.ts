import path from 'node:path';

import type Database from 'better-sqlite3';

import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningCondition, ReasoningFinding, ReasoningForce, ReasoningLogEntry, ReasoningReview, ReasoningSnapshot, ReasoningSource, ReasoningTestReport, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import { parseCatala, printCatala, printValue } from './catala.js';
import type { CatalaProgram, DeclarationItem, Rule } from './catala.js';
import { applyCommand, describeState, emptyModel, modelToCatala } from './commands.js';
import type { ReasoningCommand, ReasoningConnectors, ReasoningModel } from './commands.js';
import { evaluateReasoning } from './evaluate.js';
import type { ReasoningItem } from './evaluate.js';

type Lock = { scope: string; declaration?: DeclarationItem; rules: Rule[] };
type ItemRow = { item_id: string; kind: string; status: string; value_json: string | null; force: string | null; appreciation: string | null; author: string; sources_json: string; locked_json: string | null; note: string | null; updated_at: string };

const LEGACY_TABLES = ['pm_reasoning_results', 'pm_reasoning_nodes', 'pm_reasoning_relations', 'pm_reasoning_links', 'pm_reasoning_theories', 'pm_reasoning_tests', 'pm_reasoning_turns'];
const emptySnapshot = (): ReasoningSnapshot => ({ revision: 0, updatedAt: null, code: '', sources: [], questions: [], conditions: [], facts: [], test: null, diagnostics: [] });

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

const offline = (): never => { throw new Error('Connecteurs du raisonnement indisponibles.'); };
const OFFLINE: ReasoningConnectors = { law: offline, piece: offline, match: offline, registry: offline, bodacc: offline };

export function createReasoningService(getDatabase: () => Database.Database, connectors: ReasoningConnectors = OFFLINE) {
  let initialized = false;
  const database = () => {
    const db = getDatabase();
    if (!initialized) {
      for (const table of LEGACY_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
      const columns = db.prepare("SELECT name FROM pragma_table_info('pm_reasoning_programs')").all() as Array<{ name: string }>;
      if (columns.length && !columns.some((column) => column.name === 'code')) db.exec('DROP TABLE pm_reasoning_programs;');
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
        CREATE TABLE IF NOT EXISTS pm_reasoning_models (
          project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
          model_json TEXT NOT NULL CHECK(json_valid(model_json))
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

  const commit = (id: string, previous: ReasoningSnapshot, program: CatalaProgram, sources: ReasoningSource[], notes: string[], test = previous.test): ReasoningSnapshot => {
    const db = database();
    const used = referencedSources(program);
    const kept = sources.filter((source) => used.has(source.id));
    const evaluation = evaluateReasoning(program, new Map(kept.map((source) => [source.id, source])), items(id));
    const snapshot: ReasoningSnapshot = {
      revision: previous.revision + 1, updatedAt: new Date().toISOString(), code: printCatala(program), sources: kept,
      questions: evaluation.questions, conditions: evaluation.conditions, facts: evaluation.facts,
      test,
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
    })();
    return snapshot;
  };

  const locks = (id: string) => rows(id).filter((row) => row.locked_json).map((row) => [row.item_id, JSON.parse(row.locked_json!) as Lock] as const);

  const loadModel = (id: string): ReasoningModel => {
    const row = database().prepare('SELECT model_json FROM pm_reasoning_models WHERE project_id=?').get(id) as { model_json: string } | undefined;
    return row ? JSON.parse(row.model_json) as ReasoningModel : emptyModel();
  };

  const rebuild = (id: string, previous: ReasoningSnapshot, model: ReasoningModel, sources: ReasoningSource[], notes: string[], test?: ReasoningTestReport | null) => {
    const program = parseCatala(model.questions.length || !previous.code ? modelToCatala(model) : previous.code);
    for (const [item, lock] of locks(id)) applyLock(program, item, lock);
    return commit(id, previous, program, sources, notes, test);
  };

  const reload = (id: string, cwd: string, note: string) => {
    const previous = read(cwd);
    return rebuild(id, previous, loadModel(id), previous.sources, [note]);
  };

  const companies = (id: string) => {
    const db = database();
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='piecemaker_nodes'").get()) return [];
    return db.prepare(`SELECT c.label,
        (SELECT m.real_value FROM piecemaker_mappings m WHERE m.project_id=c.project_id AND m.node_id=c.id LIMIT 1) AS name,
        (SELECT COALESCE((SELECT m.real_value FROM piecemaker_mappings m WHERE m.project_id=s.project_id AND m.node_id=s.id LIMIT 1), s.label)
           FROM piecemaker_links l JOIN piecemaker_nodes s ON s.project_id=l.project_id AND s.id=l.to_node_id
           WHERE l.project_id=c.project_id AND l.from_node_id=c.id AND s.kind='siren' LIMIT 1) AS siren
      FROM piecemaker_nodes c WHERE c.project_id=? AND c.kind='company' ORDER BY c.label`).all(id) as Array<{ label: string; name: string | null; siren: string | null }>;
  };

  const checkSource = async (cwd: string, source: ReasoningSource, findings: ReasoningFinding[]): Promise<ReasoningSource> => {
    const link = connectors;
    const [kind, ...rest] = source.document.split(':');
    const reference = rest.join(':');
    try {
      if (kind === 'document') {
        const piece = await link.piece(cwd, reference);
        const found = Boolean(piece && link.match(piece.text, source.excerpt));
        findings.push({ level: found ? 'ok' : 'alerte', subject: source.title, text: found ? 'Extrait retrouvé dans la pièce.' : 'Extrait introuvable : la pièce a changé ou n’est plus dans le dossier.' });
        return { ...source, verified: found };
      }
      const law = await link.law(reference);
      const fresh = { ...source, ...(law.validity ? { validity: law.validity } : {}), ...(law.history ? { history: law.history } : {}) };
      if (kind === 'case') {
        const status = fresh.history?.status;
        findings.push(status === 'non remise en cause'
          ? { level: 'ok', subject: source.title, text: 'Aucune décision ultérieure ne la remet en cause.' }
          : { level: 'alerte', subject: source.title, text: status === 'remise en cause' ? `Remise en cause par une décision supérieure${fresh.history!.lines[0] ? ` : ${fresh.history!.lines[0]}` : ''}.` : status === 'à examiner' ? `Recours à examiner${fresh.history!.lines[0] ? ` : ${fresh.history!.lines[0]}` : ''}.` : 'Historique judiciaire indisponible.' });
      }
      return fresh;
    } catch (error) {
      findings.push({ level: 'alerte', subject: source.title, text: `Vérification impossible : ${error instanceof Error ? error.message : 'erreur'}.` });
      return source;
    }
  };

  const checkCompany = async (company: { label: string; name: string | null; siren: string | null }, findings: ReasoningFinding[]) => {
    const link = connectors;
    const siren = company.siren?.replace(/\D/g, '').slice(0, 9) || null;
    try {
      const record = await link.registry({ siren, name: company.name ?? company.label });
      if (!record.found) findings.push({ level: 'alerte', subject: company.label, text: `Personne morale introuvable au Registre Public${siren ? ` (SIREN ${siren})` : ''}.` });
      else if (/radi|cess|ferm|liquid|dissou/i.test(record.status)) findings.push({ level: 'alerte', subject: company.label, text: `Registre Public : ${record.status}.` });
      else findings.push({ level: 'ok', subject: company.label, text: `Registre Public : ${record.status || 'trouvée'}.` });
      if (siren) {
        const alerts = await link.bodacc(siren);
        if (alerts.length) findings.push(...alerts.map((alert) => ({ level: 'alerte' as const, subject: company.label, text: `BODACC : ${alert}` })));
      }
    } catch (error) {
      findings.push({ level: 'alerte', subject: company.label, text: `Vérification impossible : ${error instanceof Error ? error.message : 'erreur'}.` });
    }
  };

  const programFindings = (snapshot: ReasoningSnapshot): ReasoningFinding[] => {
    const titles = new Map(snapshot.sources.map((source) => [source.id, source.title]));
    return snapshot.questions.flatMap((question): ReasoningFinding[] => [
      { level: question.status === 'bloquée' || question.objectiveStatus === 'hors d’atteinte' ? 'alerte' : 'ok', subject: question.scope, text: `Réponse calculée : ${({ remplie: 'oui', 'non remplie': 'non', indéterminée: 'pas encore établie', bloquée: 'bloquée' })[question.status]}${question.objectiveStatus ? ` · objectif ${question.objectiveStatus}` : ''}.` },
      ...question.vigueur.map((entry): ReasoningFinding => ({ level: entry.inForce === true ? 'ok' : 'alerte', subject: titles.get(entry.source) ?? entry.source, text: entry.inForce === true ? `En vigueur au ${entry.date}.` : entry.inForce === false ? `Non en vigueur au ${entry.date}.` : 'Vigueur non contrôlée : date de référence non prouvée.' })),
      ...question.issues.map((issue): ReasoningFinding => ({ level: 'alerte', subject: question.scope, text: issue })),
      ...snapshot.conditions.filter((condition) => condition.scope === question.scope && condition.variable !== question.result).flatMap((condition) => condition.issues.map((issue): ReasoningFinding => ({ level: 'alerte', subject: condition.label, text: issue }))),
      ...snapshot.facts.filter((fact) => fact.scope === question.scope && fact.status !== 'établi').map((fact): ReasoningFinding => ({ level: 'alerte', subject: fact.variable, text: fact.issues[0] ?? 'Fait à prouver.' })),
    ]).concat(snapshot.diagnostics.filter((line) => !line.startsWith('Avocat · ')).map((line): ReasoningFinding => ({ level: 'alerte', subject: 'Programme', text: line })));
  };

  database();
  return {
    read,
    describe(cwd: string, focus: string | null = null, full = false) {
      return describeState(read(cwd), loadModel(projectId(cwd)), focus, full);
    },
    async command(cwd: string, input: ReasoningCommand): Promise<string> {
      if (input.commande === 'etat' || input.commande === undefined) return this.describe(cwd, typeof input.question === 'string' ? input.question : null, input.vue === 'complete');
      if (input.commande === 'tester') return this.test(cwd).then((snapshot) => `${describeTest(snapshot.test!)}\n\n${describeState(snapshot, loadModel(projectId(cwd)), null, false, false)}`);
      const id = projectId(cwd);
      const previous = read(cwd);
      const locked = new Set(rows(id).filter((row) => row.locked_json).map((row) => row.item_id));
      const result = await applyCommand(loadModel(id), previous.sources, locked, cwd, input, connectors);
      database().prepare('INSERT INTO pm_reasoning_models VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET model_json=excluded.model_json').run(id, JSON.stringify(result.model));
      const snapshot = rebuild(id, previous, result.model, result.sources, [], null);
      return `${result.note}\n\n${describeState(snapshot, result.model, result.focus)}`;
    },
    async test(cwd: string, emit: (entry: ReasoningLogEntry) => void = () => {}): Promise<ReasoningSnapshot> {
      const id = projectId(cwd);
      const previous = read(cwd);
      const list = companies(id);
      const log: ReasoningLogEntry[] = [];
      const send = (entry: ReasoningLogEntry) => { log.push(entry); emit(entry); };
      const watch = async <T>(key: string, step: ReasoningLogEntry['step'], subject: string, waiting: string, done: string, run: (findings: ReasoningFinding[]) => Promise<T>) => {
        send({ key, step, status: 'en cours', subject, text: waiting });
        const findings: ReasoningFinding[] = [];
        const value = await run(findings);
        if (!findings.length) send({ key, step, status: 'ok', subject, text: done });
        findings.forEach((finding, index) => send({ key: index ? `${key}.${index}` : key, step, status: finding.level, subject: finding.subject, text: finding.text }));
        return { value, findings };
      };
      for (const question of previous.questions) send({ key: `${question.scope}:question`, step: 'question', status: 'neutre', subject: question.question || question.scope, text: '' });
      const checked = await Promise.all(previous.sources.map((source) => watch(`source:${source.id}`, 'source', source.title, source.kind === 'document' ? 'Relecture de la pièce…' : source.kind === 'case' ? 'Recherche des recours sur Légifrance…' : 'Consultation de Légifrance…', verifiedText(source), (findings) => checkSource(cwd, source, findings))));
      const registry = await Promise.all(list.map((company) => watch(`registre:${company.label}`, 'registre', company.label, company.siren ? 'Registre Public et BODACC…' : 'Recherche au Registre Public…', 'Registre Public consulté.', (findings) => checkCompany(company, findings))));
      const evaluated = rebuild(id, previous, loadModel(id), checked.map((entry) => entry.value), [], null);
      for (const entry of resolution(evaluated)) send(entry);
      const findings = [...programFindings(evaluated), ...checked.flatMap((entry) => entry.findings), ...registry.flatMap((entry) => entry.findings)];
      const test: ReasoningTestReport = { at: new Date().toISOString(), findings: [...findings.filter((finding) => finding.level === 'alerte'), ...findings.filter((finding) => finding.level === 'ok')], log: [...new Map(log.map((entry) => [entry.key, entry])).values()] };
      const snapshot = { ...evaluated, test };
      database().prepare('UPDATE pm_reasoning_programs SET snapshot_json=? WHERE project_id=?').run(JSON.stringify(snapshot), id);
      return snapshot;
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
  };
}

const verifiedText = (source: ReasoningSource) => (source.kind === 'document' ? 'Extrait retrouvé dans la pièce.' : 'Texte relu sur Légifrance.');
const shown = (value: ReasoningValue) => (value === true ? 'oui' : value === false ? 'non' : value === null ? 'inconnu' : printValue(value).replace(/^\|(\d{4})-(\d{2})-(\d{2})\|$/, '$3/$2/$1'));
const CONDITION_TEXT = { remplie: 'Condition remplie', 'non remplie': 'Condition non remplie', indéterminée: 'Condition non établie', bloquée: 'Condition bloquée : fondement à revoir' };
const ANSWER_TEXT = { remplie: 'oui', 'non remplie': 'non', indéterminée: 'pas encore établie', bloquée: 'bloquée' };

function resolution(snapshot: ReasoningSnapshot): ReasoningLogEntry[] {
  const titles = new Map(snapshot.sources.map((source) => [source.id, source.title]));
  const cited = (ids: string[]) => ids.map((id) => titles.get(id) ?? id).join(', ');
  return snapshot.questions.flatMap((question): ReasoningLogEntry[] => {
    const facts = snapshot.facts.filter((fact) => fact.scope === question.scope);
    const pending = snapshot.conditions.filter((condition) => condition.scope === question.scope);
    const ordered: typeof pending = [];
    while (pending.length) {
      const next = pending.findIndex((condition) => condition.dependsOn.every((dependency) => !pending.some((other) => other !== condition && other.id === dependency)));
      ordered.push(...pending.splice(next < 0 ? 0 : next, 1));
    }
    const resultId = `${question.scope}.${question.result}`;
    const rules = ordered.filter((condition) => condition.id !== resultId);
    const reach = (ids: string[], seen = new Set<string>()): Set<string> => { for (const id of ids) if (!seen.has(id)) { seen.add(id); reach(ordered.find((condition) => condition.id === id)?.dependsOn ?? [], seen); } return seen; };
    const missing = (ids: string[]) => { const all = reach(ids); return facts.filter((fact) => all.has(fact.id) && fact.status !== 'établi').map((fact) => fact.variable.replace(/_/g, ' ')); };
    const why = (status: ReasoningCondition['status'], ids: string[]) => (status === 'indéterminée' && missing(ids).length ? ` : reste à prouver ${missing(ids).join(', ')}` : '');
    return [
      ...rules.map((condition): ReasoningLogEntry => ({ key: condition.id, step: 'règle', status: condition.status === 'bloquée' || !condition.sources.length ? 'alerte' : 'ok', subject: condition.label, text: condition.status === 'bloquée' ? condition.issues[0] ?? 'Fondement à revoir' : condition.sources.length ? `Fondement : ${cited(condition.sources)}` : 'Aucun fondement cité' })),
      ...question.vigueur.map((entry): ReasoningLogEntry => ({ key: `${question.scope}:vigueur:${entry.source}`, step: 'vigueur', status: entry.inForce === true ? 'ok' : 'alerte', subject: titles.get(entry.source) ?? entry.source, text: entry.inForce === true ? `En vigueur au ${shown(entry.date)}` : entry.inForce === false ? `Non en vigueur au ${shown(entry.date)}` : 'Vigueur non contrôlée : date des faits non prouvée' })),
      ...facts.map((fact): ReasoningLogEntry => ({ key: fact.id, step: 'fait', status: fact.status === 'établi' ? 'ok' : 'alerte', subject: fact.variable, text: fact.status === 'établi' ? `Établi : ${shown(fact.value)}` : fact.sources.length && fact.issues.length ? `Inconnu : ${fact.issues[0]}` : 'Inconnu : pièce à rechercher' })),
      ...rules.map((condition): ReasoningLogEntry => ({ key: `${condition.id}:conclusion`, step: 'conclusion', status: condition.status === 'remplie' ? 'ok' : condition.status === 'indéterminée' ? 'neutre' : 'alerte', subject: condition.label, text: `${CONDITION_TEXT[condition.status]}${why(condition.status, condition.dependsOn)}` })),
      { key: `${question.scope}:réponse`, step: 'réponse', status: question.status === 'remplie' || question.status === 'non remplie' ? (question.objectiveStatus === 'hors d’atteinte' ? 'alerte' : 'ok') : question.status === 'bloquée' ? 'alerte' : 'neutre', subject: question.question || question.scope, text: `Réponse : ${ANSWER_TEXT[question.status]}${why(question.status, [resultId])}${question.objectiveStatus ? ` · objectif ${question.objectiveStatus}` : ''}` },
    ];
  });
}

function describeTest(test: ReasoningTestReport) {
  const alerts = test.findings.filter((finding) => finding.level === 'alerte');
  const subjects = [...new Set(alerts.map((finding) => finding.subject))];
  return [
    `Test : ${alerts.length ? `${alerts.length} alerte(s)` : 'aucune alerte'} · ${test.findings.length - alerts.length} vérification(s) conforme(s).`,
    ...subjects.flatMap((subject) => {
      const own = alerts.filter((finding) => finding.subject === subject);
      return own.length === 1 ? [`⚠ ${subject} : ${own[0].text}`] : [`⚠ ${subject} :`, ...own.map((finding) => `  - ${finding.text}`)];
    }),
  ].join('\n');
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
  const snapshot: ReasoningSnapshot = { revision: 0, updatedAt: null, code: printCatala(program), sources, ...evaluation, test: null, demo: true };
  const checks = sources.map((source): ReasoningLogEntry => ({ key: `source:${source.id}`, step: 'source', status: 'ok', subject: source.title, text: verifiedText(source) }));
  return { ...snapshot, test: { at: new Date().toISOString(), findings: [], log: [...checks, ...resolution(snapshot)] } };
}
