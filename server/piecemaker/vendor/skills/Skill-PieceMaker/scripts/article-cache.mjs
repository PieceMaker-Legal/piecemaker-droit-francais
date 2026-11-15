import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const today = () => new Date().toLocaleDateString('sv-SE');
const file = (env, homeDir, id, folder = 'articles') => path.join(env.PIECEMAKER_HOME || path.join(homeDir || os.homedir(), '.piecemaker'), folder, `${id}.json`);
const closed = (response) => typeof response?.article?.dateFin === 'number' && response.article.dateFin < Date.now();

export function cachedArticle(env, homeDir, id) {
  if (!ID.test(id)) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(file(env, homeDir, id), 'utf8'));
    const response = entry?.reponse;
    return response && typeof response === 'object' && (closed(response) || String(entry.at ?? '').startsWith(today())) ? response : null;
  } catch {
    return null;
  }
}

export function cachedDecision(env, homeDir, id) {
  if (!ID.test(id)) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(file(env, homeDir, id, 'decisions'), 'utf8'));
    return typeof entry?.texte === 'string' && entry.texte.trim() ? entry : null;
  } catch {
    return null;
  }
}

export function keepArticle(env, homeDir, id, response) {
  const text = response?.article?.texte;
  if (!ID.test(id) || typeof text !== 'string' || !text.trim()) return;
  const target = file(env, homeDir, id);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, JSON.stringify({ kind: 'legifrance-article', id, titre: String(response.article.num ?? ''), texte: text, caracteres: text.length, source: 'catleg', at: today(), reponse: response }));
    fs.renameSync(temporary, target);
  } catch {
    fs.rmSync(temporary, { force: true });
  }
}
