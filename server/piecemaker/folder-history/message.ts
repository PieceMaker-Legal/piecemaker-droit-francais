export type CommitMessage = { subject: string; body?: string };

const SUBJECT_MAX = 72;
const BODY_MAX = 4000;
const LIST_MAX = 200;

const MANUAL_SUBJECT = 'Modifications hors IA';
const TURN_FALLBACK_SUBJECT = 'Tour IA';
const INITIAL_SUBJECT = 'État initial du dossier';

// Coupe sur une frontière de mot : un nom tronqué (« Dupo… ») échapperait au mapping de hudsucker.
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = value.slice(0, max);
  const cut = head.search(/\s\S*$/u);
  return `${(cut > 0 ? head.slice(0, cut) : head.slice(0, max - 1)).trimEnd()}…`;
}

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

function cleanConclusion(conclusion: string): string {
  return conclusion
    .replace(/<CITATIONS>[\s\S]*?<\/CITATIONS>/g, '')
    .replace(/^\[\d+\]: #piecemaker-citation=.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function turnMessage(request: string, conclusion: string): CommitMessage {
  const subject = truncate(oneLine(request), SUBJECT_MAX) || TURN_FALLBACK_SUBJECT;
  const body = truncate(cleanConclusion(conclusion), BODY_MAX);
  return body ? { subject, body } : { subject };
}

export function manualMessage(stagedChanges: string): CommitMessage {
  const lines = stagedChanges.split('\n').map((line) => line.trim()).filter(Boolean);
  const listed = lines.slice(0, LIST_MAX);
  const remaining = lines.length - listed.length;
  const body = remaining > 0 ? [...listed, `… et ${remaining} autres fichiers`].join('\n') : listed.join('\n');
  return body ? { subject: MANUAL_SUBJECT, body } : { subject: MANUAL_SUBJECT };
}

export function initialMessage(): CommitMessage {
  return { subject: INITIAL_SUBJECT };
}
