import { sourceContext } from './source-context.js';
import { catalaDocumentation } from '../../../server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/catala-documentation.mjs';
import { display, formula, reasoningMap, WORDS, modeOf, type Mode } from './reasoning-map.js';
import { nativeExecution, type NativeOrigin, type NativeProvenance } from './native-provenance.js';
import { applicationMarkup, conditionApplication } from './condition-application.js';

type File = { nom: string; chemin: string; contenu?: string };
type Citation = { origin: string; target: string; quote: string; status: string; title?: string; id?: string; recours?: Array<{ id: string; date: string; juridiction: string }>; pieces?: Array<{ target: string; quote: string; status: string; title?: string; author?: 'human' | 'agent'; review?: string }> };
export type Source = { label: string; target: string; kind: string; origin: string; quote: string; status: string; title?: string; id?: string; recours?: Array<{ id: string; date: string; juridiction: string }>; author?: 'human' | 'agent'; review?: string; premise?: string };
export type Clause = { kind: 'all' | 'any' | 'not' | 'leaf'; text: string; ref: string; refs: string[]; members: Clause[]; met: string };
type Notes = { question: string; justification: string; recherche: string; demarches: string[] };
type CoveredRange = { range: { start: { line: number }; end: { line: number } }; reached_by: number[]; subtree: CoveredRange[] };
export type Coverage = { scopes: Array<{ index: number; name: string }>; locations: Array<{ file: string; tree: CoveredRange[] }> };
export type Origin = NativeOrigin & { key: string; sources: Source[]; text: string; body: string; title: string; blockStart: number; blockEnd: number };
export type Step = { id: string; kind: 'fact' | 'condition' | 'rule'; type: string; answer: boolean; conditional: boolean; name: string; title: string; formula: string; expression: string; value: string; sources: Source[]; parents: string[]; level: number; issue: string; clause: Clause | null; notes: Notes; tests: string[]; origins: Origin[] };
export type Reasoning = { steps: Step[]; others: Source[]; nativeIssues: string[]; objective?: string; mode?: Mode };

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const key = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').trim().toLowerCase().replace(/[\s_]+/g, '_');
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const tone = (value: string) => value === 'Vrai' ? 'ok' : value === 'Faux' ? 'ko' : /^(?:Indéterminé|Disputé|null|None)$/i.test(value) ? 'warn' : 'neutral';
const legal = (source: Source) => source.kind === 'article' || source.kind === 'jurisprudence' || source.kind === 'clause';
const identity = (source: Source) => JSON.stringify([source.origin, source.label, source.target, source.quote]);
const unique = (sources: Source[]) => sources.filter((source, index) => sources.findIndex((other) => identity(other) === identity(source)) === index);
const OPERATORS = new Map([['et', 'et'], ['and', 'et'], ['ou', 'ou'], ['or', 'ou'], ['non', 'non'], ['not', 'non']]);
const BLOCKING = new Set(['si', 'alors', 'sinon', 'if', 'then', 'else', 'selon', 'soit', 'dans', 'pour', 'existe', 'bien', 'xor', 'match', 'with', 'let', 'in']);

const ACCENTS: Record<string, string> = {
  activite: 'activité', activites: 'activités', adresse: 'adresse', affaire: 'affaire',
  annee: 'année', annees: 'années', anciennete: 'ancienneté', arret: 'arrêt', arrets: 'arrêts',
  assemblee: 'assemblée', assemblees: 'assemblées', associe: 'associé', associes: 'associés',
  autorite: 'autorité', autorites: 'autorités', benefice: 'bénéfice', benefices: 'bénéfices',
  capacite: 'capacité', capacites: 'capacités', categorie: 'catégorie', categories: 'catégories',
  cede: 'cédé', cedee: 'cédée', cedes: 'cédés', cedees: 'cédées', ceder: 'céder',
  comite: 'comité', comites: 'comités', competence: 'compétence', competences: 'compétences',
  conge: 'congé', conges: 'congés', controle: 'contrôle', controles: 'contrôles',
  creat: 'créé', cree: 'créé', creee: 'créée', crees: 'créés', creent: 'créent', creation: 'création', creations: 'créations',
  creance: 'créance', creances: 'créances', creancier: 'créancier', creanciers: 'créanciers',
  debiteur: 'débiteur', debiteurs: 'débiteurs', deces: 'décès', decede: 'décédé', decedee: 'décédée',
  decision: 'décision', decisions: 'décisions', deduit: 'déduit', deduction: 'déduction', deductions: 'déductions',
  defaillance: 'défaillance', defaillances: 'défaillances', defaut: 'défaut', defauts: 'défauts',
  delai: 'délai', delais: 'délais', depense: 'dépense', depenses: 'dépenses', depot: 'dépôt', depots: 'dépôts',
  determine: 'déterminé', determinee: 'déterminée', determines: 'déterminés', determinees: 'déterminées',
  donnee: 'donnée', donnees: 'données', duree: 'durée', durees: 'durées', echeance: 'échéance', echeances: 'échéances',
  element: 'élément', elements: 'éléments', entree: 'entrée', entrees: 'entrées', etape: 'étape', etapes: 'étapes',
  economique: 'économique', economiques: 'économiques', egalite: 'égalité', election: 'élection', elections: 'élections',
  electeur: 'électeur', electeurs: 'électeurs', enregistre: 'enregistré', enregistree: 'enregistrée',
  epoux: 'époux', epouse: 'épouse', etablissement: 'établissement', etablissements: 'établissements',
  etranger: 'étranger', etrangere: 'étrangère', etrangers: 'étrangers', etrangeres: 'étrangères',
  evaluation: 'évaluation', evaluations: 'évaluations', execution: 'exécution', executions: 'exécutions',
  general: 'général', generale: 'générale', generaux: 'généraux', generales: 'générales',
  gerant: 'gérant', gerante: 'gérante', heritier: 'héritier', heritiers: 'héritiers',
  immeuble: 'immeuble', immeubles: 'immeubles', indemnite: 'indemnité', indemnites: 'indemnités',
  inexecution: 'inexécution', inexecutions: 'inexécutions', interet: 'intérêt', interets: 'intérêts',
  legal: 'légal', legale: 'légale', legaux: 'légaux', legales: 'légales', legalite: 'légalité',
  legitime: 'légitime', legitimes: 'légitimes', majorite: 'majorité', minorite: 'minorité',
  materiel: 'matériel', materielle: 'matérielle', materiels: 'matériels', materielles: 'matérielles',
  modifie: 'modifié', modifiee: 'modifiée', modifies: 'modifiés', modifiees: 'modifiées',
  necessaire: 'nécessaire', necessaires: 'nécessaires', necessite: 'nécessité',
  nullite: 'nullité', nullites: 'nullités', numero: 'numéro', numeros: 'numéros',
  penal: 'pénal', penale: 'pénale', penaux: 'pénaux', penales: 'pénales',
  penalite: 'pénalité', penalites: 'pénalités', periode: 'période', periodes: 'périodes',
  prealable: 'préalable', prealables: 'préalables', precarite: 'précarité', precedent: 'précédent',
  precedente: 'précédente', precedents: 'précédents', precedentes: 'précédentes', preavis: 'préavis',
  president: 'président', presidente: 'présidente', presomption: 'présomption', presomptions: 'présomptions',
  pret: 'prêt', prets: 'prêts', prerequis: 'prérequis', propriete: 'propriété', proprietes: 'propriétés',
  regle: 'règle', regles: 'règles', resultat: 'résultat', resultats: 'résultats',
  reclamation: 'réclamation', reclamations: 'réclamations', recu: 'reçu', recue: 'reçue', recus: 'reçus', recues: 'reçues',
  reduction: 'réduction', reductions: 'réductions', reel: 'réel', reelle: 'réelle', reels: 'réels', reelles: 'réelles',
  reglement: 'règlement', reglements: 'règlements', regulier: 'régulier', reguliere: 'régulière',
  reguliers: 'réguliers', regulieres: 'régulières', regularisation: 'régularisation', regularisations: 'régularisations',
  remuneration: 'rémunération', remunerations: 'rémunérations', representant: 'représentant', representants: 'représentants',
  residence: 'résidence', resolutions: 'résolutions', resolution: 'résolution', resiliation: 'résiliation', resiliations: 'résiliations',
  responsabilite: 'responsabilité', responsabilites: 'responsabilités', revision: 'révision', revisions: 'révisions',
  salarie: 'salarié', salariee: 'salariée', salaries: 'salariés', salariees: 'salariées',
  secretaire: 'secrétaire', secretaires: 'secrétaires', societe: 'société', societes: 'sociétés',
  solidarite: 'solidarité', specialite: 'spécialité', specialites: 'spécialités', telephone: 'téléphone', telephones: 'téléphones',
  respecte: 'respecté', respectee: 'respectée', respectes: 'respectés', respectees: 'respectées',
  valide: 'validé', validee: 'validée', valides: 'validés', validees: 'validées', validite: 'validité',
  verification: 'vérification', verifications: 'vérifications',
  verifie: 'vérifié', verifiee: 'vérifiée', verifies: 'vérifiés', verifiees: 'vérifiées',
};

