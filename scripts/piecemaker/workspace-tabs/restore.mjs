import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backupPath = fileURLToPath(new URL('./backup.json', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const headerPath = 'src/modules/project-workspace/WorkspaceHeader.tsx';
const upstreamImport = "import WorkspaceTabs from '@/modules/project-workspace/WorkspaceTabs';";
const piecemakerImport = "import { WorkspaceIconTabs as WorkspaceTabs } from '@/modules/piecemaker-workspace-tabs';";
const mainPath = 'src/modules/project-workspace/WorkspaceMain.tsx';
const panelsImport = "import { withWorkspacePanels } from '@/modules/piecemaker-workspace-tabs';";
const upstreamExport = 'export default React.memo(WorkspaceMain);';
const panelsExport = 'export default React.memo(withWorkspacePanels(WorkspaceMain));';

export function restoreWorkspaceTabs(root = repositoryRoot) {
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  for (const [path, source] of Object.entries(backup)) {
    const target = resolve(root, path);
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  const target = resolve(root, headerPath);
  const source = readFileSync(target, 'utf8');
  if (!source.includes(piecemakerImport) && source.split(upstreamImport).length !== 2) {
    throw new Error('Branchement des onglets déplacé par upstream : reporter WorkspaceIconTabs au nouveau site.');
  }
  if (!source.includes(piecemakerImport)) writeFileSync(target, source.replace(upstreamImport, piecemakerImport));
  const mainTarget = resolve(root, mainPath);
  let mainSource = readFileSync(mainTarget, 'utf8');
  if (!mainSource.includes(panelsExport)) {
    if (mainSource.split(upstreamExport).length !== 2) {
      throw new Error('Branchement des volets déplacé par upstream : reporter withWorkspacePanels au nouveau site.');
    }
    mainSource = mainSource.replace(upstreamExport, panelsExport);
  }
  if (!mainSource.includes(panelsImport)) mainSource = `${panelsImport}\n${mainSource}`;
  writeFileSync(mainTarget, mainSource);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) restoreWorkspaceTabs();
