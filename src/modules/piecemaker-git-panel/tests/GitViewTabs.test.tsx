import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { GitViewTabs, INITIAL_GIT_VIEW } from '@/modules/piecemaker-git-panel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('place les commits en premier onglet et les ouvre par défaut', () => {
  render(<GitViewTabs activeView={INITIAL_GIT_VIEW} isHidden={false} changeCount={0} onChange={vi.fn()} />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual(['git:tabs.history', 'git:tabs.changes', 'git:tabs.branches', 'git:tabs.worktrees']);
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
});