const accentWord = (word: string) => {
  const replacement = ACCENTS[word.toLocaleLowerCase('fr')];
  if (!replacement) return word;
  return /^\p{Lu}/u.test(word) ? capital(replacement) : replacement;
};
const PHRASES: Array<[RegExp, string]> = [
  [/\bdommages[ _]interets\b/gi, 'dommages et intérêts'],
  [/\bmise[ _]en[ _]demeure\b/gi, 'mise en demeure'],
  [/\bbonne[ _]foi\b/gi, 'bonne foi'],
  [/\bmauvaise[ _]foi\b/gi, 'mauvaise foi'],
];
export const human = (text: string) => PHRASES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text)
  .replace(/[\p{L}\p{N}_]+/gu, (word) => /^(?:true|vrai)$/i.test(word) ? 'Vrai' : /^(?:false|faux)$/i.test(word) ? 'Faux' : word
    .split('_').map((part) => part.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')).join(' ')
    .split(/\s+/).map(accentWord).join(' '))
  .replace(/\s+/g, ' ').replace(/(^|\s)([ldjmnst]|qu) (?=[aeiouyhéèêàâîôûœ])/giu, '$1$2’').trim();

function parseDot(dot: string) {
  const nodes = new Map<string, { lines: string[]; kind: string; source: string; headings: string[] }>();
  const inputs = new Set(dot.match(/subgraph\s+cluster_inputs\s*\{([^}]*)\}/)?.[1].match(/\bx\d+\b/g) ?? []);
  const plain = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
  const edges: Array<{ from: string; to: string; dashed: boolean }> = [];
  const statements = /\b(x\d+)\s*(?:->\s*(x\d+)\s*)?\[/g;
  let match: RegExpExecArray | null;
  while ((match = statements.exec(dot))) {
    const start = statements.lastIndex;
    let angle = 0;
    let quote = false;
    let end = start;
    for (; end < dot.length; end++) {
      const char = dot[end];
      if (char === '\\' && quote) { end++; continue; }
      if (char === '"') quote = !quote;
      if (quote) continue;
      if (char === '<') angle++;
      if (char === '>') angle--;
      if (char === ']' && angle === 0) break;
    }
    if (end === dot.length) throw new Error('Graphe Catala incomplet.');
    statements.lastIndex = end + 1;
    const attributes = dot.slice(start, end);
    if (match[2]) {
      if (!/style\s*=\s*"?invis\b/.test(attributes)) edges.push({ from: match[1], to: match[2], dashed: /style\s*=\s*"[^"]*dashed/.test(attributes) });
      continue;
    }
    const label = attributes.match(/\blabel\s*=\s*<([\s\S]*)>/)?.[1];
    if (!label) throw new Error('Libellé Catala absent.');
    const lines = (new DOMParser().parseFromString(label.replace(/<\/(?:td|tr)>|<br\s*\/?\s*>|<hr\s*\/?\s*>/gi, '\n'), 'text/html').body.textContent || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const kind = /style\s*=\s*"[^"]*dashed/.test(attributes) ? 'condition' : inputs.has(match[1]) ? 'input' : /shape\s*=\s*plaintext/.test(attributes) ? 'conclusion' : 'calculation';
    const headings = plain(attributes.match(/\btooltip\s*=\s*"((?:\\.|[^"\\])*)"/)?.[1] ?? '').split(/\n[»\s]*/).filter(Boolean);
    nodes.set(match[1], { lines, kind, source: plain(attributes.match(/\bURL\s*=\s*"((?:\\.|[^"\\])*)"/)?.[1] ?? ''), headings });
  }
  if (edges.some((edge) => !nodes.has(edge.from) || !nodes.has(edge.to))) throw new Error('Graphe Catala invalide.');
  return { nodes, edges };
}

function citationOf(sources: Citation[], origin: string, target: string, quote: string) {
  return sources.find((entry) => entry.origin === origin && entry.target === target && entry.quote === quote);
}

function citedSources(entry: Omit<Source, 'status'>, citations: Citation[]): Source[] {
  const cited = citationOf(citations, entry.origin, entry.target, entry.quote);
  if (entry.kind === 'premise' && cited?.pieces?.length) return cited.pieces.map((piece) => ({ label: piece.title ?? entry.label, target: piece.target, kind: 'piece', origin: entry.origin, quote: piece.quote, status: piece.status, ...(piece.title ? { title: piece.title } : {}), ...(piece.author ? { author: piece.author } : {}), ...(piece.review ? { review: piece.review } : {}), ...(cited.title ? { premise: cited.title } : {}) }));
  return [{ ...entry, status: cited?.status ?? '', ...(cited?.title ? { title: cited.title } : {}), ...(cited?.id ? { id: cited.id } : {}), ...(cited?.recours?.length ? { recours: cited.recours } : {}) }];
}

const emptyNotes = (): Notes => ({ question: '', justification: '', recherche: '', demarches: [] });

function documentSources(file: File, citations: Citation[], linked: Map<string, Source[]>, notes: Map<string, Notes>) {
  type Section = { sources: Source[]; concerned: string[]; blocks: Array<{ start: number; end: number }>; notes: Notes };
  const sections: Section[] = [];
  let current: Section = { sources: [], concerned: [], blocks: [], notes: emptyNotes() };
  let lines: string[] = [];
  let fence = '';
  let catala = false;
  let blockStart = 0;
  const found = (text: string) => sourceContext('https://catala.local/section.md', [{ nom: 'section.md', chemin: file.chemin, contenu: text }], true).references
    .filter((entry) => entry.target)
    .flatMap((entry) => citedSources({ label: entry.label, target: entry.target, kind: entry.kind, origin: file.chemin, quote: entry.quote }, citations));
  const commit = () => {
    const text = lines.join('\n');
    lines = [];
    if (!text.trim()) return;
    current.sources.push(...found(text));
    for (const match of text.matchAll(/^Concerne\s*:\s*(.+)$/gim)) current.concerned.push(...match[1].split(',').map(key).filter(Boolean));
    for (const [label, field] of [['Question', 'question'], ['Justification', 'justification'], ['À rechercher', 'recherche']] as const) {
      const value = text.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, 'im'))?.[1];
      if (value) current.notes[field] = value;
    }
    current.notes.demarches.push(...[...text.matchAll(/^Démarche\s*:\s*(.+)$/gim)].map((match) => match[1]));
  };
  (file.contenu ?? '').split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        if (catala) current.blocks.push({ start: blockStart, end: index + 1 });
        fence = '';
        catala = false;
      }
      return;
    }
    if (marker) { commit(); fence = marker[1]; catala = marker[2].trim() === 'catala'; blockStart = index + 1; return; }
    if (/^#{1,6}\s/.test(line)) { commit(); sections.push(current); current = { sources: [], concerned: [], blocks: [], notes: emptyNotes() }; return; }
    lines.push(line);
  });
  commit();
  sections.push(current);
  const blocks: Array<{ start: number; end: number; sources: Source[] }> = [];
  let carry: Source[] = [];
  for (const section of sections) {
    const sources = unique([...carry, ...section.sources]);
    for (const name of section.concerned) {
      linked.set(name, [...(linked.get(name) ?? []), ...section.sources]);
      const previous = notes.get(name) ?? emptyNotes();
      notes.set(name, {
        question: section.notes.question || previous.question,
        justification: section.notes.justification || previous.justification,
        recherche: section.notes.recherche || previous.recherche,
        demarches: [...previous.demarches, ...section.notes.demarches],
      });
    }
    if (section.blocks.length) {
      for (const block of section.blocks) blocks.push({ ...block, sources });
      carry = [];
    } else if (!section.concerned.length) carry = sources;
  }
  return { blocks, trailing: carry };
}

