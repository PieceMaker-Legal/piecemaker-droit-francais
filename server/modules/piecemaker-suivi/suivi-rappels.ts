import type { SuiviDossier } from '../../../shared/piecemaker-suivi.js';

const DAY = 864e5;

/** Today's date (AAAA-MM-JJ) in the server's time zone. */
export function localToday(now = new Date()): string {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}

const french = (date: string) => date.split('-').reverse().join('/');

/**
 * Plain-text reminder of the deadlines still open across every dossier: overdue
 * ones, then those due within `jours` days. Empty when nothing is due, so a
 * scheduled delivery stays silent.
 */
export function describeRappels(dossiers: SuiviDossier[], today: string, jours = 7): string {
  const limit = Date.parse(today) + jours * DAY;
  const due = dossiers.flatMap((dossier) => dossier.snapshot.echeances
    .filter((deadline) => deadline.date && !deadline.fait && Date.parse(deadline.date) <= limit)
    .map((deadline) => ({ dossier: dossier.nom, intitule: deadline.intitule || deadline.nom, date: deadline.date as string, suppose: deadline.suppose })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.dossier.localeCompare(b.dossier));
  if (!due.length) return '';
  const lines = due.map((item) => {
    const when = item.date < today ? `En retard (${french(item.date)})` : item.date === today ? 'Aujourd’hui' : french(item.date);
    return `• ${when} — ${item.dossier} : ${item.intitule}${item.suppose ? ' (date supposée)' : ''}`;
  });
  return [`Échéances PieceMaker à ${jours} jours`, ...lines].join('\n');
}
