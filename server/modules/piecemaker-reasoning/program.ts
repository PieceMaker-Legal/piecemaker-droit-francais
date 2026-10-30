import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type Database from 'better-sqlite3';

import type { ReasoningIssue, ReasoningLogEntry, ReasoningPieceReliability, ReasoningSnapshot, ReasoningStatus, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import { assignIds, checkActe } from './acte.js';
import { and, answer, calculate, compile, evaluate, isLeaf, or, objectiveRoots, decisive, reachableLeaves, runTrials, simulate, structure } from './engine.js';
import type { Calculation, Facts, Trace } from './engine.js';
import { listReasoningFiles, parseReasoningDocument, printReasoningDocument, ReasoningSyntaxError, resolveReasoningFile } from './document.js';
import { canonical, formulaConditions, SIDES, VERBS, formulaNames, formulaNumbers, LiteralError, readReasoning, stripAnnotations } from './format.js';
import { adviseNames, derivedName, isControlName } from './names.js';
import { verifyCitationLinks } from './citation-review.js';
import type { Basis, Condition, Foundation, Formula, Measure, Objective, Ref, Target, Trial } from './format.js';

export type SourceInfo = { kind: 'texte' | 'decision' | 'piece'; title: string; text: string; validity?: { from: string; to: string | null }; history?: { statut: 'remise en cause' | 'à examiner' | 'non remise en cause'; details: string[] } };

export const OFFICIAL_ID = /^(?:(?:LEGIARTI|JORFARTI|KALIARTI|JURITEXT|CETATEXT|CONSTEXT)\d+|CELEX:\S+|ECLI:\S+)$/u;
export const ID_SHAPE = 'LEGIARTI… pour un article, JURITEXT… pour une décision judiciaire, CETATEXT… pour une décision administrative, CONSTEXT… pour une décision du Conseil constitutionnel, CELEX:… ou ECLI:… pour le droit de l’Union, chemin de la pièce pour une clause';

export type ReasoningConnectors = {
  source(cwd: string, id: string): Promise<SourceInfo | null | undefined>;
  match(text: string, excerpt: string): string | null;
  registry(query: { siren: string | null; name: string | null }): Promise<{ found: boolean; status: string }>;
  bodacc(siren: string): Promise<string[]>;
  review?: (input: {
    cwd: string;
    affirmations: Array<{ emplacement: string; type: 'règle' | 'fondement' | 'valeur'; affirmation: string; citations: Array<{ source: string; citation: string }> }>;
    sources: Array<{ source: string; texte: string }>;
    contexte: unknown;
    online: boolean;
  }) => Promise<unknown>;
};

export type Person = { label: string; kind: string; siren: string | null; name: string | null; side?: string | null };


const LEGACY_TABLES = ['pm_reasoning_items', 'pm_reasoning_models', 'pm_reasoning_results', 'pm_reasoning_nodes', 'pm_reasoning_relations', 'pm_reasoning_links', 'pm_reasoning_theories', 'pm_reasoning_tests', 'pm_reasoning_turns'];
const emptySnapshot = (): ReasoningSnapshot => ({ revision: 0, updatedAt: null, code: '', annotated: null, issues: [], dismissed: [], reliability: [], test: null });
const phrase = (name: string) => name.replace(/_/g, ' ').replace(/(^|\s)([cdjlmnst]) (?=[aeiouyhàâéèêëîïôûù])/giu, '$1$2’');
const human = (name: string) => { const text = phrase(name); return text.charAt(0).toUpperCase() + text.slice(1); };
const listing = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names.join(''));
const day = (value: string) => value.split('-').reverse().join('/');
const ANSWER: Record<ReasoningStatus, string> = { acquis: 'Oui', exclu: 'Non', 'à établir': 'En suspens', disputé: 'Disputée' };
const issueId = (kind: string, at: string, text: string) => createHash('sha256').update(`${kind}\0${at}\0${text}`).digest('hex').slice(0, 10);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const STATUS = (value: ReasoningValue): ReasoningStatus => (value === true ? 'acquis' : value === false ? 'exclu' : 'à établir');
const inForce = (date: string, from: string, to: string | null): boolean => from <= date && (to === null || date < to);
const UNIT: Record<string, string> = { jours: 'jours', jours_ouvres: 'jours ouvrés', mois: 'mois', ans: 'ans' };
const COMPARE: Record<string, string> = { plus_de: 'plus de', au_moins: 'au moins', moins_de: 'moins de', au_plus: 'au plus' };
const amount = (value: string | number) => (typeof value === 'number' ? value.toLocaleString('fr-FR') : phrase(value));
const ANCHORED = /\.(piece|source|vigueur|obtenir|écarter|réduire|augmenter|decompte|applicabilite|version|validite|prescription)$/;
const applicabilityName = (title: string, spaced: boolean) => {
  const article = /article\s+(\S+)/i.exec(title);
  if (spaced) return `applicabilité de ${article ? `l'article ${article[1]}` : title.toLowerCase().replace(/[^\p{L}\p{N}'’.-]+/gu, ' ').trim().slice(0, 50).trim()}`;
  return `applicabilité_de_${(article ? `l_article_${article[1]}` : title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 50)}`;
};

function explain(measure: Measure, result: Calculation) {
  if (!result.calcul) return `À calculer : ${listing(result.missing.map(phrase))} non établi${result.missing.length > 1 ? 's' : ''}`;
  if (measure.delai) {
    const { borne, duree } = measure.delai;
    const { depart, echeance, date_retenue } = result.calcul as Record<string, string>;
    return `${COMPARE[borne]} ${duree.nombre} ${UNIT[duree.unite]} à compter du ${day(depart)} : échéance au ${day(echeance)}, date retenue ${day(date_retenue)} → ${result.value ? 'oui' : 'non'}`;
  }
  const { montant, seuil } = result.calcul as Record<string, number>;
  return `${amount(montant)} ${COMPARE[measure.montant!.comparaison]} ${amount(seuil)} → ${result.value ? 'oui' : 'non'}`;
}

function node(root: Record<string, unknown>, at: string): Record<string, unknown> | null {
  let current: unknown = root;
  for (const part of at.match(/[^.[\]]+|\[\d+\]/g) ?? []) {
    if (part.startsWith('[')) current = Array.isArray(current) ? current[Number(part.slice(1, -1))] : undefined;
    else current = isObject(current) ? current[part] : undefined;
  }
  return isObject(current) ? current : null;
}

export type Simulation = { objectifs: Array<{ objectif: string; statut: ReasoningStatus; montant?: number | null }>; valeurs: Record<string, string | number | null>; termes: Record<string, ReasoningStatus> };
export type Verification = { annotated: Record<string, unknown> | null; issues: ReasoningIssue[]; code: string; log: ReasoningLogEntry[]; simulation?: Simulation };
const shown = (value: ReasoningValue | number | string) => (value === null ? 'à établir' : typeof value === 'boolean' ? (value ? 'vrai' : 'faux') : String(value));
const told = (name: string, value: ReasoningValue | number | string) => `${human(name)} : ${value === null ? 'en suspens' : typeof value === 'boolean' ? (value ? 'acquis' : 'exclu') : typeof value === 'number' ? value.toLocaleString('fr-FR') : value}`;

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
  simulation?: Trial['faits'];
  today?: string;
}): Promise<Verification> {
  const { connectors, cwd } = input;
  const issues: ReasoningIssue[] = [];
  const log: ReasoningLogEntry[] = [];
  const emit = (entry: ReasoningLogEntry) => { const index = log.findIndex((item) => item.key === entry.key); if (index >= 0) log[index] = entry; else log.push(entry); input.emit?.(entry); };
  const within = (path: string, at: string) => path === at || path.startsWith(`${at}.`);
  const issueAt = (at: string) => issues.filter((issue) => within(issue.path, at) || issue.ailleurs?.some((other) => within(other.path, at))).map((issue) => issue.text);
  let lines = new Map<string, number>();
  const causes = new Map<string, ReasoningIssue>();
  const add = (kind: ReasoningIssue['kind'], at: string, text: string, avocat?: string, cible?: string, cause?: string) => {
    const id = issueId(kind, at, text);
    const line = lines.get(at) ?? lines.get(at.replace(/\.[^.[\]]+$/, '')) ?? null;
    const same = cause ? causes.get(cause) : undefined;
    if (same) {
      if (same.path !== at && !same.ailleurs?.some((other) => other.path === at)) same.ailleurs = [...(same.ailleurs ?? []), { path: at, line }];
      return;
    }
    if (issues.some((issue) => issue.id === id)) return;
    const issue: ReasoningIssue = { id, kind, path: at, line, text, ...(avocat ? { avocat, ...(cible ? { cible } : {}) } : {}) };
    issues.push(issue);
    if (cause) causes.set(cause, issue);
  };

  let parsed;
  try { parsed = parseReasoningDocument(input.code); } catch (error) {
    if (!(error instanceof LiteralError)) throw error;
    const found = error instanceof ReasoningSyntaxError ? error.problems : [error];
    emit({ key: 'lecture', step: 'réponse', status: 'alerte', subject: 'Fichier illisible', text: found.map((problem) => problem.message).join(' ; ') });
    return { annotated: null, issues: found.map((problem) => ({ id: issueId('erreur', '', problem.message), kind: 'erreur', path: '', line: problem.line, text: problem.message })), code: input.code, log };
  }
  lines = parsed.lines;
  const stripped = stripAnnotations(parsed.value);
  if (isObject(stripped)) assignIds(stripped.acte);
  const { reasoning, problems } = readReasoning(stripped);
  const ordered = isObject(stripped) ? printReasoningDocument(canonical(stripped, reasoning)) : null;
  const reread = ordered ? parseReasoningDocument(ordered) : null;
  if (reread) lines = reread.lines;
  for (const entry of problems) add('erreur', entry.path, entry.text, entry.avocat, entry.cible);
  if (!isObject(stripped)) return { annotated: null, issues, code: input.code, log };
  const annotated = stripped;

  const shape = structure(reasoning);
  const controlLoop = (cycle: string) => { const control = cycle.split(' → ').find((name) => isControlName(name)); return control ? ` ; les sources citées dans ${control} n’ont besoin ni d’applicabilite, ni de version, ni de validite : retire celle qui renvoie à ${control}` : ''; };
  const loopKey = (cycle: string) => {
    const steps = cycle.split(' → ');
    const index = steps.findIndex((name, at) => at > 0 && isControlName(name));
    if (index < 1 || !isObject(reread?.value)) return null;
    const [from, control] = [steps[index - 1], steps[index]];
    return [...lines.keys()].find((route) => route.startsWith(`${from}.`) && /\.(?:applicabilite|version|validite|decompte)$/u.test(route) && node(reread.value as Record<string, unknown>, route.slice(0, route.lastIndexOf('.')))?.[route.slice(route.lastIndexOf('.') + 1)] === control) ?? null;
  };
  for (const cycle of shape.cycles) add('erreur', loopKey(cycle) ?? cycle.split(' → ')[0], `boucle : ${cycle}${controlLoop(cycle)}`);
  const named = [...reasoning.terms.keys(), ...reasoning.valeurs.keys(), ...[...reasoning.terms.values()].flatMap((term) => [...term.si, ...term.sauf].flatMap(function names(condition: Condition): string[] { return condition.l_une ? condition.l_une.flatMap(names) : [condition.condition!]; }))];
  const spaced = named.some((name) => name.includes(' '));
  for (const { name, text } of adviseNames(named)) add('conseil', reasoning.terms.has(name) ? name : reasoning.valeurs.has(name) ? `valeurs.${name}` : '', text);
  const amountObjective = (objective: Objective) => !reasoning.terms.has(objective.effet) && reasoning.valeurs.has(objective.effet);
  reasoning.objectifs.forEach((objective, index) => {
    const at = `objectifs[${index}].${objective.verbe}`;
    if (!reasoning.terms.has(objective.effet) && !amountObjective(objective)) add('erreur', at, `terme ${objective.effet} non défini : écris ${objective.effet}: { si: [...] }, ou déclare-le dans valeurs si l’objectif porte sur un montant`);
    else if (VERBS[objective.verbe] === 'terme' && amountObjective(objective)) add('erreur', at, `${objective.effet} est un montant : utilise réduire ou augmenter`);
    else if (VERBS[objective.verbe] === 'montant' && !amountObjective(objective)) add('erreur', at, `${objective.effet} est un terme vrai/faux : utilise obtenir ou écarter`);
  });
  if (!reasoning.qualification) add('manque', 'qualification', 'raisonnement non qualifié : ajoute qualification: \'drafting\', \'contentieux\' ou \'consultation\'', 'Le raisonnement n’est pas qualifié : drafting, contentieux ou consultation.');
  reasoning.objectifs.forEach((objective, index) => {
    if (reasoning.qualification === 'drafting' && !reasoning.hypotheses.some((trial) => objectiveRoots(objective).some((name) => name in trial.attendu))) add('manque', `objectifs[${index}]`, `objectif sans hypothèse : ajoute dans hypotheses un cas dont attendu porte sur ${objective.effet}`, 'Aucune hypothèse ne vérifie cet objectif.');
    if (reasoning.qualification === 'contentieux' && !objective.prescription && !isControlName(objective.effet, 'prescription')) add('manque', `objectifs[${index}]`, `${reasoning.qualification} : vérifier la prescription : ajoute prescription: \'${derivedName('prescription', '…', spaced)}\' sur l’objectif et définis ce terme`, 'Prescription à vérifier.');
    if (reasoning.qualification === 'drafting' && !objective.validite && !isControlName(objective.effet, 'validite')) add('manque', `objectifs[${index}]`, `drafting : vérifier la validité : ajoute validite: '${derivedName('validité', '…', spaced)}' sur l’objectif et définis ce terme`, 'Validité à vérifier.');
  });
  const roots = new Set(reasoning.objectifs.flatMap(objectiveRoots));
  for (const name of reasoning.terms.keys()) if (!roots.has(name) && !shape.used.has(name)) add('manque', name, 'terme qui ne sert à aucun objectif : rattache-le comme condition ou ajoute l’objectif qu’il sert');
  for (const [name, term] of reasoning.terms) if (!term.fondements && !term.but) add('conseil', `${name}.but`, `étape sans but : ajoute but: '…' sous ${name}, une phrase courte disant ce que l’étape cherche à démontrer`, `${human(name)} : le but de l’étape n’est pas expliqué.`, name);

  const sources = new Map<string, Promise<SourceInfo | null | undefined>>();
  const lookup = (id: string) => {
    if (!sources.has(id)) sources.set(id, connectors.source(cwd, id).catch(() => null));
    return sources.get(id)!;
  };
  const corrections = new Map<string, string>();
  const checkCitation = (at: string, holder: Record<string, unknown> | null, info: SourceInfo, citation: string, cible: string) => {
    const matched = connectors.match(info.text, citation);
    if (!matched) { add('erreur', at, `citation introuvable dans ${info.title} : recopie le passage exact`, `Le passage cité est introuvable dans ${info.title} : « ${citation} ».`, cible); return false; }
    if (matched !== citation) {
      corrections.set(citation, matched);
      if (holder) Object.assign(holder, { citation: matched, corrigee: true, citation_d_origine: citation });
    }
    return true;
  };

  const verifiedRefs = new Map<string, boolean>();
  const checkTarget = async (at: string, target: Target) => {
    const info = await lookup(target.piece);
    if (info === undefined) return;
    if (!info) { add('manque', at, `le projet renvoie à un élément absent du dossier (${target.piece}) : joins-le ou corrige le renvoi`, `Élément visé absent du dossier : ${target.piece}.`, `#piece:${target.piece}`); return; }
    if (target.citation && !connectors.match(info.text, target.citation)) add('manque', at, `passage visé introuvable dans ${info.title} : complète l’élément visé ou corrige le renvoi`, `Le passage visé est introuvable dans ${info.title} : « ${target.citation} ».`, `#piece:${target.piece}`);
  };
  const checkRef = async (at: string, ref: Ref) => {
    const holder = node(annotated, at);
    emit({ key: `piece:${ref.piece}:${ref.citation}`, step: 'pièce', status: 'en cours', subject: ref.piece, text: 'Relecture de la pièce…' });
    const info = await lookup(ref.piece);
    if (!info) { add('erreur', `${at}.piece`, `pièce introuvable dans le dossier : ${ref.piece}`, `La pièce ${ref.piece} est introuvable dans le dossier.`); verifiedRefs.set(at, false); emit({ key: `piece:${ref.piece}:${ref.citation}`, step: 'pièce', status: 'alerte', subject: ref.piece, text: 'Pièce introuvable dans le dossier' }); return; }
    const ok = checkCitation(at, holder, info, ref.citation, `#piece:${ref.piece}`);
    const reliable = input.reliability.get(ref.piece);
    const nature = input.nature(ref.piece);
    const cited = String(holder?.citation ?? ref.citation);
    const personnes = input.persons.filter((person) => cited.includes(person.label)).map((person) => person.label);
    if (holder) Object.assign(holder, { titre: info.title, ...(nature ? { nature } : {}), fiable: reliable ?? null, ...(personnes.length ? { personnes } : {}) });
    verifiedRefs.set(at, ok && reliable !== false);
    emit({ key: `piece:${ref.piece}:${ref.citation}`, step: 'pièce', status: ok && reliable !== false ? 'ok' : 'alerte', subject: info.title, text: !ok ? `Citation introuvable : « ${ref.citation} »` : reliable === false ? 'Pièce marquée non fiable : ignorée' : `« ${String(holder?.citation ?? ref.citation)} »${reliable === undefined ? ' · à valider' : ''}` });
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
    if (info === undefined && !OFFICIAL_ID.test(basis.source)) {
      add('erreur', `${at}.source`, `source sans identifiant officiel : ${basis.source} ; indique son identifiant (${ID_SHAPE}), trouvé avec les outils Légifrance`, `${basis.source} n’est pas désigné par son identifiant officiel.`, `#source:${basis.source}`);
      basisChecks.set(at, { kind: null, from: null, to: null });
      return;
    }
    if (info === undefined) {
      add('manque', `${at}.source`, `source non vérifiable automatiquement : aucun connecteur pour ${basis.source}`, `${basis.source} n’a pas pu être relu automatiquement : à vérifier vous-même.`, `#source:${basis.source}`);
      basisChecks.set(at, { kind: 'texte', from: basis.vigueur?.debut ?? null, to: basis.vigueur?.fin ?? null });
      if (!basis.vigueur) add('manque', `${at}.vigueur`, 'vigueur non renseignée : ajoute vigueur: { debut, fin }', `La version applicable de ${basis.source} n’est pas précisée.`, `#source:${basis.source}`);
      return;
    }
    if (info === null) { add('erreur', `${at}.source`, `source introuvable : ${basis.source}`, `La source ${basis.source} est introuvable.`); basisChecks.set(at, { kind: null, from: null, to: null }); return; }
    if (holder) holder.titre = info.title;
    checkCitation(at, holder, info, basis.citation, `#source:${basis.source}`);
    if (info.kind === 'decision') {
      if (info.history?.statut === 'remise en cause') add('erreur', `${at}.source`, `décision remise en cause par un recours (${info.history.details.join(' ; ')}) : cite la décision rendue sur ce recours`, `${info.title} a été remise en cause par un recours : ${info.history.details.join(' ; ')}.`, `#source:${basis.source}`);
      else if (info.history?.statut === 'à examiner') add('manque', `${at}.source`, `historique judiciaire à examiner${info.history.details.length ? ` (${info.history.details.join(' ; ')})` : ''} : vérifie qu’aucun recours ne l’a remise en cause`, `${info.title} : l’historique judiciaire est à examiner.`, `#source:${basis.source}`);
      basisChecks.set(at, { kind: 'decision', from: null, to: null });
      return;
    }
    const version = info.validity ? `en vigueur ${info.validity.to ? `du ${day(info.validity.from)} au ${day(info.validity.to)}` : `depuis le ${day(info.validity.from)}`}` : '';
    if (!basis.vigueur && info.kind === 'texte') add('manque', `${at}.vigueur`, `vigueur non renseignée : ajoute vigueur: { debut, fin }${info.validity ? ` (version citée : debut '${info.validity.from}', fin ${info.validity.to ? `'${info.validity.to}'` : 'null'})` : ''}`, `La version applicable de ${info.title} n’est pas précisée${version ? ` (version relue : ${version})` : ''}.`, `#source:${basis.source}`);
    else if (basis.vigueur && info.validity && (basis.vigueur.debut !== info.validity.from || basis.vigueur.fin !== info.validity.to)) add('erreur', `${at}.vigueur`, `vigueur différente de la version citée : debut '${info.validity.from}', fin ${info.validity.to ? `'${info.validity.to}'` : 'null'}`, `${info.title} : la version indiquée ne correspond pas au texte relu (${version}).`, `#source:${basis.source}`);
    const known = Boolean(info.validity || basis.vigueur);
    basisChecks.set(at, { kind: info.kind, from: known ? info.validity?.from ?? basis.vigueur!.debut : null, to: info.validity ? info.validity.to : basis.vigueur?.fin ?? null });
  };

  const occurrences: Array<{ at: string; condition: Condition }> = [];
  const walk = (condition: Condition, at: string) => {
    occurrences.push({ at, condition });
    condition.l_une?.forEach((member, index) => walk(member, `${at}.l_une[${index}]`));
  };
  const foundations: Array<{ at: string; name: string; foundation: Foundation }> = [];
  for (const [name, term] of reasoning.terms) {
    term.si.forEach((condition, index) => walk(condition, `${name}.si[${index}]`));
    term.sauf.forEach((condition, index) => walk(condition, `${name}.sauf[${index}]`));
    for (const side of SIDES) term.fondements?.[side].forEach((foundation, index) => {
      const place = `${name}.${side}[${index}]`;
      foundations.push({ at: place, name, foundation });
      occurrences.push({ at: place, condition: { selon: foundation.selon } });
      foundation.si.forEach((condition, other) => walk(condition, `${place}.si[${other}]`));
    });
  }
  const checks: Array<Promise<void>> = [];
  for (const { at, condition } of occurrences) {
    condition.selon.forEach((basis, index) => {
      checks.push(checkBasis(`${at}.selon[${index}]`, basis));
      basis.renvoi.forEach((target, other) => checks.push(checkTarget(`${at}.selon[${index}].renvoi[${other}]`, target)));
    });
    if (condition.mesure?.delai && !condition.decompte) add('manque', `${at}.decompte`, `délai sans décompte : ajoute decompte: '${derivedName('décompte', condition.condition!, spaced)}' et définis ce terme, dont les conditions sourcées établissent la règle de calcul du délai`, `${human(condition.condition!)} : la règle sur laquelle se fonde le calcul du délai n’est pas mentionnée.`, condition.condition);
  }
  for (const { at, foundation } of foundations) foundation.preuve.forEach((ref, index) => checks.push(checkRef(`${at}.preuve[${index}]`, ref)));
  for (const [name, entry] of reasoning.valeurs) {
    entry.preuve.forEach((ref, index) => checks.push(checkRef(`valeurs.${name}.preuve[${index}]`, ref)));
    entry.selon.forEach((basis, index) => checks.push(checkBasis(`valeurs.${name}.selon[${index}]`, basis)));
  }
  await Promise.all(checks);
  for (const [name, entry] of reasoning.valeurs) entry.selon.forEach((basis, index) => { if (basisChecks.get(`valeurs.${name}.selon[${index}]`)?.kind === 'piece') add('erreur', `valeurs.${name}.selon[${index}].source`, `${basis.source} est une pièce : une donnée stipulée ou constatée se prouve par preuve: [{ piece, citation }] ; selon cite le texte qui fixe une valeur (taux, seuil, barème)`); });

  const correspondences = await verifyCitationLinks({ cwd, reasoning, contexte: canonical(stripAnnotations(annotated) as Record<string, unknown>, reasoning), connectors, lookup, corrections, online: input.online !== false, readable: !issues.some((issue) => issue.kind === 'erreur') });
  for (const [place, result] of correspondences) {
    const holder = node(annotated, place);
    if (holder) holder.correspondance = result;
    if (result.reponse !== 'validé') add(result.reponse === 'non validé' ? 'erreur' : 'manque', place, `correspondance citation–affirmation : ${result.reponse} — ${result.explication}`, result.explication);
    emit({ key: `correspondance:${place}`, step: 'source', status: result.reponse === 'validé' ? 'ok' : result.reponse === 'non validé' ? 'alerte' : 'neutre', subject: place, text: `${result.reponse} — ${result.explication}` });
  }
  const supported = (place: string) => !correspondences.has(place) || correspondences.get(place)!.reponse === 'validé';

  const computing = new Set<string>();
  const stating = new Set<string>();
  const test = compile(reasoning);
  const sourced = (name: string, holdsIn: (name: string) => ReasoningValue) => reasoning.valeurs.get(name)!.selon.some((basis, index) => {
    const check = basisChecks.get(`valeurs.${name}.selon[${index}]`);
    if (!check || check.kind === 'piece' || check.kind === null) return false;
    return (check.kind === 'decision' || inForceAt(basis, check) === true) && [basis.applicabilite, basis.version].every((control) => !control || holdsIn(control) === true);
  });
  const stated = (name: string, check: (name: string) => ReasoningValue = holds) => {
    const entry = reasoning.valeurs.get(name);
    if (!entry || entry.valeur === null || stating.has(name) || !supported(`valeurs.${name}`)) return null;
    stating.add(name);
    const proven = entry.preuve.some((_, index) => verifiedRefs.get(`valeurs.${name}.preuve[${index}]`)) || sourced(name, check);
    stating.delete(name);
    return proven ? entry.valeur : null;
  };
  const computedValue = (name: string): number | null => {
    const formula = reasoning.valeurs.get(name)?.formule;
    if (!formula || computing.has(name)) return null;
    computing.add(name);
    const result = evaluate(formula, valueOf, holds);
    computing.delete(name);
    return result;
  };
  const valueOf = (name: string): string | number | null => stated(name) ?? computedValue(name);
  const leaf = (name: string): ReasoningValue => {
    const measure = reasoning.computed.get(name);
    return measure ? calculate(measure, valueOf).value : null;
  };
  const proven = (place: string, count: number) => supported(place) && Array.from({ length: count }, (_, index) => verifiedRefs.get(`${place}.preuve[${index}]`)).some(Boolean);
  const baseFacts: Facts = { leaf, basis: (at, condition, applicable) => basisValue(at, condition, applicable), proven };
  function holds(name: string): ReasoningValue { return reasoning.terms.has(name) ? test(baseFacts, undefined, [name]).get(name) ?? null : leaf(name); }
  const sides = new Map<string, ReasoningValue[]>();
  const disputed = (name: string) => {
    if (!reasoning.terms.get(name)?.fondements) return false;
    if (!sides.has(name)) {
      const trace: Trace = new Map();
      test(baseFacts, trace, [name]);
      sides.set(name, [trace.get(`${name}:true`) ?? null, trace.get(`${name}:false`) ?? null]);
    }
    return sides.get(name)!.every((value) => value === true);
  };
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const dateOf = (basis: Basis, check?: BasisCheck) => { const value = basis.vigueur?.au ? valueOf(basis.vigueur.au) : null; return typeof value === 'string' ? value : reasoning.qualification === 'drafting' && check?.kind === 'texte' ? today : null; };
  const inForceAt = (basis: Basis, check: BasisCheck): ReasoningValue => {
    const date = dateOf(basis, check);
    if (date && check.from) return inForce(date, check.from, check.to);
    return check.kind === 'piece' && !basis.vigueur?.au ? true : null;
  };

  const basisValue = (at: string, condition: Condition, applicable: ReasoningValue[]): ReasoningValue => {
    if (!supported(at)) return null;
    if (!condition.selon.length) return true;
    const checked = condition.selon.map((basis, index) => ({ basis, check: basisChecks.get(`${at}.selon[${index}]`), applicable: applicable[index] }));
    const texts = checked.filter((entry) => entry.check && entry.check.kind !== 'decision');
    if (texts.length) return or(texts.map((entry) => and([inForceAt(entry.basis, entry.check!), entry.applicable])));
    const decisions = checked.filter((entry) => entry.check?.kind === 'decision');
    return decisions.length ? or(decisions.map((entry) => entry.applicable)) : null;
  };
  const tree = (root: string) => {
    const found = new Set<string>();
    const collect = (name: string) => {
      if (found.has(name) || !reasoning.terms.has(name)) return;
      found.add(name);
      const term = reasoning.terms.get(name)!;
      const walkCollect = (condition: Condition) => { if (condition.l_une) condition.l_une.forEach(walkCollect); else collect(condition.condition!); };
      [...term.si, ...term.sauf, ...SIDES.flatMap((side) => (term.fondements?.[side] ?? []).flatMap((entry) => entry.si))].forEach(walkCollect);
    };
    collect(root);
    return found;
  };
  const actValidities = new Set(reasoning.objectifs.map((objective) => objective.validite).filter((name): name is string => Boolean(name)));
  const validityRoots = [...reasoning.objectifs.map((objective) => objective.validite), ...occurrences.flatMap(({ condition }) => condition.selon.map((basis) => basis.validite))].filter((name): name is string => Boolean(name));
  const applicabilityTerms = new Set([...occurrences.flatMap(({ condition }) => condition.selon), ...[...reasoning.valeurs.values()].flatMap((entry) => entry.selon)].flatMap((basis) => [basis.applicabilite, basis.version].flatMap((control) => (control ? [...tree(control)] : []))));
  const validityTerms = new Set(validityRoots.flatMap((name) => [...tree(name)]));
  const citesLaw = (name: string, kinds = ['texte']) => occurrences.some(({ at, condition }) => tree(name).has(at.split('.')[0]) && condition.selon.some((_, index) => kinds.includes(basisChecks.get(`${at}.selon[${index}]`)?.kind ?? '')));
  for (const name of new Set(validityRoots)) if (reasoning.terms.has(name) && !citesLaw(name)) add('manque', name, 'la validité s’apprécie au regard du droit applicable : cite dans ce terme le texte qui la fonde (selon: [{ source, citation, vigueur }])', `${human(name)} : le texte qui fonde la validité n’est pas cité.`, name);
  const timeRoots = [...occurrences.flatMap(({ condition }) => condition.selon), ...[...reasoning.valeurs.values()].flatMap((entry) => entry.selon)].map((basis) => basis.version).filter((name): name is string => Boolean(name));
  for (const name of new Set(timeRoots)) if (reasoning.terms.has(name) && !citesLaw(name)) add('manque', name, 'la version applicable dépend de la règle d’application dans le temps : cite dans ce terme le texte qui la fixe (selon: [{ source, citation, vigueur }]) et établis par une pièce que ses conditions sont remplies', `${human(name)} : la règle qui fixe la version applicable du texte n’est pas citée.`, name);
  const countRoots = occurrences.map(({ condition }) => condition.decompte).filter((name): name is string => Boolean(name));
  for (const name of new Set(countRoots)) if (reasoning.terms.has(name) && !citesLaw(name, ['texte', 'piece'])) add('manque', name, 'le délai se fonde sur une règle : cite dans ce terme le texte ou la clause qui fixe le délai et son décompte (selon: [{ source, citation }]) et établis par une pièce que ses conditions sont remplies', `${human(name)} : la règle qui fonde le délai n’est pas citée.`, name);
  const declared = (name: string, at: string) => { if (!reasoning.valeurs.has(name)) add('manque', at, `${name} n’est pas déclarée : ajoute valeurs: { ${name}: { valeur, preuve } } (valeur: null si le dossier ne la fixe pas)`, `${human(name)} : cette donnée n’est pas renseignée.`, at.split('.')[0], `valeurs.${name}`); };
  for (const { at, condition } of occurrences) {
    const delay = condition.mesure?.delai;
    const amount = condition.mesure?.montant;
    if (delay) [delay.de, delay.a].forEach((name) => declared(name, at));
    if (amount) {
      declared(amount.valeur, at);
      if (typeof amount.seuil === 'string') declared(amount.seuil, at);
      else add('manque', `${at}.montant`, `seuil écrit en dur (${amount.seuil}) : déclare-le dans valeurs avec sa preuve (pièce) ou sa source (selon : texte) et désigne-le par son nom`, `${human(condition.condition!)} : le seuil de ${amount.seuil} n’est rattaché à aucune pièce.`, condition.condition);
    }
    condition.selon.forEach((basis) => { if (basis.vigueur?.au) declared(basis.vigueur.au, at); });
  }
  const drafting = reasoning.qualification === 'drafting';
  const consultation = reasoning.qualification === 'consultation';
  for (const name of reasoning.terms.keys()) if (disputed(name)) add('manque', name, `${name} : fondements contraires, à trancher`, `${human(name)} : des fondements contraires sont établis, à trancher.`, name);
  const conditionNames = new Set(occurrences.map(({ condition }) => condition.condition).filter((name): name is string => Boolean(name)));
  for (const [name, entry] of reasoning.valeurs) {
    if (!entry.formule) continue;
    for (const operand of new Set(formulaNames(entry.formule))) declared(operand, `valeurs.${name}`);
    for (const condition of new Set(formulaConditions(entry.formule))) if (!reasoning.terms.has(condition) && !conditionNames.has(condition) && !reasoning.valeurs.has(condition)) add('erreur', `valeurs.${name}.formule`, `si : ${condition} n’est ni un terme ni une condition du raisonnement : définis ${condition}: { si: [...] }`);
    const numbers = formulaNumbers(entry.formule);
    if (!entry.preuve.length && !entry.selon.length) add('manque', `valeurs.${name}`, `mode de calcul sans règle : cite la clause (preuve) ou le texte (selon) qui fixe ce calcul${numbers.length ? ` et les nombres écrits dans la formule (${numbers.join(', ')})` : ''}`, `${human(name)} : la règle qui fixe le mode de calcul n’est pas citée.`);
    const statedValue = stated(name);
    const result = computedValue(name);
    if (typeof statedValue === 'number' && result !== null && Math.abs(statedValue - result) > 0.005) add('manque', `valeurs.${name}`, `montant stipulé (${statedValue}) différent du calcul (${result}) : à rectifier`, `${human(name)} : le montant indiqué (${statedValue}) ne correspond pas au calcul (${result}).`);
  }
  for (const [name, entry] of reasoning.valeurs) if (entry.valeur !== null && !entry.preuve.length && !entry.selon.length) add('manque', `valeurs.${name}`, 'valeur sans preuve : ajoute preuve: [{ piece, citation }] (pièce) ou selon: [{ source, citation, vigueur }] (texte qui la fixe), ou valeur: null si le dossier ne la fixe pas', `${human(name)} : aucune pièce ni aucun texte ne justifie cette valeur.`);

  const statuses = new Map<string, ReasoningValue>();
  const vigueurs = new Map<string, ReasoningValue>();
  const decisiveLeaves = new Set<string>();
  const decisiveFor = new Map<string, Objective[]>();
  const trials = shape.cycles.length ? [] : runTrials(reasoning, test, { leaf, proven, supported, value: (name, check) => stated(name, check) ?? computedValue(name) });
  const supposing = (names: string[], roots: string[]) => reasoning.hypotheses.filter((trial, index) => trials[index]?.conforme && names.some((name) => name in trial.faits) && roots.some((root) => root in trial.attendu));
  const bracketed = (names: string[], objective: Objective) => objectiveRoots(objective).some((root) => new Set(supposing(names, [root]).map((trial) => String(trial.attendu[root]))).size > 1);
  const open = (formula: Formula, found: Set<string>, seen: Set<string>) => {
    if (formula.operation === 'si') {
      const held = holds(formula.condition);
      if (held === null) found.add(formula.condition);
      for (const branch of held === null ? [formula.alors, formula.sinon] : [held ? formula.alors : formula.sinon]) if (typeof branch === 'object') open(branch, found, seen); else if (typeof branch === 'string') openValue(branch, found, seen);
      return;
    }
    const items = formula.operation === 'bareme' ? [formula.assiette, ...formula.tranches.flatMap((tranche) => [tranche.jusqu_a, tranche.taux])] : formula.termes;
    for (const item of items) if (typeof item === 'string') openValue(item, found, seen); else if (item && typeof item === 'object') open(item, found, seen);
  };
  const openValue = (name: string, found: Set<string>, seen: Set<string>) => {
    if (seen.has(name) || valueOf(name) !== null) return;
    seen.add(name);
    const formula = reasoning.valeurs.get(name)?.formule;
    if (formula && reasoning.valeurs.get(name)!.valeur === null) open(formula, found, seen); else found.add(name);
  };
  reasoning.objectifs.forEach((objective, index) => {
    if (shape.cycles.length) return;
    if (amountObjective(objective)) {
      const trace: Trace = new Map();
      const controls = objectiveRoots(objective).filter((name) => reasoning.terms.has(name));
      const checked = and([...test(baseFacts, trace, controls).values()]);
      for (const [key, item] of trace) if (!statuses.has(key)) statuses.set(key, item);
      const amount = valueOf(objective.effet);
      const statut = typeof amount !== 'number' ? 'à établir' : STATUS(checked);
      const holder = node(annotated, `objectifs[${index}]`);
      if (holder) Object.assign(holder, { statut, montant_calcule: typeof amount === 'number' ? amount : null });
      const missing = new Set<string>();
      openValue(objective.effet, missing, new Set());
      for (const name of missing) {
        const isValue = reasoning.valeurs.has(name);
        const at = isValue ? `valeurs.${name}` : `objectifs[${index}]`;
        if (isValue && reasoning.valeurs.get(name)!.selon.length && reasoning.valeurs.get(name)!.valeur !== null) { add('manque', at, `${objective.effet} dépend de ${name}, dont la source n’est pas acquise : établis sa vigueur à la date et son applicabilité`, `${human(objective.effet)} dépend de ${phrase(name)}, dont le texte n’est pas encore établi comme applicable.`); continue; }
        const covered = supposing([name], [objective.effet]).length > 0;
        if (name === objective.effet) {
          if (!((drafting || consultation) && covered)) add('manque', at, `but non renseigné. Écris sa formule et son texte (selon), ou son montant et sa preuve (pièce ou selon)${drafting || consultation ? `, ou des hypothèses avec le montant attendu` : ''}.`, `Le but ${phrase(name)} n’a ni formule ni montant.`);
          continue;
        }
        const supposed = `ajoute une hypothèse qui la suppose (faits) et donne le montant attendu de ${objective.effet}`;
        if (drafting && !covered) add('manque', at, `${objective.effet} dépend de ${name}, que le projet ne fixe pas : ${isValue ? 'fixe-la dans valeurs, ou ' : ''}${supposed}`, `${human(objective.effet)} dépend de ${phrase(name)}, que le projet ne fixe pas.`, isValue ? undefined : name);
        if (!drafting && !(consultation && covered)) add('manque', at, isValue ? `${objective.effet} dépend de ${name} : renseigne-la dans valeurs, avec sa preuve (pièce) ou sa source (selon : texte)${consultation ? `, ou ${supposed}` : ''}` : `${objective.effet} dépend de ${name} : établis ce point (preuve, ou ses propres conditions)${consultation ? `, ou ${supposed}` : ''}`, `${human(objective.effet)} dépend de ${phrase(name)}, qui n’est pas établi.`, isValue ? undefined : name);
      }
      return;
    }
    if (!reasoning.terms.has(objective.effet)) return;
    const facts: Facts = { leaf, proven, basis: (at, condition, applicable) => { const value = basisValue(at, condition, applicable); if (!vigueurs.has(at)) vigueurs.set(at, value); return value; } };
    const trace: Trace = new Map();
    const value = answer(objective, test(facts, trace, objectiveRoots(objective)));
    for (const [key, item] of trace) if (!statuses.has(key)) statuses.set(key, item);
    const reachable = [...new Set(objectiveRoots(objective).flatMap((root) => [...reachableLeaves(reasoning, root)]))];
    const unknown = reachable.filter((name) => holds(name) === null).sort();
    const found = value === null ? decisive(test, facts, objective, unknown) : { decisive: [], inPlay: false };
    for (const name of found.decisive) { decisiveLeaves.add(name); decisiveFor.set(name, [...(decisiveFor.get(name) ?? []), objective]); }
    const holder = node(annotated, `objectifs[${index}]`);
    const personnes = input.persons.filter((person) => objective.objectif.includes(person.label)).map((person) => person.label);
    if (holder) Object.assign(holder, { statut: STATUS(value), ...(found.decisive.length ? { [found.inPlay ? 'en_jeu' : 'decisifs']: found.decisive } : {}), ...(personnes.length ? { personnes } : {}) });
  });

  const controlSlots: Array<string | null> = [];
  const sourceIssues = (place: string, basis: Basis) => {
    const check = basisChecks.get(place);
    const source = node(annotated, place);
    const title = String(source?.titre ?? basis.source);
    const date = dateOf(basis, check);
    if (source && check?.kind && check.kind !== 'decision') source.en_vigueur = date && check.from ? inForce(date, check.from, check.to) : null;
    const au = basis.vigueur?.au;
    if (date && source?.en_vigueur === false) add(drafting ? 'erreur' : 'manque', `${place}.vigueur`, `version non applicable : elle n’était pas en vigueur au ${date} (${au && typeof valueOf(au) === 'string' ? au : 'date du jour'}) ; cite la version en vigueur à cette date`, `${title} : la version citée n’était pas en vigueur au ${day(date)}.`, `#source:${basis.source}`);
    if (check?.kind === 'texte' && !au && !drafting) add('manque', `${place}.vigueur`, `applicabilité dans le temps non établie : ajoute vigueur: { debut, fin, au: '${spaced ? 'nom de la date' : 'nom_de_date'}' }, la date de valeurs (avec sa preuve) à laquelle s’apprécie la version applicable`, `${title} : l’applicabilité du texte dans le temps n’est pas établie.`, `#source:${basis.source}`);
    else if (check?.kind === 'texte' && !date) add('manque', `${place}.vigueur`, `${au} : renseigne cette date dans valeurs, avec sa preuve`, `${title} : la date qui fixe la version applicable (${phrase(au!)}) n’est pas établie par une pièce.`, `#source:${basis.source}`, `valeurs.${au}`);
    return title;
  };
  const applicability = (place: string, basis: Basis, title: string) => {
    if (basisChecks.get(place)?.kind !== 'texte') return;
    controlSlots.push(basis.applicabilite ?? null);
    if (!basis.applicabilite) add('manque', `${place}.applicabilite`, `applicabilité non établie : ajoute applicabilite: '${applicabilityName(title, spaced)}' et définis ce terme, dont les conditions établissent que ce texte s’applique au dossier`, `${title} : l’applicabilité de ce texte au dossier n’est pas justifiée.`, `#source:${basis.source}`);
    if (drafting) return;
    controlSlots.push(basis.version ?? null);
    if (!basis.version) add('manque', `${place}.version`, `version applicable non établie : ajoute version: '${derivedName('version', applicabilityName(title, spaced).replace(/^applicabilité(?: de |_de_)/u, ''), spaced)}' et définis ce terme : cite la règle qui fixe la version applicable (entrée en vigueur, dispositions transitoires) et établis par une pièce qu’elle est remplie`, `${title} : la règle qui rend cette version applicable au dossier n’est pas citée.`, `#source:${basis.source}`);
  };
  for (const objective of reasoning.objectifs) {
    if (reasoning.qualification === 'drafting' || objective.validite) controlSlots.push(objective.validite ?? null);
    if (reasoning.qualification === 'contentieux' || objective.prescription) controlSlots.push(objective.prescription ?? null);
  }
  for (const { condition } of occurrences) if (condition.mesure?.delai) controlSlots.push(condition.decompte ?? null);
  const groundsOpen = (fact: string) => {
    const pending = [...new Set(SIDES.flatMap((side) => (reasoning.terms.get(fact)?.fondements?.[side] ?? []).flatMap((entry) => entry.si.flatMap(function names(condition: Condition): string[] { return condition.l_une ? condition.l_une.flatMap(names) : [condition.condition!]; }))))].filter((name) => holds(name) === null);
    return pending.length ? `${fact} décide de la réponse : ses fondements dépendent de ${pending.join(', ')}, à établir ; établis ${pending.length > 1 ? 'ces questions' : 'cette question'} plutôt que d’ajouter un fondement` : `${fact} décide de la réponse : aucun de ses fondements n’est établi ; vérifie leurs citations et, pour chaque texte, son applicabilité et sa vigueur`;
  };
  for (const { at, condition } of occurrences) {
    const holder = node(annotated, at);
    if (!holder) continue;
    const fact = condition.condition && isLeaf(reasoning, condition.condition) ? condition.condition : null;
    holder.statut = fact && disputed(fact) ? 'disputé' : STATUS(statuses.get(at) ?? null);
    const result = condition.mesure ? calculate(condition.mesure, valueOf) : null;
    if (result?.calcul) holder.calcul = result.calcul;
    if (fact && decisiveLeaves.has(fact)) {
      holder.decisif = true;
      if (drafting && result?.missing.length && !(decisiveFor.get(fact) ?? []).some((objective) => bracketed([fact, ...result.missing], objective))) add('manque', at, `${fact} décide de la réponse et dépend de ${result.missing.join(', ')}, que le projet ne fixe pas : fixe ${result.missing.length > 1 ? 'ces valeurs' : 'cette valeur'} dans valeurs, ou ajoute des hypothèses qui montrent quand la réponse change`, `${human(fact)} : la réponse dépend de ${listing(result.missing.map(phrase))}, que le projet ne fixe pas.`, fact);
      if (reasoning.qualification !== 'drafting' && result && !(consultation && (decisiveFor.get(fact) ?? []).some((objective) => bracketed([fact, ...result.missing], objective)))) add('manque', at, `${fact} décide de la réponse : renseigne ${result.missing.join(', ')} dans valeurs, avec sa preuve (pièce) ou sa source (selon : texte)${consultation ? ', ou ajoute des hypothèses qui montrent quand la réponse change' : ''}`, `${human(fact)} : ${listing(result.missing.map(phrase))} ${result.missing.length > 1 ? 'ne sont pas établis' : 'n’est pas établi'} par une pièce, alors que la réponse en dépend.`, fact);
      else if (reasoning.qualification !== 'drafting' && !result && !disputed(fact)) add('manque', at, reasoning.terms.get(fact)?.fondements ? groundsOpen(fact) : reasoning.terms.has(fact) ? `${fact} décide de la réponse : ajoute un fondement (preuve ou selon) sous true ou false de ${fact}` : `${fact} décide de la réponse : ajoute ${fact}: { true: [{ preuve: [{ piece, citation }] }] } (ou false) à la racine, ou précise ce terme par son propre bloc`, `${human(fact)} : aucune pièce ne l’établit, alors que la réponse en dépend.`, fact);
    }
    condition.selon.forEach((basis, index) => {
      const place = `${at}.selon[${index}]`;
      const check = basisChecks.get(place);
      const title = sourceIssues(place, basis);
      const exempt = applicabilityTerms.has(at.split('.')[0]);
      const clauseExempt = validityTerms.has(at.split('.')[0]) || applicabilityTerms.has(at.split('.')[0]);
      if (basis.validite && actValidities.has(basis.validite)) add('erreur', `${place}.validite`, `validite : ${basis.validite} est le contrôle de validité de l’acte ; une clause a son propre contrôle (ex. ${derivedName('validité', `la clause ${condition.condition ?? at.split('.')[0]}`, spaced)})`);
      if (check?.kind === 'piece' && !clauseExempt) controlSlots.push(basis.validite ?? null);
      if (check?.kind === 'piece' && !basis.validite && !clauseExempt) add('manque', `${place}.validite`, `validité de la clause non établie : ajoute validite: '${derivedName('validité', `la clause ${condition.condition ?? at.split('.')[0]}`, spaced)}' et définis ce terme, dont les conditions établissent que la clause est valable au regard du droit applicable`, `${title} : la validité de la clause n’est pas établie.`, `#source:${basis.source}`);
      if (check?.kind === 'piece' && /\b(code|cgi|loi n|ordonnance n|décret n)/i.test(basis.citation) && /\barticles?\b/i.test(basis.citation) && !condition.selon.some((_, other) => basisChecks.get(`${at}.selon[${other}]`)?.kind === 'texte')) add('manque', place, 'la clause renvoie à un texte de loi : ajoute ce texte à selon (source, citation, vigueur)', `${title} : la clause renvoie à un texte de loi qui n’est pas cité.`, `#source:${basis.source}`);
      if (!exempt) applicability(place, basis, title);
    });
  }
  if (!shape.cycles.length) {
    const flipped = (flip: { leaf?: string; at?: string }): Facts => ({
      leaf: (name) => { if (name !== flip.leaf) return leaf(name); const value = holds(name); return value !== null ? !value : value; },
      proven,
      basis: (at, condition, applicable) => { const value = basisValue(at, condition, applicable); return at === flip.at && value !== null ? !value : value; },
    });
    const amountUnder = (name: string, facts: Facts, seen: Set<string>): number | null => {
      const fixed = stated(name);
      const formula = reasoning.valeurs.get(name)?.formule;
      if (fixed !== null || !formula || seen.has(name)) return typeof fixed === 'number' ? fixed : null;
      return evaluate(formula, (operand) => amountUnder(operand, facts, new Set([...seen, name])), (condition) => (reasoning.terms.has(condition) ? test(facts, undefined, [condition]).get(condition) ?? null : facts.leaf(condition)));
    };
    const score = (objective: Objective, facts: Facts) => (amountObjective(objective) ? amountUnder(objective.effet, facts, new Set()) : answer(objective, test(facts, undefined, objectiveRoots(objective))));
    const gap = (objective: Objective, value: ReasoningValue | number) => (amountObjective(objective) ? (typeof value === 'number' ? (objective.verbe === 'réduire' ? value : -value) : Infinity) : value === null ? 1 : value === (objective.verbe === 'obtenir') ? 0 : 2);
    const regimes = (name: string, seen: Set<string>): string[] => {
      const formula = reasoning.valeurs.get(name)?.formule;
      if (!formula || seen.has(name)) return [];
      seen.add(name);
      return [...formulaConditions(formula), ...formulaNames(formula).flatMap((operand) => regimes(operand, seen))];
    };
    const gaps = reasoning.objectifs.map((objective) => gap(objective, score(objective, baseFacts)));
    const located = (name: string, index: number) => occurrences.find(({ condition }) => condition.condition === name)?.at ?? [...reasoning.valeurs].filter(([, entry]) => entry.formule && formulaConditions(entry.formule).includes(name)).map(([value]) => `valeurs.${value}.formule`)[0] ?? `objectifs[${index}]`;
    reasoning.objectifs.forEach((objective, index) => {
      if (gaps[index] === 0) { const holder = node(annotated, `objectifs[${index}]`); if (holder) holder.atteint = true; return; }
      const scope = amountObjective(objective) ? [...new Set(regimes(objective.effet, new Set()))] : objectiveRoots(objective);
      const bases = new Map<string, ReasoningValue>();
      test({ leaf, proven, basis: (at, condition, applicable) => { const value = basisValue(at, condition, applicable); bases.set(at, value); return value; } }, undefined, scope.filter((name) => reasoning.terms.has(name)));
      const leaves = [...new Set(scope.flatMap((root) => [...reachableLeaves(reasoning, root)]))].filter((name) => holds(name) !== null);
      const found: string[] = [];
      const places = new Set<string>();
      const flips = [...leaves.map((name) => ({ leaf: name, at: located(name, index) })), ...occurrences.filter(({ at, condition }) => condition.selon.length && bases.has(at) && bases.get(at) !== null).map(({ at, condition }) => ({ basis: condition.condition ?? `l’alternative de ${at.split('.')[0]}`, at }))];
      for (const flip of flips) {
        if (!('leaf' in flip) && places.has(flip.at)) continue;
        const facts = flipped('leaf' in flip ? { leaf: flip.leaf } : { at: flip.at });
        if (gap(objective, score(objective, facts)) >= gaps[index]) continue;
        const tension = reasoning.objectifs.filter((other, at) => at !== index && gap(other, score(other, facts)) > gaps[at]).map((other) => other.objectif);
        const name = 'leaf' in flip ? flip.leaf! : flip.basis!;
        const value = 'leaf' in flip ? holds(flip.leaf!) : bases.get(flip.at);
        const goal = `l’objectif « ${objective.objectif} »`;
        const advice = 'leaf' in flip
          ? `${name} ${value ? 'fait obstacle à' : 'manque à'} ${goal} : ${reasoning.computed.has(name) ? 'discute les valeurs du calcul ou la règle qui le fixe' : value ? 'conteste-le (une pièce sous false) ou l’interprétation de la règle qui le retient' : 'établis-le par une pièce (sous true) ou par une autre interprétation de la règle'}, ou cherche une exception (sauf) ou un autre fondement (l_une)`
          : value ? `la source de ${name} fait obstacle à ${goal} : discute son interprétation, sa version ou son applicabilité, ou cherche une source contraire` : `la source de ${name} ne compte pas alors que ${goal} en dépend : établis sa version et son applicabilité, ou cherche une autre source`;
        add('manque', flip.at, `${advice}${tension.length ? ` ; en tension avec ${tension.map((other) => `l’objectif « ${other} »`).join(', ')} : à arbitrer` : ''}`, `${'leaf' in flip ? human(name) : `La source de ${phrase(name)}`} ${value ? 'fait obstacle à' : 'manque à'} l’objectif : ${objective.objectif}.${tension.length ? ` En tension avec : ${tension.join(' ; ')}.` : ''}`, 'leaf' in flip ? name : undefined);
        places.add(flip.at);
        found.push(name);
      }
      const holder = node(annotated, `objectifs[${index}]`);
      if (holder) Object.assign(holder, { ...(amountObjective(objective) ? {} : { atteint: gaps[index] === 2 ? false : null }), ...(found.length ? { obstacles: [...new Set(found)] } : {}) });
      if (gaps[index] === 2 && !found.length) add('manque', `objectifs[${index}]`, 'objectif non atteint et aucun élément seul ne le fait basculer : cherche un autre fondement (l_une), une exception (sauf) ou une autre lecture des règles retenues', `Objectif non atteint : ${objective.objectif}.`);
    });
  }
  for (const [name, entry] of reasoning.valeurs) entry.selon.forEach((basis, index) => applicability(`valeurs.${name}.selon[${index}]`, basis, sourceIssues(`valeurs.${name}.selon[${index}]`, basis)));
  for (const name of reasoning.terms.keys()) if (!statuses.has(name)) statuses.set(name, holds(name));
  for (const name of reasoning.terms.keys()) { const holder = node(annotated, name); if (holder) holder.statut = disputed(name) ? 'disputé' : STATUS(statuses.get(name) ?? null); }
  for (const name of reasoning.valeurs.keys()) { const holder = node(annotated, `valeurs.${name}`); if (holder) { holder.statut = valueOf(name) === null ? 'à établir' : 'acquis'; const result = computedValue(name); if (result !== null) holder.calcul = result; } }
  for (const name of [...shape.leaves].sort()) {
    const measure = reasoning.computed.get(name);
    if (measure) {
      const result = calculate(measure, valueOf);
      emit({ key: `fait:${name}`, step: 'fait', status: result.value === null ? (decisiveLeaves.has(name) ? 'alerte' : 'neutre') : 'ok', subject: human(name), text: `${explain(measure, result)}${decisiveLeaves.has(name) ? ' · décisif' : ''}` });
      continue;
    }
    const question = reasoning.terms.get(name)?.fondements;
    const value = question ? holds(name) : null;
    const cited = (side: 'true' | 'false') => [...new Set(foundations.filter((item) => item.name === name && item.at.startsWith(`${name}.${side}[`)).flatMap((item) => item.foundation.preuve.map((_, index) => `${item.at}.preuve[${index}]`)).filter((at) => verifiedRefs.get(at)).map((at) => node(annotated, at)).filter((ref) => ref?.titre).map((ref) => `${String(ref!.titre)} : « ${String(ref!.citation ?? '')} »`))].join(', ');
    const proofs = question ? foundations.some((item) => item.name === name && item.foundation.preuve.length > 0) : false;
    emit({ key: `fait:${name}`, step: 'fait', status: value === null && !disputed(name) ? (decisiveLeaves.has(name) ? 'alerte' : 'neutre') : 'ok', subject: human(name), text: disputed(name) ? 'Disputé : des fondements opposés sont établis' : value === true ? `Prouvé par ${cited('true') || 'le texte cité'}` : value === false ? `Contredit par ${cited('false') || 'le texte cité'}` : `${proofs ? 'Les pièces citées ne l’établissent pas' : 'Aucune pièce citée'}${decisiveLeaves.has(name) ? ' · décisif' : ''}` });
  }
  for (const name of reasoning.terms.keys()) emit({ key: `terme:${name}`, step: 'condition', status: statuses.get(name) === null || statuses.get(name) === undefined ? 'neutre' : 'ok', subject: human(name), text: disputed(name) ? ANSWER.disputé : ANSWER[STATUS(statuses.get(name) ?? null)] });

  trials.forEach((result, index) => {
    const holder = node(annotated, `hypotheses[${index}]`);
    if (holder) Object.assign(holder, result);
    emit({ key: `essai:${index}`, step: 'essai', status: result.conforme ? 'ok' : 'alerte', subject: reasoning.hypotheses[index].nom, text: result.conforme ? 'Conforme' : `Non conforme : obtenu ${Object.entries(result.obtenu).map(([name, value]) => `${human(name)} = ${shown(value)}`).join(', ')}` });
    if (!result.conforme) add('erreur', `hypotheses[${index}]`, `hypothèse non conforme : obtenu ${Object.entries(result.obtenu).map(([name, value]) => `${name} = ${shown(value)}`).join(', ')}`, `L’hypothèse « ${reasoning.hypotheses[index].nom} » ne donne pas le résultat attendu : ${Object.entries(result.obtenu).map(([name, value]) => told(name, value)).join(', ')}.`);
  });

  if (reasoning.acte.length) {
    const inScope = (names: string[]) => {
      const terms = new Set<string>();
      const facts = new Set<string>();
      const values = new Set<string>();
      const expand = (name: string) => {
        if (reasoning.terms.has(name)) {
          if (terms.has(name)) return;
          terms.add(name);
          for (const { at, condition } of occurrences) {
            if (at.split('.')[0] !== name) continue;
            if (condition.condition) expand(condition.condition);
            if (condition.decompte) expand(condition.decompte);
            const measure = condition.mesure;
            [measure?.delai?.de, measure?.delai?.a, measure?.montant?.valeur, measure?.montant?.seuil].forEach((item) => { if (typeof item === 'string') expand(item); });
            condition.selon.forEach((basis) => [basis.applicabilite, basis.validite, basis.vigueur?.au].forEach((item) => { if (item) expand(item); }));
          }
        } else if (reasoning.valeurs.has(name)) {
          if (values.has(name)) return;
          values.add(name);
          const formula = reasoning.valeurs.get(name)!.formule;
          if (formula) [...formulaNames(formula), ...formulaConditions(formula)].forEach(expand);
        } else facts.add(name);
      };
      names.forEach(expand);
      return { terms, facts, values };
    };
    const citationsOf = (names: string[] | null) => {
      const scope = names ? inScope(names) : null;
      const pool: string[] = [];
      const cite = (items: Array<{ citation?: string }>) => items.forEach((item) => { if (item.citation) pool.push(item.citation, corrections.get(item.citation) ?? item.citation); });
      for (const { at, condition } of occurrences) {
        if (scope && !scope.terms.has(at.split('.')[0]) && !(condition.condition && scope.facts.has(condition.condition))) continue;
        condition.selon.forEach((basis) => { cite([basis]); cite(basis.renvoi); });
      }
      for (const { name, foundation } of foundations) if (!scope || scope.terms.has(name)) cite(foundation.preuve);
      for (const [name, entry] of reasoning.valeurs) if (!scope || scope.values.has(name)) { cite(entry.preuve); cite(entry.selon); }
      return pool;
    };
    const statusOf = (name: string) => (reasoning.terms.has(name) ? (disputed(name) ? 'disputé' : STATUS(statuses.get(name) ?? null)) : reasoning.valeurs.has(name) ? (valueOf(name) === null ? 'à établir' : 'acquis') : conditionNames.has(name) ? STATUS(leaf(name)) : null);
    const obstacles = reasoning.objectifs.flatMap((_, index) => (node(annotated, `objectifs[${index}]`)?.obstacles as string[] | undefined) ?? []);
    for (const issue of checkActe(reasoning.acte, {
      known: (name) => reasoning.terms.has(name) || reasoning.valeurs.has(name) || conditionNames.has(name),
      status: statusOf,
      citations: citationsOf,
      objectives: reasoning.objectifs.map((objective, index) => ({ effet: objective.effet, at: `objectifs[${index}]` })),
      obstacles,
    })) add(issue.kind, issue.path, issue.text, issue.avocat);
  }

  const registre: string[] = [];
  if (input.online) {
    for (const person of input.persons.filter((entry) => entry.kind === 'company' && (entry.side === 'client' || entry.side === 'adversaire'))) {
      try {
        const siren = person.siren?.replace(/\D/g, '').slice(0, 9) || null;
        const record = await connectors.registry({ siren, name: person.name ?? person.label });
        const closed = !record.found || /radi|cess|ferm|liquid|dissou/i.test(record.status);
        registre.push(`${person.label} : ${record.found ? record.status || 'trouvée au Registre Public' : 'introuvable au Registre Public'}`);
        emit({ key: `registre:${person.label}`, step: 'registre', status: closed ? 'alerte' : 'ok', subject: person.label, text: record.found ? record.status || 'Trouvée au Registre Public' : 'Introuvable au Registre Public' });
        if (closed) add('manque', '', `registre : ${person.label} ${record.found ? record.status : 'introuvable au Registre Public'} ; vérifie sa capacité à agir ou à être poursuivie avant de conclure`, `${person.label} : ${record.found ? `le Registre Public la donne ${record.status}` : 'introuvable au Registre Public'}.`);
        if (!siren) {
          emit({ key: `bodacc:${person.label}`, step: 'registre', status: 'alerte', subject: person.label, text: 'SIREN non renseigné : BODACC non consulté' });
          add('manque', '', `BODACC non consulté pour ${person.label} : SIREN absent des parties du dossier`, `${person.label} : SIREN non renseigné dans les parties, le BODACC n’a pas été consulté.`);
          continue;
        }
        const alerts = await connectors.bodacc(siren);
        emit({ key: `bodacc:${person.label}`, step: 'registre', status: alerts.length ? 'alerte' : 'ok', subject: person.label, text: alerts.length ? `BODACC : ${alerts.join(' ; ')}` : 'BODACC : aucune procédure collective ni radiation' });
        for (const alert of alerts) {
          registre.push(`${person.label} : BODACC ${alert}`);
          add('manque', '', `BODACC, ${person.label} : ${alert} ; intègre ses effets au raisonnement (arrêt des poursuites individuelles, déclaration de créance, pouvoirs des organes de la procédure)`, `${person.label} : le BODACC signale ${alert}.`);
        }
      } catch (error) { registre.push(`${person.label} : vérification impossible (${error instanceof Error ? error.message : 'erreur'})`); }
    }
  }

  const visible = issues.filter((issue) => !input.dismissed.has(issue.id) && issue.kind !== 'conseil');
  for (const issue of visible) {
    const holder = issue.path ? node(annotated, issue.path.replace(ANCHORED, '')) : null;
    const key = issue.kind === 'erreur' ? 'erreurs' : 'manques';
    if (holder) holder[key] = [...(holder[key] as string[] | undefined ?? []), issue.text];
  }
  const general = visible.filter((issue) => !issue.path || !node(annotated, issue.path.replace(ANCHORED, '')));
  const unrated = [...new Set([...verifiedRefs.keys()].map((at) => node(annotated, at)?.piece).filter((piece): piece is string => typeof piece === 'string' && !input.reliability.has(piece)))];
  const distinctControls = [...new Set(controlSlots.filter((name): name is string => Boolean(name)))];
  const bilan = {
    erreurs: visible.filter((issue) => issue.kind === 'erreur').length,
    manques: visible.filter((issue) => issue.kind === 'manque').length,
    ...(controlSlots.length ? { controles: `${distinctControls.filter((name) => statuses.get(name) === true).length}/${distinctControls.length + controlSlots.filter((name) => !name).length} établis` } : {}),
    ...(trials.length ? { hypotheses: `${trials.filter((trial) => trial.conforme).length}/${trials.length}` } : {}),
    ecartees: issues.filter((issue) => issue.kind !== 'conseil').length - visible.length,
    ...(general.length ? { alertes: general.map((issue) => `${issue.path ? `${issue.path} : ` : ''}${issue.text}`) } : {}),
    ...(unrated.length ? { pieces_a_evaluer_par_l_avocat: unrated } : {}),
    ...(registre.length ? { registre } : {}),
  };

  reasoning.objectifs.forEach((objective, index) => {
    const holder = node(annotated, `objectifs[${index}]`);
    const decisifs = (holder?.decisifs ?? holder?.en_jeu ?? []) as string[];
    emit({ key: `réponse:${index}`, step: 'réponse', status: holder?.statut === 'à établir' ? 'neutre' : bilan.erreurs ? 'alerte' : 'ok', subject: objective.objectif, text: `${typeof holder?.montant_calcule === 'number' ? holder.montant_calcule.toLocaleString('fr-FR') : holder?.statut ? ANSWER[holder.statut as ReasoningStatus] : 'Non calculée'}${decisifs.length ? ` : dépend de ${listing(decisifs.map((name) => phrase(name)))}` : ''}${bilan.erreurs ? ` · ${bilan.erreurs} erreur${bilan.erreurs > 1 ? 's' : ''} à corriger` : ''}` });
  });
  let code = ordered ?? input.code;
  if (corrections.size) {
    const correct = (value: unknown): unknown => {
      if (typeof value === 'string') {
        for (const [original, fixed] of corrections) value = (value as string).split(original).join(fixed);
        return value;
      }
      if (Array.isArray(value)) return value.map(correct);
      return isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, correct(child)])) : value;
    };
    code = printReasoningDocument(correct(parseReasoningDocument(code).value));
  }
  let simulation: Simulation | undefined;
  if (input.simulation && !shape.cycles.length) {
    const run = simulate(reasoning, test, { leaf, proven, supported, value: (name, check) => stated(name, check) ?? computedValue(name) }, input.simulation);
    simulation = {
      objectifs: reasoning.objectifs.map((objective) => {
        if (!amountObjective(objective)) return { objectif: objective.objectif, statut: STATUS(answer(objective, run.test(objectiveRoots(objective)))) };
        const montant = run.value(objective.effet);
        const checked = and([...run.test(objectiveRoots(objective).filter((name) => reasoning.terms.has(name))).values()]);
        return { objectif: objective.objectif, statut: typeof montant === 'number' ? STATUS(checked) : 'à établir', montant: typeof montant === 'number' ? montant : null };
      }),
      valeurs: Object.fromEntries([...reasoning.valeurs.keys()].map((name) => [name, run.value(name)])),
      termes: Object.fromEntries([...[...shape.leaves].filter((name) => !reasoning.terms.has(name)).map((name) => [name, STATUS(run.leaf(name))] as const), ...[...run.test([...reasoning.terms.keys()])].map(([name, value]) => [name, STATUS(value)] as const)]),
    };
  }
  return { annotated: { bilan, ...canonical(annotated, reasoning) }, issues, code, log, ...(simulation ? { simulation } : {}) };
}