const conjunction = (kind: 'all' | 'any', members: Clause[]): Clause => members.length === 1 ? members[0] : { kind, text: '', ref: '', refs: [], members: members.flatMap((member) => member.kind === kind ? member.members : [member]), met: '' };

function parseClause(expression: string, find: (name: string) => Step | undefined): Clause | null {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  if (!tokens.length || tokens.some((token) => BLOCKING.has(token))) return null;
  let at = 0;
  const leaf = (text: string): Clause => {
    const exact = find(text);
    const refs = exact ? [exact.id] : [...new Set((text.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []).map(find).filter((step): step is Step => Boolean(step)).map((step) => step.id))];
    return { kind: 'leaf', text, ref: exact?.id ?? '', refs, members: [], met: '' };
  };
  const unary = (): Clause => {
    if (OPERATORS.get(tokens[at]) === 'non') { at++; return { kind: 'not', text: '', ref: '', refs: [], members: [unary()], met: '' }; }
    if (tokens[at] === '(') {
      at++;
      const inner = any();
      if (tokens[at++] !== ')') throw new Error('parenthèse');
      return inner;
    }
    const words: string[] = [];
    while (at < tokens.length && !OPERATORS.has(tokens[at]) && tokens[at] !== '(' && tokens[at] !== ')') words.push(tokens[at++]);
    if (!words.length) throw new Error('terme');
    return leaf(words.join(' '));
  };
  const all = (): Clause => { const members = [unary()]; while (OPERATORS.get(tokens[at]) === 'et') { at++; members.push(unary()); } return conjunction('all', members); };
  const any = (): Clause => { const members = [all()]; while (OPERATORS.get(tokens[at]) === 'ou') { at++; members.push(all()); } return conjunction('any', members); };
  try {
    const root = any();
    return at === tokens.length && !(root.kind === 'leaf' && /^(?:vrai|faux|true|false)$/i.test(root.text)) ? root : null;
  } catch { return null; }
}

