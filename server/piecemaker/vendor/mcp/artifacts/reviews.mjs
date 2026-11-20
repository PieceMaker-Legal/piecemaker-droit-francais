import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { openComments } from '../features/store.mjs';
import { ID_PATTERN, openArtifacts } from './artifacts.mjs';

const passage = z.object({
  quote: z.string().min(1).max(4000).refine((value) => value.trim().length > 0),
  start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  before: z.string().max(48),
  after: z.string().max(48),
});

const commentInput = z.object({
  text: z.string().trim().min(1).max(16000),
  thread_id: z.string().optional(),
  anchor: z.object({
    version: z.number().int().positive(),
    passage: passage.optional(),
  }).nullish(),
});

const decisionInput = z.object({
  version: z.number().int().positive(),
  decision: z.enum(['approved', 'changes_requested']),
  text: z.string().trim().max(16000).default(''),
}).refine((value) => value.decision === 'approved' || value.text.length > 0, {
  message: 'Ajoutez un motif à la demande de modifications.',
});

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw Object.assign(new Error(result.error.issues[0].message), { code: 'invalid_argument' });
  return result.data;
}

export function openArtifactReviews(root) {
  const artifacts = openArtifacts(root);
  const comments = openComments(root, { base: ['.piecemaker', 'artifacts'], namePattern: ID_PATTERN });

  async function importCompletedReviews(id) {
    const folder = path.join(root, '.piecemaker', 'artifacts', 'reviews', id);
    if (!fs.existsSync(folder)) return;
    const existing = new Set(comments.read(id).map((thread) => thread.id));
    for (const name of fs.readdirSync(folder)) {
      const match = /^([a-z0-9-]{1,40})\.review\.json$/.exec(name);
      if (!match || existing.has(match[1])) continue;
      let review;
      let result;
      try {
        review = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
        result = JSON.parse(fs.readFileSync(path.join(folder, `${match[1]}.result.json`), 'utf8'));
      } catch {
        continue;
      }
      if (!Number.isSafeInteger(review?.version) || !['approved', 'annotated'].includes(result?.decision)) continue;
      const decision = result.decision === 'approved' ? 'approved' : 'changes_requested';
      const feedback = typeof result.feedback === 'string' ? result.feedback.trim() : '';
      try {
        await comments.open(id, { kind: 'review', version: review.version, decision }, feedback || decisionLabel(decision), 'lawyer', match[1]);
      } catch (error) {
        if (error.code !== 'conflict') throw error;
      }
    }
  }

  return {
    async read(id, threadId) {
      const { id: owner } = artifacts.load(id);
      await importCompletedReviews(owner);
      return comments.read(owner, threadId).map((thread) => {
        if (!['annotated', 'approved'].includes(thread.anchor?.decision) || thread.anchor.kind === 'review') return thread;
        const { version, decision } = thread.anchor;
        return { ...thread, anchor: { kind: 'review', version, decision: decision === 'annotated' ? 'changes_requested' : decision } };
      });
    },
    async comment(id, input) {
      const { text, anchor, thread_id: threadId } = parse(commentInput, input);
      const { id: owner, version } = artifacts.summary(artifacts.load(id));
      if (threadId !== undefined) return comments.reply(owner, threadId, text, 'lawyer');
      if (anchor) artifacts.read({ url: owner, ver: anchor.version });
      return comments.open(owner, { ...anchor, version: anchor?.version ?? version }, text, 'lawyer');
    },
    async decide(id, input) {
      const { version, decision, text } = parse(decisionInput, input);
      const { meta } = artifacts.read({ url: id, ver: version });
      return comments.open(meta.id, { kind: 'review', version, decision }, text || decisionLabel(decision), 'lawyer');
    },
    reply: comments.reply,
    resolve: comments.resolve,
  };
}

function decisionLabel(decision) {
  return decision === 'approved' ? 'Version approuvée.' : 'Modifications demandées.';
}
