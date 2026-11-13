import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = process.env.PIECEMAKER_DESKTOP_AUTH_ROOT;
const targets = [
  ['modules/auth/auth.middleware', /const\s+JWT_SECRET\s*=\s*process\.env\.JWT_SECRET\s*\|\|\s*appConfigDb\.getOrCreateJwtSecret\(\);/g,
    "let JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret(); process.on('piecemaker:password-reset', secret => { JWT_SECRET = secret; });"],
  ['modules/websocket/services/websocket-server.service', /\breturn\s+wss\s*;?/g,
    "process.on('piecemaker:password-reset', () => { for (const client of wss.clients) client.terminate(); }); return wss;"],
  ['modules/auth/auth.service', /if\s*\(\s*!user\s*\|\|\s*!validPassword\s*\)/g,
    'if (!user || !validPassword || dependencies.users.getUserByUsername(username)?.password_hash !== user.password_hash)'],
];

if (root && process.env.PIECEMAKER_DESKTOP_AUTH_SECRET) {
  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      for (const [name, pattern, replacement] of targets) {
        const candidates = ['js', 'ts'].flatMap(extension => [path.join(root, 'dist-server/server', `${name}.${extension}`), path.join(root, 'server', `${name}.${extension}`)]);
        if (!url.startsWith('file:') || !candidates.includes(fileURLToPath(url))) continue;
        const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString();
        if ([...source.matchAll(pattern)].length !== 1) throw new Error(`Raccord de sécurité PieceMaker incompatible : ${name}`);
        return { ...loaded, source: source.replace(pattern, replacement) };
      }
      return loaded;
    },
  });
}
