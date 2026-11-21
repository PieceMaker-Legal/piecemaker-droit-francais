import { describe, expect, it } from 'vitest';

import { groupSessionRowsByState, groupSessionsByState, sessionActivityState } from '@/modules/piecemaker-session-groups';
import type { SessionActivityState } from '@/modules/piecemaker-session-groups';

const row = (id: string, depth = 0) => ({ session: { id }, depth });

describe('sessionActivityState', () => {
  it('ranks attention over running and background work over idle', () => {
    expect(sessionActivityState({ needsAttention: true, isRunning: true, hasBackgroundWork: false })).toBe('attention');
    expect(sessionActivityState({ needsAttention: false, isRunning: true, hasBackgroundWork: false })).toBe('running');
    expect(sessionActivityState({ needsAttention: false, isRunning: false, hasBackgroundWork: true })).toBe('running');
    expect(sessionActivityState({ needsAttention: false, isRunning: false, hasBackgroundWork: false })).toBe('idle');
  });
});

describe('groupSessionsByState', () => {
  it('orders groups attention, running, idle and keeps recency inside each', () => {
    const states: Record<string, SessionActivityState> = { a: 'idle', b: 'running', c: 'attention', d: 'idle', e: 'running' };
    const groups = groupSessionsByState(Object.keys(states), (id) => states[id]);
    expect(groups).toEqual([
      { state: 'attention', rows: ['c'] },
      { state: 'running', rows: ['b', 'e'] },
      { state: 'idle', rows: ['a', 'd'] },
    ]);
  });
});

describe('groupSessionRowsByState', () => {
  it('moves a whole fork family with its most urgent member', () => {
    const all = [row('root'), row('fork', 1), row('fork-of-fork', 2), row('other')];
    const states: Record<string, SessionActivityState> = { root: 'idle', fork: 'idle', 'fork-of-fork': 'running', other: 'idle' };
    const groups = groupSessionRowsByState(all, all, ({ session }) => states[session.id]);
    expect(groups.map(({ state, rows }) => [state, rows.map(({ session }) => session.id)])).toEqual([
      ['running', ['root', 'fork', 'fork-of-fork']],
      ['idle', ['other']],
    ]);
  });

  it('counts a collapsed descendant that is hidden from the visible rows', () => {
    const all = [row('root'), row('hidden', 1)];
    const groups = groupSessionRowsByState([row('root')], all, ({ session }) => (session.id === 'hidden' ? 'attention' : 'idle'));
    expect(groups).toEqual([{ state: 'attention', rows: [row('root')] }]);
  });
});
