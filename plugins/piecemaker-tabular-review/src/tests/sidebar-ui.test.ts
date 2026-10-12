import { afterEach, expect, it } from 'vitest';

import { inject } from '../client/sidebar.js';

const PROJECT = '/Users/exemple/Dossiers/Société Exemple SAS';

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
}

async function injectInto(markup: string) {
  document.body.innerHTML = markup;
  const stop = inject({ rpc: async () => ({ projects: [PROJECT] }), openTab: () => true });
  await Promise.resolve();
  await nextFrame();
  return stop;
}

afterEach(() => {
  document.body.innerHTML = '';
});

it('ajoute le bouton sous « Nouvelle session » sur ordinateur', async () => {
  const stop = await injectInto(`
    <div class="md:space-y-1">
      <div><div class="min-w-0 flex-1 text-left" title="${PROJECT}"></div></div>
      <div class="ml-3 space-y-1 border-l"><button><svg class="lucide-plus"></svg>Nouvelle session</button></div>
    </div>`);
  expect(document.querySelector('[data-piecemaker-tabular-review]')?.textContent).toBe('Analyse Tabulaire');
  stop();
});

it('ajoute le bouton sur téléphone grâce au chemin annoté par PieceMaker', async () => {
  const stop = await injectInto(`
    <div class="md:space-y-1" data-piecemaker-project-path="${PROJECT}">
      <div><h3>Société Exemple SAS</h3></div>
      <div class="ml-3 space-y-1 border-l"><div class="px-3 pb-1 pt-1"><button><svg class="lucide-plus"></svg>Nouvelle session</button></div></div>
    </div>`);
  const added = document.querySelector<HTMLElement>('[data-piecemaker-tabular-review]');
  expect(added?.textContent).toBe('Analyse Tabulaire');
  expect(added?.previousElementSibling?.className).toBe('px-3 pb-1 pt-1');
  stop();
});
