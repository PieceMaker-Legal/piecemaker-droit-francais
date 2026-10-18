import { createHash } from 'node:crypto';

import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningHistory, ReasoningPeriod, ReasoningSnapshot, ReasoningSource, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import { CATALA_TYPES, parseCatala, printValue } from './catala.js';
import type { Expression } from './catala.js';
import { isLegalDate } from './legal-period.js';

export type ReasoningConnectors = {
  law(id: string): Promise<{ title: string; text: string; validity?: ReasoningPeriod; history?: ReasoningHistory }>;
  piece(cwd: string, ref: string): Promise<{ title: string; text: string } | null>;
  match(text: string, excerpt: string): string | null;
  registry(query: { siren: string | null; name: string | null }): Promise<{ found: boolean; status: string }>;
  bodacc(siren: string): Promise<string[]>;
};

type Role = 'condition' | 'fondement' | 'moyen_adverse';
type ModelQuestion = { id: string; question: string; objective: boolean | null; date: string | null };
type ModelCondition = { question: string; name: string; label: string; rule: string; role: Role; sources: string[]; date: string | null };
type ModelFact = { question: string; name: string; type: string; value: ReasoningValue; sources: string[]; force: string | null; appreciation: string };
export type ReasoningModel = { questions: ModelQuestion[]; conditions: ModelCondition[]; facts: ModelFact[] };

export type ReasoningCommand = {
  commande?: unknown; question?: unknown; texte?: unknown; objectif?: unknown; date?: unknown;
  nom?: unknown; libelle?: unknown; regle?: unknown; role?: unknown; source?: unknown; extrait?: unknown; a_la_date?: unknown;
  type?: unknown; valeur?: unknown; piece?: unknown; force?: unknown; appreciation?: unknown;
};

export function sourceId(document: string, excerpt: string) {
  return `s${createHash('sha256').update(`${document}\0${excerpt}`).digest('hex').slice(0, 8)}`;
}

export const emptyModel = (): ReasoningModel => ({ questions: [], conditions: [], facts: [] });

const RESERVED = new Set(['reponse', 'et', 'ou', 'non', 'si', 'alors', 'sinon', 'vrai', 'faux', 'rempli', 'condition', 'champ', 'règle', 'définition']);
const FACT_TYPES = CATALA_TYPES.filter((type) => type !== 'condition');

