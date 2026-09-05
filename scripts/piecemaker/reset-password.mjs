#!/usr/bin/env node
/**
 * Resets the password of the single account stored in the CloudCLI/PieceMaker
 * auth database, in place (the row's id is preserved, so projects, sessions and
 * preferences keyed on user_id stay attached to the account).
 *
 * The password is read from the terminal with echo disabled and never appears
 * in the shell history, in the process arguments or in this script's output.
 *
 * Usage: node scripts/piecemaker/reset-password.mjs [username]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';

import { loadProductConfig } from '../../shared/product-config.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12; // Must match server/modules/auth/auth.module.ts.
const MIN_PASSWORD_LENGTH = 6; // Must match the server's register() validation.

function resolveDatabasePath() {
  if (process.env.AUTH_DB_PATH) {
    return path.resolve(process.env.AUTH_DB_PATH);
  }

  const candidates = [];
  try {
    candidates.push(path.join(os.homedir(), loadProductConfig().dataDirectoryName));
  } catch {
    // No product config available: fall back to the upstream CloudCLI root only.
  }
  candidates.push(path.join(os.homedir(), '.cloudcli'));

  for (const root of candidates) {
    const dbPath = path.join(root, 'auth.db');
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }
  }

  throw new Error(`No auth.db found. Looked in: ${candidates.join(', ')}`);
}

/** Reads a line from the TTY without echoing it back. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('This script must be run from an interactive terminal.'));
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onKeypress = () => {
      // Repaint the prompt alone so the typed characters never reach the screen.
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(question);
    };

    process.stdout.write(question);
    process.stdin.on('data', onKeypress);
    rl.question('', (answer) => {
      process.stdin.removeListener('data', onKeypress);
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const dbPath = resolveDatabasePath();
  const database = new Database(dbPath);

  try {
    const accounts = database.prepare('SELECT id, username FROM users ORDER BY id').all();
    if (accounts.length === 0) {
      throw new Error(`${dbPath} holds no account. Start the app and use the setup screen instead.`);
    }

    const requested = process.argv[2];
    const account = requested
      ? accounts.find((row) => row.username === requested)
      : accounts[0];
    if (!account) {
      throw new Error(`No account named "${requested}". Known: ${accounts.map((row) => row.username).join(', ')}`);
    }

    console.log(`Database: ${dbPath}`);
    console.log(`Account:  ${account.username} (id ${account.id})`);

    const password = await promptHidden('New password: ');
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const confirmation = await promptHidden('Confirm:      ');
    if (password !== confirmation) {
      throw new Error('The two entries differ. Nothing was changed.');
    }

    const backupPath = `${dbPath}.password-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    database.prepare('VACUUM INTO ?').run(backupPath);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = database
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(passwordHash, account.id);
    if (result.changes !== 1) {
      throw new Error('The update touched no row. The database is unchanged.');
    }

    console.log(`Backup:   ${backupPath}`);
    console.log(`Password updated for "${account.username}".`);
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(`Reset failed: ${error.message}`);
  process.exitCode = 1;
});
