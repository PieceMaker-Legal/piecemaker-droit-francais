import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { readCitationReplies } from './citation-review.js';
import type { ReasoningConnectors } from './program.js';

export type ReviewSelection = { provider: string; userId: number };
export type ReviewInvocation = ReviewSelection & { model: string; cwd: string; prompt: string; payload: string; schema: typeof REVIEW_SCHEMA };

const MODELS: Record<string, string> = { claude: 'haiku', codex: 'gpt-6-luna', mistral: 'mistral-small-latest' };
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verifications'],
  properties: { verifications: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['emplacement', 'reponse', 'score', 'explication'],
    properties: { emplacement: { type: 'string' }, reponse: { type: 'string', enum: ['validé', 'non validé', 'indéterminé'] }, score: { type: 'integer', minimum: 1, maximum: 5 }, explication: { type: 'string', minLength: 1 } },
  } } },
};

export function createCitationReviewer(applicationRoot: string, select: () => ReviewSelection, invoke: (request: ReviewInvocation) => Promise<unknown>): NonNullable<ReasoningConnectors['review']> {
  const cache = new Map<string, Promise<unknown>>();
  return async ({ online, ...input }) => {
    const selection = select();
    const model = MODELS[selection.provider];
    if (!model) throw new TypeError('Vérification sémantique disponible avec Claude, Codex ou Mistral : choisissez un de ces fournisseurs.');
    const prompt = await readFile(path.join(applicationRoot, 'server/modules/piecemaker-reasoning/citation-review.md'), 'utf8');
    const payload = JSON.stringify(input);
    const key = createHash('sha256').update(JSON.stringify({ ...selection, model })).update(prompt).update(payload).digest('hex');
    if (cache.has(key)) return cache.get(key)!;
    if (!online) throw new Error('Vérification hors ligne sans résultat en cache.');
    const pending = invoke({ ...selection, model, cwd: input.cwd, prompt, payload, schema: REVIEW_SCHEMA }).then((raw) => {
      const replies = readCitationReplies(raw, input.affirmations.map((entry) => entry.emplacement));
      return { verifications: [...replies].map(([emplacement, reply]) => ({ emplacement, ...reply })), provider: selection.provider, model };
    });
    cache.set(key, pending);
    pending.catch(() => { cache.delete(key); });
    return pending;
  };
}
