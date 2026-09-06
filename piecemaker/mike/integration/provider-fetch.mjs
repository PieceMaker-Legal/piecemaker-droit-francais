import { readFile } from 'node:fs/promises';

const originalFetch = globalThis.fetch;
const protectedOrigins = new Set(['https://api.openai.com', 'https://api.anthropic.com', 'https://generativelanguage.googleapis.com', 'https://openrouter.ai', 'https://opencode.ai', 'https://ai-gateway.vercel.sh']);

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!protectedOrigins.has(url.origin)) return originalFetch(input, init);
  if (url.origin !== 'https://api.openai.com') throw new Error('Ce fournisseur doit être connecté au proxy PieceMaker avant son utilisation.');
  if (url.pathname.endsWith('/models')) return Response.json({ object: 'list', data: ['gpt-5.4', 'gpt-5.2', 'gpt-5'].map((id) => ({ id, object: 'model', owned_by: 'openai' })) });
  if (!url.pathname.endsWith('/responses')) throw new Error('Le fournisseur PieceMaker utilise Responses.');
  const authentication = JSON.parse(await readFile(process.env.PIECEMAKER_CODEX_AUTH, 'utf8'));
  const accessToken = authentication.tokens?.access_token;
  if (!accessToken) throw new Error('La session Codex doit être connectée dans PieceMaker.');
  const body = await request.json();
  const wasStreaming = body.stream === true;
  body.stream = true;
  body.store = false;
  body.instructions ||= 'Suivez les instructions de la requête et le format de sortie demandé.';
  delete body.max_output_tokens;
  delete body.temperature;
  delete body.top_p;
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  if (authentication.tokens.account_id) headers.set('chatgpt-account-id', authentication.tokens.account_id);
  const upstream = await originalFetch(`${process.env.PIECEMAKER_PII_ORIGIN}/chatgpt/responses`, { method: 'POST', headers, body: JSON.stringify(body), signal: request.signal });
  if (wasStreaming || !upstream.ok) return upstream;
  const stream = await upstream.text();
  let result;
  for (const line of stream.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    try {
      const event = JSON.parse(line.slice(6));
      if (event.type === 'response.completed') result = event.response;
      if (event.type === 'response.failed' || event.type === 'error') throw new Error('Le fournisseur n’a pas terminé la requête.');
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  if (!result) throw new Error('La réponse du fournisseur a été interrompue.');
  return Response.json(result);
};
