import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { adoptRunningServerPort } from '../../installer/lib/conversion-client.mjs';

const text = z.string().min(1);

export const replyFields = {
  text,
  attached_outputs: z.array(z.object({
    kind: z.enum(['file', 'artifact', 'link']), ref: text.describe('Chemin du fichier, référence de l’artifact ou URL du lien.'), title: text.optional(),
  })).optional().describe('Fichiers, artifacts ou liens joints au message.'),
};

export const decisionFields = {
  question: text,
  options: z.array(z.object({ label: text, consequence: text })).min(2).max(4).describe('Deux à quatre choix présentés à l’avocat avec leurs conséquences.'),
  recommended: z.number().int().min(0).max(3).describe('Index de l’option recommandée, à partir de zéro.'),
  reason: text.optional().describe('Motif de la recommandation.'),
};

async function call(tool, { session_key, ...args }) {
  const port = await adoptRunningServerPort();
  const response = await fetch(`http://127.0.0.1:${port}/api/piecemaker/local/orchestrateur/call`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: process.cwd(), session_key, tool, args }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Erreur HTTP ${response.status}.`);
  return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
}

export function createRelayServer(name, tools) {
  const server = new McpServer({ name, version: '0.1.0' });
  for (const [tool, [description, fields]] of Object.entries(tools)) {
    const inputSchema = z.strictObject({
      session_key: text.describe('Clé de session reçue dans le wake ou le premier message.'),
      ...fields,
    });
    server.registerTool(tool, { description, inputSchema }, args => call(tool, args));
  }
  return server;
}
