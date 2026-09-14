import { renderHook } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SlashCommand } from '@/shared/types';
import {
  displaySkillLabel,
  useSlashCommandPills,
} from '@/piecemaker/chat/useSlashCommandPills';

const pluginSkill: SlashCommand = {
  name: '/legal-tools:recherche-juridique',
  type: 'skill',
  metadata: {
    type: 'plugin',
    skillName: 'recherche-juridique',
  },
};

describe('slash command pills', () => {
  it('hides the provider namespace in the displayed skill label', () => {
    expect(displaySkillLabel(pluginSkill)).toBe('/recherche-juridique');
    expect(displaySkillLabel({ name: '$analyse', type: 'skill' })).toBe('$analyse');
  });

  it('marks only exact skill command tokens while preserving their executable text', () => {
    const renderBase = vi.fn((text: string) => text);
    const { result } = renderHook(() => useSlashCommandPills({
      slashCommands: [pluginSkill, { name: '/help', type: 'built-in' }],
      input: '',
      setInput: vi.fn(),
      textareaRef: { current: null },
      renderBase,
    }));

    const markup = renderToStaticMarkup(
      <>{result.current.renderInputWithCommandPills('Avant /legal-tools:recherche-juridique après /help')}</>,
    );

    expect(markup).toContain('bg-violet-200/70');
    expect(markup).toContain('/legal-tools:recherche-juridique');
    expect(markup).not.toContain('>/help</span>');
  });
});
