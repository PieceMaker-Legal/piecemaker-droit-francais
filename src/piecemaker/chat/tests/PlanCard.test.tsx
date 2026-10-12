import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { OPEN_IN_EDITOR_EVENT, planPath } from '@/piecemaker/editor-tabs/editorPanels';

const PLAN = '# Plan\n\n1. Lire le bail commercial de Société Exemple SAS';

describe('plan dans le chat', () => {
  it.each([
    ['Claude', 'ExitPlanMode', { plan: PLAN, planFilePath: '/Users/jean/.claude/plans/vif-ruisseau.md' }],
    ['Claude (fichier)', 'Write', { file_path: '/Users/jean/.claude/plans/vif-ruisseau.md', content: PLAN }],
    ['Codex', 'ExitPlanMode', { plan: PLAN }],
    ['Mistral', 'write_file', JSON.stringify({ path: '/Users/jean/.vibe/plans/1783013478-keen-rustic-vale.md', content: PLAN })],
  ])('%s : carte compacte sans le texte du plan, ouvert dans la visionneuse', (_provider, toolName, toolInput) => {
    const opened = vi.fn();
    window.addEventListener(OPEN_IN_EDITOR_EVENT, opened);
    const { container } = render(<ToolRenderer toolName={toolName} toolInput={toolInput} toolId="outil-1" mode="input" />);
    expect(container.textContent).not.toContain('Société Exemple SAS');
    fireEvent.click(screen.getByText('Voir le plan'));
    const file = typeof toolInput === 'string' ? JSON.parse(toolInput).path : toolInput.planFilePath ?? toolInput.file_path ?? 'outil-1';
    expect((opened.mock.calls[0][0] as CustomEvent<{ path: string }>).detail.path).toBe(planPath(file));
    window.removeEventListener(OPEN_IN_EDITOR_EVENT, opened);
  });

  it('ne rend rien côté résultat', () => {
    const { container } = render(<ToolRenderer toolName="Write" toolInput={{ file_path: '/Users/jean/.claude/plans/vif-ruisseau.md', content: PLAN }} toolResult={{ content: PLAN }} mode="result" />);
    expect(container.textContent).toBe('');
  });
});
