import assert from 'node:assert/strict';
import test from 'node:test';

import {
  macUninstallScript,
  packagedApplicationRoot,
  removalPlan,
  windowsUninstallScript,
} from '../../electron/uninstallPlan.js';

test('repère le bundle macOS et refuse un dossier qui n’est pas l’application', () => {
  const app = '/Applications/PieceMaker.app/Contents/Resources/app';
  assert.equal(packagedApplicationRoot(app, 'darwin'), '/Applications/PieceMaker.app');
  assert.equal(packagedApplicationRoot('/Users/me/repo/electron', 'darwin'), null);
});

test('repère le dossier Windows', () => {
  const app = 'C:\\Users\\me\\AppData\\Local\\Programs\\PieceMaker\\resources\\app';
  assert.equal(
    packagedApplicationRoot(app, 'win32'),
    'C:\\Users\\me\\AppData\\Local\\Programs\\PieceMaker',
  );
});

test('retire l’application, les certificats et les composants, pas le dossier de données', () => {
  const plan = removalPlan('/Applications/PieceMaker.app', '/Users/me', {}, 'darwin');
  assert.equal(plan.certificates, '/Users/me/.piecemaker/certs');
  assert.equal(plan.python, '/Users/me/.piecemaker/python');
  assert.equal(plan.venv, '/Users/me/.piecemaker/venv');
  assert.equal(plan.bootstrap, '/Users/me/.piecemaker/bootstrap');
  const script = macUninstallScript(plan);
  assert.match(script, /security remove-trusted-cert/);
  assert.match(script, /PieceMaker\.app/);
  assert.doesNotMatch(script, /rm -rf '\/Users\/me\/\.piecemaker'\n/);
});

test('le script Windows retire les raccourcis et le certificat local', () => {
  const plan = removalPlan('C:\\Programs\\PieceMaker', 'C:\\Users\\me', {
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  }, 'win32');
  const script = windowsUninstallScript(plan);
  assert.match(script, /PieceMaker Local/);
  assert.match(script, /PieceMaker\.lnk/);
  assert.match(script, /PieceMaker'/);
});
