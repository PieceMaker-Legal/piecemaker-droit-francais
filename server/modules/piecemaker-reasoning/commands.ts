import { createHash } from 'node:crypto';

import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningHistory, ReasoningPeriod, ReasoningSnapshot, ReasoningSource, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import { CATALA_TYPES, freeVariables, parseCatala, printValue } from './catala.js';
import type { Expression } from './catala.js';
import { isLegalDate } from './legal-period.js';

export type ReasoningConnectors = {
  law(id: string): Promise<{ title: string; text: string; validity?: ReasoningPeriod; history?: ReasoningHistory }>;
  piece(cwd: string, ref: string): Promise<{ title: string; text: string } | null>;
  match(text: string, excerpt: string): string | null;
  registry(query: { siren: string | null; name: string | null }): Promise<{ found: boolean; status: string }>;
  bodacc(siren: string): Promise<string[]>;
};

type Role = 'condition' | 'fondement' | 'moyen_adverse' | 'assertion';
type ModelQuestion = { id: string; question: string; objective: boolean | null; date: string | null };
type ModelCondition = { question: string; name: string; label: string; rule: string; role: Role; sources: string[]; date: string | null; type?: string; parametres?: string; etiquette?: string; exceptionDe?: string; etat?: string; si?: string; negative?: boolean };
type ModelFact = { question: string; name: string; type: string; value: ReasoningValue; sources: string[]; force: string | null; appreciation: string };
type ModelType = { name: string; kind: 'structure' | 'énumération'; members: string };
export type ReasoningModel = { questions: ModelQuestion[]; conditions: ModelCondition[]; facts: ModelFact[]; types?: ModelType[] };

export type ReasoningCommand = {
  commande?: unknown; question?: unknown; texte?: unknown; objectif?: unknown; date?: unknown;
  nom?: unknown; libelle?: unknown; regle?: unknown; role?: unknown; source?: unknown; extrait?: unknown; a_la_date?: unknown;
  type?: unknown; valeur?: unknown; piece?: unknown; force?: unknown; appreciation?: unknown; vue?: unknown;
  parametres?: unknown; etiquette?: unknown; exception_de?: unknown; etat?: unknown; si?: unknown; consequence?: unknown; champs?: unknown; cas?: unknown;
};

export function sourceId(document: string, excerpt: string) {
  return `s${createHash('sha256').update(`${document}\0${excerpt}`).digest('hex').slice(0, 8)}`;
}

export const emptyModel = (): ReasoningModel => ({ questions: [], conditions: [], facts: [], types: [] });

const RESERVED = new Set(['reponse', 'et', 'ou', 'non', 'si', 'alors', 'sinon', 'vrai', 'faux', 'rempli', 'condition', 'champ', 'règle', 'définition', 'de', 'liste', 'nombre', 'somme', 'existe', 'parmi', 'soit', 'selon', 'dans', 'contient', 'base']);
const BASE_TYPES = CATALA_TYPES.filter((type) => type !== 'condition');
const SYNTAX = 'Syntaxe : et, ou, ou bien, non, = != < <= > >=, + - * /, vrai, faux, |AAAA-MM-JJ|, 2 mois, 1 000 €, 30%, si … alors … sinon, soit x égal à … dans …, [a; b], nombre de l, somme argent de l, existe x parmi l tel que …, pour tout x parmi l on a …, liste de x parmi l tel que …, maximum de l, x.champ, x sous forme Cas, selon x sous forme -- Cas de y : … -- n\'importe quel : …, f de (a, b), arrondi de, accès_année de, q1.reponse.';

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
const typeName = (value: unknown, field = 'nom') => {
  const name = text(value, field, 80);
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(name) || /^Q\d+$/.test(name) || name === 'Dossier') throw new TypeError(`${field} : une majuscule puis lettres, chiffres et _ (ex. Bail, ModeDeRupture).`);
  return name;
};

const types = (model: ReasoningModel) => model.types ?? [];
const caseNames = (model: ReasoningModel) => types(model).filter((entry) => entry.kind === 'énumération').flatMap((entry) => entry.members.split(',').map((member) => member.trim().split(/\s+/)[0]));
const typeDeclaration = (entry: ModelType) => `déclaration ${entry.kind} ${entry.name}:\n${entry.members.split(',').map((member) => `  ${entry.kind === 'structure' ? 'donnée' : '--'} ${member.trim()}\n`).join('')}`;

