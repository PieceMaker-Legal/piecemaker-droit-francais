import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'piecemaker/mike/upstream');
const integration = path.join(root, 'piecemaker/mike/integration');
const home = process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
const runtimeDirectory = path.join(home, 'mike');
const configurationFile = path.join(runtimeDirectory, 'compose.json');

/**
 * Port du proxy PII embarqué (server/piecemaker/anonymizer/proxy.cjs), lu
 * depuis ~/.piecemaker/config.json, champ mikePiiPort. Ce proxy scanne une
 * plage de ports au démarrage (4111 et suivants) et publie le port réellement
 * obtenu dans ce fichier via service.cjs — c'est la seule source fiable,
 * un port codé en dur ici divergerait dès que le scan dévie de sa préférence.
 * PIECEMAKER_PII_ORIGIN reste un override explicite prioritaire pour les cas
 * avancés (proxy distant, tunnel).
 */
async function piecemakerPiiOrigin() {
  if (process.env.PIECEMAKER_PII_ORIGIN) return process.env.PIECEMAKER_PII_ORIGIN;
  let port = 4111;
  try {
    const config = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8'));
    const configuredPort = Number(config.mikePiiPort);
    if (Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65_535) {
      port = configuredPort;
    }
  } catch {
    // Fichier absent, illisible, ou proxy jamais démarré : repli sur 4111,
    // le port préféré du scan dans proxy.cjs.
  }
  return `http://host.docker.internal:${port}`;
}
const environment = {
  PATH: process.env.PATH,
  HOME: os.homedir(),
  DOCKER_HOST: process.env.DOCKER_HOST,
  DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
  NODE_ENV: 'development',
  BACKEND_PORT: '3011',
  FRONTEND_PORT: '3010',
  GATEWAY_PORT: '54331',
  DB_PORT: '54332',
  STORAGE_PORT: '9010',
  STORAGE_CONSOLE_PORT: '9011',
  REDIS_PORT: '6389',
  FRONTEND_URL: 'http://localhost:3012',
  API_PUBLIC_URL: 'http://localhost:3012/api',
  SUPABASE_PUBLIC_URL: 'http://localhost:54331',
};

async function configuration() {
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  const { stdout } = await execute('docker', ['compose', '-p', 'piecemaker-mike', '-f', path.join(source, 'docker-compose.yml'), 'config', '--format', 'json'], { env: environment, maxBuffer: 4 * 1024 * 1024 });
  const config = JSON.parse(stdout);
  config.name = 'piecemaker-mike';
  for (const service of Object.values(config.services)) {
    if (service.ports) service.ports = service.ports.map((port) => ({ ...port, host_ip: '127.0.0.1' }));
  }
  config.services.mailpit.ports = [{ target: 1025, published: '1026', host_ip: '127.0.0.1' }, { target: 8025, published: '8026', host_ip: '127.0.0.1' }];
  config.services.frontend.image = 'piecemaker-mike-frontend:local';
  config.services.frontend.build.dockerfile = path.join(integration, 'frontend.Dockerfile');
  for (const name of ['backend', 'workflow-sync']) config.services[name].image = 'piecemaker-mike-backend:local';
  config.services.backend.environment = {
    ...config.services.backend.environment,
    NODE_OPTIONS: '--import /piecemaker/provider-fetch.mjs',
    OPENAI_API_KEY: 'piecemaker-managed-codex',
    PIECEMAKER_PII_ORIGIN: await piecemakerPiiOrigin(),
    PIECEMAKER_CODEX_AUTH: '/piecemaker-auth/codex.json',
    R2_PUBLIC_ENDPOINT_URL: 'http://localhost:9010',
  };
  config.services.backend.volumes = [
    ...(config.services.backend.volumes || []),
    { type: 'bind', source: integration, target: '/piecemaker', read_only: true },
    { type: 'bind', source: path.join(os.homedir(), '.codex/auth.json'), target: '/piecemaker-auth/codex.json', read_only: true },
  ];
  config.services.backend.extra_hosts = ['host.docker.internal:host-gateway'];
  config.services.createbucket.volumes = [{ type: 'bind', source: path.join(integration, 'storage-cors.json'), target: '/storage-cors.json', read_only: true }];
  config.services['workflow-sync'].command = ['node', '/piecemaker/catalogue.cjs'];
  config.services['workflow-sync'].volumes = [
    { type: 'bind', source: integration, target: '/piecemaker', read_only: true },
    { type: 'bind', source: path.join(root, 'server/piecemaker/vendor/mike-defaults-fr'), target: '/piecemaker-defaults', read_only: true },
  ];
  await writeFile(configurationFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

const action = process.argv[2] || 'start';
await configuration();
const command = action === 'build' ? ['build', 'backend', 'frontend'] : action === 'stop' ? ['stop'] : action === 'status' ? ['ps', '--format', 'json'] : action === 'sync' ? ['run', '--rm', '--no-deps', 'workflow-sync'] : ['up', '-d', '--no-build'];
const { spawn } = await import('node:child_process');
if (action === 'start') {
  const images = await Promise.allSettled(['piecemaker-mike-backend:local', 'piecemaker-mike-frontend:local'].map((image) => execute('docker', ['image', 'inspect', image], { env: environment })));
  if (images.some((result) => result.status === 'rejected')) {
    const builder = spawn('docker', ['compose', '-p', 'piecemaker-mike', '-f', configurationFile, 'build', 'backend', 'frontend'], { env: environment, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { builder.on('error', reject); builder.on('exit', resolve); });
    if (code !== 0) process.exit(Number(code) || 1);
  }
}
const child = spawn('docker', ['compose', '-p', 'piecemaker-mike', '-f', configurationFile, ...command], { env: environment, stdio: 'inherit' });
child.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
