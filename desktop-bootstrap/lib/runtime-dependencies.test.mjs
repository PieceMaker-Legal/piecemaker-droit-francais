import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { selectRuntimeDependencies } from './runtime-dependencies.mjs';

test('selects quoted runtime imports from owned and plugin server sources', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-runtime-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['server/modules', 'electron', 'shared', 'desktop-bootstrap/overlay', 'plugins/piecemaker-fixture/src/server', 'server/tests']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'server/modules/main.ts'), "import express from 'express';\nimport type { Options } from 'pkg/subpath';\nconst optional = import('dynamic-package');\n");
  fs.writeFileSync(path.join(root, 'electron/main.js'), "const codex = require('@openai/codex/bin/codex.js');\n");
  fs.writeFileSync(path.join(root, 'shared/util.mjs'), "export { run } from \"shared-runtime\";\n");
  fs.writeFileSync(path.join(root, 'desktop-bootstrap/overlay/main.cjs'), "const shell = require('overlay-runtime');\n");
  fs.writeFileSync(path.join(root, 'server/modules/main.test.ts'), "import 'test-only-package';\n");
  fs.writeFileSync(path.join(root, 'server/tests/ignored.ts'), "import 'test-directory-package';\n");
  fs.writeFileSync(path.join(root, 'plugins/piecemaker-fixture/manifest.json'), JSON.stringify({
    piecemakerSources: { server: 'src/server/index.ts' },
  }));
  fs.writeFileSync(path.join(root, 'plugins/piecemaker-fixture/src/server/index.ts'), "import db from 'plugin-runtime';\n");
  fs.writeFileSync(path.join(root, 'plugins/piecemaker-fixture/src/server/helper.ts'), "import 'helper-runtime';\n");

  const manifest = {
    dependencies: Object.fromEntries([
      'express', 'pkg', 'dynamic-package', '@openai/codex', 'shared-runtime', 'overlay-runtime',
      'plugin-runtime', 'helper-runtime', 'test-only-package', 'test-directory-package', '@vscode/ripgrep', 'unused-package',
    ].map((name) => [name, '1.0.0'])),
    optionalDependencies: { optionalOne: '^1.0.0', optionalTwo: '^2.0.0' },
  };

  assert.deepEqual(selectRuntimeDependencies(root, manifest), {
    dependencies: {
      '@openai/codex': '1.0.0',
      '@vscode/ripgrep': '1.0.0',
      'dynamic-package': '1.0.0',
      express: '1.0.0',
      'helper-runtime': '1.0.0',
      'overlay-runtime': '1.0.0',
      'plugin-runtime': '1.0.0',
      pkg: '1.0.0',
      'shared-runtime': '1.0.0',
    },
    optionalDependencies: { optionalOne: '^1.0.0', optionalTwo: '^2.0.0' },
  });
});

test('keeps optional dependencies when source roots are absent', () => {
  const result = selectRuntimeDependencies(os.tmpdir(), {
    dependencies: { unused: '1.0.0' },
    optionalDependencies: { optional: '^1.2.3' },
  });
  assert.deepEqual(result, { dependencies: {}, optionalDependencies: { optional: '^1.2.3' } });
});