function infer(clause: Clause, met: string) {
  if (!met) return;
  if (!clause.met) clause.met = met;
  if (clause.kind === 'not') infer(clause.members[0], ({ ok: 'ko', ko: 'ok' } as Record<string, string>)[met] ?? '');
  else if (clause.kind === 'all' && met === 'ok' || clause.kind === 'any' && met === 'ko') clause.members.forEach((member) => infer(member, met));
}

function judge(clause: Clause, steps: Map<string, Step>): string {
  const members = clause.members.map((member) => judge(member, steps));
  const truth = (value = '') => value === 'Vrai' ? 'ok' : value === 'Faux' ? 'ko' : value ? 'warn' : '';
  clause.met = clause.kind === 'leaf' ? truth(steps.get(clause.ref)?.value)
    : clause.kind === 'not' ? ({ ok: 'ko', ko: 'ok' } as Record<string, string>)[members[0]] ?? members[0]
    : members.includes(clause.kind === 'all' ? 'ko' : 'ok') ? (clause.kind === 'all' ? 'ko' : 'ok')
    : members.every((met) => met === (clause.kind === 'all' ? 'ok' : 'ko')) ? (clause.kind === 'all' ? 'ok' : 'ko')
    : members.includes('warn') ? 'warn' : '';
  return clause.met;
}

const leaves = (clause: Clause | null): Clause[] => !clause ? [] : clause.kind === 'leaf' ? [clause] : clause.members.flatMap(leaves);
const roots = (clause: Clause) => clause.kind === 'all' ? clause.members : [clause];
const inner = (clause: Clause) => clause.kind === 'not' ? clause.members[0] : clause;
const children = (clause: Clause) => inner(clause).kind === 'leaf' ? [] : inner(clause).members;
const lawOf = (clause: Clause, steps: Map<string, Step>) => unique(leaves(clause).flatMap((leaf) => leaf.refs.flatMap((id) => steps.get(id)?.sources.filter(legal) ?? [])));

