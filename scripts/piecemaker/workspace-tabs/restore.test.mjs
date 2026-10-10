import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { restoreWorkspaceTabs } from './restore.mjs';

test('restaure les fichiers supprimés et réinjecte le branchement upstream', () => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-tabs-'));
  const header = join(root, 'src/modules/project-workspace/WorkspaceHeader.tsx');
  mkdirSync(dirname(header), { recursive: true });
  writeFileSync(header, "import WorkspaceTabs from '@/modules/project-workspace/WorkspaceTabs';\n");
  restoreWorkspaceTabs(root);
  assert.match(readFileSync(header, 'utf8'), /WorkspaceIconTabs as WorkspaceTabs/);
  const component = join(root, 'src/modules/piecemaker-workspace-tabs/WorkspaceIconTabs.tsx');
  assert.match(readFileSync(component, 'utf8'), /export function WorkspaceIconTabs/);
  writeFileSync(component, 'travail en cours');
  restoreWorkspaceTabs(root);
  assert.equal(readFileSync(component, 'utf8'), 'travail en cours');
});
