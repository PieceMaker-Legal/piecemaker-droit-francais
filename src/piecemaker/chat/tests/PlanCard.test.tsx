import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { OPEN_IN_EDITOR_EVENT, planPath } from '@/piecemaker/editor-tabs/editorPanels';
import { PlanTab } from '@/piecemaker/editor-tabs/PlanTab';

const PLAN = '# Plan\n\n1. Lire le bail commercial de Société Exemple SAS';

describe('plan dans le chat', () => {
  it.each([
    ['Claude', 'ExitPlanMode', { plan: PLAN, planFilePath: '/Users/jean/.claude/plans/vif-ruisseau.md' }, '/Users/jean/.claude/plans/vif-ruisseau.md'],
    ['Claude (fichier)', 'Write', { file_path: '/Users/jean/.claude/plans/vif-ruisseau.md', content: PLAN }, '/Users/jean/.claude/plans/vif-ruisseau.md'],
    ['Codex', 'ExitPlanMode', { plan: PLAN }, 'outil-1'],
    ['Mistral Vibe 3', 'ExitPlanMode', { plan: PLAN }, 'outil-1'],
    ['Mistral', 'write_file', JSON.stringify({ path: '/Users/jean/.vibe/plans/1783013478-keen-rustic-vale.md', content: PLAN }), '/Users/jean/.vibe/plans/1783013478-keen-rustic-vale.md'],
  ])('%s : carte compacte sans le texte du plan, ouvert dans la visionneuse', (_provider, toolName, toolInput, expectedFile) => {
    const opened = vi.fn();
    window.addEventListener(OPEN_IN_EDITOR_EVENT, opened);
    const { container } = render(<ToolRenderer toolName={toolName} toolInput={toolInput} toolId="outil-1" mode="input" />);
    expect(container.textContent).not.toContain('Société Exemple SAS');
    fireEvent.click(screen.getByText('Voir le plan'));
    expect((opened.mock.calls[0][0] as CustomEvent<{ path: string }>).detail.path).toBe(planPath(expectedFile));
    window.removeEventListener(OPEN_IN_EDITOR_EVENT, opened);
  });

  it('ne rend rien côté résultat', () => {
    const { container } = render(<ToolRenderer toolName="Write" toolInput={{ file_path: '/Users/jean/.claude/plans/vif-ruisseau.md', content: PLAN }} toolResult={{ content: PLAN }} mode="result" />);
    expect(container.textContent).toBe('');
  });

  it('affiche le contenu du plan Mistral Vibe 3 dans la visionneuse', () => {
    render(<ToolRenderer toolName="ExitPlanMode" toolInput={{ plan: PLAN }} toolId="mistral-plan-viewer" mode="input" />);
    fireEvent.click(screen.getByText('Voir le plan'));
    const { container } = render(<PlanTab id="mistral-plan-viewer" />);
    expect(container.textContent).toContain('Lire le bail commercial de Société Exemple SAS');
    expect(container.textContent).not.toContain('Ce plan n’est plus disponible.');
  });
});
