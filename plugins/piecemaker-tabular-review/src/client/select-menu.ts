import { escapeHtml } from './dom.js';

type SelectMenuOption = { value: string; label: string };

export function selectMenu(label: string, key: 'provider' | 'model', value: string, options: SelectMenuOption[], disabled = false): string {
  const selected = options.find((option) => option.value === value);
  const menuOptions = options.length ? options : [{ value: '', label: 'Aucun modèle disponible' }];
  return `
    <details class="ptr-menu ptr-choice-menu" data-choice-menu="${key}"${disabled ? ' data-choice-disabled="true"' : ''}>
      <summary class="ptr-choice-trigger" aria-label="${escapeHtml(label)}"${disabled ? ' aria-disabled="true" tabindex="-1"' : ''}>
        <span>${escapeHtml(selected?.label ?? value)}</span><span class="ptr-choice-chevron" aria-hidden="true">▾</span>
      </summary>
      <div class="ptr-menu-list" role="group" aria-label="${escapeHtml(label)}">
        ${menuOptions.map((option) => `<button type="button" class="ptr-menu-item${option.value === value ? ' ptr-choice-selected' : ''}" aria-pressed="${option.value === value}" data-choice-option="${key}" data-value="${escapeHtml(option.value)}"${disabled || !options.length ? ' disabled' : ''}>${escapeHtml(option.label)}</button>`).join('')}
      </div>
    </details>`;
}
