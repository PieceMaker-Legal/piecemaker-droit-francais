import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import type { EventEmitter } from 'node:events';

import type Database from 'better-sqlite3';

type Account = { id: number; username: string };
const bcrypt = createRequire(import.meta.url)('bcrypt') as { hash(value: string, rounds: number): Promise<string> };
const runtimeEvents: EventEmitter = process;

export function createDesktopAuthService(database: Database.Database) {
  let resetting = false;
  const account = () => database.prepare('SELECT id, username FROM users WHERE is_active = 1 LIMIT 1').get() as Account | undefined;
  return {
    account,
    async reset(password: unknown) {
      if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password) > 72 || password.includes('\0')) {
        throw new TypeError('Le mot de passe doit contenir au moins 6 caractères et au plus 72 octets, sans caractère nul.');
      }
      if (resetting) throw new Error('Une réinitialisation est déjà en cours.');
      if (process.env.JWT_SECRET || !process.listenerCount('piecemaker:password-reset')) {
        throw new Error('La révocation des connexions est indisponible. Relancez l’application de bureau.');
      }
      const user = account();
      if (!user) throw new Error('Aucun compte PieceMaker à réinitialiser.');
      resetting = true;
      try {
        const hash = await bcrypt.hash(password, 12);
        const secret = randomBytes(64).toString('hex');
        database.transaction(() => {
          const result = database.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND is_active = 1').run(hash, user.id);
          if (result.changes !== 1) throw new Error('Le compte PieceMaker a changé. Recommencez.');
          database.prepare("INSERT INTO app_config (key, value) VALUES ('jwt_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(secret);
        })();
        runtimeEvents.emit('piecemaker:password-reset', secret);
        return { username: user.username };
      } finally {
        resetting = false;
      }
    },
  };
}