const text = (value: unknown, field: string, max = 2000) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} requis.`);
  if (value.length > max) throw new TypeError(`${field} trop long.`);
  return value.trim();
};
const optional = (value: unknown, field: string, max = 2000) => (value === undefined || value === null || value === '' ? null : text(value, field, max));
const identifier = (value: unknown, field = 'nom') => {
  const name = text(value, field, 80);
  if (!/^[a-z][a-z0-9_]*$/.test(name) || RESERVED.has(name)) throw new TypeError(`${field} : minuscules, chiffres et _ (ex. societe_cotee).`);
  return name;
};

function names(expression: Expression | undefined, found = new Set<string>()): Set<string> {
  if (!expression) return found;
  if (expression.t === 'var') found.add(expression.path.join('.'));
  else if (expression.t === 'not' || expression.t === 'neg') names(expression.e, found);
  else if (expression.t === 'bin') { names(expression.l, found); names(expression.r, found); }
  else if (expression.t === 'if') { names(expression.c, found); names(expression.a, found); names(expression.b, found); }
  return found;
}

function ruleNames(rule: string) {
  try {
    const program = parseCatala(`déclaration champ d'application T:\n  résultat x condition\nchamp d'application T:\n  règle x sous condition ${rule} conséquence rempli\n`);
    return [...names(program.bodies[0]?.rules[0]?.condition)];
  } catch (error) {
    throw new TypeError(`Règle illisible : ${error instanceof Error ? error.message.replace(/^Ligne \d+ : /, '') : 'syntaxe'} Syntaxe : et, ou, non, = != < <= > >=, vrai, faux, |AAAA-MM-JJ|, 2 mois.`);
  }
}

function parseValue(value: unknown, type: string): ReasoningValue {
  if (value === undefined || value === null || value === '') return null;
  if (type === 'booléen') {
    if (typeof value === 'boolean') return value;
    if (value === 'vrai' || value === 'oui') return true;
    if (value === 'faux' || value === 'non') return false;
  } else if (type === 'date') {
    if (isLegalDate(value)) return value;
  } else if (type === 'durée') {
    const match = typeof value === 'string' ? /^(\d+) (an|ans|mois|jour|jours)$/.exec(value.trim()) : null;
    if (match) return { ans: 0, mois: 0, jours: 0, [match[2].startsWith('an') ? 'ans' : match[2] === 'mois' ? 'mois' : 'jours']: Number(match[1]) };
  } else {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.').replace(/\s/g, '')) : NaN;
    if (Number.isFinite(number) && (type !== 'entier' || Number.isInteger(number))) return number;
  }
  throw new TypeError(`Valeur de type ${type} attendue${type === 'date' ? ' (AAAA-MM-JJ)' : type === 'durée' ? ' (ex. 2 mois)' : ''}.`);
}

const question = (model: ReasoningModel, value: unknown) => {
  const id = text(value, 'question', 20);
  const found = model.questions.find((entry) => entry.id === id);
  if (!found) throw new TypeError(`Question inconnue : ${id}. Questions : ${model.questions.map((entry) => entry.id).join(', ') || 'aucune (commande question)'}.`);
  return found;
};

const declareFact = (model: ReasoningModel, scope: string, name: string, type = 'booléen') => {
  if (model.conditions.some((entry) => entry.question === scope && entry.name === name)) return;
  if (!model.facts.some((entry) => entry.question === scope && entry.name === name)) model.facts.push({ question: scope, name, type, value: null, sources: [], force: null, appreciation: '' });
};

const pruneFacts = (model: ReasoningModel) => {
  const used = new Set([
    ...model.conditions.flatMap((entry) => ruleNames(entry.rule).map((name) => `${entry.question}.${name}`)),
    ...model.questions.flatMap((entry) => (entry.date ? [`${entry.id}.${entry.date}`] : [])),
    ...model.conditions.flatMap((entry) => (entry.date ? [`${entry.question}.${entry.date}`] : [])),
  ]);
  model.facts = model.facts.filter((fact) => used.has(`${fact.question}.${fact.name}`) || fact.value !== null);
};

async function lawSource(cwd: string, reference: string, excerpt: string | null, known: Map<string, ReasoningSource>, connectors: ReasoningConnectors): Promise<ReasoningSource> {
  if (known.has(reference)) return known.get(reference)!;
  if (!excerpt) throw new TypeError('extrait requis : le passage qui pose la condition, recopié mot pour mot.');
  const legal = /^(LEGIARTI|JURITEXT|CETATEXT)\d+$/.exec(reference);
  if (legal) {
    const law = await connectors.law(reference);
    const matched = connectors.match(law.text, excerpt);
    const kind = legal[1] === 'LEGIARTI' ? 'article' : 'case';
    const document = `${kind}:${reference}`;
    return { id: sourceId(document, matched ?? excerpt), kind, document, title: law.title || reference, excerpt: matched ?? excerpt, token: '', verified: Boolean(matched), repaired: Boolean(matched && matched !== excerpt), ...(law.validity ? { validity: law.validity } : {}), ...(law.history ? { history: law.history } : {}) };
  }
  return pieceSource(cwd, reference, excerpt, connectors);
}

async function pieceSource(cwd: string, reference: string, excerpt: string, connectors: ReasoningConnectors): Promise<ReasoningSource> {
  const piece = await connectors.piece(cwd, reference);
  if (!piece) throw new TypeError(`Document introuvable dans le dossier : ${reference}. Article : LEGIARTI…, décision : JURITEXT…, sinon chemin d'une pièce ou d'une note.`);
  const matched = connectors.match(piece.text, excerpt);
  const document = `document:${reference}`;
  return { id: sourceId(document, matched ?? excerpt), kind: 'document', document, title: piece.title, excerpt: matched ?? excerpt, token: '', verified: Boolean(matched), repaired: Boolean(matched && matched !== excerpt) };
}

export async function applyCommand(model: ReasoningModel, sources: ReasoningSource[], locked: Set<string>, cwd: string, input: ReasoningCommand, connectors: ReasoningConnectors): Promise<{ model: ReasoningModel; sources: ReasoningSource[]; focus: string | null; note: string }> {
  const next: ReasoningModel = JSON.parse(JSON.stringify(model));
  const known = new Map(sources.map((source) => [source.id, source]));
  const guard = (id: string) => { if (locked.has(id)) throw new TypeError(`${id} est verrouillé par l'avocat : il ne peut plus être modifié.`); };
  const command = input.commande;
  if (command === 'question') {
    const wording = text(input.texte, 'texte', 500);
    const objective = input.objectif === undefined || input.objectif === null || input.objectif === '' ? null : input.objectif === 'oui' ? true : input.objectif === 'non' ? false : (() => { throw new TypeError('objectif : oui ou non (la réponse que le client recherche).'); })();
    const date = input.date === undefined || input.date === null || input.date === '' ? null : identifier(input.date, 'date');
    let entry = input.question ? question(next, input.question) : undefined;
    if (!entry) next.questions.push(entry = { id: `Q${Math.max(0, ...next.questions.map((item) => Number(item.id.slice(1)))) + 1}`, question: wording, objective, date });
    Object.assign(entry, { question: wording, objective, date });
    if (date) {
      declareFact(next, entry.id, date, 'date');
      const fact = next.facts.find((item) => item.question === entry!.id && item.name === date);
      if (fact) fact.type = 'date';
    }
    return { model: next, sources, focus: entry.id, note: `${entry.id} enregistrée.` };
  }
  if (command === 'condition') {
    const scope = question(next, input.question).id;
    const name = identifier(input.nom);
    guard(`${scope}.${name}`);
    if (next.facts.some((fact) => fact.question === scope && fact.name === name && fact.value !== null)) throw new TypeError(`${name} est déjà un fait prouvé ; choisis un autre nom.`);
    const rule = text(input.regle, 'regle', 1000);
    const role = (input.role ?? 'condition') as Role;
    if (!['condition', 'fondement', 'moyen_adverse'].includes(role)) throw new TypeError('role : condition, fondement ou moyen_adverse.');
    const used = ruleNames(rule);
    if (used.includes(name)) throw new TypeError('Une condition ne peut pas dépendre d’elle-même.');
    const source = await lawSource(cwd, text(input.source, 'source', 500), optional(input.extrait, 'extrait'), known, connectors);
    const date = input.a_la_date ? identifier(input.a_la_date, 'a_la_date') : null;
    next.facts = next.facts.filter((fact) => !(fact.question === scope && fact.name === name));
    const existing = next.conditions.find((entry) => entry.question === scope && entry.name === name);
    const entry: ModelCondition = { question: scope, name, label: text(input.libelle, 'libelle', 300), rule, role, sources: [...new Set([...(existing && existing.rule === rule ? existing.sources : []), source.id])], date };
    next.conditions = [...next.conditions.filter((item) => item !== existing), entry];
    for (const dependency of used) declareFact(next, scope, dependency);
    if (date) declareFact(next, scope, date, 'date');
    known.set(source.id, source);
    return { model: next, sources: [...known.values()], focus: scope, note: `${scope}.${name} enregistrée${source.verified ? '' : ' — extrait introuvable dans la source, à corriger'}.` };
  }
  if (command === 'fait') {
    const scope = question(next, input.question).id;
    const name = identifier(input.nom);
    guard(`${scope}.${name}`);
    if (next.conditions.some((entry) => entry.question === scope && entry.name === name)) throw new TypeError(`${name} est une condition, pas un fait.`);
    let fact = next.facts.find((entry) => entry.question === scope && entry.name === name);
    if (!fact) next.facts.push(fact = { question: scope, name, type: 'booléen', value: null, sources: [], force: null, appreciation: '' });
    if (input.type !== undefined) {
      if (!FACT_TYPES.includes(input.type as string)) throw new TypeError(`type : ${FACT_TYPES.join(', ')}.`);
      fact.type = input.type as string;
    }
    fact.value = parseValue(input.valeur, fact.type);
    if (input.force !== undefined && input.force !== null && !REASONING_FORCES.includes(input.force as typeof REASONING_FORCES[number])) throw new TypeError(`force : ${REASONING_FORCES.join(', ')}.`);
    fact.force = (input.force as string | undefined) ?? fact.force;
    fact.appreciation = optional(input.appreciation, 'appreciation') ?? fact.appreciation;
    let note = `${scope}.${name} enregistré.`;
    if (input.piece !== undefined) {
      const source = await pieceSource(cwd, text(input.piece, 'piece', 500), text(input.extrait, 'extrait'), connectors);
      known.set(source.id, source);
      fact.sources = [source.id];
      if (!source.verified) note = `${scope}.${name} : extrait introuvable dans ${input.piece}, fait non établi.`;
    }
    return { model: next, sources: [...known.values()], focus: scope, note };
  }
  if (command === 'retirer') {
    const scope = question(next, input.question).id;
    if (input.nom === undefined) {
      for (const id of locked) if (id.startsWith(`${scope}.`)) guard(id);
      next.questions = next.questions.filter((entry) => entry.id !== scope);
      next.conditions = next.conditions.filter((entry) => entry.question !== scope);
      next.facts = next.facts.filter((entry) => entry.question !== scope);
      return { model: next, sources, focus: null, note: `${scope} retirée.` };
    }
    const name = identifier(input.nom);
    guard(`${scope}.${name}`);
    next.conditions = next.conditions.filter((entry) => !(entry.question === scope && entry.name === name));
    next.facts = next.facts.map((entry) => (entry.question === scope && entry.name === name ? { ...entry, value: null, sources: [], force: null, appreciation: '' } : entry));
    pruneFacts(next);
    return { model: next, sources, focus: scope, note: `${scope}.${name} retiré.` };
  }
  throw new TypeError('commande : etat, question, condition, fait, retirer ou tester.');
}

