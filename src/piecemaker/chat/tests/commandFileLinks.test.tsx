import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { commandFileRefs } from '@/piecemaker/chat/commandFileRefs';
import { startCommandFileLinks } from '@/piecemaker/chat/commandFileLinks';
import { OPEN_IN_EDITOR_EVENT } from '@/piecemaker/editor-tabs/editorPanels';
import { BashCommandDisplay } from '@/modules/chat/tools/BashCommandDisplay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const COMMAND = "python3 - <<'EOF'\nsub('src/exemple/Fiche.tsx:12', 'a', 'b')\nEOF";
const OUTPUT = 'inchangé src/exemple/Autre.ts\n';

describe('commandFileRefs', () => {
  it('retient un chemin entre quotes et retire le suffixe de ligne', () => {
    expect(commandFileRefs(COMMAND).map((ref) => ref.path)).toEqual(['src/exemple/Fiche.tsx']);
  });

  it('ignore une commande, une version et une adresse', () => {
    const command = 'grep head v2.0.14 https://exemple.fr/a.html';
    expect(commandFileRefs(command)).toEqual([]);
  });
});

describe('startCommandFileLinks', () => {
  const opened: string[] = [];
  const record = (event: Event) => opened.push((event as CustomEvent<{ path: string }>).detail.path);
  let stop = () => {};

  afterEach(() => {
    stop();
    window.removeEventListener(OPEN_IN_EDITOR_EVENT, record);
    opened.length = 0;
  });

  it('ouvre le fichier cité dans la commande du composant amont, pas celui de la sortie', async () => {
    const headerClicks: number[] = [];
    render(<BashCommandDisplay command={COMMAND} output={OUTPUT} />);
    const commandSpan = [...document.querySelectorAll('.group\\/cmd span')].find((span) => span.textContent?.includes('Fiche.tsx'));
    const header = commandSpan?.parentElement;
    expect(commandSpan).toBeTruthy();
    expect(header).toBeTruthy();
    header?.addEventListener('click', () => headerClicks.push(1));

    const box = { left: 0, top: 0, right: 400, bottom: 40, width: 400, height: 40, x: 0, y: 0, toJSON() { return {}; } } as DOMRect;
    vi.spyOn(commandSpan as HTMLElement, 'getBoundingClientRect').mockReturnValue(box);
    const rectsOf = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function getClientRects() {
      if (this.toString() === 'src/exemple/Fiche.tsx') {
        return [{ left: 10, top: 8, right: 180, bottom: 24, width: 170, height: 16, x: 10, y: 8, toJSON() { return {}; } }] as unknown as DOMRectList;
      }
      return rectsOf.call(this);
    };

    window.addEventListener(OPEN_IN_EDITOR_EVENT, record);
    stop = startCommandFileLinks();

    try {
      commandSpan?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 40, clientY: 16 }));
      expect(opened).toEqual(['src/exemple/Fiche.tsx']);
      expect(headerClicks).toEqual([]);
      expect(commandSpan?.querySelector('button')).toBeNull();
      expect(document.body.textContent).not.toContain('Autre.ts');

      await act(async () => {
        commandSpan?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 300, clientY: 16 }));
      });
      expect(opened).toEqual(['src/exemple/Fiche.tsx']);
      expect(headerClicks).toEqual([1]);

      const output = document.querySelector('pre');
      expect(output?.textContent).toContain('Autre.ts');
      const outputBox = { ...box, top: 50, bottom: 90, y: 50, height: 40 };
      vi.spyOn(output as HTMLElement, 'getBoundingClientRect').mockReturnValue(outputBox);
      Range.prototype.getClientRects = function getClientRects() {
        const text = this.toString();
        const rect = text === 'src/exemple/Autre.ts' ? outputBox : text === 'src/exemple/Fiche.tsx' ? box : null;
        if (!rect) return rectsOf.call(this);
        const { left, top, right, bottom, width, height, x, y } = rect;
        return [{ left, top, right, bottom, width, height, x, y, toJSON() { return {}; } }] as unknown as DOMRectList;
      };
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      });
      output?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }));
      expect(opened).toEqual(['src/exemple/Fiche.tsx']);
    } finally {
      Range.prototype.getClientRects = rectsOf;
    }
  });
});
