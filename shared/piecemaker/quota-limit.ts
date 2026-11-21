export type QuotaLimit = {
  resetAt: Date | null;
  notice: string;
};

const MAX_NOTICE_LENGTH = 800;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const CLAUDE_LEGACY = /Claude AI usage limit reached\|(\d{10,13})/;
const CLAUDE_RESETS = /(?:hit your (?:[\w-]+ )*limit|limit reached)\s*[·∙•|-]?\s*resets\s+([^()\n]+?)\s*(?:\(([^)]+)\))?\s*\.?\s*$/im;
const CODEX_LIMIT = /hit your usage limit/i;
const CODEX_AT = /try again at\s+([^\n]+?)\.?\s*$/im;
const CODEX_IN = /try again in\s+([^\n.]+)/i;
const GENERIC_LIMIT = /\b(?:usage limit reached|rate[ _-]?limit(?:ed| exceeded|_error| reached)|too many requests|quota (?:exceeded|reached)|capacity exceeded|insufficient_quota|(?:error|erreur|status)\W{0,3}429)\b/i;

type WallClock = { year?: number; month?: number; day?: number; weekday?: number; hour: number; minute: number };

function zonedParts(instant: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(value('year')),
    month: Number(value('month')) - 1,
    day: Number(value('day')),
    hour: Number(value('hour')) % 24,
    minute: Number(value('minute')),
    second: Number(value('second')),
    weekday: WEEKDAYS.indexOf(value('weekday').toLowerCase().slice(0, 3)),
  };
}

function validTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

function zonedToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone?: string): Date {
  if (!timeZone) return new Date(year, month, day, hour, minute, 0, 0);
  const target = Date.UTC(year, month, day, hour, minute);
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = zonedParts(new Date(guess), timeZone);
    const seenUtc = Date.UTC(seen.year, seen.month, seen.day, seen.hour, seen.minute);
    guess += target - seenUtc;
  }
  return new Date(guess);
}

function parseWallClock(raw: string): WallClock | null {
  const text = raw.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const time = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/);
  if (!time) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2] ?? 0);
  const meridiem = time[3];
  if (!meridiem && time[2] === undefined) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const head = text.slice(0, time.index).replace(/\bat\b/g, ' ').trim();
  const clock: WallClock = { hour, minute };
  const monthDay = head.match(/([a-z]{3})[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?/);
  if (monthDay && MONTHS.includes(monthDay[1])) {
    clock.month = MONTHS.indexOf(monthDay[1]);
    clock.day = Number(monthDay[2]);
    if (monthDay[3]) clock.year = Number(monthDay[3]);
    return clock;
  }
  const weekday = head.match(/^([a-z]{3})[a-z]*$/);
  if (weekday && WEEKDAYS.includes(weekday[1])) clock.weekday = WEEKDAYS.indexOf(weekday[1]);
  else if (head) return null;
  return clock;
}

function nextOccurrence(clock: WallClock, reference: Date, timeZone?: string): Date {
  const today = zonedParts(reference, timeZone);
  if (clock.month !== undefined && clock.day !== undefined) {
    const year = clock.year ?? today.year;
    let instant = zonedToInstant(year, clock.month, clock.day, clock.hour, clock.minute, timeZone);
    if (clock.year === undefined && instant.getTime() < reference.getTime() - 86_400_000) {
      instant = zonedToInstant(year + 1, clock.month, clock.day, clock.hour, clock.minute, timeZone);
    }
    return instant;
  }
  let offset = clock.weekday === undefined ? 0 : (clock.weekday - today.weekday + 7) % 7;
  let instant = zonedToInstant(today.year, today.month, today.day + offset, clock.hour, clock.minute, timeZone);
  if (instant.getTime() <= reference.getTime()) {
    offset += clock.weekday === undefined ? 1 : 7;
    instant = zonedToInstant(today.year, today.month, today.day + offset, clock.hour, clock.minute, timeZone);
  }
  return instant;
}

function parseDuration(raw: string): number | null {
  const units: Record<string, number> = { day: 86_400_000, hour: 3_600_000, hr: 3_600_000, minute: 60_000, min: 60_000, second: 1_000, sec: 1_000 };
  let total = 0;
  for (const match of raw.matchAll(/(\d+)\s*(day|hour|hr|minute|min|second|sec)s?/gi)) {
    total += Number(match[1]) * units[match[2].toLowerCase()];
  }
  return total > 0 ? total : null;
}

export function detectQuotaLimit(text: unknown, reference: Date = new Date()): QuotaLimit | null {
  if (typeof text !== 'string') return null;
  const notice = text.trim();
  if (!notice || notice.length > MAX_NOTICE_LENGTH) return null;

  const legacy = notice.match(CLAUDE_LEGACY);
  if (legacy) {
    const value = Number(legacy[1]);
    return { notice, resetAt: new Date(value < 1e12 ? value * 1000 : value) };
  }

  const claude = notice.match(CLAUDE_RESETS);
  if (claude) {
    const timeZone = validTimeZone(claude[2]?.trim());
    const clock = parseWallClock(claude[1]);
    return { notice, resetAt: clock ? nextOccurrence(clock, reference, timeZone) : null };
  }

  if (CODEX_LIMIT.test(notice)) {
    const at = notice.match(CODEX_AT);
    const clock = at ? parseWallClock(at[1]) : null;
    if (clock) return { notice, resetAt: nextOccurrence(clock, reference) };
    const within = notice.match(CODEX_IN);
    const duration = within ? parseDuration(within[1]) : null;
    return { notice, resetAt: duration ? new Date(reference.getTime() + duration) : null };
  }

  return GENERIC_LIMIT.test(notice) ? { notice, resetAt: null } : null;
}
