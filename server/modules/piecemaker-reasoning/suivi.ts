import { createHash } from 'node:crypto';
import path from 'node:path';

import type { ReasoningIssue } from '../../../shared/piecemaker-reasoning.js';
import type { SuiviBasis, SuiviDeadline, SuiviDone, SuiviEvent, SuiviProof, SuiviSnapshot } from '../../../shared/piecemaker-suivi.js';

import { addDays, closed, nextOpen, shift, weekday } from './calendar.js';
import { parseReasoningDocument, ReasoningSyntaxError } from './document.js';
import { LiteralError, unknownKey } from './format.js';
import type { Duration } from './format.js';
import { isLegalDate } from './legal-period.js';
import { ID_SHAPE, OFFICIAL_ID } from './program.js';
import type { ReasoningConnectors, SourceInfo } from './program.js';

export const SUIVI_FILE = path.join('.piecemaker', 'suivi.yaml');

type Proof = { piece: string; citation: string };
type Source = { source: string; citation: string };
type Count = { depart?: 'exclu' | 'inclus'; report?: 'jour_ouvrable_suivant' | 'jour_ouvrable_precedent' | 'aucun'; selon: Source[] };
type Event = { nom: string; intitule: string; date: string; hypothese: boolean; preuve: Proof[]; selon: Source[] };
type Deadline = {
  nom: string; intitule: string; date?: string; preuve: Proof[]; de?: string; avant?: string; delai?: Duration;
  prolongation?: { delai: Duration; selon: Source[] }; selon: Source[]; decompte?: Count; fait?: { date: string; preuve: Proof[] };
};
export type SuiviMark = { date: string; piece: string | null; at: string };

const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const UNITS = ['jours', 'jours_ouvres', 'mois', 'ans'] as const;
const UNIT_LABEL: Record<Duration['unite'], string> = { jours: 'jours', jours_ouvres: 'jours ouvrés', mois: 'mois', ans: 'ans' };
const ROOT_KEYS = ['evenements', 'echeances'];
const EVENT_KEYS = ['intitule', 'date', 'preuve', 'hypothese', 'selon'];
const DEADLINE_KEYS = ['intitule', 'date', 'preuve', 'de', 'avant', 'delai', 'prolongation', 'selon', 'decompte', 'fait'];
const COUNT_KEYS = ['depart', 'report', 'selon'];
const DEPARTS = ['exclu', 'inclus'];
const REPORTS = ['jour_ouvrable_suivant', 'jour_ouvrable_precedent', 'aucun'];
const DURATION_SHAPE = `{ ${UNITS.join(' | ')}: nombre entier }`;
const COUNT_SHAPE = 'decompte : { depart: exclu ou inclus, report: jour_ouvrable_suivant, jour_ouvrable_precedent ou aucun, selon: [{ source, citation }] }';
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const day = (value: string) => value.split('-').reverse().join('/');
const human = (name: string) => { const phrase = name.replace(/_/g, ' ').replace(/(^|\s)([cdjlmnst]) (?=[aeiouyhàâéèêëîïôûù])/giu, '$1$2’'); return phrase.charAt(0).toUpperCase() + phrase.slice(1); };
const ONE: Record<Duration['unite'], string> = { jours: 'jour', jours_ouvres: 'jour ouvré', mois: 'mois', ans: 'an' };
const span = ({ unite, nombre }: Duration) => `${nombre} ${nombre === 1 ? ONE[unite] : UNIT_LABEL[unite]}`;
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
const issueId = (kind: string, at: string, message: string) => createHash('sha256').update(`suivi\0${kind}\0${at}\0${message}`).digest('hex').slice(0, 10);

export function mentionsDate(citation: string, date: string) {
  const [year, month, dayOfMonth] = date.split('-');
  const d = Number(dayOfMonth), m = Number(month);
  const folded = fold(citation);
  const numeric = new RegExp(`(^|\\D)0?${d}\\s*[/.-]\\s*0?${m}\\s*[/.-]\\s*(${year}|${year.slice(2)})(\\D|$)`);
  const written = new RegExp(`(^|\\D)(${d}|${d === 1 ? '1er|premier' : d})\\s+${MONTHS[m - 1]}\\s+${year}(\\D|$)`);
  return folded.includes(date) || numeric.test(folded) || written.test(folded);
}