type PersonRow = { label: string; kind: string; name: string | null; siren: string | null; side: string | null };

export function createReasoningService(getDatabase: () => Database.Database, connectors: ReasoningConnectors) {
  let initialized = false;
  const sources = new Map<string, Promise<SourceInfo | null | undefined>>();
  const cached: ReasoningConnectors = { ...connectors, source: (cwd, id) => { const key = `${cwd}\0${id}`; if (!sources.has(key)) sources.set(key, connectors.source(cwd, id)); return sources.get(key)!; } };
  const database = () => {
    const db = getDatabase();
    if (!initialized) {
      for (const table of LEGACY_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
      for (const table of ['pm_reasoning_programs', 'pm_reasoning_dismissed']) {
        const columns = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Array<{ name: string }>;
        if (columns.length && !columns.some((column) => column.name === 'name')) db.exec(`DROP TABLE ${table};`);
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS pm_reasoning_programs (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE, name TEXT NOT NULL,
          revision INTEGER NOT NULL, code TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
          PRIMARY KEY(project_id, name)
        );
        CREATE TABLE IF NOT EXISTS pm_reasoning_dismissed (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE, name TEXT NOT NULL,
          issue_id TEXT NOT NULL, path TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL,
          PRIMARY KEY(project_id, name, issue_id)
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
  const persons = (id: string): Person[] => (hasGraph() ? database().prepare(`SELECT n.label, n.kind, json_extract(n.data_json,'$.partySide') AS side,
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
  const dismissed = (id: string, name: string) => database().prepare('SELECT issue_id AS id, path, text, at FROM pm_reasoning_dismissed WHERE project_id=? AND name=? ORDER BY at').all(id, name) as ReasoningSnapshot['dismissed'];
  const stored = (id: string, name: string): Partial<ReasoningSnapshot> => {
    const row = database().prepare('SELECT snapshot_json FROM pm_reasoning_programs WHERE project_id=? AND name=?').get(id, name) as { snapshot_json: string } | undefined;
    const parsed = row ? JSON.parse(row.snapshot_json) as Partial<ReasoningSnapshot> : {};
    return 'annotated' in parsed ? parsed : {};
  };
  const named = async (cwd: string, name?: string) => {
    const found = await resolveReasoningFile(cwd, name);
    if (!found) throw new TypeError('Aucun raisonnement : écris .piecemaker/raisonnements/<nom>.yaml (nom d’après le sujet, ex. indemnite-de-depart) avec objectifs et les termes, puis relance verifier.');
    return found;
  };

  const read = async (cwd: string, name?: string): Promise<ReasoningSnapshot> => {
    const id = projectId(cwd);
    const available = await listReasoningFiles(cwd);
    const latest = () => [...available].sort((left, right) => String(stored(id, right).updatedAt ?? '').localeCompare(String(stored(id, left).updatedAt ?? '')))[0];
    const chosen = name ?? latest();
    const snapshot = chosen ? stored(id, chosen) : {};
    return { ...emptySnapshot(), ...snapshot, name: chosen ?? null, raisonnements: available, dismissed: chosen ? dismissed(id, chosen) : [], reliability: reliability(id) };
  };

  const run = async (cwd: string, options: { online: boolean; emit?: (entry: ReasoningLogEntry) => void; simulation?: Trial['faits'] }, name?: string) => {
    const id = projectId(cwd);
    const found = await named(cwd, name);
    const code = await readFile(found.file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (code === null) throw new TypeError(`Raisonnement introuvable : .piecemaker/raisonnements/${found.name}.yaml (raisonnements du dossier : ${(await listReasoningFiles(cwd)).join(', ') || 'aucun'}).`);
    const result = await verifyReasoning({
      code, cwd, connectors: cached, ...options,
      reliability: new Map(reliability(id).map((entry) => [entry.piece, entry.reliable])),
      nature: nature(id),
      persons: persons(id),
      dismissed: new Set(dismissed(id, found.name).map((entry) => entry.id)),
    });
    return { id, code, result, ...found };
  };

  const verify = async (cwd: string, online = true, emit?: (entry: ReasoningLogEntry) => void, name?: string): Promise<ReasoningSnapshot> => {
    for (const key of sources.keys()) if (key.startsWith(`${cwd}\0`)) sources.delete(key);
    const { id, code, result, file, name: chosen } = await run(cwd, { online, emit }, name);
    if (await readFile(file, 'utf8') !== code) throw new Error('Le raisonnement a été modifié pendant la vérification : relance-la sur la version actuelle.');
    if (result.code !== code) await writeFile(file, result.code, 'utf8');
    const previous = await read(cwd, chosen);
    const snapshot: ReasoningSnapshot = { ...previous, revision: previous.revision + 1, updatedAt: new Date().toISOString(), code: result.code, annotated: result.annotated, issues: result.issues, test: { at: new Date().toISOString(), log: result.log } };
    const { dismissed: _dismissed, reliability: _reliability, name: _name, raisonnements: _raisonnements, ...kept } = snapshot;
    database().prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?,?,?) ON CONFLICT(project_id, name) DO UPDATE SET revision=excluded.revision, code=excluded.code, snapshot_json=excluded.snapshot_json').run(id, chosen, snapshot.revision, snapshot.code, JSON.stringify(kept));
    return snapshot;
  };

  const list = async (cwd: string) => {
    const id = projectId(cwd);
    const names = await listReasoningFiles(cwd);
    if (!names.length) return 'Aucun raisonnement dans .piecemaker/raisonnements/.';
    return names.map((name) => {
      const snapshot = stored(id, name);
      const objectifs = ((snapshot.annotated?.objectifs ?? []) as Array<{ objectif?: string; statut?: string }>).map((objective) => `${objective.objectif ?? '?'}${objective.statut ? ` (${objective.statut})` : ''}`);
      const counts = snapshot.issues ? `${snapshot.issues.filter((issue) => issue.kind === 'erreur').length} erreur(s), ${snapshot.issues.filter((issue) => issue.kind === 'manque').length} manque(s), vérifié le ${String(snapshot.updatedAt).slice(0, 10)}` : 'non vérifié';
      return `${name} — .piecemaker/raisonnements/${name}.yaml — ${counts}${objectifs.length ? `\n  ${objectifs.join('\n  ')}` : ''}`;
    }).join('\n');
  };

  database();
  return {
    read,
    verify,
    list,
    test: (cwd: string, emit: (entry: ReasoningLogEntry) => void, name?: string) => verify(cwd, true, emit, name),
    async source(cwd: string, id: string, name?: string): Promise<{ kind: SourceInfo['kind']; title: string; text: string }> {
      const { code } = await read(cwd, name);
      if (!code.split('\n').some((line) => line.replace(/^\s*-?\s*(?:source|piece):\s*/u, '').replace(/^["']|["']$/gu, '').trim() === id)) throw new TypeError('Source absente du raisonnement.');
      const info = await connectors.source(cwd, id).catch(() => null);
      if (!info) throw new TypeError('Texte de la source indisponible.');
      return { kind: info.kind, title: info.title, text: info.text };
    },
    async command(cwd: string, input: { commande?: unknown; raisonnement?: unknown }): Promise<string> {
      if (input.commande !== undefined && input.commande !== 'verifier' && input.commande !== 'lister') throw new TypeError('Commande : verifier ou lister.');
      if (input.raisonnement !== undefined && typeof input.raisonnement !== 'string') throw new TypeError('raisonnement : nom du fichier, sans .yaml.');
      if (input.commande === 'lister') return list(cwd);
      const snapshot = await verify(cwd, true, undefined, input.raisonnement as string | undefined);
      return `Raisonnement ${snapshot.name} (.piecemaker/raisonnements/${snapshot.name}.yaml)\n${describeReasoning(snapshot)}`;
    },
    async simulate(cwd: string, faits: unknown, name?: string): Promise<Simulation> {
      if (!isObject(faits) || Object.values(faits).some((item) => typeof item !== 'boolean' && typeof item !== 'number' && !(typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item)))) throw new TypeError('faits : { nom: vrai, faux, nombre ou date AAAA-MM-JJ }.');
      const { result } = await run(cwd, { online: false, simulation: faits as Trial['faits'] }, name);
      if (!result.simulation) throw new TypeError('Simulation impossible : corrige d’abord les erreurs du raisonnement.');
      return result.simulation;
    },
    async dismiss(cwd: string, issue: string, restore = false, name?: string): Promise<ReasoningSnapshot> {
      const id = projectId(cwd);
      const { name: chosen } = await named(cwd, name);
      if (restore) database().prepare('DELETE FROM pm_reasoning_dismissed WHERE project_id=? AND name=? AND issue_id=?').run(id, chosen, issue);
      else {
        const found = (await read(cwd, chosen)).issues.find((entry) => entry.id === issue);
        if (!found) throw new TypeError('Alerte introuvable.');
        database().prepare('INSERT OR REPLACE INTO pm_reasoning_dismissed VALUES(?,?,?,?,?,?)').run(id, chosen, issue, found.path, found.text, new Date().toISOString());
      }
      return verify(cwd, false, undefined, chosen);
    },
    async rate(cwd: string, piece: string, reliable: boolean | null, name?: string): Promise<ReasoningSnapshot> {
      const id = projectId(cwd);
      if (typeof piece !== 'string' || !piece.trim()) throw new TypeError('Pièce requise.');
      if (reliable === null) database().prepare('DELETE FROM pm_reasoning_reliability WHERE project_id=? AND piece=?').run(id, piece);
      else database().prepare('INSERT OR REPLACE INTO pm_reasoning_reliability VALUES(?,?,?,?)').run(id, piece, reliable ? 1 : 0, new Date().toISOString());
      return verify(cwd, false, undefined, name);
    },
  };
}

export function describeReasoning(snapshot: Pick<ReasoningSnapshot, 'issues' | 'code'> & { dismissed?: ReasoningSnapshot['dismissed'] }) {
  const hidden = new Set((snapshot.dismissed ?? []).map((entry) => entry.id));
  const issues = snapshot.issues.filter((issue) => !hidden.has(issue.id));
  const source = snapshot.code.split('\n');
  const content = (line: number) => {
    const text = source[line - 1]?.trim() ?? '';
    const shown = text.length < 4 && source[line] ? `${text} ${source[line].trim()}` : text;
    return shown.length > 220 ? `${shown.slice(0, 219)}…` : shown;
  };
  const errors = issues.filter((issue) => issue.kind === 'erreur');
  const gaps = issues.filter((issue) => issue.kind === 'manque');
  const advice = errors.length ? [] : issues.filter((issue) => issue.kind === 'conseil').slice(0, 5);
  if (!errors.length && !gaps.length && !advice.length) return 'Aucune erreur, aucun manque. Le raisonnement a été réécrit dans son ordre.';
  const out = [`${errors.length} erreur(s), ${gaps.length} manque(s)${advice.length ? `, ${advice.length} conseil(s) d’écriture` : ''}. Le raisonnement a été réécrit dans son ordre : les lignes ci-dessous s’y rapportent.`];
  const block = (label: string, issue: ReasoningIssue, index: number) => {
    const place = issue.path ? issue.path.replace(/\./g, ' › ') : 'fichier';
    out.push('', `${label} ${index + 1} — ${place}${issue.line ? ` (ligne ${issue.line})` : ''}`);
    out.push(issue.line ? `  ligne ${issue.line} : ${content(issue.line)}` : `  ${!issue.path ? 'porte sur le fichier entier' : /[.[]/.test(issue.path) ? `absent du fichier : à ajouter dans ${issue.path.replace(/(\.[^.[\]]+|\[\d+\])$/, '')}` : 'absent du fichier : clé à ajouter au premier niveau de l’objet'}`);
    out.push(`  ${issue.text}`);
    if (issue.ailleurs?.length) out.push(`  même cause, aussi : ${issue.ailleurs.map((other) => `${other.path.replace(/\./g, ' › ')}${other.line ? ` (ligne ${other.line})` : ''}`).join(' ; ')}`);
  };
  errors.forEach((issue, index) => block('ERREUR', issue, index));
  gaps.forEach((issue, index) => block('MANQUE', issue, index));
  advice.forEach((issue, index) => block('CONSEIL', issue, index));
  return out.join('\n');
}

export const EXAMPLE_CODE = `objectifs:
  - objectif: Obtenir de Société Beta SARL le paiement de la pénalité de retard
    obtenir: pénalité_encourue
valeurs:
  date_de_conclusion_du_contrat:
    valeur: 2024-01-15
    preuve:
      - piece: pieces/01_contrat.md
        citation: Fait le 15/01/2024
pénalité_encourue:
  but: Établir que la pénalité de retard est due par le débiteur mis en demeure
  si:
    - pénalité_stipulée: true
      selon:
        - source: LEGIARTI000000000005
          citation: la pénalité n'est encourue que lorsque le débiteur est mis en demeure
          vigueur:
            debut: 2016-10-01
            fin: null
            au: date_de_conclusion_du_contrat
          applicabilite: applicabilité_de_l_article_1231_5
          version: version_de_l_article_1231_5
    - l_une:
        - mise_en_demeure: true
        - inexécution_définitive: true
      selon:
        - source: LEGIARTI000000000005
          citation: Sauf inexécution définitive
          vigueur:
            debut: 2016-10-01
            fin: null
            au: date_de_conclusion_du_contrat
          applicabilite: applicabilité_de_l_article_1231_5
          version: version_de_l_article_1231_5
mise_en_demeure:
  true:
    - preuve:
        - piece: pieces/06_mise_en_demeure.md
          citation: vous met en demeure
applicabilité_de_l_article_1231_5:
  but: Montrer que l'article 1231-5 s'applique à ce contrat
  si:
    - contrat_stipulant_une_pénalité: true
      selon:
        - source: LEGIARTI000000000005
          citation: Lorsque le contrat stipule une pénalité
          vigueur:
            debut: 2016-10-01
            fin: null
            au: date_de_conclusion_du_contrat
contrat_stipulant_une_pénalité:
  true:
    - preuve:
        - piece: pieces/01_contrat.md
          citation: une pénalité est due
version_de_l_article_1231_5:
  but: Montrer que la version de 2016 s'applique à ce contrat
  si:
    - contrat_conclu_après_le_1er_octobre_2016: true
      selon:
        - source: LEGIARTI000000000009
          citation: Les contrats conclus avant cette date demeurent soumis à la loi ancienne
          vigueur:
            debut: 2016-02-11
            fin: null
            au: date_de_conclusion_du_contrat
contrat_conclu_après_le_1er_octobre_2016:
  true:
    - preuve:
        - piece: pieces/01_contrat.md
          citation: Fait le 15/01/2024
pénalité_stipulée:
  but: Montrer que le contrat prévoit la pénalité pour ce retard
  si:
    - retard_de_livraison: true
      selon:
        - source: pieces/01_contrat.md
          citation: En cas de retard de livraison
          vigueur:
            debut: 2024-01-15
            fin: null
  sauf:
    - force_majeure_contractuelle: true
      selon:
        - source: pieces/01_contrat.md
          citation: sauf force majeure au sens de l'article 12
          vigueur:
            debut: 2024-01-15
            fin: null
retard_de_livraison:
  true:
    - preuve:
        - piece: pieces/05_bon_de_livraison.md
          citation: Livré le 14/06/2025
force_majeure_contractuelle:
  but: Vérifier si la force majeure du contrat écarte la pénalité
  si:
    - l_une:
        - force_majeure: true
        - grève: true
      selon:
        - source: pieces/01_contrat.md
          citation: ainsi que les grèves
          vigueur:
            debut: 2024-01-15
            fin: null
grève:
  but: Vérifier si une grève visée par le contrat est survenue
  si:
    - l_une:
        - grève_nationale: true
        - grève_du_secteur: true
      selon:
        - source: pieces/01_contrat.md
          citation: grève nationale ou propre au secteur
          vigueur:
            debut: 2024-01-15
            fin: null
grève_du_secteur:
  false:
    - preuve:
        - piece: pieces/07_courriel.md
          citation: mouvement limité à notre atelier
hypotheses:
  - nom: "grève nationale : pas de pénalité"
    faits:
      retard_de_livraison: true
      mise_en_demeure: true
      grève_nationale: true
    attendu:
      pénalité_encourue: false
`;

export const EXAMPLE_SOURCES: Record<string, SourceInfo> = {
  LEGIARTI000000000005: { kind: 'texte', title: 'Code civil fictif, article 1231-5', text: 'Lorsque le contrat stipule une pénalité en cas d\'inexécution, elle est due dans les conditions suivantes. Sauf inexécution définitive, la pénalité n\'est encourue que lorsque le débiteur est mis en demeure.', validity: { from: '2016-10-01', to: null } },
  LEGIARTI000000000009: { kind: 'texte', title: 'Ordonnance fictive, article 9', text: 'Les dispositions de la présente ordonnance entrent en vigueur le 1er octobre 2016. Les contrats conclus avant cette date demeurent soumis à la loi ancienne.', validity: { from: '2016-02-11', to: null } },
  'pieces/01_contrat.md': { kind: 'piece', title: 'Contrat de prestation (fictif)', text: 'Fait le 15/01/2024. Article 1. Grève : grève nationale ou propre au secteur. Article 8. En cas de retard de livraison, une pénalité est due, sauf force majeure au sens de l\'article 12. Article 12. Constituent des cas de force majeure les événements de l\'article 1218, ainsi que les grèves.' },
  'pieces/05_bon_de_livraison.md': { kind: 'piece', title: 'Bon de livraison (fictif)', text: 'Société Beta SARL. Livré le 14/06/2025.' },
  'pieces/06_mise_en_demeure.md': { kind: 'piece', title: 'Mise en demeure (fictive)', text: 'La présente vous met en demeure de livrer.' },
  'pieces/07_courriel.md': { kind: 'piece', title: 'Courriel (fictif)', text: 'Le mouvement limité à notre atelier a duré deux jours.' },
};

export async function reasoningExample(simulation?: Trial['faits']) {
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
    ...(simulation ? { simulation } : {}),
  });
  return { ...emptySnapshot(), code: result.code, annotated: result.annotated, issues: result.issues, test: { at: new Date().toISOString(), log: result.log }, demo: true, ...(result.simulation ? { simulation: result.simulation } : {}) };
}
