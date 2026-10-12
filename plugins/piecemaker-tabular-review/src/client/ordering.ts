export type SortState = { key: string; direction: 1 | -1 } | null;

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

function numberOf(value: string): number | null {
  const match = value.trim().match(/^[-+]?\d[\d\s  .]*(,\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/[\s  ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function compareValues(left: string, right: string): number {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const x = numberOf(a);
  const y = numberOf(b);
  if (x !== null && y !== null && x !== y) return x - y;
  if (x !== null && y === null) return -1;
  if (x === null && y !== null) return 1;
  return collator.compare(a, b);
}

export function sortBy<T>(items: T[], state: SortState, value: (item: T, key: string) => string): T[] {
  if (!state) return items;
  return [...items].sort((left, right) => {
    const a = value(left, state.key);
    const b = value(right, state.key);
    if (!a.trim() || !b.trim()) return compareValues(a, b);
    return compareValues(a, b) * state.direction;
  });
}

export function nextSort(state: SortState, key: string): SortState {
  if (state?.key !== key) return { key, direction: 1 };
  return state.direction === 1 ? { key, direction: -1 } : null;
}

export function sortButton(state: SortState, key: string, label: string): string {
  const arrow = state?.key === key ? (state.direction === 1 ? '↑' : '↓') : '↕';
  return `<button type="button" class="ptr-sort${state?.key === key ? ' ptr-sort-active' : ''}" data-sort="${key}" aria-label="Trier par ${label}" title="Trier (numérique puis alphabétique)">${arrow}</button>`;
}