export function readSuivi(value: unknown) {
  const problems: Array<{ path: string; text: string }> = [];
  const problem = (at: string, message: string) => { problems.push({ path: at, text: message }); };
  const events = new Map<string, Event>();
  const deadlines = new Map<string, Deadline>();
  if (value === null || value === undefined) return { events, deadlines, problems };
  if (!isObject(value)) { problem('', 'le suivi est un objet { evenements: {...}, echeances: {...} }'); return { events, deadlines, problems }; }
  for (const key of Object.keys(value)) if (!ROOT_KEYS.includes(key)) problem(key, unknownKey(key, ROOT_KEYS));

  const keys = (raw: Record<string, unknown>, at: string, admitted: string[]) => { for (const key of Object.keys(raw)) if (!admitted.includes(key)) problem(`${at}.${key}`, unknownKey(key, admitted)); };
  const proofs = (raw: unknown, at: string): Proof[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(at, 'liste attendue : [{ piece, citation }]'); return []; }
    return raw.flatMap((entry, index) => {
      const place = `${at}[${index}]`;
      if (isObject(entry)) keys(entry, place, ['piece', 'citation']);
      if (!isObject(entry) || !text(entry.piece) || !text(entry.citation)) { problem(place, '{ piece: chemin de la pièce, citation: passage exact } attendu'); return []; }
      return [{ piece: entry.piece.trim(), citation: entry.citation }];
    });
  };
  const sources = (raw: unknown, at: string): Source[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(at, 'liste attendue : [{ source, citation }]'); return []; }
    return raw.flatMap((entry, index) => {
      const place = `${at}[${index}]`;
      if (isObject(entry)) keys(entry, place, ['source', 'citation']);
      if (!isObject(entry) || !text(entry.source) || !text(entry.citation)) { problem(place, '{ source: identifiant du texte, de la décision ou chemin de la pièce, citation: passage exact } attendu'); return []; }
      return [{ source: entry.source.trim(), citation: entry.citation }];
    });
  };
  const duration = (raw: unknown, at: string): Duration | undefined => {
    const entries = isObject(raw) ? Object.entries(raw) : [];
    if (entries.length !== 1 || !(UNITS as readonly string[]).includes(entries[0][0]) || !Number.isInteger(entries[0][1]) || (entries[0][1] as number) < 0) { problem(at, `durée : ${DURATION_SHAPE}`); return undefined; }
    return { unite: entries[0][0] as Duration['unite'], nombre: entries[0][1] as number };
  };
  const date = (raw: unknown, at: string) => { if (isLegalDate(raw)) return raw; problem(at, 'date AAAA-MM-JJ attendue'); return undefined; };
  const named = (raw: unknown, at: string, shape: string) => {
    if (raw === undefined) return true;
    if (!isObject(raw)) { problem(at, shape); return false; }
    for (const name of Object.keys(raw)) if (!IDENTIFIER.test(name)) problem(`${at}.${name}`, `nom invalide : lettres, chiffres et _ (ex. ${name.replace(/[^\p{L}\p{N}]+/gu, '_')})`);
    return true;
  };

  if (named(value.evenements, 'evenements', 'evenements : { nom_de_l_evenement: { date, preuve } }')) {
    for (const [nom, raw] of Object.entries((value.evenements ?? {}) as Record<string, unknown>)) {
      const at = `evenements.${nom}`;
      if (!isObject(raw)) { problem(at, 'événement : { date: AAAA-MM-JJ, preuve: [{ piece, citation }] }'); continue; }
      keys(raw, at, EVENT_KEYS);
      if (raw.intitule !== undefined && !text(raw.intitule)) problem(`${at}.intitule`, 'intitule : texte');
      if (raw.hypothese !== undefined && typeof raw.hypothese !== 'boolean') problem(`${at}.hypothese`, 'hypothese : true ou false');
      const when = date(raw.date, `${at}.date`);
      if (!when) continue;
      events.set(nom, { nom, intitule: text(raw.intitule) ? raw.intitule : human(nom), date: when, hypothese: raw.hypothese === true, preuve: proofs(raw.preuve, `${at}.preuve`), selon: sources(raw.selon, `${at}.selon`) });
    }
  }
  if (named(value.echeances, 'echeances', 'echeances : { nom_de_l_echeance: { intitule, de ou avant, delai, selon, decompte } ou { intitule, date, preuve } }')) {
    for (const [nom, raw] of Object.entries((value.echeances ?? {}) as Record<string, unknown>)) {
      const at = `echeances.${nom}`;
      if (!isObject(raw)) { problem(at, 'échéance : { intitule, de ou avant, delai, selon, decompte } ou { intitule, date, preuve }'); continue; }
      keys(raw, at, DEADLINE_KEYS);
      if (events.has(nom)) problem(at, `${nom} est déjà un événement : donne un autre nom à l’échéance`);
      if (!text(raw.intitule)) problem(`${at}.intitule`, 'intitule : ce qu’il faut faire, en clair (ex. Déposer les conclusions)');
      const deadline: Deadline = { nom, intitule: text(raw.intitule) ? raw.intitule : human(nom), preuve: proofs(raw.preuve, `${at}.preuve`), selon: sources(raw.selon, `${at}.selon`) };
      if (raw.date !== undefined) deadline.date = date(raw.date, `${at}.date`);
      for (const link of ['de', 'avant'] as const) if (raw[link] !== undefined) {
        if (typeof raw[link] === 'string' && IDENTIFIER.test(raw[link] as string)) deadline[link] = raw[link] as string;
        else problem(`${at}.${link}`, `${link} : nom d’un événement ou d’une échéance`);
      }
      if (raw.de !== undefined && raw.avant !== undefined) problem(at, 'de (après un événement) ou avant (avant une échéance), pas les deux');
      if (raw.delai !== undefined) deadline.delai = duration(raw.delai, `${at}.delai`);
      if ((raw.de !== undefined || raw.avant !== undefined) && raw.delai === undefined) problem(at, `délai manquant : delai: ${DURATION_SHAPE}`);
      if (raw.delai !== undefined && raw.de === undefined && raw.avant === undefined) problem(at, 'delai sans point de départ : ajoute de: événement (après) ou avant: échéance');
      if (raw.date === undefined && raw.de === undefined && raw.avant === undefined) problem(at, 'échéance sans date : date fixée (date, preuve) ou calculée (de ou avant, delai)');
      if (raw.prolongation !== undefined) {
        const extra = raw.prolongation;
        if (!isObject(extra)) problem(`${at}.prolongation`, `prolongation : { delai: ${DURATION_SHAPE}, selon: [{ source, citation }] }`);
        else {
          keys(extra, `${at}.prolongation`, ['delai', 'selon']);
          const extension = duration(extra.delai, `${at}.prolongation.delai`);
          if (extension) deadline.prolongation = { delai: extension, selon: sources(extra.selon, `${at}.prolongation.selon`) };
        }
      }
      if (raw.decompte !== undefined) {
        const count = raw.decompte;
        if (!isObject(count)) problem(`${at}.decompte`, COUNT_SHAPE);
        else {
          keys(count, `${at}.decompte`, COUNT_KEYS);
          if (count.depart !== undefined && !DEPARTS.includes(count.depart as string)) problem(`${at}.decompte.depart`, 'depart : exclu (le jour de l’événement ne compte pas) ou inclus');
          if (count.report !== undefined && !REPORTS.includes(count.report as string)) problem(`${at}.decompte.report`, 'report : jour_ouvrable_suivant, jour_ouvrable_precedent ou aucun (si le terme tombe un samedi, un dimanche ou un jour férié)');
          deadline.decompte = { ...(DEPARTS.includes(count.depart as string) ? { depart: count.depart as Count['depart'] } : {}), ...(REPORTS.includes(count.report as string) ? { report: count.report as Count['report'] } : {}), selon: sources(count.selon, `${at}.decompte.selon`) };
        }
      }
      if (raw.fait !== undefined) {
        const done = raw.fait;
        if (!isObject(done)) problem(`${at}.fait`, 'fait : { date: AAAA-MM-JJ, preuve: [{ piece, citation }] }');
        else {
          keys(done, `${at}.fait`, ['date', 'preuve']);
          const when = date(done.date, `${at}.fait.date`);
          if (when) deadline.fait = { date: when, preuve: proofs(done.preuve, `${at}.fait.preuve`) };
        }
      }
      deadlines.set(nom, deadline);
    }
  }
  return { events, deadlines, problems };
}