function checkType(model: ReasoningModel, type: string): string {
  const known = new Set([...BASE_TYPES, ...types(model).map((entry) => entry.name)]);
  const inner = type.replace(/^(liste de\s+)+/, '');
  if (!known.has(inner)) throw new TypeError(`type inconnu : ${inner}. Types : ${[...known].join(', ')}, liste de …${types(model).length ? '' : ' (structure ou énumération : commande type)'}.`);
  return type.replace(/\s+/g, ' ');
}

function parameters(model: ReasoningModel, value: unknown) {
  const raw = optional(value, 'parametres', 500);
  if (!raw) return [];
  return raw.split(',').map((part) => {
    const match = /^\s*([a-z][a-z0-9_]*)\s+contenu\s+(.+?)\s*$/.exec(part);
    if (!match || RESERVED.has(match[1])) throw new TypeError('parametres : « nom contenu type », séparés par des virgules (ex. montant contenu argent, date_acte contenu date).');
    return { name: match[1], type: checkType(model, match[2]) };
  });
}

function wrap(error: unknown): never {
  throw new TypeError(`Règle illisible : ${error instanceof Error ? error.message.replace(/^Ligne \d+ : /, '') : 'syntaxe'} ${SYNTAX}`);
}

function expressionOf(source: string): Expression {
  try {
    const program = parseCatala(`déclaration champ d'application T:\n  résultat x contenu entier\nchamp d'application T:\n  définition x égal à ${source}\n`);
    return program.bodies[0].rules[0].consequence as Expression;
  } catch (error) { return wrap(error); }
}

function namesOf(model: ReasoningModel, entry: Pick<ModelCondition, 'rule' | 'si' | 'parametres'>) {
  const bound = [...parameters(model, entry.parametres).map((parameter) => parameter.name), ...caseNames(model)];
  const found = new Set<string>();
  for (const source of [entry.rule, entry.si]) if (source) for (const name of freeVariables(expressionOf(source), bound)) found.add(/^q\d+\./.test(name) ? name.split('.').slice(0, 2).join('.') : name.split('.')[0]);
  return [...found];
}

function constantValue(model: ReasoningModel, expression: Expression): ReasoningValue {
  const enumOf = (cas: string) => types(model).find((entry) => entry.kind === 'énumération' && entry.members.split(',').some((member) => member.trim().split(/\s+/)[0] === cas))?.name;
  const cases = caseNames(model);
  switch (expression.t) {
    case 'lit': return expression.v;
    case 'neg': { const value = constantValue(model, expression.e); if (typeof value === 'number') return -value; break; }
    case 'liste': return expression.items.map((item) => constantValue(model, item));
    case 'structure': return { structure: expression.name, champs: Object.fromEntries(expression.champs.map((field) => [field.name, constantValue(model, field.e)])) };
    case 'cas': if (enumOf(expression.cas)) return { énumération: enumOf(expression.cas)!, cas: expression.cas, ...(expression.e ? { contenu: constantValue(model, expression.e) } : {}) }; break;
    case 'var': if (expression.path.length === 1 && cases.includes(expression.path[0])) return { énumération: enumOf(expression.path[0])!, cas: expression.path[0] }; break;
  }
  throw new TypeError('valeur : une constante (nombre, date |AAAA-MM-JJ|, durée, [a; b], Structure { -- champ: valeur }, Cas ou Cas contenu valeur), sans variable.');
}

function parseValue(model: ReasoningModel, value: unknown, type: string): ReasoningValue {
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
  } else if (BASE_TYPES.includes(type)) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.').replace(/\s|€|%$/g, '')) / (typeof value === 'string' && value.trim().endsWith('%') ? 100 : 1) : NaN;
    if (Number.isFinite(number) && (type !== 'entier' || Number.isInteger(number))) return number;
  } else return constantValue(model, expressionOf(typeof value === 'string' ? value : JSON.stringify(value)));
  throw new TypeError(`Valeur de type ${type} attendue${type === 'date' ? ' (AAAA-MM-JJ)' : type === 'durée' ? ' (ex. 2 mois)' : ''}.`);
}