const quote = (value: string) => JSON.stringify(value);

export function modelToCatala(model: ReasoningModel) {
  const out: string[] = [];
  for (const entry of model.questions) {
    const conditions = model.conditions.filter((item) => item.question === entry.id);
    const facts = model.facts.filter((item) => item.question === entry.id);
    out.push(`#[question = ${quote(entry.question)}]`);
    if (entry.objective !== null) out.push(`#[objectif = ${entry.objective ? 'rempli' : quote('non rempli')}]`);
    if (entry.date) out.push(`#[date_de_référence = ${entry.date}]`);
    out.push(`déclaration champ d'application ${entry.id}:`, ...facts.map((fact) => `  entrée ${fact.name} contenu ${fact.type}`), ...conditions.map((item) => `  interne ${item.name} condition`), '  résultat reponse condition', '');
    out.push(`champ d'application ${entry.id}:`);
    for (const item of conditions) {
      const attrs = `  #[libellé = ${quote(item.label)}]${item.sources.length ? ` #[selon = ${item.sources.join(', ')}]` : ''}${item.date ? ` #[à_la_date = ${item.date}]` : ''}`;
      out.push(attrs, `  règle ${item.name} sous condition ${item.rule} conséquence rempli`);
      if (item.role === 'fondement') out.push(attrs, `  étiquette base règle reponse sous condition ${item.name} conséquence rempli`);
      if (item.role === 'moyen_adverse') out.push(attrs, `  exception base règle reponse sous condition ${item.name} conséquence non rempli`);
    }
    out.push('');
  }
  if (model.questions.length) {
    out.push("déclaration champ d'application Dossier:", ...model.questions.map((entry) => `  ${entry.id.toLowerCase()} champ ${entry.id}`), '', "champ d'application Dossier:");
    for (const fact of model.facts.filter((item) => item.value !== null)) {
      const attrs = [fact.sources.length ? `#[selon = ${fact.sources.join(', ')}]` : '', fact.force ? `#[force = ${fact.force}]` : '', fact.appreciation ? `#[appréciation = ${quote(fact.appreciation)}]` : ''].filter(Boolean);
      if (attrs.length) out.push(`  ${attrs.join(' ')}`);
      out.push(`  définition ${fact.question.toLowerCase()}.${fact.name} égal à ${printValue(fact.value)}`);
    }
  }
  return out.join('\n');
}

