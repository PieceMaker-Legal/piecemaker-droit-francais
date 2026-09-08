import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const settings = new URL('./local.json', import.meta.url);
const home = fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')).home : path.join(os.homedir(), '.piecemaker');
const connectionPath = path.join(home, 'library-backend', 'connection.json');
const allowed = /^\/(?:catalog(?:\/[a-f0-9]{64}(?:\/activation)?)?|activation(?:\/toggle)?|plugin\/marketplace(?:\/(?:register|acquire))?)(?:\?|$)/;
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!allowed.test(req.url || '')) { res.writeHead(404); res.end('{}'); return; }
    const { port, token } = JSON.parse(fs.readFileSync(connectionPath, 'utf8'));
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('Requête trop volumineuse.');
      chunks.push(chunk);
    }
    const response = await fetch(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      signal: AbortSignal.timeout(120000),
    });
    res.writeHead(response.status);
    res.end(await response.text());
  } catch {
    res.writeHead(503);
    res.end(JSON.stringify({ error: 'Bibliothèque indisponible. Vérifiez le serveur PieceMaker.' }));
  }
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`${JSON.stringify({ ready: true, port: server.address().port })}\n`));
