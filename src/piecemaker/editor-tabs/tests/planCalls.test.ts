import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OPEN_IN_EDITOR_EVENT, planPath, readPlan } from '@/piecemaker/editor-tabs/editorPanels';
import { planCall, showPlan } from '@/piecemaker/editor-tabs/planCalls';

const FILE = '/Users/jean/.vibe/plans/1783013478-keen-rustic-vale.md';

describe('showPlan', () => {
  const opened: string[] = [];
  beforeEach(() => {
    opened.length = 0;
    window.addEventListener(OPEN_IN_EDITOR_EVENT, (event) => opened.push((event as CustomEvent<{ path: string }>).detail.path));
  });

  it('suit les écritures puis les modifications du fichier de plan', () => {
    showPlan(planCall('write_file', { path: FILE, content: '# Plan\n\n1. Lire le bail' })!, 'outil-1');
    showPlan(planCall('edit', { file_path: FILE, old_string: 'Lire le bail', new_string: 'Lire le bail commercial' })!, 'outil-2');
    expect(readPlan(FILE)).toBe('# Plan\n\n1. Lire le bail commercial');
    expect(opened).toEqual([planPath(FILE), planPath(FILE)]);
  });

  it('range le plan Codex sous l’identifiant de l’appel', () => {
    showPlan(planCall('ExitPlanMode', { plan: '# Plan Codex' })!, 'outil-3');
    expect(readPlan('outil-3')).toBe('# Plan Codex');
  });

  it('n’ouvre rien pour un plan vide ou une modification sans plan connu', () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_IN_EDITOR_EVENT, listener);
    showPlan(planCall('ExitPlanMode', {})!, 'outil-4');
    showPlan(planCall('edit', { file_path: '/Users/jean/.vibe/plans/1-inconnu.md', old_string: 'a', new_string: 'b' })!, 'outil-5');
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(OPEN_IN_EDITOR_EVENT, listener);
  });
});
