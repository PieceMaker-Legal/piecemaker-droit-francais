export type JudgeZone = { zone: 'motifs' | 'dispositif' | 'absente'; text: string };

type State = 'court' | 'party' | 'other';

const GAP = '[…]';
const HEADING_MAX = 120;

const ANNEX = /^(moyens? annexes?|moyens? produits?,? (?:\S+ ){0,8}?par|moyen annexe)\b/;
const GLUED_ANNEX = /([^\n])[ \t]*(MOYENS? ANNEX[EÉ]S?\b)/g;
const ANNEX_HEADING = /^annexes?$/;
const DISPOSITIF = /^par ces motifs\b/;
const DISPOSITIF_HEADING = /^(d ?e ?c ?i ?d ?e|dispositif)$/;

const COURT_HEADING = /^((motifs?|motivation|discussion)( de la decision| de l'arret| du jugement| de l'ordonnance| de la cour| du tribunal)?|sur ce|sur quoi|considerant ce qui suit)(,? (la cour|le tribunal|le conseil|la juridiction|nous)\b.*)?$/;
const COURT_START = /^(sur ce\b(?!\s+(point|chef|moyen|fondement|dernier|sujet|theme|volet|plan|terrain))|sur quoi\b|considerant\b|attendu\b)/;

const CASSATION_COURT_HEADING = /^(reponse de la cour|recevabilite (du|des) (moyens?|pourvois?)|sur la recevabilite\b.*|sur le moyen releve d'office\b.*|portee et consequences de la cassation|(sur la )?(demande de )?mise hors de cause|desistement\b.*)$/;
const CASSATION_PARTY_HEADING = /^enonces? (du|des) moyens?$/;
const CASSATION_NEUTRAL_HEADING = /^(faits et procedure|expose du litige|procedure|examen (du|des) (moyens?|pourvois?))$/;
const CASSATION_MOYEN = /^sur (le|les|la)\b.*\b(moyens?|pourvois?|branches?|griefs?)\b/;
const CASSATION_VISA = /^vu (l'article|les articles|le principe|les principes|la loi|le decret|l'ordonnance|le reglement|la directive|la convention|le code|les textes|l'avis|la constitution)\b/;
const GRIEF = /\b(fai(t|saient|sait|sons)|font) grief\b|\bselon le moyen\b|\breproche(nt)? a l'arret\b/;
const PARTY_START = /^["«“]?\s*(en ce que|alors,? (que|d'une part|selon le moyen)|1°\/)/;
const FACTS = /^attendu,? (selon|qu'il (resulte|ressort) (de l'arret|du jugement|de la decision|de l'ordonnance|des pieces|des enonciations|des productions))/;
const COURT_CONCLUSION = /^(mais attendu|qu'en statuant ainsi|en statuant ainsi|d'ou il suit|d'ou il resulte que le moyen|le moyen,? (qui|n'est)|par ces seuls motifs|la cour d'appel a (ainsi )?(legalement )?justifie)/;

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/[ \t\f\v  ]+/g, ' ').trim())
    .filter(Boolean);
}

function normalized(paragraph: string): string {
  return paragraph
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, '\'')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function withoutNumber(value: string): string {
  return value.replace(/^(\d+|[ivx]+|[a-h])\s*[.)°/–—-]\s+/, '');
}

function headingOf(value: string): string {
  return withoutNumber(value.replace(/^[\s*_•.:–—-]+/, '')).replace(/[\s*_•.:;–—-]+$/, '').trim();
}

type Line = { heading: string; body: string; short: boolean };

function lines(paragraphs: string[]): Line[] {
  return paragraphs.map((paragraph) => {
    const key = normalized(paragraph);
    return { heading: headingOf(key), body: withoutNumber(key), short: key.length <= HEADING_MAX };
  });
}

function isDispositif(line: Line): boolean {
  return DISPOSITIF.test(line.body) || (line.short && DISPOSITIF_HEADING.test(line.heading));
}

function bounds(entries: Line[]): { end: number; dispositif: number } {
  const candidates = entries.flatMap((line, index) => (isDispositif(line) ? [index] : []));
  const annex = entries.findIndex((line, index) => index > 0
    && (ANNEX.test(line.body) || (line.short && ANNEX_HEADING.test(line.heading)))
    && (!candidates.length ? ANNEX.test(line.body) : index > candidates[0]));
  const end = annex > 0 ? annex : entries.length;
  const before = candidates.filter((index) => index < end);
  return { end, dispositif: before.length ? before[before.length - 1] : -1 };
}

function joinSelected(paragraphs: string[], selected: number[]): string {
  const parts: string[] = [];
  selected.forEach((index, position) => {
    if (position > 0 && index !== selected[position - 1] + 1) parts.push(GAP);
    parts.push(paragraphs[index]);
  });
  return parts.join('\n\n');
}

function cassationSelection(entries: Line[], end: number, dispositif: number): number[] {
  const selected: number[] = [];
  let state: State = 'other';
  const limit = dispositif >= 0 ? dispositif : end;
  for (let index = 0; index < limit; index += 1) {
    const { heading, body, short } = entries[index];
    if (short && CASSATION_COURT_HEADING.test(heading)) {
      state = 'court';
      continue;
    }
    if (short && CASSATION_PARTY_HEADING.test(heading)) {
      state = 'party';
      continue;
    }
    if ((short && CASSATION_NEUTRAL_HEADING.test(heading)) || CASSATION_MOYEN.test(body)) {
      state = 'other';
      continue;
    }
    if (CASSATION_VISA.test(body) || COURT_CONCLUSION.test(body)) state = 'court';
    else if (FACTS.test(body)) state = 'other';
    else if (PARTY_START.test(body) || (GRIEF.test(body) && (/^attendu\b/.test(body) || state !== 'court'))) state = 'party';
    else if (/^(et )?attendu\b/.test(body)) state = 'court';
    if (state === 'court') selected.push(index);
  }
  if (dispositif >= 0) for (let index = dispositif; index < end; index += 1) selected.push(index);
  return selected;
}

function courtStart(entries: Line[], limit: number): number {
  return entries.findIndex((line, index) => index < limit && ((line.short && COURT_HEADING.test(line.heading)) || COURT_START.test(line.body)));
}

function separateAnnexes(text: string): string {
  return text.replace(GLUED_ANNEX, '$1\n$2');
}

export function withoutAnnexes(text: string): string {
  const paragraphs = splitParagraphs(separateAnnexes(text));
  const annex = lines(paragraphs).findIndex((line, index) => index > 0 && ANNEX.test(line.body));
  return (annex > 0 ? paragraphs.slice(0, annex) : paragraphs).join('\n\n');
}

export function judgeZone(text: string, cassation: boolean): JudgeZone {
  const paragraphs = splitParagraphs(separateAnnexes(text));
  const entries = lines(paragraphs);
  const { end, dispositif } = bounds(entries);
  if (cassation) {
    const selected = cassationSelection(entries, end, dispositif);
    const motifs = selected.some((index) => dispositif < 0 || index < dispositif);
    if (motifs) return { zone: 'motifs', text: joinSelected(paragraphs, selected) };
  } else {
    const start = courtStart(entries, dispositif >= 0 ? dispositif : end);
    if (start >= 0) return { zone: 'motifs', text: paragraphs.slice(start, end).join('\n\n') };
  }
  if (dispositif >= 0) return { zone: 'dispositif', text: paragraphs.slice(dispositif, end).join('\n\n') };
  return { zone: 'absente', text: paragraphs.join('\n\n') };
}
