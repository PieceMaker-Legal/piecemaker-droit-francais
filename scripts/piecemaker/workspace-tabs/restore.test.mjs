import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { restoreWorkspaceTabs } from './restore.mjs';

test('répare les branchements et fichiers manquants dans le dépôt', () => {
  restoreWorkspaceTabs();
});

test('restaure les fichiers supprimés et réinjecte le branchement upstream', () => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-tabs-'));
  const header = join(root, 'src/modules/project-workspace/WorkspaceHeader.tsx');
  mkdirSync(dirname(header), { recursive: true });
  writeFileSync(header, "import WorkspaceTabs from '@/modules/project-workspace/WorkspaceTabs';\n");
  const main = join(root, 'src/modules/project-workspace/WorkspaceMain.tsx');
  writeFileSync(main, "import { EditorSidebar, useEditorSidebar } from '@/modules/code-editor';\nexport default React.memo(WorkspaceMain);\n");
  restoreWorkspaceTabs(root);
  assert.match(readFileSync(header, 'utf8'), /WorkspaceIconTabs as WorkspaceTabs/);
  assert.match(readFileSync(main, 'utf8'), /withWorkspacePanels\(WorkspaceMain\)/);
  assert.match(readFileSync(main, 'utf8'), /import \{ withWorkspacePanels \}/);
  assert.match(readFileSync(main, 'utf8'), /WorkspaceViewer as EditorSidebar/);
  assert.match(readFileSync(join(root, 'src/modules/piecemaker-workspace-tabs/WorkspacePanels.tsx'), 'utf8'), /export function withWorkspacePanels/);
  const component = join(root, 'src/modules/piecemaker-workspace-tabs/WorkspaceIconTabs.tsx');
  assert.match(readFileSync(component, 'utf8'), /export function WorkspaceIconTabs/);
  writeFileSync(component, 'travail en cours');
  restoreWorkspaceTabs(root);
  assert.equal(readFileSync(component, 'utf8'), 'travail en cours');
});
