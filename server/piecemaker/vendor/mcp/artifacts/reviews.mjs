import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Revues Plannotator d'un artifact : `.piecemaker/artifacts/reviews/<id>/<revue>.review.json` (la
 * demande) et `<revue>.result.json` (la décision écrite par Plannotator). Une revue terminée devient
 * un fil de commentaires de l'avocat, de même identifiant que la revue.
 */
const OWNER = /^[a-z][a-z0-9-]{2,63}$/;
const reviewsFolder = (root) => path.join(root, '.piecemaker', 'artifacts', 'reviews');

export function startReview(root, plannotator, page) {
  const review = `pn-${randomBytes(4).toString('hex')}`;
  const folder = path.join(reviewsFolder(root), page.meta.id);
  const resultFile = path.join(folder, `${review}.result.json`);
  const started = plannotator.start(page.file, resultFile, { cwd: root });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${review}.review.json`), `${JSON.stringify({ id: review, version: page.version, path: page.path, result_file: resultFile, started_at: new Date().toISOString(), pid: started.pid }, null, 2)}\n`);
  return { review, version: page.version };
}

export async function collectReviews(root, comments) {
  const base = reviewsFolder(root);
  if (!fs.existsSync(base)) return [];
  const created = [];
  for (const id of fs.readdirSync(base).filter((name) => OWNER.test(name))) {
    for (const name of fs.readdirSync(path.join(base, id)).filter((file) => file.endsWith('.review.json'))) {
      const metaFile = path.join(base, id, name);
      const review = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      if (review.collected || !fs.existsSync(review.result_file)) continue;
      let result;
      try { result = JSON.parse(fs.readFileSync(review.result_file, 'utf8')); } catch { continue; }
      review.collected = new Date().toISOString();
      review.decision = result.decision ?? null;
      fs.writeFileSync(metaFile, `${JSON.stringify(review, null, 2)}\n`);
      if (result.decision === 'dismissed') continue;
      const body = result.decision === 'approved' ? `Approved in Plannotator.${result.feedback ? `\n\n${result.feedback}` : ''}` : String(result.feedback || '(no feedback)');
      created.push(comments.open(id, { source: 'plannotator', version: review.version, path: review.path, decision: result.decision }, body, 'lawyer', review.id).catch(() => null));
    }
  }
  return Promise.all(created);
}
