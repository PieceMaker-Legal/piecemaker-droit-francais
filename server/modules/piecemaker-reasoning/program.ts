import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type Database from 'better-sqlite3';

import type { ReasoningIssue, ReasoningLogEntry, ReasoningPieceReliability, ReasoningSnapshot, ReasoningStatus, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import { compile, decisive, reachableLeaves, runTrials, structure } from './engine.js';
import type { Facts, Trace } from './engine.js';
import { LiteralError, parseLiteral, printLiteral, readReasoning, stripAnnotations } from './format.js';
import type { Basis, Condition, Ref } from './format.js';

export type SourceInfo = { kind: 'texte' | 'decision' | 'piece'; title: string; text: string; validity?: { from: string; to: string | null } };

export type ReasoningConnectors = {
  source(cwd: string, id: string): Promise<SourceInfo | null | undefined>;
  match(text: string, excerpt: string): string | null;
  registry(query: { siren: string | null; name: string | null }): Promise<{ found: boolean; status: string }>;
  bodacc(siren: string): Promise<string[]>;
};

export type Person = { label: string; kind: string; siren: string | null; name: string | null };

export const REASONING_FILE = path.join('.piecemaker', 'raisonnement.js');

const LEGACY_TABLES = ['pm_reasoning_items', 'pm_reasoning_models', 'pm_reasoning_results', 'pm_reasoning_nodes', 'pm_reasoning_relations', 'pm_reasoning_links', 'pm_reasoning_theories', 'pm_reasoning_tests', 'pm_reasoning_turns'];
const emptySnapshot = (): ReasoningSnapshot => ({ revision: 0, updatedAt: null, code: '', annotated: null, issues: [], dismissed: [], reliability: [], test: null });
const human = (name: string) => { const text = name.replace(/_/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); };
const listing = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names.join(''));
const day = (value: string) => value.split('-').reverse().join('/');
const ANSWER: Record<ReasoningStatus, string> = { acquis: 'Oui', exclu: 'Non', 'à établir': 'En suspens', contesté: 'Contestée' };
const issueId = (kind: string, at: string, text: string) => createHash('sha256').update(`${kind}\0${at}\0${text}`).digest('hex').slice(0, 10);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const STATUS = (value: ReasoningValue): ReasoningStatus => (value === true ? 'acquis' : value === false ? 'exclu' : 'à établir');
const inForce = (date: string, from: string, to: string | null): boolean => from <= date && (to === null || date < to);

function node(root: Record<string, unknown>, at: string): Record<string, unknown> | null {
  let current: unknown = root;
  for (const part of at.match(/[^.[\]]+|\[\d+\]/g) ?? []) {
    if (part.startsWith('[')) current = Array.isArray(current) ? current[Number(part.slice(1, -1))] : undefined;
    else current = isObject(current) ? current[part] : undefined;
  }
  return isObject(current) ? current : null;
}

export type Verification = { annotated: Record<string, unknown> | null; issues: ReasoningIssue[]; code: string; log: ReasoningLogEntry[] };

