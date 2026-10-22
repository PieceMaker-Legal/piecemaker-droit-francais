import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  macUninstallScript,
  packagedApplicationRoot,
  removalPlan,
  windowsUninstallScript,
  WINDOWS_UNINSTALL_KEY,
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

test('retire les données privées Mac et conserve comptes, bibliothèque et modèles partagés', () => {
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
  assert.equal(plan.remove.includes('/Users/me/.piecemaker'), false);
  assert.ok(plan.remove.includes('/Users/me/.piecemaker/venv'));
  assert.ok(plan.remove.includes('/Users/me/Library/Application Support/PieceMaker'));
  assert.ok(plan.remove.includes('/Users/me/Library/Logs/PieceMaker'));
  assert.ok(plan.remove.includes('/Users/me/Library/Preferences/legal.piecemaker.droitfrancais.plist'));
  assert.ok(plan.remove.includes('/Users/me/Library/Caches/legal.piecemaker.droitfrancais'));
  assert.equal(plan.remove.includes('/Users/me/.cache/huggingface/hub/models--fastino--gliner2-privacy-filter-PII-multi'), false);
  assert.equal(plan.remove.includes('/Users/me/.cache/huggingface/hub/models--fastino--gliner2.5-multi-v1'), false);
  assert.equal(plan.remove.includes('/Users/me/.cache/huggingface/hub/models--fastino--gliner2-multi-v1'), false);
  assert.equal(plan.remove.includes('/Users/me/.cache/huggingface/hub/models--opendatalab--PDF-Extract-Kit-1.0'), false);
  assert.equal(plan.remove.includes('/Users/me/mineru.json'), false);
  assert.equal(plan.remove.includes('/Users/me/.piecemaker-droit-francais'), false);
  assert.deepEqual(plan.purge, [{
    directory: '/Users/me/.piecemaker-droit-francais',
    keep: ['auth.db', 'auth.db-wal', 'auth.db-shm'],
  }, {
    directory: '/Users/me/.piecemaker',
    keep: ['library-backend'],
  }]);
  const script = macUninstallScript(plan);
  assert.match(script, /security remove-trusted-cert/);
  assert.match(script, /security delete-certificate -Z/);
  assert.doesNotMatch(script, /delete-certificate -c|delete-keychain/);
  assert.match(script, /PieceMaker\.app/);
  assert.match(script, /find '\/Users\/me\/\.piecemaker-droit-francais' -mindepth 1 -maxdepth 1 ! -name 'auth\.db' ! -name 'auth\.db-wal' ! -name 'auth\.db-shm' -exec rm -rf/);
  assert.match(script, /find '\/Users\/me\/\.piecemaker' -mindepth 1 -maxdepth 1 ! -name 'library-backend' -exec rm -rf/);
  assert.doesNotMatch(script, /rm -rf [^\n]*'\/Users\/me\/\.piecemaker'( |\n)/);
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
  assert.doesNotMatch(script, /Remove-Item -LiteralPath 'C:\\Users\\me\\\.piecemaker' /);
  assert.match(script, /Get-ChildItem -LiteralPath 'C:\\Users\\me\\\.piecemaker' [^\n]*'library-backend'/);
  assert.match(script, /-notcontains \$_\.Name/);
  assert.match(script, /'auth\.db', 'auth\.db-wal', 'auth\.db-shm'/);
  assert.match(script, /PieceMaker/);
  assert.match(script, /TrustedPublisher/);
  assert.match(script, /SystemCertificates/);
  assert.match(script, /PieceMaker\.lnk/);
  assert.match(script, /PieceMaker'/);
  assert.match(script, /models--fastino--gliner2\.5-multi-v1/);
  assert.match(script, /mineru\.json/);
});

test('le script Windows attend et arrête les processus qui verrouillent les fichiers, puis retire l’entrée « Applications installées »', () => {
  const plan = removalPlan('C:\Programs\PieceMaker', 'C:\Users\me', {}, 'win32', { productDataRoot: 'C:\Users\me\.piecemaker-droit-francais' });
  const script = windowsUninstallScript(plan);
  assert.match(script, /function Holders/);
  assert.match(script, /Stop-Process -Id \$process\.ProcessId -Force/);
  assert.match(script, /foreach \(\$location in @\('CurrentUser', 'LocalMachine'\)\)/);
  assert.match(script, /foreach \(\$name in @\('My', 'TrustedPublisher', 'Root', 'CA'\)\)/);
  assert.match(script, /Issuer -match 'PieceMaker'/);
  assert.match(script, /SystemCertificates/);
  assert.ok(script.includes(`Remove-Item -LiteralPath '${WINDOWS_UNINSTALL_KEY}' -Recurse -Force`));
});

test('le retrait Mac conserve les ressources partagées et cible uniquement le certificat de cette installation', { skip: process.platform !== 'darwin' }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-mac-uninstall-'));
  try {
    const data = path.join(home, '.piecemaker');
    const product = path.join(home, '.piecemaker-droit-francais');
    const appRoot = path.join(home, 'Applications', 'PieceMaker.app');
    const bin = path.join(home, 'bin');
    const calls = path.join(home, 'security-calls');
    const shared = [
      path.join(home, 'Library/Keychains/piecemaker-signing.keychain-db'),
      path.join(home, '.cache/huggingface/hub/models--fastino--gliner2-privacy-filter-PII-multi/weights'),
      path.join(home, 'mineru.json'),
      path.join(home, 'case/sample.docx'),
      path.join(data, 'library-backend/sample'),
      path.join(product, 'auth.db'),
    ];
    for (const file of shared) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'preserved');
    }
    await fs.mkdir(appRoot, { recursive: true });
    await fs.mkdir(path.join(data, 'certs'), { recursive: true });
    const ca = path.join(data, 'certs/piecemaker-ca.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(data, 'certs/key'), '-out', ca, '-days', '1', '-subj', '/CN=PieceMaker Local CA'], { stdio: 'ignore' });
    const fingerprint = execFileSync('openssl', ['x509', '-in', ca, '-noout', '-fingerprint', '-sha1'], { encoding: 'utf8' }).trim().split('=')[1].replaceAll(':', '');
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, 'security'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PM_SECURITY_CALLS"\nif [ "$1" = default-keychain ]; then printf "test-keychain"; fi\n', { mode: 0o755 });
    const script = path.join(home, 'uninstall.sh');
    await fs.writeFile(script, macUninstallScript(removalPlan(appRoot, home, {}, 'darwin', { productDataRoot: product })));
    execFileSync('/bin/sh', [script, '2147483647'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PM_SECURITY_CALLS: calls }, timeout: 10000 });
    await assert.rejects(fs.access(appRoot));
    for (const file of shared) assert.equal(await fs.readFile(file, 'utf8'), 'preserved');
    assert.match(await fs.readFile(calls, 'utf8'), new RegExp(`delete-certificate -Z ${fingerprint} test-keychain`));
    assert.doesNotMatch(await fs.readFile(calls, 'utf8'), /delete-keychain|delete-certificate -c/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
