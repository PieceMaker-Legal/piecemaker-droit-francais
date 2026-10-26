import { Mistral } from '@mistralai/mistralai';

import { credentialsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

import { browserLogin } from '../../../scripts/piecemaker/mistral-sdk/browser-login.mjs';

const CREDENTIAL_TYPE = 'mistral_sdk';

type LoginAttempt = {
  state: 'pending' | 'connected' | 'error';
  url: Promise<string>;
  error: string | null;
};

export function createMistralSdkAuthService(
  credentials: Pick<typeof credentialsDb, 'getCredentials' | 'getActiveCredential' | 'createCredential' | 'deleteCredential'> = credentialsDb,
  authenticate = browserLogin,
) {
  const attempts = new Map<number, LoginAttempt>();
  const key = (userId: number) => credentials.getActiveCredential(userId, CREDENTIAL_TYPE);
  const removeCredentials = (userId: number) => {
    for (const credential of credentials.getCredentials(userId, CREDENTIAL_TYPE)) credentials.deleteCredential(userId, credential.id);
  };

  return {
    status(userId: number) {
      return {
        authenticated: Boolean(key(userId)),
        loginState: attempts.get(userId)?.state ?? 'idle',
        error: attempts.get(userId)?.error ?? null,
      };
    },

    startLogin(userId: number): Promise<string> {
      const pending = attempts.get(userId);
      if (pending?.state === 'pending') return pending.url;
      let open!: (url: string) => void;
      let reject!: (error: Error) => void;
      const attempt: LoginAttempt = {
        state: 'pending', error: null,
        url: new Promise<string>((resolve, fail) => { open = resolve; reject = fail; }),
      };
      attempts.set(userId, attempt);
      void authenticate({ openBrowser: async (url: string) => open(url) }).then(apiKey => {
        if (attempts.get(userId) !== attempt) return;
        removeCredentials(userId);
        credentials.createCredential(userId, 'Compte Mistral', CREDENTIAL_TYPE, apiKey);
        attempt.state = 'connected';
      }).catch((error: Error) => {
        reject(error);
        if (attempts.get(userId) !== attempt) return;
        attempt.state = 'error';
        attempt.error = error.message;
      });
      return attempt.url;
    },

    logout(userId: number) {
      attempts.delete(userId);
      removeCredentials(userId);
      return this.status(userId);
    },

    async checkConnection(userId: number) {
      const apiKey = key(userId);
      if (!apiKey) throw new AppError('Connectez-vous à Mistral depuis les paramètres.', { statusCode: 401, code: 'MISTRAL_NOT_CONNECTED' });
      const client = new Mistral({ apiKey, timeoutMs: 60000 });
      try {
        const response = await client.chat.complete({
          model: 'mistral-small-latest', maxTokens: 32,
          messages: [{ role: 'user', content: 'Réponds uniquement : Connexion Mistral réussie.' }],
        });
        return { ok: true, response: response.choices?.[0]?.message?.content ?? '' };
      } catch {
        throw new AppError('Mistral n’a pas accepté la demande de vérification. Reconnectez votre compte.', { statusCode: 502, code: 'MISTRAL_CHECK_FAILED' });
      }
    },
  };
}

export const mistralSdkAuth = createMistralSdkAuthService();
