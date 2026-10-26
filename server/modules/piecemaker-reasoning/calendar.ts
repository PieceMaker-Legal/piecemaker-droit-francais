import type { Duration } from './format.js';

const utc = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (value: string, days: number) => { const date = utc(value); date.setUTCDate(date.getUTCDate() + days); return iso(date); };

function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return `${year}-${String(month).padStart(2, '0')}-${String(((h + l - 7 * m + 114) % 31) + 1).padStart(2, '0')}`;
}

const holidayCache = new Map<number, Map<string, string>>();
export function holidays(year: number): Map<string, string> {
  if (!holidayCache.has(year)) {
    const sunday = easter(year);
    holidayCache.set(year, new Map([
      [`${year}-01-01`, 'jour de l’an'], [addDays(sunday, 1), 'lundi de Pâques'], [`${year}-05-01`, '1er mai'], [`${year}-05-08`, '8 mai'],
      [addDays(sunday, 39), 'Ascension'], [addDays(sunday, 50), 'lundi de Pentecôte'], [`${year}-07-14`, '14 juillet'], [`${year}-08-15`, 'Assomption'],
      [`${year}-11-01`, 'Toussaint'], [`${year}-11-11`, '11 novembre'], [`${year}-12-25`, 'Noël'],
    ]));
  }
  return holidayCache.get(year)!;
}

export function closed(value: string): string | null {
  const weekday = utc(value).getUTCDay();
  if (weekday === 6) return 'samedi';
  if (weekday === 0) return 'dimanche';
  return holidays(Number(value.slice(0, 4))).get(value) ?? null;
}

export function shift(start: string, { unite, nombre }: Duration, sign: 1 | -1): string {
  if (unite === 'jours') return addDays(start, sign * nombre);
  if (unite === 'jours_ouvres') {
    let current = start;
    for (let left = nombre; left > 0;) { current = addDays(current, sign); if (!closed(current)) left -= 1; }
    return current;
  }
  const date = utc(start);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + sign * (unite === 'ans' ? nombre * 12 : nombre));
  date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
  return iso(date);
}

export function nextOpen(value: string, sign: 1 | -1): { date: string; skipped: Array<{ date: string; raison: string }> } {
  const skipped: Array<{ date: string; raison: string }> = [];
  let current = value;
  for (let reason = closed(current); reason; reason = closed(current)) { skipped.push({ date: current, raison: reason }); current = addDays(current, sign); }
  return { date: current, skipped };
}

export const WEEKDAY = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const weekday = (value: string) => WEEKDAY[utc(value).getUTCDay()];
