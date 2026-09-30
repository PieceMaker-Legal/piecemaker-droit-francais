import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const source = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(process.argv[2] || path.join(source, '../..'));
const require = createRequire(path.join(applicationRoot, 'package.json'));
const esbuild = require('esbuild');
const nodePaths = [path.join(applicationRoot, 'node_modules')];

const browser = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'info',
};

await esbuild.build({ ...browser, entryPoints: [path.join(source, 'src/client/index.ts')], outfile: path.join(source, 'dist/index.js') });
await esbuild.build({ ...browser, entryPoints: [path.join(source, 'src/client/sidebar.ts')], outfile: path.join(source, 'dist/sidebar.js') });
await esbuild.build({
  entryPoints: [path.join(source, 'src/server/server.ts')],
  outfile: path.join(source, 'dist/server.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  nodePaths,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'info',
});
