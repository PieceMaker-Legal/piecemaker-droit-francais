export type SessionActivityState = 'attention' | 'running' | 'idle';

export const SESSION_STATE_ORDER: SessionActivityState[] = ['attention', 'running', 'idle'];

export type SessionStateGroup<Row> = {
  state: SessionActivityState;
  rows: Row[];
};

type TreeRow = { session: { id: string }; depth: number };

function mostUrgent(states: SessionActivityState[]): SessionActivityState {
  return SESSION_STATE_ORDER.find((state) => states.includes(state)) ?? 'idle';
}

function familyStates<Row extends TreeRow>(allRows: Row[], stateOf: (row: Row) => SessionActivityState) {
  const familyOf = new Map<string, string>();
  const statesByFamily = new Map<string, SessionActivityState[]>();
  let familyId = '';
  for (const row of allRows) {
    if (row.depth === 0 || !familyId) familyId = row.session.id;
    familyOf.set(row.session.id, familyId);
    statesByFamily.set(familyId, [...(statesByFamily.get(familyId) ?? []), stateOf(row)]);
  }
  return { familyOf, statesByFamily };
}

export function groupSessionRowsByState<Row extends TreeRow, FamilyRow extends TreeRow>(
  visibleRows: Row[],
  allRows: FamilyRow[],
  stateOf: (row: FamilyRow) => SessionActivityState,
): SessionStateGroup<Row>[] {
  const { familyOf, statesByFamily } = familyStates(allRows, stateOf);
  const rowsByState = new Map<SessionActivityState, Row[]>(SESSION_STATE_ORDER.map((state) => [state, []]));
  for (const row of visibleRows) {
    const familyId = familyOf.get(row.session.id) ?? row.session.id;
    const state = mostUrgent(statesByFamily.get(familyId) ?? []);
    rowsByState.get(state)?.push(row);
  }
  return SESSION_STATE_ORDER
    .map((state) => ({ state, rows: rowsByState.get(state) ?? [] }))
    .filter((group) => group.rows.length > 0);
}

export function groupSessionsByState<Item>(
  items: Item[],
  stateOf: (item: Item) => SessionActivityState,
): SessionStateGroup<Item>[] {
  return SESSION_STATE_ORDER
    .map((state) => ({ state, rows: items.filter((item) => stateOf(item) === state) }))
    .filter((group) => group.rows.length > 0);
}

export function sessionActivityState(flags: {
  needsAttention: boolean;
  isRunning: boolean;
  hasBackgroundWork: boolean;
}): SessionActivityState {
  if (flags.needsAttention) return 'attention';
  if (flags.isRunning || flags.hasBackgroundWork) return 'running';
  return 'idle';
}
