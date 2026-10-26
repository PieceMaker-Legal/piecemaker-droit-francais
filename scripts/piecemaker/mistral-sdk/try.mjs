import { spawn } from 'node:child_process';
import { Mistral } from '@mistralai/mistralai';

import { browserLogin } from './browser-login.mjs';

async function openBrowser(url) {
  console.log(`Connecte-toi à ton compte Pro ou Team : ${url}`);
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Ouvre le lien de connexion affiché dans ton navigateur.')));
  });
}

try {
  const apiKey = await browserLogin({ openBrowser });
  const client = new Mistral({ apiKey, timeoutMs: 60000 });
  const response = await client.chat.complete({
    model: process.argv[2] || 'mistral-small-latest',
    messages: [{ role: 'user', content: 'Réponds uniquement : Connexion Mistral réussie.' }],
    maxTokens: 32,
  });
  console.log(response.choices?.[0]?.message?.content || 'Réponse Mistral vide.');
} catch (error) {
  console.error(error.statusCode ? `Test Mistral refusé (HTTP ${error.statusCode}).` : error.message);
  process.exitCode = 1;
}
