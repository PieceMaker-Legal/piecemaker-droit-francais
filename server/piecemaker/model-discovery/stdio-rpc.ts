import readline from 'node:readline';

import crossSpawn from 'cross-spawn';

type RpcReply = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

export type RpcCall = (method: string, params: unknown) => Promise<unknown>;

export type StdioRpcServer = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

const CLIENT_INFO = { name: 'piecemaker', title: 'PieceMaker', version: '1' };

export async function withStdioRpcServer<T>(
  server: StdioRpcServer,
  exchange: (call: RpcCall) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const child = crossSpawn(server.command, server.args, { env: server.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, (reply: RpcReply) => void>();
  let nextId = 1;
  let stderr = '';

  const failAll = (reason: string) => {
    for (const settle of pending.values()) settle({ error: { message: reason } });
    pending.clear();
  };

  child.stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-1000); });
  child.on('error', (error) => failAll(error.message));
  child.on('exit', (code) => failAll(`${server.command} exited (code ${code ?? 'null'}) ${stderr.trim().split('\n').pop() ?? ''}`.trim()));
  child.stdin?.on('error', (error) => failAll(error.message));
  child.stdout?.on('error', (error) => failAll(error.message));
  child.stderr?.on('error', () => {});

  const reader = readline.createInterface({ input: child.stdout! });
  reader.on('line', (line) => {
    let reply: RpcReply;
    try { reply = JSON.parse(line) as RpcReply; } catch { return; }
    if (typeof reply.id !== 'number') return;
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });

  const call: RpcCall = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (reply) => (reply.error
      ? reject(new Error(reply.error.message || `${server.command} rejected ${method}`))
      : resolve(reply.result)));
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${server.command} did not answer within ${timeoutMs} ms`)), timeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        await call('initialize', { clientInfo: CLIENT_INFO, capabilities: {} });
        child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);
        return exchange(call);
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    reader.close();
    child.kill();
  }
}
