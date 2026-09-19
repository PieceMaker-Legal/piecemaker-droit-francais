import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';
import { ui } from './ui.mjs';
import { IS_MAC, PRODUCT_NAME } from './paths.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function findBuiltApp(sourceDir) {
  const releaseRoot = path.join(sourceDir, 'release', 'desktop');
  const entries = await fs.readdir(releaseRoot, { withFileTypes: true });

  for (const entry of entries.filter((item) => item.isDirectory())) {
    const dir = path.join(releaseRoot, entry.name);
    if (IS_MAC) {
      const inner = await fs.readdir(dir);
      const app = inner.find((name) => name.endsWith('.app'));
      if (app) return path.join(dir, app);
    } else if (entry.name.includes('unpacked')) {
      const executable = path.join(dir, `${PRODUCT_NAME}.exe`);
      if (await exists(executable)) return dir;
    }
  }

  throw new Error(`Aucune application construite trouvée dans ${releaseRoot}.`);
}

export async function buildDesktopApp(sourceDir) {
  ui.step('Installation des dépendances du projet (plusieurs minutes)…');
  await run(npmCommand, ['install', '--no-audit', '--no-fund'], { cwd: sourceDir });

  ui.step("Construction de l'application Electron…");
  await run(npmCommand, ['run', 'desktop:pack'], {
    cwd: sourceDir,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  });

  const built = await findBuiltApp(sourceDir);
  ui.ok(`Application construite : ${built}`);
  return built;
}
