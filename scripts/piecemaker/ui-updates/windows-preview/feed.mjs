import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const executable = process.argv[2];
const token = randomBytes(24).toString('hex');
let mode = 'valid';
let child;
const config = JSON.parse(fs.readFileSync(path.join(directory, 'test-runtime.json')));
if (config.dataDirectory !== '.piecemaker-maj-test') throw new Error('Unexpected preview data directory');
const page = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>PieceMaker Test MAJ</title><body style="font:16px system-ui;max-width:760px;margin:40px auto;padding:20px"><h1>PieceMaker Test MAJ</h1><p>Serveur local de test uniquement. Aucun accès au canal de mise à jour public.</p><p>1. Choisir « Interface correcte », ouvrir l'application puis la fermer et la rouvrir pour activer le paquet. La bannière verte confirme l'activation.</p><p>2. Choisir « Interface défaillante », fermer et rouvrir pour télécharger le paquet, puis recommencer pour l'activer. L'interface valide doit revenir automatiquement.</p><p>Chaque paquet n'est essayé qu'une fois. Pour recommencer, fermer l'application et cliquer « Réinitialiser » (seul le cache des interfaces de test sera retiré).</p><form method="post" action="/${token}/valid"><button>Interface correcte</button></form><form method="post" action="/${token}/broken"><button>Interface défaillante</button></form><form method="post" action="/${token}/invalid"><button>Signature invalide</button></form><form method="post" action="/${token}/start"><button>Ouvrir PieceMaker Test MAJ</button></form><form method="post" action="/${token}/reset"><button>Réinitialiser le cache de test</button></form><p>Ne tester qu'avec des dossiers fictifs. L'anonymiseur est désactivé dans cette application de test.</p></body></html>`;
const secure = createSecureServer({ key: fs.readFileSync(path.join(directory, 'localhost.key')), cert: fs.readFileSync(path.join(directory, 'localhost.crt')) }, (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/ui-update.json') {
    const envelope = JSON.parse(fs.readFileSync(path.join(directory, 'updates', mode === 'broken' ? 'broken.json' : 'valid.json')));
    if (mode === 'invalid') envelope.signature = Buffer.alloc(64).toString('base64');
    response.end(JSON.stringify(envelope));
  } else if (/^\/ui-[a-f0-9]{64}\.json\.gz$/.test(request.url)) {
    const file = path.join(directory, 'updates', request.url.slice(1));
    if (!fs.existsSync(file)) return response.writeHead(404).end();
    fs.createReadStream(file).pipe(response);
  } else response.writeHead(404).end();
});
const control = createServer((request, response) => {
  if (request.headers.host !== '127.0.0.1:39148' || !request.url.startsWith(`/${token}`)) return response.writeHead(404).end();
  const action = request.url.slice(token.length + 2);
  if (action === 'status') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ running: Boolean(child && child.exitCode === null), pid: child?.pid, mode }));
    return;
  }
  if (request.method === 'POST') {
    if (['valid', 'broken', 'invalid'].includes(action)) mode = action;
    if (action === 'start' && (!child || child.exitCode !== null)) {
      const env = { ...process.env, NODE_EXTRA_CA_CERTS: path.join(directory, 'localhost.crt') };
      delete env.ELECTRON_RUN_AS_NODE;
      const args = process.env.PIECEMAKER_TEST_DEBUG_PORT ? [`--remote-debugging-port=${process.env.PIECEMAKER_TEST_DEBUG_PORT}`] : [];
      child = spawn(executable, args, { env, stdio: process.env.PIECEMAKER_PREVIEW_AUTOMATED ? 'inherit' : 'ignore' });
      child.on('error', (error) => console.error(error.message));
    }
    if (action === 'close' && child && child.exitCode === null) {
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if($p){[void]$p.CloseMainWindow()}`], { windowsHide: true });
    }
    if (action === 'reset') {
      if (child && child.exitCode === null) return response.writeHead(409).end('Fermer l’application de test avant de réinitialiser.');
      fs.rmSync(path.join(process.env.USERPROFILE, config.dataDirectory, 'app-data', 'ui-updates'), { recursive: true, force: true });
    }
    response.writeHead(303, { Location: `/${token}` }).end();
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(page);
});
secure.listen(39147, '127.0.0.1');
control.listen(39148, '127.0.0.1', () => {
  const url = `http://127.0.0.1:39148/${token}`;
  console.log(`Console de test : ${url}`);
  if (!process.env.PIECEMAKER_PREVIEW_AUTOMATED) spawn('cmd.exe', ['/d', '/c', 'start', '', url], { windowsHide: true });
});
for (const server of [secure, control]) server.on('error', (error) => { console.error(error.message); process.exit(1); });
