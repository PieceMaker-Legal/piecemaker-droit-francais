import { afterEach, expect, it } from 'vitest';

import { startPanelPicker } from '@/modules/piecemaker-chat-picks/panelPicker';

const TAB = 'plugin:piecemaker-dossier';
const listened: Array<[string, (event: Event) => void]> = [];
const record = (type: string) => {
  const seen: unknown[] = [];
  const listen = (event: Event) => seen.push((event as CustomEvent).detail);
  window.addEventListener(type, listen);
  listened.push([type, listen]);
  return seen;
};
const request = (tab: string) => window.dispatchEvent(new CustomEvent('piecemaker:panel-pick', { detail: { tab } }));

afterEach(() => {
  for (const [type, listen] of listened.splice(0)) window.removeEventListener(type, listen);
  document.body.innerHTML = '';
});

it('cible un élément marqué du volet demandé et transmet son fichier et ses lignes', () => {
  document.body.innerHTML = `<div data-chat-tab="${TAB}"><p>hors cible</p><div data-chat-pick="modifie" data-chat-kind="Relation" data-chat-file="/Users/exemple/.piecemaker/ontologie.json" data-chat-line="3" data-chat-end="16"><span>modifie</span></div></div>`;
  const stop = startPanelPicker();
  const picks = record('piecemaker:chat-pick');
  const states = record('piecemaker:panel-pick-state');
  const picked = record('piecemaker:panel-picked');
  try {
    request(TAB);
    expect(document.documentElement.classList.contains('pmc-picking')).toBe(true);
    document.querySelector('p')!.click();
    expect(picks).toEqual([]);
    document.querySelector('span')!.click();
    expect(picks).toEqual([{ titre: 'modifie', nature: 'Relation', fichier: '/Users/exemple/.piecemaker/ontologie.json', debut: 3, fin: 16, note: undefined, tab: TAB }]);
    expect(states).toEqual([{ tab: TAB, active: true }, { tab: TAB, active: false }]);
    expect(picked).toEqual([{ tab: TAB }]);
    expect(document.documentElement.classList.contains('pmc-picking')).toBe(false);
  } finally { stop(); }
});

it('laisse la demande au volet qui n’a aucun élément marqué', () => {
  document.body.innerHTML = `<div data-chat-tab="${TAB}"><div data-chat-pick="modifie"></div></div>`;
  const stop = startPanelPicker();
  const states = record('piecemaker:panel-pick-state');
  try {
    request('plugin:piecemaker-catala');
    expect(states).toEqual([]);
    request(TAB);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(states).toEqual([{ tab: TAB, active: true }, { tab: TAB, active: false }]);
  } finally { stop(); }
});
