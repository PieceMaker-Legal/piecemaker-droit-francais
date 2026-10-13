import { constants } from 'fs';
import { copyFile, mkdir, readdir } from 'fs/promises';
import path from 'path';

export async function installCustomFiles(applicationRoot: string, piecemakerHome: string): Promise<void> {
  const source = path.join(applicationRoot, 'server', 'piecemaker', 'custom-files');
  const target = path.join(piecemakerHome, 'custom');
  await mkdir(target, { recursive: true });
  for (const name of await readdir(source)) {
    await copyFile(path.join(source, name), path.join(target, name), constants.COPYFILE_EXCL).catch(() => undefined);
  }
}
