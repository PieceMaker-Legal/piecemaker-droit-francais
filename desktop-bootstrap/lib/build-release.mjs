import fs from 'node:fs/promises';
import path from 'node:path';
import { buildDesktopApp, windowsTar } from './build.mjs';
import { generateCertificates } from './certificates.mjs';
import { sourceDir } from './paths.mjs';
import { run } from './shell.mjs';

const archive = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage : node build-release.mjs <archive.tar.gz>');
if (!sourceDir) throw new Error('PIECEMAKER_SRC_DIR est absent.');

await generateCertificates();
const built = await buildDesktopApp(sourceDir);
await fs.mkdir(path.dirname(archive), { recursive: true });
await run(windowsTar(), ['-czf', archive, '-C', built, '.']);
console.log(`Archive : ${archive}`);
