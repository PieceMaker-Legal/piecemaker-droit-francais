import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import ProviderSelectionEmptyState from '@/modules/chat/transcript/ProviderSelectionEmptyState';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { LLMProvider } from '@/shared/types';

const providerModels: Record<LLMProvider, string> = {
  claude: 'opus',
  cursor: 'auto',
  codex: 'gpt-5',
  mistral: 'mistral-medium-3.5',
  opencode: 'default',
};

describe('une session Mistral porte le nom Mistral', () => {
  it('dans le sélecteur de nouvelle session', () => {
    const { container } = render(
      <ProviderSelectionEmptyState
        selectedSession={null}
        currentSessionId={null}
        provider="mistral"
        setProvider={() => {}}
        textareaRef={React.createRef<HTMLTextAreaElement>()}
        providerModels={providerModels}
        setProviderModel={() => {}}
        providerModelCatalog={{ mistral: { OPTIONS: [{ value: 'mistral-medium-3.5', label: 'Mistral Medium 3.5' }], DEFAULT: 'mistral-medium-3.5' } }}
        providerModelActions={{} as never}
        providerModelsLoading={false}
        tasksEnabled={false}
        isTaskMasterInstalled={false}
        setInput={() => {}}
      />,
    );
    const card = container.querySelector('[role="button"]');
    expect(card?.textContent).toContain('Mistral·Mistral Medium 3.5');
    expect(card?.textContent).not.toContain('Claude');
  });

  it("dans l'en-tête des réponses", () => {
    const { container } = render(
      <UiPreferencesProvider>
        <MessageComponent
          message={{ type: 'assistant', content: 'Voici le bail de Société Exemple SAS.', timestamp: '2026-10-17T12:00:00.000Z' }}
          prevMessage={null}
          createDiff={() => []}
          provider="mistral"
        />
      </UiPreferencesProvider>,
    );
    expect(container.textContent).toContain('Mistral');
    expect(container.textContent).not.toContain('Claude');
  });
});