const question = (model: ReasoningModel, value: unknown) => {
  const id = text(value, 'question', 20);
  const found = model.questions.find((entry) => entry.id === id);
  if (!found) throw new TypeError(`Question inconnue : ${id}. Questions : ${model.questions.map((entry) => entry.id).join(', ') || 'aucune (commande question)'}.`);
  return found;
};

const declareFact = (model: ReasoningModel, scope: string, name: string, type = 'booléen') => {
  if (name.includes('.')) return;
  if (model.conditions.some((entry) => entry.question === scope && entry.name === name && entry.role !== 'assertion')) return;
  if (!model.facts.some((entry) => entry.question === scope && entry.name === name)) model.facts.push({ question: scope, name, type, value: null, sources: [], force: null, appreciation: '' });
};

const pruneFacts = (model: ReasoningModel) => {
  const used = new Set([
    ...model.conditions.flatMap((entry) => namesOf(model, entry).map((name) => `${entry.question}.${name}`)),
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
  next.types = types(next);
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
  if (command === 'type') {
    const name = typeName(input.nom);
    const kind = input.champs !== undefined ? 'structure' : input.cas !== undefined ? 'énumération' : (() => { throw new TypeError('type : --champs « nom contenu type, … » (structure) ou --cas « Cas, Cas contenu type, … » (énumération).'); })();
    const entry: ModelType = { name, kind, members: text(kind === 'structure' ? input.champs : input.cas, kind === 'structure' ? 'champs' : 'cas', 1000) };
    try { parseCatala(typeDeclaration(entry)); } catch (error) { throw new TypeError(`${kind === 'structure' ? 'champs : « nom contenu type », séparés par des virgules' : 'cas : « Cas » ou « Cas contenu type », séparés par des virgules'} (${error instanceof Error ? error.message.replace(/^Ligne \d+ : /, '') : 'syntaxe'}).`); }
    for (const member of entry.members.split(',')) { const inner = /contenu\s+(.+)$/.exec(member.trim())?.[1]; if (inner && inner.replace(/^(liste de\s+)+/, '') !== name) checkType(next, inner); }
    next.types = [...types(next).filter((item) => item.name !== name), entry];
    return { model: next, sources, focus: null, note: `Type ${name} enregistré.` };
  }
  if (command === 'condition') {
    const scope = question(next, input.question).id;
    const name = identifier(input.nom);
    guard(`${scope}.${name}`);
    if (next.facts.some((fact) => fact.question === scope && fact.name === name && fact.value !== null)) throw new TypeError(`${name} est déjà un fait prouvé ; choisis un autre nom.`);
    const role = (input.role ?? 'condition') as Role;
    if (!['condition', 'fondement', 'moyen_adverse', 'assertion'].includes(role)) throw new TypeError('role : condition, fondement, moyen_adverse ou assertion.');
    const type = input.type === undefined || input.type === '' || input.type === 'condition' ? 'condition' : checkType(next, text(input.type, 'type', 200));
    if (role !== 'assertion' && role !== 'condition' && type !== 'condition') throw new TypeError(`role ${role} : réservé aux conditions (sans --type).`);
    const parametres = optional(input.parametres, 'parametres', 500) ?? undefined;
    parameters(next, parametres);
    const etiquette = input.etiquette ? identifier(input.etiquette, 'etiquette') : undefined;
    const exceptionDe = input.exception_de ? (input.exception_de === 'base' ? 'base' : identifier(input.exception_de, 'exception_de')) : undefined;
    const etat = input.etat ? identifier(input.etat, 'etat') : undefined;
    const si = optional(input.si, 'si', 1000) ?? undefined;
    if (si && type === 'condition') throw new TypeError('si : réservé aux valeurs (--type) ; pour une condition, la règle est déjà la condition.');
    const negative = input.consequence === undefined || input.consequence === '' || input.consequence === 'rempli' ? false : input.consequence === 'non' || input.consequence === 'non rempli' ? true : (() => { throw new TypeError('consequence : rempli ou non.'); })();
    const rule = text(input.regle, 'regle', 1000);
    const draft = { rule, si, parametres };
    const used = namesOf(next, draft);
    if (used.includes(name) && !etat) throw new TypeError('Une condition ne peut pas dépendre d’elle-même (sauf d’un état précédent : --etat).');
    for (const path of used.filter((entry) => entry.includes('.'))) {
      const target = path.split('.')[0].toUpperCase();
      if (target === scope || !next.questions.some((entry) => entry.id === target)) throw new TypeError(`${path} : ${target === scope ? 'une question ne peut pas s’appeler elle-même' : `question ${target} inconnue`}.`);
    }
    const siblings = next.conditions.filter((entry) => entry.question === scope && entry.name === name && entry.role !== 'assertion' && !(entry.etiquette === etiquette && entry.etat === etat));
    if (role !== 'assertion' && siblings.some((entry) => (entry.type ?? 'condition') !== type || (entry.parametres ?? '') !== (parametres ?? ''))) throw new TypeError(`${name} a déjà un autre type ou d’autres parametres : garde les mêmes, ou retire d’abord ${name}.`);
    if (exceptionDe && exceptionDe !== 'base' && !siblings.some((entry) => entry.etiquette === exceptionDe)) throw new TypeError(`exception_de : aucune règle de ${name} n’a l’étiquette ${exceptionDe}.`);
    const source = input.source === undefined && role === 'assertion' ? null : await lawSource(cwd, text(input.source, 'source', 500), optional(input.extrait, 'extrait'), known, connectors);
    const date = input.a_la_date ? identifier(input.a_la_date, 'a_la_date') : null;
    next.facts = next.facts.filter((fact) => !(fact.question === scope && fact.name === name));
    const existing = next.conditions.find((entry) => entry.question === scope && entry.name === name && entry.etiquette === etiquette && entry.etat === etat && (entry.role === 'assertion') === (role === 'assertion'));
    const entry: ModelCondition = {
      question: scope, name, label: text(input.libelle, 'libelle', 300), rule, role, sources: [...new Set([...(existing && existing.rule === rule ? existing.sources : []), ...(source ? [source.id] : [])])], date,
      ...(type !== 'condition' ? { type } : {}), ...(parametres ? { parametres } : {}), ...(etiquette ? { etiquette } : {}), ...(exceptionDe ? { exceptionDe } : {}), ...(etat ? { etat } : {}), ...(si ? { si } : {}), ...(negative ? { negative } : {}),
    };
    next.conditions = [...next.conditions.filter((item) => item !== existing), entry];
    for (const dependency of used) if (dependency !== name) declareFact(next, scope, dependency);
    if (date) declareFact(next, scope, date, 'date');
    if (source) known.set(source.id, source);
    return { model: next, sources: [...known.values()], focus: scope, note: `${scope}.${name}${etiquette ? ` (${etiquette})` : ''}${etat ? ` état ${etat}` : ''} enregistrée${source && !source.verified ? ' — extrait introuvable dans la source, à corriger' : ''}.` };
  }
  if (command === 'fait') {
    const scope = question(next, input.question).id;
    const name = identifier(input.nom);
    guard(`${scope}.${name}`);
    if (next.conditions.some((entry) => entry.question === scope && entry.name === name && entry.role !== 'assertion')) throw new TypeError(`${name} est une condition, pas un fait.`);
    let fact = next.facts.find((entry) => entry.question === scope && entry.name === name);
    if (!fact) next.facts.push(fact = { question: scope, name, type: 'booléen', value: null, sources: [], force: null, appreciation: '' });
    if (input.type !== undefined) fact.type = checkType(next, text(input.type, 'type', 200));
    fact.value = parseValue(next, input.valeur, fact.type);
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
    if (input.type !== undefined) {
      const name = typeName(input.type, 'type');
      if (!types(next).some((entry) => entry.name === name)) throw new TypeError(`Type inconnu : ${name}.`);
      next.types = types(next).filter((entry) => entry.name !== name);
      return { model: next, sources, focus: null, note: `Type ${name} retiré.` };
    }
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
    const etiquette = input.etiquette ? identifier(input.etiquette, 'etiquette') : undefined;
    const etat = input.etat ? identifier(input.etat, 'etat') : undefined;
    next.conditions = next.conditions.filter((entry) => !(entry.question === scope && entry.name === name && (!etiquette || entry.etiquette === etiquette) && (!etat || entry.etat === etat)));
    if (!etiquette && !etat) next.facts = next.facts.map((entry) => (entry.question === scope && entry.name === name ? { ...entry, value: null, sources: [], force: null, appreciation: '' } : entry));
    pruneFacts(next);
    return { model: next, sources, focus: scope, note: `${scope}.${name}${etiquette ? ` (${etiquette})` : ''}${etat ? ` état ${etat}` : ''} retiré.` };
  }
  throw new TypeError('commande : etat, question, type, condition, fait, retirer ou tester.');
}

const quote = (value: string) => JSON.stringify(value);

export function modelToCatala(model: ReasoningModel) {
  const out: string[] = types(model).map(typeDeclaration);
  for (const entry of model.questions) {
    const conditions = model.conditions.filter((item) => item.question === entry.id);
    const values = conditions.filter((item) => item.role !== 'assertion');
    const facts = model.facts.filter((item) => item.question === entry.id);
    const subScopes = [...new Set(conditions.flatMap((item) => namesOf(model, item)).filter((name) => name.includes('.')).map((name) => name.split('.')[0]))];
    const variables = [...new Set(values.map((item) => item.name))].map((name) => {
      const own = values.filter((item) => item.name === name);
      const states = [...new Set(own.flatMap((item) => (item.etat ? [item.etat] : [])))];
      const parameters = own[0].parametres ? ` dépendant de ${own[0].parametres}` : '';
      return `  interne ${name} ${own[0].type ? `contenu ${own[0].type}` : 'condition'}${parameters}${states.map((state) => ` état ${state}`).join('')}`;
    });
    out.push(`#[question = ${quote(entry.question)}]`);
    if (entry.objective !== null) out.push(`#[objectif = ${entry.objective ? 'rempli' : quote('non rempli')}]`);
    if (entry.date) out.push(`#[date_de_référence = ${entry.date}]`);
    out.push(`déclaration champ d'application ${entry.id}:`, ...facts.map((fact) => `  entrée ${fact.name} contenu ${fact.type}`), ...variables, ...subScopes.map((sub) => `  ${sub} champ ${sub.toUpperCase()}`), '  résultat reponse condition', '');
    out.push(`champ d'application ${entry.id}:`);
    for (const item of conditions) {
      const attrs = `  #[libellé = ${quote(item.label)}]${item.sources.length ? ` #[selon = ${item.sources.join(', ')}]` : ''}${item.date ? ` #[à_la_date = ${item.date}]` : ''}`;
      if (item.role === 'assertion') { out.push(attrs, `  assertion ${item.rule}`); continue; }
      const head = `${item.etiquette ? `étiquette ${item.etiquette} ` : ''}${item.exceptionDe ? `exception${item.exceptionDe === 'base' ? '' : ` ${item.exceptionDe}`} ` : ''}`;
      const target = `${item.name}${item.parametres ? ` de ${item.parametres.split(',').map((part) => part.trim().split(/\s+/)[0]).join(', ')}` : ''}${item.etat ? ` état ${item.etat}` : ''}`;
      out.push(attrs, item.type
        ? `  ${head}définition ${target}${item.si ? ` sous condition ${item.si} conséquence` : ''} égal à ${item.rule}`
        : `  ${head}règle ${target} sous condition ${item.rule} conséquence ${item.negative ? 'non ' : ''}rempli`);
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
const MARK = { remplie: '✓', 'non remplie': '✗', indéterminée: '?', bloquée: '⚠' } as const;
const ROLE = { condition: '', fondement: '[fondement] ', moyen_adverse: '[moyen adverse] ', assertion: '' } as const;
const shownValue = (value: ReasoningValue, type?: string) => `${printValue(value).replace(/^\|(.*)\|$/, '$1')}${type === 'argent' && typeof value === 'number' ? ' €' : ''}`;
const ruleText = (item: ModelCondition) => `${item.etiquette ? `[${item.etiquette}] ` : ''}${item.exceptionDe ? `[exception à ${item.exceptionDe}] ` : ''}${item.etat ? `[état ${item.etat}] ` : ''}${item.si ? `si ${item.si} : ` : ''}${item.rule}${item.negative ? ' → non remplie' : ''}`;

export function describeState(snapshot: ReasoningSnapshot, model: ReasoningModel, focus: string | null, full = false, withTest = true) {
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const shown = focus ? snapshot.questions.filter((entry) => entry.scope === focus) : snapshot.questions;
  if (!snapshot.questions.length) return 'Aucune question. Commence par : commande question, texte « La question de droit posée ? », objectif oui|non, date (nom du fait date de référence).';
  const reference = (id: string) => {
    const source = sources.get(id);
    if (!source) return id;
    return `${source.title} (${source.document.split(':').slice(1).join(':')})${source.verified ? '' : ' — extrait introuvable'}`;
  };
  const citations = (ids: string[], indent: string) => ids.flatMap((id) => {
    const source = sources.get(id);
    if (!source) return [`${indent}source inconnue : ${id}`];
    const validity = source.validity ? ` · vigueur ${source.validity.from} → ${source.validity.to ?? 'en vigueur'}` : '';
    const history = source.history ? ` · ${source.history.status}` : '';
    return [`${indent}${reference(id)}${validity}${history}`, `${indent}  « ${source.excerpt} »`];
  });
  const lines: string[] = [];
  for (const entry of shown) {
    const own = model.conditions.filter((item) => item.question === entry.scope);
    const modelConditions = new Map<string, ModelCondition[]>();
    for (const item of own.filter((condition) => condition.role !== 'assertion')) modelConditions.set(`${entry.scope}.${item.name}`, [...(modelConditions.get(`${entry.scope}.${item.name}`) ?? []), item]);
    const conditions = new Map(snapshot.conditions.filter((item) => item.scope === entry.scope).map((item) => [item.id, item]));
    const facts = new Map(snapshot.facts.filter((item) => item.scope === entry.scope).map((item) => [item.id, item]));
    lines.push(`${entry.scope} — ${entry.question}`, `Réponse : ${ANSWER[entry.status]}${entry.objective === null ? '' : ` · objectif ${entry.objective ? 'oui' : 'non'} : ${entry.objectiveStatus}`}${entry.referenceDate ? ` · date de référence ${entry.referenceDate}` : ''}`);
    const seen = new Set<string>();
    const reached = new Set<string>();
    const tree: string[] = [];
    const factLine = (id: string, prefix: string) => {
      const fact = facts.get(id)!;
      reached.add(id);
      const value = fact.status === 'établi' ? `${shownValue(fact.value, fact.type)} ✓` : 'à prouver ✗';
      tree.push(`${prefix}fait ${fact.variable} (${fact.type}) : ${value}${fact.burden ? ` · charge : ${fact.burden}` : ''}${fact.review ? ` · ${fact.review.status} par l'avocat` : ''}`);
      if (!full) return;
      const pad = prefix.replace(/[├└]─ $/, (match) => (match.startsWith('├') ? '│  ' : '   '));
      if (fact.status === 'établi') tree.push(`${pad}  force : ${fact.force ?? 'à indiquer'}${fact.appreciation ? ` · ${fact.appreciation}` : ''}${fact.author === 'avocat' ? ' · saisi par l’avocat' : ''}`);
      tree.push(...citations(fact.sources, `${pad}  `));
      for (const issue of fact.issues) tree.push(`${pad}  ⚠ ${issue}`);
    };
    const node = (id: string, prefix: string, childPrefix: string) => {
      if (facts.has(id)) { factLine(id, prefix); return; }
      const condition = conditions.get(id);
      if (!condition) { tree.push(`${prefix}${id.slice(entry.scope.length + 1)} : inconnu`); return; }
      const entries = modelConditions.get(id) ?? [];
      const role = entries.find((item) => item.role !== 'condition')?.role ?? 'condition';
      const signature = entries[0] ? `${entries[0].parametres ? ` (${entries[0].parametres})` : ''}${entries[0].type ? ` [${entries[0].type}]` : ''}` : '';
      const label = condition.label !== condition.variable ? ` — ${condition.label}` : '';
      if (seen.has(id)) { tree.push(`${prefix}${condition.variable} : ${STATUS[condition.status]} ${MARK[condition.status]} (voir plus haut)`); return; }
      seen.add(id);
      const status = entries[0]?.parametres ? 'fonction' : entries[0]?.type ? (condition.value === null ? `${STATUS[condition.status]} ?` : `${shownValue(condition.value, entries[0].type)} ${condition.status === 'bloquée' ? MARK.bloquée : '✓'}`) : `${STATUS[condition.status]} ${MARK[condition.status]}`;
      tree.push(`${prefix}${ROLE[role]}${condition.variable}${signature} : ${status}${label}${condition.sources.length && !full ? ` [${condition.sources.map((source) => sources.get(source)?.title ?? source).join(' ; ')}]` : ''}${condition.review ? ` · ${condition.review.status} par l'avocat` : ''}`);
      const rules = entries.map(ruleText);
      if (full) {
        if (rules.length) tree.push(...rules.map((rule) => `${childPrefix}  règle : ${rule}`));
        else if (condition.code) tree.push(...condition.code.trim().split('\n').filter((line) => !line.trim().startsWith('#[')).map((line) => `${childPrefix}  ${line.trim()}`));
        tree.push(...citations(condition.sources, `${childPrefix}  `));
        for (const issue of condition.issues) tree.push(`${childPrefix}  ⚠ ${issue}`);
      } else tree.push(...rules.map((rule) => `${childPrefix}  = ${rule}`));
      const children = condition.dependsOn.filter((child) => child !== id && (conditions.has(child) || facts.has(child)));
      children.forEach((child, index) => {
        const last = index === children.length - 1;
        node(child, `${childPrefix}${last ? '└─ ' : '├─ '}`, `${childPrefix}${last ? '   ' : '│  '}`);
      });
    };
    node(`${entry.scope}.${entry.result}`, '', '');
    const outside = [...conditions.keys()].filter((id) => !seen.has(id) && id !== `${entry.scope}.${entry.result}`);
    if (outside.length) tree.push('Hors de la réponse :');
    for (const id of outside) if (!seen.has(id)) node(id, '', '');
    const loose = [...facts.keys()].filter((id) => !reached.has(id));
    if (loose.length) { tree.push('Faits hors de la réponse :'); loose.forEach((id, index) => factLine(id, index === loose.length - 1 ? '└─ ' : '├─ ')); }
    const assertions = own.filter((item) => item.role === 'assertion');
    if (assertions.length) tree.push('Assertions :', ...assertions.map((item) => `- ${item.name} — ${item.label} : ${item.rule}`));
    lines.push('Arbre :', ...tree);
    if (entry.voies.length > 1) lines.push('Voies :', ...entry.voies.map((voie) => `- ${voie.favorable ? 'pour' : 'contre'} · ${voie.status} — ${voie.label}${voie.toProve.length ? ` · à prouver : ${voie.toProve.map((id) => id.slice(entry.scope.length + 1)).join(', ')}` : ''}${full && voie.weaknesses.length ? ` · faiblesses : ${voie.weaknesses.join(' ')}` : ''}`));
    const todo = [
      ...entry.issues,
      ...[...conditions.values()].filter((item) => item.variable !== entry.result).flatMap((item) => item.issues.map((issue) => `${item.variable} : ${issue}`)),
      ...[...facts.values()].filter((item) => item.status !== 'établi').map((item) => `${item.variable} : ${item.issues[0] ?? 'à prouver'} (commande fait, avec piece et extrait)`),
    ];
    if (todo.length) lines.push(`À faire (${new Set(todo).size}) :`, ...[...new Set(todo)].map((item) => `- ${item}`));
    lines.push('');
  }
  const diagnostics = snapshot.diagnostics.filter((line) => !line.startsWith('Avocat · '));
  if (diagnostics.length) lines.push('Erreurs du programme :', ...diagnostics.map((line) => `- ${line}`), '');
  if (withTest && snapshot.test) {
    const alerts = snapshot.test.findings.filter((finding) => finding.level === 'alerte');
    lines.push(`Dernier test (${snapshot.test.at.slice(0, 16).replace('T', ' ')}) : ${alerts.length ? `${alerts.length} alerte(s)` : 'aucune alerte'}.`, ...alerts.map((finding) => `- ${finding.subject} : ${finding.text}`));
  } else if (withTest) lines.push('Pas encore testé : commande tester une fois la théorie posée.');
  if (!full) lines.push('Détail des pièces, citations et règles : commande etat avec vue complete.');
  return lines.join('\n').trim();
}
