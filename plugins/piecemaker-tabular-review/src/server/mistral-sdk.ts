import type { Conversation, SessionRequest } from './sessions.js';

export function mistralConversation(request: SessionRequest): Conversation {
  const controller = new AbortController();
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  let delegation: { origin: string; token: string } | null = null;
  const localOrigin = `http://127.0.0.1:${request.environment.SERVER_PORT || 3002}/api/piecemaker/local/mistral-sdk`;
  return {
    async send(text) {
      const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(request.mode === 'path' ? 25 * 60000 : 10 * 60000)]);
      signal.throwIfAborted();
      if (!delegation) {
        const response = await fetch(`${localOrigin}/delegation`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal, redirect: 'error',
          body: JSON.stringify({ project: request.readableDirectory }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || 'Connectez votre compte Mistral depuis les paramètres PieceMaker.');
        if (payload.origin !== `${localOrigin}/tabular` || typeof payload.token !== 'string' || !/^[a-f0-9]{64}$/.test(payload.token)) throw new Error('Autorisation SDK Mistral invalide.');
        delegation = payload;
      }
      messages.push({ role: 'user', content: text });
      try {
        const response = await fetch(delegation!.origin, {
          method: 'POST', signal, redirect: 'error',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${delegation!.token}` },
          body: JSON.stringify({ model: request.model, mode: request.mode, system: request.system, readableDirectory: request.readableDirectory, messages }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || 'La session SDK Mistral a échoué.');
        if (typeof payload.response !== 'string') throw new Error('Réponse SDK Mistral invalide.');
        messages.push({ role: 'assistant', content: payload.response });
        return payload.response;
      } catch (error) {
        messages.pop();
        throw error;
      }
    },
    close() { controller.abort(); },
  };
}
