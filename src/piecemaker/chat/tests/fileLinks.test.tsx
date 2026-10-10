import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { commandFileRefs } from '@/piecemaker/chat/commandFileRefs';
import { startFileLinks } from '@/piecemaker/chat/fileLinks';
import { OPEN_IN_EDITOR_EVENT } from '@/piecemaker/editor-tabs/editorPanels';
import { BashCommandDisplay } from '@/modules/chat/tools/BashCommandDisplay';
import { Markdown } from '@/modules/chat/transcript/Markdown';
import { PaletteOpsProvider, usePaletteOpsRegister } from '@/modules/command-palette';

const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api')>()),
  authenticatedFetch: vi.fn(async (_url: string, init: { body: string }) => {
    const { refs } = JSON.parse(init.body) as { refs: string[] };
    return new Response(JSON.stringify({ paths: refs.map((ref) => files.get(ref) ?? null) }));
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const settle = () => act(async () => {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

const click = (element: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
};

describe('commandFileRefs', () => {
  it('garde un chemin entre quotes ou aux espaces échappés en une seule référence', () => {
    const command = 'docx read "~/Desktop/01 - Modèle Assignation.docx" && cat ~/Bureau/Mon\\ dossier/note.md';
    expect(commandFileRefs(command).map((ref) => ref.path)).toEqual([
      '~/Desktop/01 - Modèle Assignation.docx',
      '~/Bureau/Mon dossier/note.md',
    ]);
  });

  it('ignore une commande, une option et une adresse', () => {
    expect(commandFileRefs('grep -rn head https://exemple.fr/a.html').map((ref) => ref.path)).toEqual([]);
  });
});

describe('startFileLinks', () => {
  const opened: string[] = [];
  const record = (event: Event) => opened.push((event as CustomEvent<{ path: string }>).detail.path);
  let stop = () => {};

  beforeEach(() => {
    window.addEventListener(OPEN_IN_EDITOR_EVENT, record);
  });

  afterEach(() => {
    stop();
    window.removeEventListener(OPEN_IN_EDITOR_EVENT, record);
    opened.length = 0;
    files.clear();
  });

  it('ne rend cliquable qu’un fichier vérifié et ouvre son chemin réel, jamais le texte cité', async () => {
    files.set('src/exemple/Fiche.tsx:12', '/reel/src/exemple/Fiche.tsx');
    files.set('notes/a b.md', '/reel/notes/a b.md');
    const reactOpen = vi.fn();
    function Register() {
      usePaletteOpsRegister({ openFileInEditor: reactOpen });
      return null;
    }
    render(
      <PaletteOpsProvider>
        <Register />
        <Markdown className="prose">{'Voir `src/exemple/Fiche.tsx:12`, `src/exemple/Invente.tsx`, [la note](<notes/a b.md>) et [le site](https://exemple.fr).'}</Markdown>
      </PaletteOpsProvider>,
    );
    stop = startFileLinks();
    await settle();

    const anchor = (text: string) => [...document.querySelectorAll('a')].find((a) => a.textContent?.includes(text))!;
    expect(anchor('Fiche.tsx').dataset.pmFile).toBe('ok');
    expect(anchor('la note').dataset.pmFile).toBe('ok');
    expect(anchor('Invente.tsx').dataset.pmFile).toBe('none');
    expect(anchor('le site').dataset.pmFile).toBeUndefined();

    expect(click(anchor('Invente.tsx')).defaultPrevented).toBe(true);
    click(anchor('Fiche.tsx'));
    click(anchor('la note'));
    await settle();
    expect(opened).toEqual(['/reel/src/exemple/Fiche.tsx', '/reel/notes/a b.md']);
    expect(reactOpen).not.toHaveBeenCalled();

    files.delete('src/exemple/Fiche.tsx:12');
    click(anchor('Fiche.tsx'));
    await settle();
    expect(opened).toHaveLength(2);
    expect(anchor('Fiche.tsx').dataset.pmFile).toBe('none');
  });

  it('ne souligne dans une commande que les chemins dont le fichier existe', async () => {
    files.set('~/Desktop/01 - Modèle.docx', '/Users/exemple/Desktop/01 - Modèle.docx');
    const headerClicks: number[] = [];
    render(<BashCommandDisplay command={'docx read "~/Desktop/01 - Modèle.docx" && cat src/Invente.md'} output="" />);
    const commandSpan = [...document.querySelectorAll('.group\\/cmd span')].find((span) => span.textContent?.includes('Modèle'))!;
    commandSpan.parentElement!.addEventListener('click', () => headerClicks.push(1));

    const box = { left: 0, top: 0, right: 600, bottom: 40, width: 600, height: 40, x: 0, y: 0, toJSON() { return {}; } } as DOMRect;
    vi.spyOn(commandSpan as HTMLElement, 'getBoundingClientRect').mockReturnValue(box);
    const rectsOf = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function getClientRects() {
      const at = (left: number, right: number) => [{ left, top: 8, right, bottom: 24, width: right - left, height: 16, x: left, y: 8, toJSON() { return {}; } }] as unknown as DOMRectList;
      if (this.toString() === '~/Desktop/01 - Modèle.docx') return at(80, 260);
      if (this.toString() === 'src/Invente.md') return at(320, 420);
      return rectsOf.call(this);
    };

    try {
      stop = startFileLinks();
      await settle();

      click(commandSpan, { clientX: 340, clientY: 16 });
      expect(headerClicks).toEqual([1]);

      click(commandSpan, { clientX: 100, clientY: 16 });
      await settle();
      expect(opened).toEqual(['/Users/exemple/Desktop/01 - Modèle.docx']);
      expect(headerClicks).toEqual([1]);
    } finally {
      Range.prototype.getClientRects = rectsOf;
    }
  });
});
