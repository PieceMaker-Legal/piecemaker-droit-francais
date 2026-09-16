import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml');

export const REGISTRE_PUBLIC_CONNECTOR = Object.freeze({
  name: 'registre-public',
  url: 'https://registre-public.com/api/mcp',
});

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.piecemaker.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function readToml(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const value = TOML.parse(fs.readFileSync(filePath, 'utf8'));
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function writeToml(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.piecemaker.tmp`;
  fs.writeFileSync(temporaryPath, TOML.stringify(value), { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

export function installDefaultConnectors(userHome = os.homedir()) {
  const claudePath = path.join(userHome, '.claude.json');
  const claudeConfig = readJson(claudePath);
  const claudeServers = claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object' && !Array.isArray(claudeConfig.mcpServers)
    ? claudeConfig.mcpServers
    : {};
  const claudeAdded = !Object.prototype.hasOwnProperty.call(claudeServers, REGISTRE_PUBLIC_CONNECTOR.name);
  if (claudeAdded) {
    claudeConfig.mcpServers = {
      ...claudeServers,
      [REGISTRE_PUBLIC_CONNECTOR.name]: {
        type: 'http',
        url: REGISTRE_PUBLIC_CONNECTOR.url,
      },
    };
    writeJson(claudePath, claudeConfig);
  }

  const codexPath = path.join(userHome, '.codex', 'config.toml');
  const codexConfig = readToml(codexPath);
  const codexServers = codexConfig.mcp_servers && typeof codexConfig.mcp_servers === 'object' && !Array.isArray(codexConfig.mcp_servers)
    ? codexConfig.mcp_servers
    : {};
  const codexAdded = !Object.prototype.hasOwnProperty.call(codexServers, REGISTRE_PUBLIC_CONNECTOR.name);
  if (codexAdded) {
    codexConfig.mcp_servers = {
      ...codexServers,
      [REGISTRE_PUBLIC_CONNECTOR.name]: {
        url: REGISTRE_PUBLIC_CONNECTOR.url,
      },
    };
    writeToml(codexPath, codexConfig);
  }

  return { claudeAdded, codexAdded };
}
