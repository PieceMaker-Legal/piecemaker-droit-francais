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
  const plan = removalPlan('/Applications/PieceMaker.app', '/Users/me', {}, 'darwin', {
    config: { venvPath: '/Users/me/.piecemaker/venv' },
    mineru: {
      'models-dir': {
        pipeline: '/Users/me/.cache/huggingface/hub/models--opendatalab--PDF-Extract-Kit-1.0/snapshots/abc',
        vlm: '',
      },
    },
  });
  assert.equal(plan.certificates, '/Users/me/.piecemaker/certs');
  assert.equal(plan.python, '/Users/me/.piecemaker/python');
  assert.equal(plan.venv, '/Users/me/.piecemaker/venv');
  assert.equal(plan.bootstrap, '/Users/me/.piecemaker/bootstrap');
  assert.ok(plan.models.includes('/Users/me/.cache/huggingface/hub/models--fastino--gliner2.5-multi-v1'));
  assert.ok(plan.models.includes('/Users/me/.cache/huggingface/hub/models--fastino--gliner2-multi-v1'));
  assert.ok(plan.models.includes('/Users/me/.cache/huggingface/hub/models--opendatalab--PDF-Extract-Kit-1.0'));
  const script = macUninstallScript(plan);
  assert.match(script, /security remove-trusted-cert/);
  assert.match(script, /PieceMaker\.app/);
  assert.match(script, /models--fastino--gliner2\.5-multi-v1/);
  assert.match(script, /mineru\.json/);
  assert.doesNotMatch(script, /rm -rf '\/Users\/me\/\.piecemaker'\n/);
  assert.doesNotMatch(script, /rm -rf '\/Users\/me\/\.cache\/huggingface'/);
});

test('ignore un interpréteur système et un dossier de modèles hors du compte', () => {
  const plan = removalPlan('/Applications/PieceMaker.app', '/Users/me', {}, 'darwin', {
    config: { venvPath: '/Library/Frameworks/Python.framework/Versions/3.12' },
    mineru: { 'models-dir': { pipeline: '/usr/local/share/mineru' } },
  });
  assert.equal(plan.venv, '/Users/me/.piecemaker/venv');
  assert.equal(plan.models.some((entry) => entry.startsWith('/usr')), false);
});

test('le script Windows retire les raccourcis et le certificat local', () => {
  const plan = removalPlan('C:\\Programs\\PieceMaker', 'C:\\Users\\me', {
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  }, 'win32');
  const script = windowsUninstallScript(plan);
  assert.match(script, /PieceMaker Local/);
  assert.match(script, /PieceMaker\.lnk/);
  assert.match(script, /PieceMaker'/);
  assert.match(script, /models--fastino--gliner2\.5-multi-v1/);
  assert.match(script, /mineru\.json/);
});
