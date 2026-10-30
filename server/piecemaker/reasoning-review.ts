import { getConnection, userPreferencesDb } from '@/modules/database/index.js';

import { createCitationReviewer } from '../modules/piecemaker-reasoning/citation-review-model.js';

import { mistralSdkAuth } from './mistral-sdk/auth.service.js';
import { createCitationReviewContext } from './reasoning-review-context.js';
import { createCitationTransport } from './reasoning-review-transport.js';

export function createReasoningReview(applicationRoot: string, transportOptions: Omit<Parameters<typeof createCitationTransport>[0], 'authenticate'>) {
  const context = createCitationReviewContext(
    (userId) => userPreferencesDb.getPreferences(userId),
    () => getConnection().prepare('SELECT id FROM users WHERE is_active = 1 LIMIT 2').all() as Array<{ id: number }>,
  );
  const transport = createCitationTransport({ ...transportOptions, authenticate: (userId) => mistralSdkAuth.createClient(userId) });
  return { review: createCitationReviewer(applicationRoot, context.select, transport), scope: context.scope };
}
