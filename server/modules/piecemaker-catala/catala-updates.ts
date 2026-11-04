import { connectedClients, WS_OPEN_STATE } from '../websocket/index.js';

export function notifyCatalaUpdated(projectPath: string) {
  const message = JSON.stringify({ type: 'piecemaker-catala-updated', projectPath });
  for (const client of connectedClients) if (client.readyState === WS_OPEN_STATE) client.send(message);
}
