import { readFile } from 'node:fs/promises';
import path from 'node:path';

import spawn from 'cross-spawn';

import { getHermesHome, getHermesRoot } from '@/modules/providers/list/hermes/hermes-home.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { CliVersionProbe, ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

export class HermesProviderAuth implements IProviderAuth {
  checkInstalled(): CliVersionProbe {
    const cliPath = process.env.HERMES_CLI_PATH || 'hermes acp';
    const [command, ...args] = cliPath.trim().split(/\s+/);
    try {
      const result = spawn.sync(command || 'hermes', [...args, '--version'], { encoding: 'utf8', timeout: 5000 });
      if (result.error) return { installed: false, exitCode: null, version: null };
      const version = /\d+\.\d+\.\d+[^\s]*/.exec(`${result.stdout ?? ''}`)?.[0] ?? null;
      return { installed: result.status === 0 || result.status === null, exitCode: result.status, version };
    } catch {
      return { installed: false, exitCode: null, version: null };
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const { installed, version: installedVersion } = this.checkInstalled();
    if (!installed) {
      return {
        provider: 'hermes',
        installed: false,
        installedVersion: null,
        authenticated: false,
        email: null,
        method: null,
        error: 'Hermes is not installed',
      };
    }

    const credentials = await this.checkCredentials();
    return {
      provider: 'hermes',
      installed,
      installedVersion,
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method ?? 'managed_by_hermes',
      error: undefined,
    };
  }

  private async checkCredentials(): Promise<{ authenticated: boolean; email: string | null; method: string | null }> {
    if (this.hasKnownProviderEnv(process.env)) {
      return { authenticated: true, email: 'API Key Auth', method: 'env' };
    }

    const hermesHome = getHermesHome();
    // A named profile can read single-use OAuth grants from the root profile.
    for (const authHome of new Set([hermesHome, getHermesRoot()])) {
      try {
        const authJson = readObjectRecord(JSON.parse(await readFile(path.join(authHome, 'auth.json'), 'utf8')));
        const providers = readObjectRecord(authJson?.providers) ?? {};
        const pools = readObjectRecord(authJson?.credential_pool) ?? {};
        const credentials = [authJson, ...Object.values(providers), ...Object.values(pools).flatMap((pool) => Array.isArray(pool) ? pool : [])];
        if (credentials.some((value) => {
          const record = readObjectRecord(value);
          return record?.last_status !== 'dead' && ['apiKey', 'api_key', 'token', 'access_token', 'refresh_token']
            .some((key) => readOptionalString(record?.[key]));
        })) {
          return {
            authenticated: true,
            email: readOptionalString(authJson?.email) ?? 'Hermes Auth',
            method: 'credentials_file',
          };
        }
      } catch {
        // Try the next home, then the dotenv check.
      }
    }

    try {
      const envContent = await readFile(path.join(hermesHome, '.env'), 'utf8');
      if (this.hasKnownProviderEnv(this.parseEnvFile(envContent))) {
        return { authenticated: true, email: 'API Key Auth', method: 'env_file' };
      }
    } catch {
      // Fall through.
    }

    try {
      const configContent = await readFile(path.join(hermesHome, 'config.yaml'), 'utf8');
      if (/^\s*api_key\s*:\s*["']?[^"'#\s]+/m.test(configContent)) {
        return { authenticated: true, email: 'Hermes Config', method: 'config_file' };
      }
    } catch {
      // Fall through.
    }

    return { authenticated: false, email: null, method: null };
  }

  private parseEnvFile(content: string): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && value) {
        parsed[key] = value;
      }
    }
    return parsed;
  }

  private hasKnownProviderEnv(env: Record<string, string | undefined>): boolean {
    const keys = [
      'HERMES_API_KEY',
      'NOUS_API_KEY',
      'OPENROUTER_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_API_KEY',
      'GEMINI_API_KEY',
      'GLM_API_KEY',
      'KIMI_API_KEY',
      'MINIMAX_API_KEY',
      'MINIMAX_CN_API_KEY',
      'HF_TOKEN',
      'NVIDIA_API_KEY',
      'ARCEEAI_API_KEY',
      'OLLAMA_API_KEY',
      'KILOCODE_API_KEY',
      'GITHUB_TOKEN',
    ];
    return keys.some((key) => Boolean(env[key]?.trim()));
  }
}