const STATUS = { remplie: 'remplie', 'non remplie': 'non remplie', indéterminée: 'à établir', bloquée: 'à revoir' } as const;
const ANSWER = { remplie: 'oui', 'non remplie': 'non', indéterminée: 'pas encore établie', bloquée: 'bloquée (fondement à revoir)' } as const;

export function describeState(snapshot: ReasoningSnapshot, model: ReasoningModel, focus: string | null) {
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const shown = focus ? snapshot.questions.filter((entry) => entry.scope === focus) : snapshot.questions;
  if (!snapshot.questions.length) return 'Aucune question. Commence par : commande question, texte « La question de droit posée ? », objectif oui|non, date (nom du fait date de référence).';
  const lines: string[] = [];
  for (const entry of shown) {
    const roles = new Map(model.conditions.filter((item) => item.question === entry.scope).map((item) => [`${entry.scope}.${item.name}`, item.role]));
    lines.push(`${entry.scope} — ${entry.question}`, `Réponse : ${ANSWER[entry.status]}${entry.objective === null ? '' : ` · objectif ${entry.objective ? 'oui' : 'non'} : ${entry.objectiveStatus}`}`);
    const conditions = snapshot.conditions.filter((item) => item.scope === entry.scope && item.variable !== entry.result);
    if (conditions.length) lines.push('Conditions :', ...conditions.map((item) => `- ${item.variable}${roles.get(item.id) !== 'condition' ? ` (${roles.get(item.id)?.replace('_', ' ')})` : ''} : ${STATUS[item.status]} — ${item.label}${item.sources.length ? ` [${item.sources.map((id) => sources.get(id)?.title ?? id).join(' ; ')}]` : ''}${item.review ? ` · ${item.review.status} par l'avocat` : ''}`));
    const facts = snapshot.facts.filter((item) => item.scope === entry.scope);
    if (facts.length) lines.push('Faits :', ...facts.map((item) => `- ${item.variable} (${item.type}) : ${item.status === 'établi' ? `${printValue(item.value)} — ${item.sources.map((id) => sources.get(id)?.title ?? id).join(' ; ') || 'avocat'}${item.force ? `, ${item.force}` : ''}` : 'à prouver'}${item.review ? ` · ${item.review.status} par l'avocat` : ''}`));
    const todo = [
      ...entry.issues,
      ...conditions.flatMap((item) => item.issues.map((issue) => `${item.variable} : ${issue}`)),
      ...facts.filter((item) => item.status !== 'établi').map((item) => `${item.variable} : ${item.issues[0] ?? 'à prouver'} (commande fait, avec piece et extrait)`),
    ];
    if (todo.length) lines.push('À faire :', ...[...new Set(todo)].map((item) => `- ${item}`));
    lines.push('');
  }
  if (snapshot.test) {
    const alerts = snapshot.test.findings.filter((finding) => finding.level === 'alerte');
    lines.push(`Dernier test (${snapshot.test.at.slice(0, 16).replace('T', ' ')}) : ${alerts.length ? `${alerts.length} alerte(s)` : 'aucune alerte'}.`);
  } else lines.push('Pas encore testé : commande tester une fois la théorie posée.');
  return lines.join('\n').trim();
}
