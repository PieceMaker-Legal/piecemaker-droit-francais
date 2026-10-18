import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';

if (process.platform !== 'win32') throw new Error('Cet outil concerne uniquement Windows.');
const executable = path.resolve(process.argv[2]);
if (path.basename(executable) !== 'PieceMakerTestMAJ.exe') throw new Error('Application de test attendue.');
const root = path.join(path.dirname(executable), 'resources', 'app.asar.unpacked');
const product = JSON.parse(await fs.readFile(path.join(root, 'product.config.json'), 'utf8'));
if (product.appId !== 'legal.piecemaker.testmaj' || product.dataDirectoryName !== '.piecemaker-maj-test') throw new Error('Identité de test incorrecte : aucune modification.');
const running = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Name PieceMakerTestMAJ -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne ${process.pid} } | Measure-Object).Count`], { encoding: 'utf8' }).trim();
if (running !== '0') throw new Error('Fermer toutes les fenêtres PieceMaker Test MAJ, puis relancer cet outil.');
const directory = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(root, 'electron-piecemaker', 'ui-update-runtime.json');
const current = JSON.parse(await fs.readFile(configFile, 'utf8'));
const next = JSON.parse(await fs.readFile(path.join(directory, 'remote-runtime.json'), 'utf8'));
if (next.runtime !== current.runtime || next.feed !== 'https://github.com/PieceMaker-Legal/piecemaker-droit-francais/releases/download/test-maj-ui-desktop-2.0.47' || createPublicKey(next.publicKey).asymmetricKeyType !== 'ed25519') throw new Error('Canal distant incompatible.');
if (next.feed !== current.feed || next.publicKey !== current.publicKey) {
  const suffix = `.before-remote-${Date.now()}`;
  await fs.copyFile(configFile, configFile + suffix);
  const cache = path.join(os.homedir(), '.piecemaker-maj-test', 'app-data', 'ui-updates', current.runtime);
  try { await fs.rename(cache, cache + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(configFile + '.tmp', JSON.stringify(next, null, 2));
  await fs.rename(configFile + '.tmp', configFile);
}
console.log('Canal distant signé activé pour PieceMaker Test MAJ uniquement.');
console.log('Premier lancement : téléchargement. Fermer et rouvrir : bouton bleu TEST MAJ.');
