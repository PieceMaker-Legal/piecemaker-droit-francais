import http from 'node:http';

const HEALTH_TIMEOUT_MS = 1000;

function readHealth(baseUrl) {
  return new Promise((resolve) => {
    const request = http.get(`${baseUrl}/health`, { timeout: HEALTH_TIMEOUT_MS }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
}

export function isHealthOfBundledServer(health, appVersion) {
  return Boolean(health) && health.installMode !== 'git' && health.version === appVersion;
}

export async function isAdoptableServer(baseUrl, { isPackaged, appVersion }) {
  if (!isPackaged) return true;
  return isHealthOfBundledServer(await readHealth(baseUrl), appVersion);
}
