import type { Fiche } from './api.js';

export type Alerte = { texte: string; jours: number; ton: 'danger' | 'warning' | 'accent' };

const ECHEANCE_JOURS = 7;
const PRESCRIPTION_JOURS = 60;
const PRESCRIPTION_ROUGE_JOURS = 30;
const SILENCE_JOURS = 45;
const NATURE: Record<string, string> = { limitation: 'Prescription ou forclusion', hearing: 'Audience', filing: 'Acte à déposer' };
const JOUR = 86_400_000;

const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const ecart = (de: string, a: string) => Math.round((utc(a) - utc(de)) / JOUR);
const jours = (n: number) => n === 1 ? '1 jour' : `${n} jours`;
const relatif = (n: number) => n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} jours`;
const aujourdhui = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function alertes(fiche: Fiche | undefined, today = aujourdhui()): Alerte[] {
  if (!fiche) return [];
  const ouvert = (fiche.status ?? 'open') === 'open';
  const verifier: Alerte[] = fiche.origin !== 'page' && !(fiche.checked && typeof fiche.checked === 'object') ? [{ texte: 'À vérifier', jours: 900, ton: 'accent' }] : [];
  if (fiche.proposedDates && ouvert) verifier.push({ texte: 'Dates à confirmer', jours: 901, ton: 'accent' });
  if (!ouvert) return verifier;
  const out: Alerte[] = [...verifier];
  const suite = fiche.nextStep;
  if (suite?.due && suite.due < today) {
    const n = ecart(suite.due, today);
    out.push({ texte: `Prochaine action en retard de ${jours(n)}`, jours: -n, ton: 'danger' });
  }
  for (const date of fiche.keyDates ?? []) {
    if (date.done || !date.date) continue;
    if (date.date < today) {
      if (date.kind === 'limitation' || date.kind === 'filing') {
        const n = ecart(date.date, today);
        out.push({ texte: `${date.kind === 'limitation' ? 'Date de prescription' : 'Date de dépôt'} dépassée depuis ${jours(n)}`, jours: -100_000 - n, ton: 'danger' });
      }
      continue;
    }
    const n = ecart(today, date.date);
    const prescription = date.kind === 'limitation';
    if (n > (prescription ? PRESCRIPTION_JOURS : ECHEANCE_JOURS)) continue;
    const libelle = date.kind && NATURE[date.kind] ? NATURE[date.kind] : date.label ?? 'Date';
    out.push({ texte: `${libelle} ${relatif(n)}`, jours: n, ton: n <= (prescription ? PRESCRIPTION_ROUGE_JOURS : ECHEANCE_JOURS) ? 'danger' : 'warning' });
  }
  if (!suite?.text) out.push({ texte: 'Aucune prochaine action', jours: 1000, ton: 'warning' });
  if (fiche.lastActivityOn && ecart(fiche.lastActivityOn, today) >= SILENCE_JOURS) out.push({ texte: `Rien consigné depuis ${ecart(fiche.lastActivityOn, today)} jours`, jours: 2000, ton: 'warning' });
  return out.sort((a, b) => a.jours - b.jours);
}
