import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function installDesktopKeepAwake({ app, powerSaveBlocker }) {
  let blockerId = null;
  const started = () => blockerId !== null && powerSaveBlocker.isStarted(blockerId);
  const endpoint = `/${randomUUID()}`;
  const server = createServer(async (request, response) => {
    if (request.url !== endpoint || (request.method !== 'GET' && request.method !== 'POST')) {
      response.writeHead(404).end();
      return;
    }
    try {
      if (request.method === 'POST') {
        const body = await readJson(request);
        if (typeof body.enabled !== 'boolean') {
          response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'enabled attendu' }));
          return;
        }
        if (body.enabled) {
          if (!started()) blockerId = powerSaveBlocker.start('prevent-app-suspension');
        } else if (blockerId !== null) {
          powerSaveBlocker.stop(blockerId);
          blockerId = null;
        }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ active: started() }));
    } catch {
      response.writeHead(400).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL = `http://127.0.0.1:${server.address().port}${endpoint}`;
  app.once('quit', () => {
    if (blockerId !== null) powerSaveBlocker.stop(blockerId);
    server.close();
  });
}
