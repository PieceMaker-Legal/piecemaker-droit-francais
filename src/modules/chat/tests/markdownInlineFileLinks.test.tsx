import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import { PaletteOpsProvider, usePaletteOpsRegister } from '@/modules/command-palette';
import { Markdown } from '@/modules/chat/transcript/Markdown';

/**
 * Claude Code cites files as inline code (`src/app.ts:42`) rather than as
 * markdown links, so those references must open in the editor like the
 * `[app.ts](/abs/app.ts)` links Codex writes.
 */

function Registrar({ onOpen }: { onOpen: (path: string) => void }) {
  usePaletteOpsRegister({ openFileInEditor: onOpen });
  return null;
}

const renderMarkdown = (content: string) => {
  const opened: string[] = [];
  const view = render(
    <PaletteOpsProvider>
      <Registrar onOpen={(path) => opened.push(path)} />
      <Markdown>{content}</Markdown>
    </PaletteOpsProvider>,
  );
  return { ...view, opened };
};

const FILE_REFS: Record<string, string> = {
  'src/app.ts:42': 'src/app.ts',
  '/home/me/Dossier Dupont/Conclusions v2.docx': '/home/me/Dossier Dupont/Conclusions v2.docx',
  'contrat.docx': 'contrat.docx',
  'C:\\repo\\main.rs:12:5': 'C:\\repo\\main.rs',
};

for (const [ref, expected] of Object.entries(FILE_REFS)) {
  test(`inline code naming a file opens it in the editor: ${ref}`, () => {
    const { container, opened } = renderMarkdown(`Voir \`${ref}\`.`);
    const links = container.querySelectorAll('a');
    assert.equal(links.length, 1);
    assert.equal(links[0].querySelector('code')?.textContent, ref);

    fireEvent.click(links[0]);
    assert.deepEqual(opened, [expected]);
  });
}

const NOT_FILE_REFS = [
  'npm run build',
  'foo()',
  'a = b.c',
  'v2.0.14',
  '.env',
  '*.docx',
  'https://example.com/a.html',
  'claude/determined-gates-gyx48a',
];

for (const ref of NOT_FILE_REFS) {
  test(`inline code that is not a file stays plain code: ${ref}`, () => {
    const { container } = renderMarkdown(`Voir \`${ref}\`.`);
    assert.equal(container.querySelectorAll('a').length, 0);
    assert.equal(container.querySelector('code')?.textContent, ref);
  });
}

test('inline code inside a file link does not nest a second link', () => {
  const { container, opened } = renderMarkdown('Voir [`app.ts`](/abs/src/app.ts).');
  const links = container.querySelectorAll('a');
  assert.equal(links.length, 1);

  fireEvent.click(links[0].querySelector('code')!);
  assert.deepEqual(opened, ['/abs/src/app.ts']);
});

test('a path inside a fenced block is not linked', () => {
  const { container } = renderMarkdown('```\nsrc/app.ts\n```\n');
  assert.equal(container.querySelectorAll('a').length, 0);
});
