import fs from 'node:fs/promises';
import path from 'node:path';
import { buildDesktopApp, windowsTar } from './build.mjs';
import { generateCertificates } from './certificates.mjs';
import { IS_MAC, sourceDir } from './paths.mjs';
import { run } from './shell.mjs';

const archive = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage : node build-release.mjs <archive.tar.gz>');
if (!sourceDir) throw new Error('PIECEMAKER_SRC_DIR est absent.');

await generateCertificates();
const built = await buildDesktopApp(sourceDir, { windowsInstaller: !IS_MAC });
await fs.mkdir(path.dirname(archive), { recursive: true });
await run(IS_MAC ? '/usr/bin/tar' : windowsTar(), ['-czf', archive, '-C', IS_MAC ? path.dirname(built) : built, IS_MAC ? path.basename(built) : '.']);
console.log(`Archive : ${archive}`);
