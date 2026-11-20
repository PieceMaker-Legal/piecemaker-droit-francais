import assert from 'node:assert/strict';

import React from 'react';
import { render } from '@testing-library/react';
import { test } from 'vitest';

import '@/modules/i18n';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import type { ProviderModelOption } from '@/shared/types';

const OPTIONS: ProviderModelOption[] = [
  { value: 'default', label: 'Default (recommended)' },
  { value: 'opus', label: 'Opus' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
];

const renderMenu = (model: string, servedModel: string | null) => render(
  <ComposerModelMenu
    effort="default"
    effortOptions={[]}
    onSelectEffort={() => {}}
    model={model}
    servedModel={servedModel}
    modelOptions={OPTIONS}
    onSelectModel={() => {}}
    modelsLoading={false}
  />,
);

test('an alias shows the exact model that served the last turn', () => {
  const { getByRole } = renderMenu('default', 'claude-opus-5-5');
  const trigger = getByRole('button');
  assert.equal(trigger.textContent, 'Opus 5.5');
  assert.match(trigger.getAttribute('title') ?? '', /claude-opus-5-5/);
});

test('a model the catalog does not pin is shortened the way reply footers show it', () => {
  const { getByRole } = renderMenu('opus', 'claude-opus-5-6');
  assert.equal(getByRole('button').textContent, 'Opus 5.6');
});

test('without a served model, or on the pinned model itself, the selection is shown', () => {
  assert.equal(renderMenu('default', null).getAllByRole('button').at(-1)?.textContent, 'Default (recommended)');
  assert.equal(renderMenu('claude-opus-5-5', 'claude-opus-5-5').getAllByRole('button').at(-1)?.textContent, 'Opus 5.5');
});
