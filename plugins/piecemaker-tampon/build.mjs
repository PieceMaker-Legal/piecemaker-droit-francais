import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const source = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(process.argv[2] || path.join(source, '../..'));
const require = createRequire(path.join(applicationRoot, 'package.json'));
const esbuild = require('esbuild');

await esbuild.build({
  entryPoints: [path.join(source, 'src/index.ts')],
  outfile: path.join(source, 'dist/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'info',
});
