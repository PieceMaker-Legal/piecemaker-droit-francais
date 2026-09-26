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

test('retire tout, y compris les données, sauf la base auth.db', () => {
  const plan = removalPlan('/Applications/PieceMaker.app', '/Users/me', {}, 'darwin', {
    config: { venvPath: '/Users/me/.piecemaker/venv' },
    mineru: {
      'models-dir': {
        pipeline: '/Users/me/.cache/huggingface/hub/models--opendatalab--PDF-Extract-Kit-1.0/snapshots/abc',
        vlm: '',
      },
    },
    productDataRoot: '/Users/me/.piecemaker-droit-francais',
    appId: 'legal.piecemaker.droitfrancais',
    electronPaths: ['/Users/me/Library/Application Support/PieceMaker', '/Users/me/Library/Logs/PieceMaker', null],
  });
  assert.ok(plan.remove.includes('/Users/me/.piecemaker'));
  assert.ok(plan.remove.includes('/Users/me/Library/Application Support/PieceMaker'));
  assert.ok(plan.remove.includes('/Users/me/Library/Logs/PieceMaker'));
  assert.ok(plan.remove.includes('/Users/me/Library/Preferences/legal.piecemaker.droitfrancais.plist'));
  assert.ok(plan.remove.includes('/Users/me/Library/Caches/legal.piecemaker.droitfrancais'));
  assert.ok(plan.remove.includes('/Users/me/.cache/huggingface/hub/models--fastino--gliner2.5-multi-v1'));
  assert.ok(plan.remove.includes('/Users/me/.cache/huggingface/hub/models--fastino--gliner2-multi-v1'));
  assert.ok(plan.remove.includes('/Users/me/.cache/huggingface/hub/models--opendatalab--PDF-Extract-Kit-1.0'));
  assert.ok(plan.remove.includes('/Users/me/mineru.json'));
  assert.equal(plan.remove.includes('/Users/me/.piecemaker-droit-francais'), false);
  assert.deepEqual(plan.purge, [{
    directory: '/Users/me/.piecemaker-droit-francais',
    keep: ['auth.db', 'auth.db-wal', 'auth.db-shm'],
  }]);
  const script = macUninstallScript(plan);
  assert.match(script, /security remove-trusted-cert/);
  assert.match(script, /PieceMaker\.app/);
  assert.match(script, /find '\/Users\/me\/\.piecemaker-droit-francais' -mindepth 1 -maxdepth 1 ! -name 'auth\.db' ! -name 'auth\.db-wal' ! -name 'auth\.db-shm' -exec rm -rf/);
  assert.doesNotMatch(script, /'\/Users\/me\/\.cache\/huggingface'/);
  assert.doesNotMatch(script, /'\/Users\/me'( |\n)/);
});

test('épargne un dossier qui contient la base ailleurs que dans le dossier de données', () => {
  const plan = removalPlan('/Applications/PieceMaker.app', '/Users/me', {
    DATABASE_PATH: '/Users/me/.piecemaker/db/auth.db',
  }, 'darwin', { productDataRoot: '/Users/me/.piecemaker-droit-francais' });
  assert.equal(plan.remove.includes('/Users/me/.piecemaker'), false);
  assert.ok(plan.remove.includes('/Users/me/.piecemaker-droit-francais'));
  assert.ok(plan.remove.includes('/Users/me/.piecemaker/bootstrap'));
});

test('ne retire jamais le dossier personnel ni un chemin hors du compte', () => {
  const plan = removalPlan('/Applications/PieceMaker.app', '/Users/me', {
    PIECEMAKER_HOME: '/Users/me',
  }, 'darwin', { productDataRoot: '/srv/piecemaker', electronPaths: ['/Library/Application Support/PieceMaker'] });
  assert.equal(plan.remove.includes('/Users/me'), false);
  assert.equal(plan.remove.some((entry) => !entry.startsWith('/Users/me/')), false);
  assert.deepEqual(plan.purge, []);
});

test('ignore un interpréteur système et un dossier de modèles hors du compte', () => {
  const plan = removalPlan('/Applications/PieceMaker.app', '/Users/me', {}, 'darwin', {
    config: { venvPath: '/Library/Frameworks/Python.framework/Versions/3.12' },
    mineru: { 'models-dir': { pipeline: '/usr/local/share/mineru' } },
  });
  assert.equal(plan.remove.some((entry) => entry.startsWith('/Library') || entry.startsWith('/usr')), false);
});

test('le script Windows retire les raccourcis et le certificat local', () => {
  const plan = removalPlan('C:\\Programs\\PieceMaker', 'C:\\Users\\me', {
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
  }, 'win32', { productDataRoot: 'C:\\Users\\me\\.piecemaker-droit-francais' });
  const script = windowsUninstallScript(plan);
  assert.match(script, /Remove-Item -LiteralPath 'C:\\Users\\me\\\.piecemaker' /);
  assert.match(script, /-notcontains \$_\.Name/);
  assert.match(script, /'auth\.db', 'auth\.db-wal', 'auth\.db-shm'/);
  assert.match(script, /PieceMaker Local/);
  assert.match(script, /PieceMaker\.lnk/);
  assert.match(script, /PieceMaker'/);
  assert.match(script, /models--fastino--gliner2\.5-multi-v1/);
  assert.match(script, /mineru\.json/);
});