export async function verifyReasoning(input: {
  code: string;
  cwd: string;
  connectors: ReasoningConnectors;
  reliability: Map<string, boolean>;
  nature: (piece: string) => string | null;
  persons: Person[];
  dismissed: Set<string>;
  online?: boolean;
  emit?: (entry: ReasoningLogEntry) => void;
}): Promise<Verification> {
  const { connectors, cwd } = input;
  const issues: ReasoningIssue[] = [];
  const log: ReasoningLogEntry[] = [];
  const emit = (entry: ReasoningLogEntry) => { const index = log.findIndex((item) => item.key === entry.key); if (index >= 0) log[index] = entry; else log.push(entry); input.emit?.(entry); };
  const issueAt = (at: string) => issues.filter((issue) => issue.path === at || issue.path.startsWith(`${at}.`)).map((issue) => issue.text);
  let lines = new Map<string, number>();
  const add = (kind: ReasoningIssue['kind'], at: string, text: string) => {
    const id = issueId(kind, at, text);
    if (!issues.some((issue) => issue.id === id)) issues.push({ id, kind, path: at, line: lines.get(at) ?? lines.get(at.replace(/\.[^.[\]]+$/, '')) ?? null, text });
  };

  let parsed;
  try { parsed = parseLiteral(input.code); } catch (error) {
    if (!(error instanceof LiteralError)) throw error;
    emit({ key: 'lecture', step: 'réponse', status: 'alerte', subject: 'Fichier illisible', text: error.message });
    return { annotated: null, issues: [{ id: issueId('erreur', '', error.message), kind: 'erreur', path: '', line: error.line, text: error.message }], code: input.code, log };
  }
  lines = parsed.lines;
  const stripped = stripAnnotations(parsed.value);
  const { reasoning, problems } = readReasoning(stripped);
  for (const entry of problems) add('erreur', entry.path, entry.text);
  if (!isObject(stripped)) return { annotated: null, issues, code: input.code, log };
  const annotated = stripped;

  const shape = structure(reasoning);
  for (const cycle of shape.cycles) add('erreur', cycle.split(' → ')[0], `boucle : ${cycle}`);
  reasoning.questions.forEach((question, index) => {
    if (!reasoning.terms.has(question.reponse)) add('erreur', `questions[${index}].reponse`, `terme ${question.reponse} non défini : écris ${question.reponse}: { si: [...] }`);
    if (!question.date) add('manque', `questions[${index}]`, 'date d’application non renseignée : ajoute date: { valeur: \'AAAA-MM-JJ\', preuve: [{ piece, citation }] }');
    else if (!question.date.preuve.length) add('manque', `questions[${index}].date`, 'date non justifiée : ajoute preuve: [{ piece, citation }]');
  });
  const roots = new Set(reasoning.questions.map((question) => question.reponse));
  for (const name of reasoning.terms.keys()) if (!roots.has(name) && !shape.used.has(name)) add('manque', name, 'terme qui ne sert à aucune question : rattache-le comme condition ou ajoute la question à laquelle il répond');

  const sources = new Map<string, Promise<SourceInfo | null | undefined>>();
  const lookup = (id: string) => {
    if (!sources.has(id)) sources.set(id, connectors.source(cwd, id).catch(() => null));
    return sources.get(id)!;
  };
  const corrections = new Map<string, string>();
  const checkCitation = (at: string, holder: Record<string, unknown> | null, info: SourceInfo, citation: string) => {
    const matched = connectors.match(info.text, citation);
    if (!matched) { add('erreur', at, `citation introuvable dans ${info.title} : recopie le passage exact`); return false; }
    if (matched !== citation) {
      corrections.set(citation, matched);
      if (holder) Object.assign(holder, { citation: matched, corrigee: true, citation_d_origine: citation });
    }
    return true;
  };

  const verifiedRefs = new Map<string, boolean>();
  const checkRef = async (at: string, ref: Ref) => {
    const holder = node(annotated, at);
    emit({ key: `piece:${ref.piece}:${ref.citation}`, step: 'pièce', status: 'en cours', subject: ref.piece, text: 'Relecture de la pièce…' });
    const info = await lookup(ref.piece);
    if (!info) { add('erreur', `${at}.piece`, `pièce introuvable dans le dossier : ${ref.piece}`); verifiedRefs.set(at, false); emit({ key: `piece:${ref.piece}:${ref.citation}`, step: 'pièce', status: 'alerte', subject: ref.piece, text: 'Pièce introuvable dans le dossier' }); return; }
    const ok = checkCitation(at, holder, info, ref.citation);
    const reliable = input.reliability.get(ref.piece);
    const nature = input.nature(ref.piece);
    const cited = String(holder?.citation ?? ref.citation);
    const personnes = input.persons.filter((person) => cited.includes(person.label)).map((person) => person.label);
    if (holder) Object.assign(holder, { titre: info.title, ...(nature ? { nature } : {}), fiable: reliable ?? null, ...(personnes.length ? { personnes } : {}) });
    verifiedRefs.set(at, ok && reliable !== false);
    emit({ key: `piece:${ref.piece}:${ref.citation}`, step: 'pièce', status: ok && reliable !== false ? 'ok' : 'alerte', subject: info.title, text: !ok ? `Citation introuvable : « ${ref.citation} »` : reliable === false ? 'Pièce marquée non fiable : ignorée' : `« ${String(holder?.citation ?? ref.citation)} »${reliable === undefined ? ' · fiabilité à évaluer' : ''}` });
  };

  type BasisCheck = { kind: SourceInfo['kind'] | null; from: string | null; to: string | null };
  const basisChecks = new Map<string, BasisCheck>();
  const checkBasis = async (at: string, basis: Basis) => {
    const holder = node(annotated, at);
    const key = `source:${basis.source}:${basis.citation}`;
    emit({ key, step: 'source', status: 'en cours', subject: basis.source, text: 'Consultation de la source…' });
    await checkBasisInner(at, basis, holder);
    const title = String(holder?.titre ?? basis.source);
    const problems = issueAt(at);
    const check = basisChecks.get(at);
    emit({ key, step: 'source', status: problems.some((text) => !text.startsWith('vigueur non') && !text.startsWith('source non vérifiable')) ? 'alerte' : problems.length ? 'neutre' : 'ok', subject: title, text: problems.length ? problems.join(' · ') : `« ${String(holder?.citation ?? basis.citation)} »${check?.kind === 'decision' ? '' : check?.from ? check.to ? ` · en vigueur du ${day(check.from)} au ${day(check.to)}` : ` · en vigueur depuis le ${day(check.from)}` : ''}` });
  };
  const checkBasisInner = async (at: string, basis: Basis, holder: Record<string, unknown> | null) => {
    const info = await lookup(basis.source);
    if (info === undefined) {
      add('manque', `${at}.source`, `source non vérifiable automatiquement : aucun connecteur pour ${basis.source}`);
      basisChecks.set(at, { kind: 'texte', from: basis.vigueur?.debut ?? null, to: basis.vigueur?.fin ?? null });
      if (!basis.vigueur) add('manque', `${at}.vigueur`, 'vigueur non renseignée : ajoute vigueur: { debut, fin }');
      return;
    }
    if (info === null) { add('erreur', `${at}.source`, `source introuvable : ${basis.source}`); basisChecks.set(at, { kind: null, from: null, to: null }); return; }
    if (holder) holder.titre = info.title;
    checkCitation(at, holder, info, basis.citation);
    if (info.kind === 'decision') { basisChecks.set(at, { kind: 'decision', from: null, to: null }); return; }
    if (!basis.vigueur) add('manque', `${at}.vigueur`, `vigueur non renseignée : ajoute vigueur: { debut, fin }${info.validity ? ` (version citée : debut '${info.validity.from}', fin ${info.validity.to ? `'${info.validity.to}'` : 'null'})` : ''}`);
    else if (info.validity && (basis.vigueur.debut !== info.validity.from || basis.vigueur.fin !== info.validity.to)) add('erreur', `${at}.vigueur`, `vigueur différente de la version citée : debut '${info.validity.from}', fin ${info.validity.to ? `'${info.validity.to}'` : 'null'}`);
    const known = Boolean(info.validity || basis.vigueur);
    basisChecks.set(at, { kind: info.kind, from: known ? info.validity?.from ?? basis.vigueur!.debut : null, to: info.validity ? info.validity.to : basis.vigueur?.fin ?? null });
  };

  const occurrences: Array<{ at: string; condition: Condition }> = [];
  const walk = (condition: Condition, at: string) => {
    occurrences.push({ at, condition });
    condition.l_une?.forEach((member, index) => walk(member, `${at}.l_une[${index}]`));
  };
  for (const [name, term] of reasoning.terms) {
    term.si.forEach((condition, index) => walk(condition, `${name}.si[${index}]`));
    term.sauf.forEach((condition, index) => walk(condition, `${name}.sauf[${index}]`));
  }
  const checks: Array<Promise<void>> = [];
  for (const { at, condition } of occurrences) {
    condition.selon.forEach((basis, index) => checks.push(checkBasis(`${at}.selon[${index}]`, basis)));
    condition.preuve.forEach((ref, index) => checks.push(checkRef(`${at}.preuve[${index}]`, ref)));
    condition.contredit.forEach((ref, index) => checks.push(checkRef(`${at}.contredit[${index}]`, ref)));
  }
  reasoning.questions.forEach((question, index) => question.date?.preuve.forEach((ref, at) => checks.push(checkRef(`questions[${index}].date.preuve[${at}]`, ref))));
  await Promise.all(checks);

  const evidence = new Map<string, { pro: boolean; con: boolean }>();
  for (const { at, condition } of occurrences) {
    if (!condition.condition || reasoning.terms.has(condition.condition)) continue;
    const entry = evidence.get(condition.condition) ?? { pro: false, con: false };
    entry.pro ||= condition.preuve.some((_, index) => verifiedRefs.get(`${at}.preuve[${index}]`));
    entry.con ||= condition.contredit.some((_, index) => verifiedRefs.get(`${at}.contredit[${index}]`));
    evidence.set(condition.condition, entry);
  }
  const leafValue = (name: string): ReasoningValue => {
    const entry = evidence.get(name);
    return !entry || entry.pro === entry.con ? null : entry.pro;
  };
  const contested = (name: string) => Boolean(evidence.get(name)?.pro && evidence.get(name)?.con);

  const basisValue = (date: string | null, at: string, condition: Condition): ReasoningValue => {
    if (!condition.selon.length) return true;
    const relevant = condition.selon.map((_, index) => basisChecks.get(`${at}.selon[${index}]`)).filter((check): check is BasisCheck => Boolean(check && check.kind !== 'decision'));
    if (!relevant.length) return condition.selon.some((_, index) => basisChecks.get(`${at}.selon[${index}]`)?.kind === 'decision') ? true : null;
    const values = relevant.map((check): ReasoningValue => (date && check.from ? inForce(date, check.from, check.to) : null));
    return values.includes(true) ? true : values.includes(null) ? null : false;
  };

  const test = compile(reasoning);
  const statuses = new Map<string, ReasoningValue>();
  const vigueurs = new Map<string, ReasoningValue>();
  const decisiveLeaves = new Set<string>();
  const firstDate = reasoning.questions.find((question) => question.date)?.date?.valeur ?? null;
  reasoning.questions.forEach((question, index) => {
    if (!reasoning.terms.has(question.reponse) || shape.cycles.length) return;
    const date = question.date?.valeur ?? null;
    const facts: Facts = { leaf: leafValue, basis: (at, condition) => { const value = basisValue(date, at, condition); if (!vigueurs.has(at)) vigueurs.set(at, value); return value; } };
    const trace: Trace = new Map();
    const value = test(facts, trace, [question.reponse]).get(question.reponse) ?? null;
    for (const [key, item] of trace) if (!statuses.has(key)) statuses.set(key, item);
    const unknown = [...reachableLeaves(reasoning, question.reponse)].filter((name) => leafValue(name) === null).sort();
    const found = value === null ? decisive(test, facts, question.reponse, unknown) : { decisive: [], inPlay: false };
    for (const name of found.decisive) decisiveLeaves.add(name);
    const holder = node(annotated, `questions[${index}]`);
    const personnes = input.persons.filter((person) => question.question.includes(person.label)).map((person) => person.label);
    if (holder) Object.assign(holder, { statut: STATUS(value), ...(found.decisive.length ? { [found.inPlay ? 'en_jeu' : 'decisifs']: found.decisive } : {}), ...(personnes.length ? { personnes } : {}) });
  });

  for (const { at, condition } of occurrences) {
    const holder = node(annotated, at);
    if (!holder) continue;
    const leaf = condition.condition && !reasoning.terms.has(condition.condition) ? condition.condition : null;
    holder.statut = leaf && contested(leaf) ? 'contesté' : STATUS(statuses.get(at) ?? null);
    if (leaf && decisiveLeaves.has(leaf)) {
      holder.decisif = true;
      add('manque', at, `${leaf} décide de la réponse : ajoute preuve ou contredit, ou précise ce terme par son propre bloc`);
    }
    if (condition.selon.length && vigueurs.get(at) === false) add('erreur', at, 'aucune source de cette condition n’est en vigueur à la date d’application');
    condition.selon.forEach((_, index) => {
      const check = basisChecks.get(`${at}.selon[${index}]`);
      const source = node(annotated, `${at}.selon[${index}]`);
      if (source && check?.kind && check.kind !== 'decision') source.en_vigueur = firstDate && check.from ? inForce(firstDate, check.from, check.to) : null;
    });
  }
  for (const name of reasoning.terms.keys()) { const holder = node(annotated, name); if (holder) holder.statut = STATUS(statuses.get(name) ?? null); }
  for (const name of [...shape.leaves].sort()) {
    const entry = evidence.get(name);
    const value = leafValue(name);
    const cited = (field: 'preuve' | 'contredit') => [...new Set(occurrences.filter((item) => item.condition.condition === name).flatMap((item) => item.condition[field].map((_, index) => `${item.at}.${field}[${index}]`)).filter((at) => verifiedRefs.get(at)).map((at) => String(node(annotated, at)?.titre ?? '')))].filter(Boolean).join(', ');
    emit({ key: `fait:${name}`, step: 'fait', status: value === null ? (decisiveLeaves.has(name) ? 'alerte' : 'neutre') : 'ok', subject: human(name), text: contested(name) ? 'Contesté : une pièce le prouve, une autre le contredit' : value === true ? `Prouvé par ${cited('preuve')}` : value === false ? `Contredit par ${cited('contredit')}` : `${entry ? 'Les pièces citées ne l’établissent pas' : 'Aucune pièce citée'}${decisiveLeaves.has(name) ? ' · décisif' : ''}` });
  }
  for (const name of reasoning.terms.keys()) emit({ key: `terme:${name}`, step: 'condition', status: statuses.get(name) === null || statuses.get(name) === undefined ? 'neutre' : 'ok', subject: human(name), text: STATUS(statuses.get(name) ?? null) });

  const trials = shape.cycles.length ? [] : runTrials(reasoning, test);
  trials.forEach((result, index) => {
    const holder = node(annotated, `essais[${index}]`);
    if (holder) Object.assign(holder, result);
    emit({ key: `essai:${index}`, step: 'essai', status: result.conforme ? 'ok' : 'alerte', subject: reasoning.essais[index].nom, text: result.conforme ? 'Conforme' : `Non conforme : obtenu ${Object.entries(result.obtenu).map(([name, value]) => `${human(name)} = ${value === null ? 'à établir' : value ? 'vrai' : 'faux'}`).join(', ')}` });
    if (!result.conforme) add('erreur', `essais[${index}]`, `essai non conforme : obtenu ${Object.entries(result.obtenu).map(([name, value]) => `${name} = ${value === null ? 'à établir' : value ? 'vrai' : 'faux'}`).join(', ')}`);
  });

  const registre: string[] = [];
  if (input.online) {
    const cited = new Set<string>();
    const collect = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (isObject(value)) for (const [key, item] of Object.entries(value)) { if (key === 'personnes' && Array.isArray(item)) item.forEach((label) => cited.add(String(label))); else collect(item); }
    };
    collect(annotated);
    for (const person of input.persons.filter((entry) => entry.kind === 'company' && cited.has(entry.label))) {
      try {
        const siren = person.siren?.replace(/\D/g, '').slice(0, 9) || null;
        const record = await connectors.registry({ siren, name: person.name ?? person.label });
        registre.push(`${person.label} : ${record.found ? record.status || 'trouvée au Registre Public' : 'introuvable au Registre Public'}`);
        emit({ key: `registre:${person.label}`, step: 'registre', status: record.found && !/radi|cess|ferm|liquid|dissou/i.test(record.status) ? 'ok' : 'alerte', subject: person.label, text: record.found ? record.status || 'Trouvée au Registre Public' : 'Introuvable au Registre Public' });
        if (siren) for (const alert of await connectors.bodacc(siren)) registre.push(`${person.label} : BODACC ${alert}`);
      } catch (error) { registre.push(`${person.label} : vérification impossible (${error instanceof Error ? error.message : 'erreur'})`); }
    }
  }

  const visible = issues.filter((issue) => !input.dismissed.has(issue.id));
  for (const issue of visible) {
    const holder = issue.path ? node(annotated, issue.path.replace(/\.(piece|source|vigueur|reponse)$/, '')) : null;
    const key = issue.kind === 'erreur' ? 'erreurs' : 'manques';
    if (holder) holder[key] = [...(holder[key] as string[] | undefined ?? []), issue.text];
  }
  const general = visible.filter((issue) => !issue.path || !node(annotated, issue.path.replace(/\.(piece|source|vigueur|reponse)$/, '')));
  const unrated = [...new Set([...verifiedRefs.keys()].map((at) => node(annotated, at)?.piece).filter((piece): piece is string => typeof piece === 'string' && !input.reliability.has(piece)))];
  const bilan = {
    erreurs: visible.filter((issue) => issue.kind === 'erreur').length,
    manques: visible.filter((issue) => issue.kind === 'manque').length,
    ...(trials.length ? { essais: `${trials.filter((trial) => trial.conforme).length}/${trials.length}` } : {}),
    ecartees: issues.length - visible.length,
    ...(general.length ? { alertes: general.map((issue) => `${issue.path ? `${issue.path} : ` : ''}${issue.text}`) } : {}),
    ...(unrated.length ? { pieces_a_evaluer_par_l_avocat: unrated } : {}),
    ...(registre.length ? { registre } : {}),
  };

  reasoning.questions.forEach((question, index) => {
    const holder = node(annotated, `questions[${index}]`);
    const decisifs = (holder?.decisifs ?? holder?.en_jeu ?? []) as string[];
    emit({ key: `réponse:${index}`, step: 'réponse', status: holder?.statut === 'à établir' ? 'neutre' : bilan.erreurs ? 'alerte' : 'ok', subject: question.question, text: `${holder?.statut ? ANSWER[holder.statut as ReasoningStatus] : 'Non calculée'}${decisifs.length ? ` : dépend de ${listing(decisifs.map((name) => human(name).toLowerCase()))}` : ''}${bilan.erreurs ? ` · ${bilan.erreurs} erreur${bilan.erreurs > 1 ? 's' : ''} à corriger` : ''}` });
  });
  let code = input.code;
  for (const [original, fixed] of corrections) code = code.split(original).join(fixed);
  return { annotated: { bilan, ...annotated }, issues, code, log };
}

