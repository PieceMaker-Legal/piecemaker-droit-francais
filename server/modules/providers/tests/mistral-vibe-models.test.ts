import assert from 'node:assert/strict';
import test from 'node:test';

import { MISTRAL_PREDEFINED_MODELS } from '@/modules/providers/list/mistral/mistral-models.provider.js';
import { buildVibeModelsEnvironment } from '@/modules/providers/list/mistral/mistral-vibe-models.js';

test('Vibe receives the GLM models alongside Mistral Medium without overriding thinking by default', () => {
  const models = JSON.parse(buildVibeModelsEnvironment());
  assert.deepEqual(Object.keys(models), ['mistral-medium-3.5', 'glm-5.3', 'glm-5.2']);
  assert.deepEqual(models['glm-5.3'], { name: 'zai-glm-5-3', provider: 'mistral', alias: 'glm-5.3', display_name: 'Z.ai GLM 5.3' });
  assert.equal(models['mistral-medium-3.5'].thinking, undefined);
});

test('the selected effort becomes Vibe thinking only on models with adjustable reasoning', () => {
  assert.equal(JSON.parse(buildVibeModelsEnvironment('mistral-medium-3.5', 'none'))['mistral-medium-3.5'].thinking, 'low');
  assert.equal(JSON.parse(buildVibeModelsEnvironment('mistral-medium-3.5', 'high'))['mistral-medium-3.5'].thinking, 'high');
  assert.equal(JSON.parse(buildVibeModelsEnvironment('glm-5.3', 'high'))['glm-5.3'].thinking, undefined);
  assert.equal(JSON.parse(buildVibeModelsEnvironment('mistral-medium-3.5', 'bogus'))['mistral-medium-3.5'].thinking, undefined);
});

test('the curated Mistral catalog lists GLM 5.3 and 5.2 and offers effort on Medium 3.5 only', () => {
  const byValue = Object.fromEntries(MISTRAL_PREDEFINED_MODELS.OPTIONS.map((option) => [option.value, option]));
  assert.deepEqual(Object.keys(byValue), ['mistral-medium-3.5', 'glm-5.3', 'glm-5.2', 'local']);
  assert.deepEqual(byValue['mistral-medium-3.5'].effort?.values.map((value) => value.value), ['none', 'high']);
  assert.equal(byValue['glm-5.3'].effort, undefined);
  assert.equal(MISTRAL_PREDEFINED_MODELS.DEFAULT, 'mistral-medium-3.5');
});
