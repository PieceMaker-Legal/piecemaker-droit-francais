import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRelayServer, decisionFields, replyFields } from '../orchestrateur/client.mjs';

export function createServer() {
  return createRelayServer('fil', {
    reply: ['Répond au tour du fil. Les fichiers et artifacts joints deviennent des livrables.', replyFields],
    ask_decision: ['Demande une décision pour le fil et avertit l’orchestrateur par un événement thread_decision.', decisionFields],
    message_orchestrator: ['Transmet un message du fil à l’orchestrateur par un événement thread_message.', { text: replyFields.text }],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createServer().connect(new StdioServerTransport());
}