type PersonRow = { label: string; kind: string; name: string | null; siren: string | null };

export function createReasoningService(getDatabase: () => Database.Database, connectors: ReasoningConnectors) {
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
        CREATE TABLE IF NOT EXISTS pm_reasoning_dismissed (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          issue_id TEXT NOT NULL, path TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL,
          PRIMARY KEY(project_id, issue_id)
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_reliability (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          piece TEXT NOT NULL, reliable INTEGER NOT NULL CHECK(reliable IN (0,1)), at TEXT NOT NULL,
          PRIMARY KEY(project_id, piece)
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

  const hasGraph = () => Boolean(database().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='piecemaker_nodes'").get());
  const persons = (id: string): Person[] => (hasGraph() ? database().prepare(`SELECT n.label, n.kind,
      (SELECT m.real_value FROM piecemaker_mappings m WHERE m.project_id=n.project_id AND m.node_id=n.id LIMIT 1) AS name,
      (SELECT COALESCE((SELECT m.real_value FROM piecemaker_mappings m WHERE m.project_id=s.project_id AND m.node_id=s.id LIMIT 1), s.label)
         FROM piecemaker_links l JOIN piecemaker_nodes s ON s.project_id=l.project_id AND s.id=l.to_node_id
         WHERE l.project_id=n.project_id AND l.from_node_id=n.id AND s.kind='siren' LIMIT 1) AS siren
    FROM piecemaker_nodes n WHERE n.project_id=? AND n.kind IN ('person','company') AND length(n.label) > 2`).all(id) as PersonRow[] : []);
  const nature = (id: string) => (piece: string) => {
    if (!hasGraph()) return null;
    const row = database().prepare("SELECT json_extract(data_json,'$.nature') AS nature FROM piecemaker_nodes WHERE project_id=? AND kind='document' AND label=? LIMIT 1").get(id, path.basename(piece)) as { nature: string | null } | undefined;
    return row?.nature ?? null;
  };
  const reliability = (id: string): ReasoningPieceReliability[] => (database().prepare('SELECT piece, reliable, at FROM pm_reasoning_reliability WHERE project_id=? ORDER BY piece').all(id) as Array<{ piece: string; reliable: number; at: string }>).map((row) => ({ piece: row.piece, reliable: row.reliable === 1, at: row.at }));
  const dismissed = (id: string) => database().prepare('SELECT issue_id AS id, path, text, at FROM pm_reasoning_dismissed WHERE project_id=? ORDER BY at').all(id) as ReasoningSnapshot['dismissed'];

  const read = (cwd: string): ReasoningSnapshot => {
    const id = projectId(cwd);
    const row = database().prepare('SELECT snapshot_json FROM pm_reasoning_programs WHERE project_id=?').get(id) as { snapshot_json: string } | undefined;
    const parsed = row ? JSON.parse(row.snapshot_json) as Partial<ReasoningSnapshot> : {};
    const stored = 'annotated' in parsed ? parsed : {};
    return { ...emptySnapshot(), ...stored, dismissed: dismissed(id), reliability: reliability(id) };
  };

  const verify = async (cwd: string, online = true, emit?: (entry: ReasoningLogEntry) => void): Promise<ReasoningSnapshot> => {
    const id = projectId(cwd);
    const file = path.join(cwd, REASONING_FILE);
    const code = await readFile(file, 'utf8').catch(() => null);
    if (code === null) throw new TypeError(`Aucun raisonnement : écris ${REASONING_FILE} (objet { questions: [...], terme: { si: [...] } }), puis relance verifier.`);
    const result = await verifyReasoning({
      code, cwd, connectors, online, emit,
      reliability: new Map(reliability(id).map((entry) => [entry.piece, entry.reliable])),
      nature: nature(id),
      persons: persons(id),
      dismissed: new Set(dismissed(id).map((entry) => entry.id)),
    });
    if (result.code !== code) await writeFile(file, result.code, 'utf8');
    const previous = read(cwd);
    const snapshot: ReasoningSnapshot = { ...previous, revision: previous.revision + 1, updatedAt: new Date().toISOString(), code: result.code, annotated: result.annotated, issues: result.issues, test: { at: new Date().toISOString(), log: result.log } };
    const { dismissed: _dismissed, reliability: _reliability, ...stored } = snapshot;
    database().prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision, code=excluded.code, snapshot_json=excluded.snapshot_json').run(id, snapshot.revision, snapshot.code, JSON.stringify(stored));
    return snapshot;
  };

  database();
  return {
    read,
    verify,
    test: (cwd: string, emit: (entry: ReasoningLogEntry) => void) => verify(cwd, true, emit),
    async command(cwd: string, input: { commande?: unknown }): Promise<string> {
      if (input.commande !== undefined && input.commande !== 'verifier') throw new TypeError('Commande : verifier.');
      return describeReasoning(await verify(cwd));
    },
    async dismiss(cwd: string, issue: string, restore = false): Promise<ReasoningSnapshot> {
      const id = projectId(cwd);
      if (restore) database().prepare('DELETE FROM pm_reasoning_dismissed WHERE project_id=? AND issue_id=?').run(id, issue);
      else {
        const found = read(cwd).issues.find((entry) => entry.id === issue);
        if (!found) throw new TypeError('Alerte introuvable.');
        database().prepare('INSERT OR REPLACE INTO pm_reasoning_dismissed VALUES(?,?,?,?,?)').run(id, issue, found.path, found.text, new Date().toISOString());
      }
      return verify(cwd, false);
    },
    async rate(cwd: string, piece: string, reliable: boolean | null): Promise<ReasoningSnapshot> {
      const id = projectId(cwd);
      if (typeof piece !== 'string' || !piece.trim()) throw new TypeError('Pièce requise.');
      if (reliable === null) database().prepare('DELETE FROM pm_reasoning_reliability WHERE project_id=? AND piece=?').run(id, piece);
      else database().prepare('INSERT OR REPLACE INTO pm_reasoning_reliability VALUES(?,?,?,?)').run(id, piece, reliable ? 1 : 0, new Date().toISOString());
      return verify(cwd, false);
    },
  };
}

export function describeReasoning(snapshot: Pick<ReasoningSnapshot, 'annotated' | 'issues'>) {
  if (snapshot.annotated) return printLiteral(snapshot.annotated);
  return ['Raisonnement illisible :', ...snapshot.issues.map((issue) => `- ${issue.text}`)].join('\n');
}

export const EXAMPLE_CODE = `{
  questions: [
    {
      question: \`La pénalité de retard est-elle due par Société Beta SARL ?\`,
      reponse: 'pénalité_encourue',
      date: { valeur: '2025-06-14', preuve: [{ piece: 'pieces/05_bon_de_livraison.md', citation: \`Livré le 14/06/2025\` }] },
    },
  ],
  pénalité_encourue: {
    si: [
      { condition: 'pénalité_stipulée',
        selon: [{ source: 'LEGIARTI000000000005', citation: \`la pénalité n'est encourue que lorsque le débiteur est mis en demeure\`, vigueur: { debut: '2016-10-01', fin: null } }] },
      { l_une: [
          { condition: 'mise_en_demeure', preuve: [{ piece: 'pieces/06_mise_en_demeure.md', citation: \`vous met en demeure\` }] },
          { condition: 'inexécution_définitive' },
        ],
        selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\`, vigueur: { debut: '2016-10-01', fin: null } }] },
    ],
  },
  pénalité_stipulée: {
    si: [
      { condition: 'retard_de_livraison',
        selon: [{ source: 'pieces/01_contrat.md', citation: \`En cas de retard de livraison\`, vigueur: { debut: '2024-01-15', fin: null } }],
        preuve: [{ piece: 'pieces/05_bon_de_livraison.md', citation: \`Livré le 14/06/2025\` }] },
    ],
    sauf: [
      { condition: 'force_majeure_contractuelle',
        selon: [{ source: 'pieces/01_contrat.md', citation: \`sauf force majeure au sens de l'article 12\`, vigueur: { debut: '2024-01-15', fin: null } }] },
    ],
  },
  force_majeure_contractuelle: {
    si: [
      { l_une: [{ condition: 'force_majeure' }, { condition: 'grève' }],
        selon: [{ source: 'pieces/01_contrat.md', citation: \`ainsi que les grèves\`, vigueur: { debut: '2024-01-15', fin: null } }] },
    ],
  },
  grève: {
    si: [
      { l_une: [
          { condition: 'grève_nationale' },
          { condition: 'grève_du_secteur', contredit: [{ piece: 'pieces/07_courriel.md', citation: \`mouvement limité à notre atelier\` }] },
        ],
        selon: [{ source: 'pieces/01_contrat.md', citation: \`grève nationale ou propre au secteur\`, vigueur: { debut: '2024-01-15', fin: null } }] },
    ],
  },
  essais: [
    { nom: \`grève nationale : pas de pénalité\`, faits: { retard_de_livraison: vrai, mise_en_demeure: vrai, grève_nationale: vrai }, attendu: { pénalité_encourue: faux } },
  ],
}
`;

export const EXAMPLE_SOURCES: Record<string, SourceInfo> = {
  LEGIARTI000000000005: { kind: 'texte', title: 'Code civil fictif, article 1231-5', text: 'Sauf inexécution définitive, la pénalité n\'est encourue que lorsque le débiteur est mis en demeure.', validity: { from: '2016-10-01', to: null } },
  'pieces/01_contrat.md': { kind: 'piece', title: 'Contrat de prestation (fictif)', text: 'Article 1. Grève : grève nationale ou propre au secteur. Article 8. En cas de retard de livraison, une pénalité est due, sauf force majeure au sens de l\'article 12. Article 12. Constituent des cas de force majeure les événements de l\'article 1218, ainsi que les grèves.' },
  'pieces/05_bon_de_livraison.md': { kind: 'piece', title: 'Bon de livraison (fictif)', text: 'Société Beta SARL. Livré le 14/06/2025.' },
  'pieces/06_mise_en_demeure.md': { kind: 'piece', title: 'Mise en demeure (fictive)', text: 'La présente vous met en demeure de livrer.' },
  'pieces/07_courriel.md': { kind: 'piece', title: 'Courriel (fictif)', text: 'Le mouvement limité à notre atelier a duré deux jours.' },
};

export async function reasoningExample(): Promise<ReasoningSnapshot> {
  const result = await verifyReasoning({
    code: EXAMPLE_CODE, cwd: '',
    connectors: {
      source: async (_cwd, id) => EXAMPLE_SOURCES[id] ?? null,
      match: (text, excerpt) => (text.includes(excerpt) ? excerpt : null),
      registry: async () => ({ found: true, status: '' }),
      bodacc: async () => [],
    },
    reliability: new Map(), nature: () => null,
    persons: [{ label: 'Société Beta SARL', kind: 'company', name: null, siren: null }],
    dismissed: new Set(),
  });
  return { ...emptySnapshot(), code: result.code, annotated: result.annotated, issues: result.issues, test: { at: new Date().toISOString(), log: result.log }, demo: true };
}