export type SuiviVerification = Pick<SuiviSnapshot, 'evenements' | 'echeances' | 'issues'>;

export async function verifySuivi(input: {
  code: string;
  cwd: string;
  connectors: ReasoningConnectors;
  reliability: Map<string, boolean>;
  marks: Map<string, SuiviMark>;
  today?: string;
}): Promise<SuiviVerification> {
  const { connectors, cwd } = input;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const issues: ReasoningIssue[] = [];
  let lines = new Map<string, number>();
  const add = (kind: ReasoningIssue['kind'], at: string, message: string, avocat?: string, cible?: string) => {
    const id = issueId(kind, at, message);
    if (issues.some((issue) => issue.id === id)) return;
    const line = lines.get(at) ?? lines.get(at.replace(/(\.[^.[\]]+|\[\d+\])$/, '')) ?? null;
    issues.push({ id, kind, path: at, line, text: message, ...(avocat ? { avocat, ...(cible ? { cible } : {}) } : {}) });
  };

  let parsed;
  try { parsed = parseReasoningDocument(input.code); } catch (error) {
    if (!(error instanceof LiteralError)) throw error;
    const found = error instanceof ReasoningSyntaxError ? error.problems : [error];
    return { evenements: [], echeances: [], issues: found.map((problem) => ({ id: issueId('erreur', '', problem.message), kind: 'erreur', path: '', line: problem.line, text: problem.message })) };
  }
  lines = parsed.lines;
  const { events, deadlines, problems } = readSuivi(parsed.value);
  for (const problem of problems) add('erreur', problem.path, problem.text);

  const used = new Set<string>();
  for (const deadline of deadlines.values()) for (const link of [deadline.de, deadline.avant]) if (link) {
    used.add(link);
    if (!events.has(link) && !deadlines.has(link)) add('erreur', `echeances.${deadline.nom}.${deadline.de ? 'de' : 'avant'}`, `${link} n’est ni un événement ni une échéance du suivi`);
  }

  type Computed = { date: string | null; calcul: string[]; suppose: boolean; base: string | null };
  const computed = new Map<string, Computed>();
  const visiting = new Set<string>();
  const compute = (nom: string): Computed => {
    const known = computed.get(nom);
    if (known) return known;
    const event = events.get(nom);
    if (event) return { date: event.date, calcul: [], suppose: event.hypothese, base: event.date };
    const deadline = deadlines.get(nom);
    if (!deadline) return { date: null, calcul: [], suppose: false, base: null };
    if (visiting.has(nom)) { add('erreur', `echeances.${nom}`, 'échéances qui dépendent l’une de l’autre en boucle : l’une d’elles doit partir d’un événement'); return { date: null, calcul: [], suppose: false, base: null }; }
    visiting.add(nom);
    const result = calculate(deadline);
    visiting.delete(nom);
    computed.set(nom, result);
    return result;
  };
  const calculate = (deadline: Deadline): Computed => {
    const link = deadline.de ?? deadline.avant;
    if (!link || !deadline.delai) return { date: deadline.date ?? null, calcul: deadline.date ? ['Date fixée'] : [], suppose: false, base: deadline.date ?? null };
    const origin = compute(link);
    if (!origin.date) return { date: null, calcul: [`À calculer : ${human(link)} n’a pas de date`], suppose: origin.suppose, base: null };
    const sign = deadline.de ? 1 : -1;
    const label = events.get(link)?.intitule ?? deadlines.get(link)?.intitule ?? human(link);
    const steps: string[] = [];
    let term = shift(origin.date, deadline.delai, sign);
    steps.push(`${label} le ${day(origin.date)} ${sign > 0 ? '+' : '−'} ${span(deadline.delai)} → ${day(term)}`);
    if (deadline.decompte?.depart === 'inclus') { term = addDays(term, -sign); steps.push(`jour de départ compté → ${day(term)}`); }
    if (deadline.prolongation) { term = shift(term, deadline.prolongation.delai, sign); steps.push(`prolongation ${sign > 0 ? '+' : '−'} ${span(deadline.prolongation.delai)} → ${day(term)}`); }
    const report = deadline.decompte?.report;
    if (report && report !== 'aucun' && closed(term)) {
      const moved = nextOpen(term, report === 'jour_ouvrable_suivant' ? 1 : -1);
      steps.push(`${weekday(term)} ${day(term)} (${moved.skipped.map((entry) => entry.raison).filter((reason, index, all) => all.indexOf(reason) === index).join(', ')}) → ${weekday(moved.date)} ${day(moved.date)}`);
      term = moved.date;
    } else if (!report && closed(term)) steps.push(`tombe un ${closed(term)} : report à préciser dans decompte`);
    if (deadline.delai.unite === 'jours_ouvres' || (report && report !== 'aucun')) steps.push('jours fériés de métropole');
    return { date: term, calcul: steps, suppose: origin.suppose, base: origin.date };
  };
  for (const nom of deadlines.keys()) compute(nom);

  for (const event of events.values()) {
    const at = `evenements.${event.nom}`;
    if (event.hypothese && event.preuve.length) add('erreur', at, 'hypothese et preuve s’excluent : une date prouvée n’est pas une hypothèse');
    if (!event.hypothese && !event.preuve.length) add('manque', at, 'date non prouvée : ajoute preuve: [{ piece, citation }] avec le passage qui porte la date ; pour un acte pas encore signé, hypothese: true', `${event.intitule} : la date n’est pas prouvée par une pièce.`);
    if (event.preuve.length && !event.preuve.some((proof) => mentionsDate(proof.citation, event.date))) add('manque', `${at}.preuve`, `la citation ne montre pas la date du ${day(event.date)} : cite le passage de la pièce qui la porte`, `${event.intitule} : la pièce citée ne montre pas la date du ${day(event.date)}.`);
    if (!used.has(event.nom) && !event.selon.length) add('manque', at, 'événement qui ne fait courir aucune échéance et dont aucun texte cité ne fonde la portée : relie-le à une échéance (de ou avant), cite le texte ou la clause qui lui donne effet (selon), ou retire-le ; le suivi n’est pas une chronologie', `${event.intitule} : sans effet établi sur le dossier.`);
  }
  for (const deadline of deadlines.values()) {
    const at = `echeances.${deadline.nom}`;
    const result = computed.get(deadline.nom)!;
    if (deadline.delai && (deadline.de || deadline.avant)) {
      if (!deadline.selon.length) add('erreur', at, 'délai sans fondement : cite le texte, la décision ou la clause qui le fixe (selon: [{ source, citation }])', `${deadline.intitule} : le délai n’est pas justifié.`);
      if (!deadline.decompte) add('manque', at, `décompte non justifié : ajoute ${COUNT_SHAPE}, avec le texte ou la clause qui fixe ce décompte`, `${deadline.intitule} : la manière de compter le délai n’est pas justifiée.`);
      else {
        if (!deadline.decompte.depart) add('manque', `${at}.decompte`, 'depart manquant : exclu (le jour de l’événement ne compte pas) ou inclus');
        if (!deadline.decompte.report) add('manque', `${at}.decompte`, 'report manquant : jour_ouvrable_suivant, jour_ouvrable_precedent ou aucun');
        if (!deadline.decompte.selon.length) add('manque', `${at}.decompte`, 'décompte sans fondement : cite le texte ou la clause qui fixe ce décompte (selon: [{ source, citation }])', `${deadline.intitule} : la manière de compter le délai n’est pas justifiée.`);
      }
      if (deadline.prolongation && !deadline.prolongation.selon.length) add('erreur', `${at}.prolongation`, 'prolongation sans fondement : cite le texte ou la clause qui l’accorde (selon: [{ source, citation }])');
      if (deadline.date && result.date && deadline.date !== result.date) add('erreur', `${at}.date`, `date écrite ${day(deadline.date)}, le calcul donne ${day(result.date)} : corrige la date ou le délai`, `${deadline.intitule} : la date indiquée (${day(deadline.date)}) ne correspond pas au calcul (${day(result.date)}).`);
    } else if (deadline.date) {
      if (!deadline.preuve.length && !deadline.selon.length) add('erreur', at, 'date sans justification : cite la pièce qui la fixe (preuve: [{ piece, citation }]) ou le texte (selon)', `${deadline.intitule} : la date n’est pas justifiée.`);
      if (deadline.preuve.length && !deadline.preuve.some((proof) => mentionsDate(proof.citation, deadline.date!))) add('manque', `${at}.preuve`, `la citation ne montre pas la date du ${day(deadline.date)} : cite le passage de la pièce qui la porte`);
    }
    if (deadline.fait && !deadline.fait.preuve.length) add('manque', `${at}.fait`, 'accomplissement non prouvé : ajoute preuve: [{ piece, citation }]');
    if (result.date && result.date < today && !result.suppose && !deadline.fait && !input.marks.has(deadline.nom)) add('manque', at, `échéance dépassée le ${day(result.date)} sans être marquée faite : ajoute fait: { date, preuve } ou fais-la marquer par l’avocat`, `${deadline.intitule} : échéance du ${day(result.date)} dépassée, non marquée faite.`);
  }

  const lookups = new Map<string, Promise<SourceInfo | null | undefined>>();
  const lookup = (id: string) => { if (!lookups.has(id)) lookups.set(id, connectors.source(cwd, id).catch(() => null)); return lookups.get(id)!; };
  const titles = new Map<string, string>();
  const checkProof = async (at: string, proof: Proof) => {
    const info = await lookup(proof.piece);
    if (!info) { add('erreur', `${at}.piece`, `pièce introuvable dans le dossier : ${proof.piece}`, `La pièce ${proof.piece} est introuvable dans le dossier.`); return; }
    titles.set(proof.piece, info.title);
    if (!connectors.match(info.text, proof.citation)) add('erreur', at, `citation introuvable dans ${info.title} : recopie le passage exact`, `Le passage cité est introuvable dans ${info.title} : « ${proof.citation} ».`, `#piece:${proof.piece}`);
    if (input.reliability.get(proof.piece) === false) add('erreur', `${at}.piece`, `pièce marquée non fiable par l’avocat : ${info.title}`, `${info.title} est marquée non fiable.`, `#piece:${proof.piece}`);
  };
  const checkSource = async (at: string, basis: Source, on: string | null) => {
    const info = await lookup(basis.source);
    if (info === undefined && !OFFICIAL_ID.test(basis.source)) { add('erreur', `${at}.source`, `source sans identifiant officiel : ${basis.source} ; indique son identifiant (${ID_SHAPE}), trouvé avec les outils Légifrance`, `${basis.source} n’est pas désigné par son identifiant officiel.`, `#source:${basis.source}`); return; }
    if (info === undefined) { add('manque', `${at}.source`, `source non vérifiable automatiquement : aucun connecteur pour ${basis.source}`, `${basis.source} n’a pas pu être relu automatiquement : à vérifier vous-même.`, `#source:${basis.source}`); return; }
    if (info === null) { add('erreur', `${at}.source`, `source introuvable : ${basis.source}`, `La source ${basis.source} est introuvable.`); return; }
    titles.set(basis.source, info.title);
    if (!connectors.match(info.text, basis.citation)) add('erreur', at, `citation introuvable dans ${info.title} : recopie le passage exact`, `Le passage cité est introuvable dans ${info.title} : « ${basis.citation} ».`, `#source:${basis.source}`);
    if (info.kind === 'decision') {
      if (info.history?.statut === 'remise en cause') add('erreur', `${at}.source`, `décision remise en cause par un recours (${info.history.details.join(' ; ')}) : cite la décision rendue sur ce recours`, `${info.title} a été remise en cause par un recours.`, `#source:${basis.source}`);
      else if (info.history?.statut === 'à examiner') add('manque', `${at}.source`, `historique judiciaire à examiner${info.history.details.length ? ` (${info.history.details.join(' ; ')})` : ''} : vérifie qu’aucun recours ne l’a remise en cause`, `${info.title} : l’historique judiciaire est à examiner.`, `#source:${basis.source}`);
      return;
    }
    if (info.kind === 'texte' && info.validity && on && !(info.validity.from <= on && (info.validity.to === null || on < info.validity.to))) {
      add('erreur', `${at}.source`, `version citée en vigueur ${info.validity.to ? `du ${day(info.validity.from)} au ${day(info.validity.to)}` : `depuis le ${day(info.validity.from)}`}, pas au ${day(on)} : cite la version applicable à cette date`, `${info.title} : la version citée n’était pas en vigueur au ${day(on)}.`, `#source:${basis.source}`);
    }
  };
  const checks: Array<Promise<void>> = [];
  const sourcesOf = (at: string, list: Source[], on: string | null) => list.forEach((basis, index) => checks.push(checkSource(`${at}[${index}]`, basis, on)));
  const proofsOf = (at: string, list: Proof[]) => list.forEach((proof, index) => checks.push(checkProof(`${at}[${index}]`, proof)));
  for (const event of events.values()) {
    proofsOf(`evenements.${event.nom}.preuve`, event.preuve);
    sourcesOf(`evenements.${event.nom}.selon`, event.selon, event.date);
  }
  for (const deadline of deadlines.values()) {
    const at = `echeances.${deadline.nom}`;
    const on = computed.get(deadline.nom)!.base;
    proofsOf(`${at}.preuve`, deadline.preuve);
    sourcesOf(`${at}.selon`, deadline.selon, on);
    if (deadline.decompte) sourcesOf(`${at}.decompte.selon`, deadline.decompte.selon, on);
    if (deadline.prolongation) sourcesOf(`${at}.prolongation.selon`, deadline.prolongation.selon, on);
    if (deadline.fait) proofsOf(`${at}.fait.preuve`, deadline.fait.preuve);
  }
  await Promise.all(checks);

  const proofView = (list: Proof[]): SuiviProof[] => list.map((proof) => ({ ...proof, ...(titles.has(proof.piece) ? { titre: titles.get(proof.piece) } : {}) }));
  const sourceView = (list: Source[]): SuiviBasis[] => list.map((basis) => ({ ...basis, ...(titles.has(basis.source) ? { titre: titles.get(basis.source) } : {}) }));
  const counted = (at: string, kind: ReasoningIssue['kind']) => issues.filter((issue) => issue.kind === kind && (issue.path === at || issue.path.startsWith(`${at}.`))).length;
  const evenements: SuiviEvent[] = [...events.values()].map((event) => ({ nom: event.nom, intitule: event.intitule, date: event.date, suppose: event.hypothese, preuve: proofView(event.preuve), selon: sourceView(event.selon) }));
  const echeances: SuiviDeadline[] = [...deadlines.values()].map((deadline) => {
    const result = computed.get(deadline.nom)!;
    const mark = input.marks.get(deadline.nom);
    const fait: SuiviDone | null = deadline.fait ? { date: deadline.fait.date, preuve: proofView(deadline.fait.preuve), par: 'fichier' } : mark ? { date: mark.date, preuve: [], par: 'avocat', piece: mark.piece, at: mark.at } : null;
    const at = `echeances.${deadline.nom}`;
    return {
      nom: deadline.nom, intitule: deadline.intitule, date: result.date, calcul: result.calcul, fixe: !deadline.delai, suppose: result.suppose,
      preuve: proofView(deadline.preuve), selon: sourceView([...deadline.selon, ...(deadline.prolongation?.selon ?? [])]), decompte: sourceView(deadline.decompte?.selon ?? []),
      fait, erreurs: counted(at, 'erreur'), manques: counted(at, 'manque'),
    };
  }).sort((left, right) => (left.date ?? '9999').localeCompare(right.date ?? '9999'));
  return { evenements: evenements.sort((left, right) => left.date.localeCompare(right.date)), echeances, issues };
}

