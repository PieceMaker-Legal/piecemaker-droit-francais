import type { AgentThreadState } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';

export const THREAD_STATE_LABELS: Record<AgentThreadState, string> = {
  queued: 'En file',
  working: 'En cours',
  blocked: 'Bloqué',
  review_ready: 'À relire',
  done: 'Terminé',
  failed: 'Échec',
  stopped: 'Arrêté',
};

export const THREAD_STATE_COLORS: Record<AgentThreadState, string> = {
  queued: 'bg-zinc-400',
  working: 'bg-blue-500',
  blocked: 'bg-amber-500',
  review_ready: 'bg-violet-500',
  done: 'bg-emerald-500',
  failed: 'bg-red-500',
  stopped: 'bg-zinc-500',
};

export const PROVIDER_LABELS: Record<string, string> = { auto: 'Automatique', chat: 'Comme le chat principal', claude: 'Claude', codex: 'Codex', mistral: 'Mistral' };

export const DELIVERABLE_LABELS = { brouillon: 'Brouillon', a_relire: 'À relire', valide: 'Validé' } as const;

export function age(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)} j`;
}

export function bytes(value: number): string {
  const units = ['o', 'ko', 'Mo', 'Go', 'To'];
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) { size /= 1000; unit += 1; }
  return `${size.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${units[unit]}`;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function cronLabel(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;
  const [minute, hour, day, month, weekday] = fields;
  if (!/^\d+$/.test(minute)) return cron;
  const at = /^\d+$/.test(hour) ? ` à ${hour.padStart(2, '0')} h ${minute.padStart(2, '0')}` : '';
  if (hour === '*' && day === '*' && month === '*' && weekday === '*') return minute === '0' ? 'Toutes les heures' : `Toutes les heures à ${minute} min`;
  if (!at) return cron;
  if (day === '*' && month === '*' && weekday === '*') return `Tous les jours${at}`;
  if (day === '*' && month === '*' && weekday === '1-5') return `Du lundi au vendredi${at}`;
  if (day === '*' && month === '*' && /^[0-7](,[0-7])*$/.test(weekday)) return `Chaque ${weekday.split(',').map((value) => WEEKDAYS[Number(value) % 7]).join(', ')}${at}`;
  if (/^\d+$/.test(day) && month === '*' && weekday === '*') return `Le ${day === '1' ? '1er' : day} de chaque mois${at}`;
  return cron;
}
