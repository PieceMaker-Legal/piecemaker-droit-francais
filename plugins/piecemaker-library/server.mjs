import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const settings = new URL('./local.json', import.meta.url);
const home = fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')).home : path.join(os.homedir(), '.piecemaker');
const connectionPath = path.join(home, 'library-backend', 'connection.json');
const allowed = /^\/(?:catalog(?:\/[a-f0-9]{64}(?:\/activation)?)?|provider-skills(?:\/scan)?|plugins(?:\/[^/?]+(?:\/(?:files|file|activation))?)?|activation(?:\/toggle)?|plugin\/marketplace(?:\/(?:register|acquire))?)(?:\?|$)/;
function forward({ port, token, method, url, body }) {
  return new Promise((resolve, reject) => {
    const upstream = http.request(
      { host: '127.0.0.1', port, path: url, method },
      (response) => {
        const parts = [];
        response.on('data', (chunk) => parts.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(parts) }));
      },
    );
    upstream.setHeader('authorization', `Bearer ${token}`);
    upstream.setHeader('content-type', 'application/json');
    upstream.setTimeout(120000, () => upstream.destroy(new Error('Délai dépassé.')));
    upstream.on('error', reject);
    upstream.end(body);
  });
}

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
    const response = await forward({
      port,
      token,
      method: req.method,
      url: req.url,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    res.writeHead(response.status);
    res.end(response.text);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    res.writeHead(503);
    res.end(JSON.stringify({ error: 'Bibliothèque indisponible. Vérifiez le serveur PieceMaker.' }));
  }
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`${JSON.stringify({ ready: true, port: server.address().port })}\n`));