export function describeSuivi(snapshot: Pick<SuiviSnapshot, 'issues' | 'code' | 'echeances'>, today = new Date().toISOString().slice(0, 10)) {
  const source = snapshot.code.split('\n');
  const out: string[] = [];
  if (snapshot.echeances.length) {
    out.push('Échéances :');
    for (const deadline of snapshot.echeances) {
      const state = deadline.fait ? `faite le ${day(deadline.fait.date)}` : !deadline.date ? 'date à établir' : deadline.date < today ? 'DÉPASSÉE' : deadline.date === today ? 'AUJOURD’HUI' : 'à venir';
      out.push(`  ${deadline.date ? day(deadline.date) : '??/??/????'} — ${deadline.intitule} (${deadline.nom}) — ${state}${deadline.suppose ? ' — date supposée' : ''}`);
      for (const step of deadline.calcul) out.push(`      ${step}`);
    }
    out.push('');
  }
  const errors = snapshot.issues.filter((issue) => issue.kind === 'erreur');
  const gaps = snapshot.issues.filter((issue) => issue.kind === 'manque');
  if (!errors.length && !gaps.length) { out.push('Aucune erreur, aucun manque.'); return out.join('\n'); }
  out.push(`${errors.length} erreur(s), ${gaps.length} manque(s).`);
  const block = (label: string, issue: ReasoningIssue, index: number) => {
    out.push('', `${label} ${index + 1} — ${issue.path ? issue.path.replace(/\./g, ' › ') : 'fichier'}${issue.line ? ` (ligne ${issue.line})` : ''}`);
    if (issue.line) out.push(`  ligne ${issue.line} : ${source[issue.line - 1]?.trim() ?? ''}`);
    out.push(`  ${issue.text}`);
  };
  errors.forEach((issue, index) => block('ERREUR', issue, index));
  gaps.forEach((issue, index) => block('MANQUE', issue, index));
  return out.join('\n');
}