export function reasoning(dot: string, files: File[] = [], citations: Citation[] = [], coverage?: Coverage, provenance?: NativeProvenance, mode: Mode = 'litigation'): Reasoning {
  const contract = mode === 'transactional';
  const native = provenance ? nativeExecution(provenance) : null;
  const fallback = !dot.trim() || dot.trim() === 'digraph G {}' || Boolean(native?.variables.length);
  const { nodes, edges } = parseDot(fallback && native?.variables.length ? native.dot : dot);
  const linked = new Map<string, Source[]>();
  const notes = new Map<string, Notes>();
  const activeFiles = files.filter((file) => !/#\[test\]/.test(file.contenu ?? '') || [...nodes.values()].some((node) => {
    try { return decodeURIComponent(new URL(node.source).pathname).endsWith(`/${file.nom}`); } catch { return false; }
  }));
  const documents = activeFiles.map((file) => documentSources(file, citations, linked, notes));
  const authoredSources = documents.flatMap((document) => [...document.blocks.flatMap((block) => block.sources), ...document.trailing]);
  const types = new Map(activeFiles.flatMap((file) => [...(file.contenu ?? '').matchAll(/^\s*(?:entrée|interne|résultat|contexte|input|internal|output|context)\s+(\S+)\s+contenu\s+(\S+)/gm)].map((match) => [key(match[1]), match[2]])));
  const articleNames = new Map(activeFiles.flatMap((file) => [...(file.contenu ?? '').matchAll(/^#{1,6}\s+(.+?)\s*\|\s*((?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d+)/gm)].map((match) => [match[2], match[1].trim()])));
  const located = (source: string): Source[] => {
    let selected: File[];
    try {
      const url = new URL(source);
      const pathname = decodeURIComponent(url.pathname).replace(/^\/(\w:)/, '$1');
      selected = activeFiles.filter((file) => url.protocol === 'file:' ? file.chemin.replaceAll('\\', '/') === pathname : pathname.endsWith(`/${file.nom.replaceAll('\\', '/')}`));
    } catch { return []; }
    if (selected.length !== 1) return [];
    return sourceContext(source, selected, false, contract).references.filter((entry) => entry.target).flatMap((entry) => {
      const authored = authoredSources.find((item) => item.target === entry.target && item.label !== item.target);
      const id = entry.target.match(/(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d+/)?.[0];
      const label = authored?.label ?? (id ? articleNames.get(id) : undefined) ?? entry.label;
      return citedSources({ ...entry, label }, citations);
    });
  };
  const documentation = new Map(files.map((file) => [file.chemin, catalaDocumentation(file.contenu ?? '').entries.filter((entry) => entry.hasDoc || entry.title)]));
  const docTitle = (file: string, line: number) => documentation.get(file)?.find((entry) => entry.startLine <= line && line <= entry.endLine)?.title ?? '';
  const enrich = (entry: NativeOrigin): Origin => {
    const source = `${new URL(`file:///${entry.file.replaceAll('\\', '/').replace(/^\/+/, '')}`).href}#L${entry.line}`;
    const content = files.find((file) => file.chemin === entry.file)?.contenu?.split(/\r?\n/) ?? [];
    const selected = content.slice(entry.line - 1, entry.endLine);
    if (selected.length) {
      selected[selected.length - 1] = selected.at(-1)!.slice(0, entry.endColumn - 1);
      selected[0] = selected[0].slice(Math.max(0, entry.column - 1));
    }
    const opened = /\b(?:définition|règle|definition|rule)\b/.test(content[entry.line - 1] ?? '');
    const end = content.findIndex((line, at) => at >= entry.line && (/^\s*(?:```|#\[|étiquette\b|exception\b|label\b)/.test(line) || (opened || at > entry.line) && /^\s*(?:définition|règle|definition|rule)\b/.test(line) || !line.trim()));
    const body = content.slice(entry.line - 1, end < 0 ? undefined : end).join('\n').slice(Math.max(0, entry.column - 1));
    const block = documentation.get(entry.file)?.find((item) => item.startLine <= entry.line && entry.line <= item.endLine);
    return { ...entry, key: JSON.stringify([entry.file, entry.line, entry.column, entry.endLine, entry.endColumn, entry.role]), sources: located(source), text: selected.join('\n'), body, title: docTitle(entry.file, entry.line), blockStart: block?.startLine ?? entry.line, blockEnd: block?.endLine ?? entry.endLine };
  };
  const steps = new Map<string, Step>();
  for (const [id, node] of nodes) {
    const body = node.kind === 'conclusion' && node.lines.length > 2 ? node.lines.slice(1) : node.lines;
    let equal = -1;
    body.forEach((line, index) => { if (line.startsWith('=')) equal = index; });
    const value = human(equal >= 0 ? body.slice(equal).join(' ').replace(/^=\s*/, '') : node.kind !== 'condition' && body.length > 1 ? body.at(-1)! : '');
    const kind = node.kind === 'input' ? 'fact' : node.kind === 'condition' ? 'condition' : 'rule';
    const head = kind === 'condition' ? body.slice(0, equal >= 0 ? equal : undefined).join(' ') : body[0] ?? '';
    const expression = kind === 'condition' ? head : body.slice(1, equal >= 0 ? equal : body.length > 1 ? -1 : undefined).join(' ');
    const tests = new Set<number>();
    if (coverage && node.source) {
      const url = new URL(node.source);
      const file = files.find((entry) => decodeURIComponent(url.pathname).endsWith(`/${entry.nom}`));
      const line = Number(url.hash.match(/^#L(\d+)/)?.[1]) - 1;
      const visit = (ranges: CoveredRange[]) => { for (const range of ranges) {
        if (range.range.start.line <= line && line <= range.range.end.line) range.reached_by.forEach((index) => tests.add(index));
        visit(range.subtree);
      } };
      if (file) for (const location of coverage.locations) if (location.file === file.chemin) visit(location.tree);
    }
    const matches = native?.variables.filter((variable) => key(variable.name) === key(head) && human(variable.value) === value) ?? [];
    const variable = fallback ? native?.variables.find((variable) => variable.id === id) : matches.length === 1 ? matches[0] : undefined;
    const origins = variable?.origins.filter((entry) => entry.file && entry.line > 0).map(enrich) ?? [];
    if (!origins.some((entry) => entry.selected && entry.role === 'definition') && node.source) {
      try {
        const url = new URL(node.source);
        const path = decodeURIComponent(url.pathname);
        const file = files.filter((entry) => path.endsWith(`/${entry.nom}`));
        const line = Number(url.hash.match(/^#L(\d+)/)?.[1]);
        if (file.length === 1 && line) origins.push(enrich({ file: file[0].chemin, line, column: 1, endLine: line, endColumn: (file[0].contenu?.split(/\r?\n/)[line - 1]?.length ?? 0) + 1, headings: node.headings, role: 'definition', selected: true, label: '', expression: '', overrides: '' }));
      } catch {}
    }
    const documented = (['definition', 'declaration'] as const).map((role) => origins.find((entry) => entry.selected && entry.role === role && entry.title)?.title).find(Boolean) || notes.get(key(head))?.question;
    steps.set(id, { id, kind, type: types.get(key(head)) ?? '', answer: node.kind === 'conclusion' || Boolean(fallback && variable?.output && !edges.some((edge) => edge.from === id)), conditional: false, name: kind === 'condition' ? '' : head, title: documented || capital(human(head)), formula: kind === 'condition' ? '' : human(expression), expression, value, sources: [], parents: edges.filter((edge) => edge.to === id).map((edge) => edge.from), level: 0, issue: '', clause: null, notes: notes.get(key(head)) ?? emptyNotes(), tests: coverage?.scopes.filter((scope) => tests.has(scope.index)).map((scope) => scope.name) ?? [], origins });
  }
  for (const step of [...steps.values()].filter((entry) => entry.answer)) {
    const twin = step.parents.map((id) => steps.get(id)!).find((parent) => parent.kind === 'rule' && key(parent.name) === key(step.name));
    if (!twin) continue;
    twin.answer = true;
    steps.delete(step.id);
    for (const other of steps.values()) other.parents = other.parents.map((id) => id === step.id ? twin.id : id);
  }
  const used = new Set<string>();
  for (const step of steps.values()) {
    step.sources = unique([...step.origins.filter((origin) => origin.selected).flatMap((origin) => origin.sources), ...located(nodes.get(step.id)!.source), ...(step.name ? linked.get(key(step.name)) ?? [] : [])]);
    if (step.kind === 'rule' && !step.answer && !step.expression && !step.parents.length && step.sources.some((source) => source.kind === 'piece' || source.kind === 'premise') && !step.sources.some(legal)) step.kind = 'fact';
    step.sources.forEach((source) => used.add(identity(source)));
    step.origins.flatMap((origin) => origin.sources).forEach((source) => used.add(identity(source)));
  }
  const named = new Map([...steps.values()].filter((step) => step.name).map((step) => [key(step.name), step]));
  const find = (name: string) => named.get(key(name));
  for (const step of steps.values()) {
    if (step.kind !== 'rule') continue;
    step.conditional = !step.expression && edges.some((edge) => edge.to === step.id && edge.dashed);
    const conditions = step.parents.map((id) => steps.get(id)!).filter((parent) => parent.kind === 'condition');
    const parts = [...conditions.map((condition) => parseClause(condition.expression, find) ?? { kind: 'leaf' as const, text: condition.expression, ref: condition.id, refs: condition.parents, members: [], met: '' }), parseClause(step.expression, find)].filter((part): part is Clause => Boolean(part));
    step.clause = parts.length ? conjunction('all', parts) : null;
    if (step.clause) { judge(step.clause, steps); infer(step.clause, step.value === 'Vrai' ? 'ok' : step.value === 'Faux' ? 'ko' : ''); }
    step.parents = [...new Set(step.parents.flatMap((id) => steps.get(id)!.kind === 'condition' ? steps.get(id)!.parents : [id]))];
  }
  for (const step of [...steps.values()]) if (step.kind === 'condition') steps.delete(step.id);
  for (const step of steps.values()) {
    step.parents = step.parents.filter((id) => steps.has(id));
    if (step.kind === 'fact' && /\b(?:Disputé|Contesté)(?!\p{L})/iu.test(step.value)) step.issue = contract ? 'Hypothèse discutée : fixez-la dans le cas de figure.' : 'Fait contesté : tranchez-le au vu des pièces.';
    if (step.kind === 'fact' && (!step.value || /\b(?:Indéterminé|Inconnu|null|None)(?!\p{L})/iu.test(step.value))) step.issue = contract ? 'Hypothèse non renseignée : fixez sa valeur dans le cas de figure.' : 'Fait non établi : indiquez la pièce qui l’établit.';
    if (step.kind === 'rule' && !step.sources.some(legal) && !(step.clause && roots(step.clause).some((clause) => lawOf(clause, steps).length))) step.issue = contract ? 'Aucune clause du contrat ni aucun texte rattaché à cette règle.' : 'Aucun article ni aucune décision rattaché à cette règle.';
  }
  const levels = new Map<string, number>();
  for (let pass = 0; pass <= steps.size; pass++) {
    for (const step of steps.values()) {
      if (levels.has(step.id) || !step.parents.every((id) => levels.has(id))) continue;
      levels.set(step.id, step.parents.length ? Math.max(...step.parents.map((id) => levels.get(id)!)) + 1 : 0);
    }
  }
  if (levels.size !== steps.size) throw new Error('Le graphe Catala contient un cycle.');
  for (const step of steps.values()) step.level = levels.get(step.id)!;
  const all = [...[...documents.values()].flatMap((document) => [...document.blocks.flatMap((block) => block.sources), ...document.trailing]), ...[...linked.values()].flat()];
  const others = all.filter((source, index) => !used.has(identity(source)) && all.findIndex((other) => identity(other) === identity(source)) === index);
  const objective = activeFiles.map((file) => (file.contenu ?? '').match(/^Objectif\s*:\s*(.+)$/im)?.[1]?.trim() ?? '').find(Boolean) ?? '';
  return { steps: [...steps.values()].sort((a, b) => a.level - b.level), others, nativeIssues: provenance?.issues ?? [], objective, mode };
}

const FACT: Record<string, [string, string]> = { Vrai: ['neutral', 'Oui'], Faux: ['neutral', 'Non'], Disputé: ['warn', 'Contesté'] };
const pill = (kind: string, label: string) => `<span class="pmc-value pmc-${kind}">${escape(label)}</span>`;
const factPill = (step: Step) => pill(...(FACT[step.value] ?? (/^(?:Indéterminé|null|None|)$/.test(step.value) ? ['warn', 'Indéterminé'] : ['neutral', display(step)])) as [string, string]);
const clausePill = (clause: Clause) => {
  if (!clause.met) return '';
  const labels = clause.kind === 'not' ? { ok: 'Condition négative remplie', ko: 'Condition négative non remplie' } : { ok: 'Remplie', ko: 'Non remplie' };
  return pill(clause.met, (labels as Record<string, string>)[clause.met] ?? 'À établir');
};
const label = (clause: Clause) => {
  const core = inner(clause).kind === 'any' ? 'l’une des conditions' : inner(clause).kind === 'all' ? 'les conditions suivantes' : '';
  return clause.kind === 'not' ? 'La condition suivante doit être fausse' : core ? capital(core) : 'Condition';
};
const sourceName = (source: Source) => {
  if (source.kind === 'piece' && source.title && !/\.[a-z0-9]{2,5}$/i.test(source.title)) return { main: source.title, note: '' };
  if (source.kind === 'premise') return { main: source.title || 'Prémisse absente de l’index', note: '' };
  if (source.kind === 'piece' || source.kind === 'origin') {
    let filename = source.target.replaceAll('\\', '/').split(/[?#]/)[0].split('/').pop() || 'Document';
    try { filename = decodeURIComponent(filename); } catch {}
    return { main: filename, note: '' };
  }
  if (source.title) {
    const match = /^(.*?),\s*(article\s+.+)$/i.exec(source.title);
    if (match) return { main: capital(match[2]), note: match[1] };
    return { main: source.title, note: '' };
  }
  const named = source.label && source.label !== source.target && !/^(?:https?:|file:|(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d+)/.test(source.label);
  return { main: named ? source.label : source.kind === 'article' ? 'Article — intitulé à préciser' : source.kind === 'jurisprudence' ? 'Décision — intitulé à préciser' : 'Document — intitulé à préciser', note: '' };
};
const sourceLink = (source: Source, chip = false) => {
  const { main, note } = sourceName(source);
  return `<button type="button" class="pmc-reference${chip ? ' pmc-chip' : ''}" data-kind="${escape(source.kind)}" data-open-reference data-target="${escape(source.target)}" data-origin="${escape(source.origin)}" data-quote="${escape(source.quote)}"${source.id ? ` data-id="${escape(source.id)}"` : ''}${source.status === 'failed' ? ' data-citation="failed"' : ''} title="${escape(source.status === 'failed' ? `${main} · citation non retrouvée` : `Afficher ${main}`)}">${escape(main)}${note ? `<span class="pmc-code">${escape(note)}</span>` : ''}</button>`;
};
const sourceItem = (source: Source) => `<li data-kind="${escape(source.kind)}">${sourceLink(source)}${source.premise ? `<span class="pmc-muted">Prémisse : ${escape(source.premise)}</span>` : ''}${source.quote ? `<q>${escape(source.quote)}</q>` : ''}${source.author === 'human' ? '<span class="pmc-author" data-author="human">Relu par l’avocat</span>' : source.author === 'agent' ? '<span class="pmc-author" data-author="agent">Relevé par l’agent, à relire</span>' : ''}${source.status === 'failed' ? '<span class="pmc-warn">Citation non retrouvée dans la source</span>' : ''}${source.recours?.length ? `<span class="pmc-muted">Non rendue en dernier ressort, voir ${source.recours.map((entry) => `<button type="button" class="pmc-reference" data-kind="jurisprudence" data-open-reference data-target="" data-origin="${escape(source.origin)}" data-quote="" data-id="${escape(entry.id)}" data-parent="${escape(source.id ?? '')}">${escape(`${entry.juridiction}, ${entry.date}`)}</button>`).join(' ; ')}</span>` : ''}</li>`;
const sourceList = (sources: Source[]) => sources.length ? `<ul class="pmc-sources">${sources.map(sourceItem).join('')}</ul>` : '';
const chips = (sources: Source[]) => sources.length ? `<span class="pmc-chips">${sources.map((source) => sourceLink(source, true)).join('')}</span>` : '';

function writer(model: Reasoning) {
  const mode = modeOf(model);
  const words = WORDS[mode];
  const steps = new Map(model.steps.map((step) => [step.id, step]));
  const stepOf = (clause: Clause) => inner(clause).kind === 'leaf' ? steps.get(inner(clause).ref) : undefined;
  const title = (clause: Clause) => {
    const leaf = inner(clause);
    const rule = leaf.kind === 'leaf' ? steps.get(leaf.ref) : undefined;
    if (rule?.kind === 'rule') return `<button type="button" class="pmc-text-action" data-goto="${rule.id}">${escape(rule.title)}</button>`;
    if (rule) return `<strong>${escape(rule.title)}</strong>`;
    return `<strong>${escape(capital(human(leaf.text)))}</strong>`;
  };
  const sourcesOf = (clause: Clause) => {
    const leaf = inner(clause);
    const step = leaf.kind === 'leaf' ? steps.get(leaf.ref) : undefined;
    return step ? unique(step.sources.filter(legal)) : [];
  };
  const ruleBranch = (clause: Clause, excluded: Set<string>): string => {
    const members = children(clause);
    const extra = sourcesOf(clause).filter((source) => !excluded.has(identity(source)));
    if (!members.length) return `<li data-op="${clause.kind}">${clause.kind === 'not' ? '<span class="pmc-op">Non</span> ' : ''}${title(clause)}${chips(extra)}</li>`;
    return `<li data-op="${clause.kind}"><span class="pmc-op">${escape(label(clause))}</span>${chips(extra)}<ul>${members.map((member) => ruleBranch(member, excluded)).join('')}</ul></li>`;
  };
  const rulePart = (step: Step) => {
    const basis = step.sources.filter(legal);
    const excluded = new Set(basis.map(identity));
    const foundation = basis.length ? sourceList(basis) : '';
    if (!step.clause) {
      if (step.expression) return `${foundation}<p class="pmc-formula">${escape(human(step.expression))}</p>`;
      if (step.conditional) return `${foundation}<p class="pmc-formula">Cette définition dépend d’une condition d’application.</p>`;
      const written = formula(step, human);
      if (written) return `${foundation}<p class="pmc-formula">${escape(written)}</p>`;
      return foundation || '<p class="pmc-muted">Aucune condition ni aucun fondement déclaré.</p>';
    }
    return `${foundation}<ul class="pmc-conditions">${roots(step.clause).map((clause) => ruleBranch(clause, excluded)).join('')}</ul>`;
  };
  const factLine = (fact: Step, prefix = '') => `<li data-tone="${tone(fact.value)}">${prefix}<strong>${escape(fact.title)}</strong> ${factPill(fact)}${chips(fact.sources.filter((source) => source.kind === 'piece'))}${fact.issue ? `<span class="pmc-warn"> ${escape(fact.issue)}</span>` : ''}</li>`;
  const justifyBranch = (clause: Clause): string => {
    const members = children(clause);
    if (!members.length) {
      const step = stepOf(clause);
      const prefix = clause.kind === 'not' ? '<span class="pmc-op">Non</span> ' : '';
      if (step?.kind === 'fact') return factLine(step, prefix);
      if (step?.kind === 'rule') return `<li data-tone="${tone(step.value)}">${prefix}<span class="pmc-op">Règle</span> <button type="button" class="pmc-text-action" data-goto="${step.id}">${escape(step.title)}</button> ${pill(tone(step.value), display(step))}</li>`;
      return `<li>${prefix}${title(clause)}</li>`;
    }
    const prefix = clause.kind === 'not' ? '<span class="pmc-op">Non</span> ' : `<span class="pmc-op">${escape(label(clause))}</span> `;
    return `<li data-tone="${clause.met}">${prefix}${clausePill(clause)}<ul>${members.map(justifyBranch).join('')}</ul></li>`;
  };
  const justification = (step: Step) => {
    if (step.clause) return `<ul class="pmc-justification">${roots(step.clause).map(justifyBranch).join('')}</ul>`;
    if (step.conditional) {
      const facts = step.parents.map((id) => steps.get(id)!).filter((parent) => parent.kind === 'fact');
      return facts.length ? `<ul class="pmc-justification">${facts.map((fact) => factLine(fact)).join('')}</ul>` : '';
    }
    const parents = step.parents.map((id) => steps.get(id)!).filter(Boolean);
    return parents.length ? `<ul class="pmc-justification">${parents.map((parent) => parent.kind === 'fact' ? factLine(parent) : `<li><button type="button" class="pmc-text-action" data-goto="${parent.id}">${escape(parent.title)}</button> ${pill(tone(parent.value), display(parent))}</li>`).join('')}</ul>` : '';
  };
  const projection = (step: Step) => {
    const value = step.value ? pill(tone(step.value), display(step)) : pill('warn', 'Indéterminé');
    const reason = step.clause && step.clause.met === 'ok' ? (step.clause.kind === 'any' ? 'L’une des conditions est remplie.' : 'Les conditions sont remplies.')
      : step.clause && step.clause.met === 'ko' ? (step.clause.kind === 'any' ? 'Aucune condition n’est remplie.' : 'Au moins une condition n’est pas remplie.')
      : step.conditional ? 'Une condition d’application sélectionne cette définition.' : '';
    return `<div class="pmc-projection" data-tone="${tone(step.value)}">${value}<span>${escape(reason)}</span></div>`;
  };
  const serves = (step: Step) => {
    const used = model.steps.filter((rule) => rule.kind === 'rule' && rule.parents.includes(step.id));
    return used.length ? `<p class="pmc-serves">Sert à établir : ${used.map((rule) => `<button type="button" class="pmc-text-action" data-goto="${rule.id}">${escape(rule.title)}</button>`).join(', ')}</p>` : '';
  };
  const card = (step: Step, rank = 0) => {
    const native = step.origins.length || model.nativeIssues.length ? `<details class="pmc-native"><summary>Origine native Catala</summary>${model.nativeIssues.map((issue) => `<p class="pmc-warn">${escape(issue)}</p>`).join('')}${step.origins.map((entry) => `<section><h4>${entry.role === 'declaration' ? 'Déclaration' : entry.role === 'condition' ? 'Condition' : 'Définition'}${entry.selected ? ' · appliquée au scénario' : ' · autre règle'}</h4>${sourceLink({ kind: 'origin', label: entry.headings.join(' › ') || 'Passage du programme', target: entry.file, origin: entry.file, quote: entry.text, status: '' })}<p class="pmc-muted">Ligne ${entry.line}, colonne ${entry.column} à ligne ${entry.endLine}, colonne ${entry.endColumn}</p>${entry.expression ? `<p>${escape(human(entry.expression))}</p>` : ''}${sourceList(entry.sources)}</section>`).join('')}</details>` : '';
    const notes = `${native}${step.notes.justification ? `<p>${escape(step.notes.justification)}</p>` : ''}${step.tests.length ? `<p class="pmc-muted">Exercé par les tests : ${step.tests.map(escape).join(', ')}.</p>` : ''}${step.notes.recherche ? `<p class="pmc-warn">À rechercher : ${escape(step.notes.recherche)}</p>` : ''}${step.notes.demarches.length ? `<h4>Démarches effectuées</h4><ul>${step.notes.demarches.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}`;
    const application = conditionApplication(step, model);
    if (application) return `<section class="pmc-rule" data-card="${step.id}" data-kind="${application.kind}"><header><span class="pmc-kind">${application.kind === 'exception' ? words.exception : words.rule}</span><h3>${escape(step.title)}</h3></header>${applicationMarkup(application, sourceLink, mode)}<div class="pmc-part" data-part="scenario"><h4>${mode === 'transactional' ? 'Dans ce cas de figure' : 'Dans ce scénario'}</h4>${factPill(step)}</div>${step.clause ? `<details><summary>Conditions de cette qualification</summary>${rulePart(step)}</details>` : ''}${notes}</section>`;
    if (step.kind === 'fact') {
      const used = model.steps.filter((rule) => rule.parents.includes(step.id));
      return `<section class="pmc-rule" data-card="${step.id}" data-kind="fact" data-tone="${tone(step.value)}"><header><span class="pmc-kind">${words.fact}</span><h3>${escape(step.title)}</h3>${factPill(step)}</header><div class="pmc-part" data-part="justification"><h4>Pièces citées</h4>${step.sources.some((source) => source.kind === 'piece') ? sourceList(step.sources.filter((source) => source.kind === 'piece')) : `<p class="pmc-muted">${mode === 'transactional' ? 'Hypothèse du cas de figure, sans pièce.' : 'Aucune pièce rattachée à ce fait.'}</p>`}${notes}${step.issue ? `<p class="pmc-warn">${escape(step.issue)}</p>` : ''}${used.length ? `<h4>Retenu pour</h4><ul class="pmc-sources">${used.map((rule) => `<li><button type="button" class="pmc-text-action" data-goto="${rule.id}">${escape(rule.title)}</button></li>`).join('')}</ul>` : ''}</div></section>`;
    }
    return `<section class="pmc-rule" data-card="${step.id}" data-kind="${step.answer ? 'answer' : 'rule'}" data-tone="${tone(step.value)}"><header><span class="pmc-kind">${step.answer ? words.root : words.rule}</span><h3>${escape(step.answer && model.objective || step.title)}</h3></header>${serves(step)}<div class="pmc-part" data-part="rule"><h4>La règle</h4>${rulePart(step)}</div><div class="pmc-part" data-part="projection"><h4>${step.answer ? words.outcome : mode === 'transactional' ? 'Dans ce cas de figure' : 'Dans ce scénario'}</h4>${projection(step)}</div><div class="pmc-part" data-part="justification"><h4>Justification</h4>${notes}${justification(step) || `<p class="pmc-muted">${mode === 'transactional' ? 'Aucune hypothèse à l’appui de cet effet.' : 'Aucun élément de fait à l’appui de cette solution.'}</p>`}</div>${step.issue ? `<p class="pmc-warn">${escape(step.issue)}</p>` : ''}</section>`;
  };
  return { steps, card, title };
}

export function reasoningCard(step: Step, model: Reasoning) {
  return writer(model).card(step);
}

const ordered = (model: Reasoning) => model.steps.filter((step) => step.kind === 'rule').sort((a, b) => Number(a.answer) - Number(b.answer) || a.level - b.level);

export function reasoningBrief(model: Reasoning) {
  const titles = new Map(model.steps.map((step) => [step.id, step.title]));
  const cited = (step: Step) => unique(step.sources).map((source) => `${source.title || source.label}${source.quote ? ` « ${source.quote} »` : ''}`).join(' ; ');
  const line = (step: Step, label: string) => [`- ${label} — ${step.title} : ${step.value ? display(step) : 'non établi'}`, cited(step) ? `${step.kind === 'fact' ? 'Pièce' : 'Fondement'} : ${cited(step)}` : '', step.kind === 'rule' && step.parents.length ? `S’appuie sur : ${step.parents.map((id) => titles.get(id)).join(', ')}` : ''].filter(Boolean).join('. ');
  return [...model.steps.filter((step) => step.kind === 'fact').map((step) => line(step, 'Fait')), ...ordered(model).map((step, index) => line(step, step.answer ? 'Conclusion' : `Étape ${index + 1}`))].join('\n');
}

export function reasoningText(model: Reasoning) {
  const { card } = writer(model);
  const thread = ordered(model);
  return `${thread.length ? `<p class="pmc-thread">${modeOf(model) === 'transactional' ? 'Chaque clause cite son texte, son effet dans le cas de figure et les hypothèses retenues, jusqu’à la stipulation.' : 'Le raisonnement part des faits et monte jusqu’à la prétention. Chaque condition cite sa règle, sa valeur dans le scénario et les faits qui la justifient.'}</p>` : ''}${thread.map((step, index) => card(step, index + 1)).join('')}${model.others.length ? `<section class="pmc-rule pmc-others"><header><h3>Autres sources citées</h3></header>${sourceList(model.others)}</section>` : ''}`;
}

export function reasoningIssues(model: Reasoning) {
  return [
    ...model.steps.filter((step) => step.issue).map((step) => ({ id: step.id, title: step.title, issue: step.issue })),
    ...[...model.steps.flatMap((step) => step.sources.map((source) => ({ id: step.id, source }))), ...model.others.map((source) => ({ id: '', source }))].filter((entry, index, all) => entry.source.status === 'failed' && all.findIndex((other) => other.source === entry.source) === index).map((entry) => ({ id: entry.id, title: entry.source.label, issue: 'Citation non retrouvée dans la source.' })),
  ];
}

export function reasoningGraph(model: Reasoning, only?: Step[]) {
  return reasoningMap(model, human, sourceLink, only);
}
