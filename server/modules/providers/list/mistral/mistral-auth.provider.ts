import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

type MistralLoginStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class MistralProviderAuth implements IProviderAuth {
  private getExecutable(): string {
    const configuredPath = process.env.MISTRAL_CLI_PATH?.trim();
    if (configuredPath) {
      return configuredPath;
    }

    const bundledPath = path.join(
      os.homedir(),
      '.mistral',
      'bin',
      process.platform === 'win32' ? 'mistral.exe' : 'mistral',
    );

    return fs.existsSync(bundledPath) ? bundledPath : 'mistral';
  }

  /**
   * Checks whether the mistral CLI is available on this host.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync(this.getExecutable(), ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns Mistral CLI installation and login status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();

    if (!installed) {
      return {
        installed,
        provider: 'mistral',
        authenticated: false,
        email: null,
        method: null,
        error: 'Mistral CLI is not installed',
      };
    }

    const login = await this.checkMistralLogin();

    return {
      installed,
      provider: 'mistral',
      authenticated: login.authenticated,
      email: login.email,
      method: login.method,
      error: login.authenticated ? undefined : login.error || 'Not logged in',
    };
  }

  /**
   * Runs `mistral whoami --json` and parses the OAuth identity from stdout.
   */
  private checkMistralLogin(): Promise<MistralLoginStatus> {
    return new Promise((resolve) => {
      let processCompleted = false;
      let childProcess: ReturnType<typeof spawn> | undefined;

      const timeout = setTimeout(() => {
        if (!processCompleted) {
          processCompleted = true;
          childProcess?.kill();
          resolve({
            authenticated: false,
            email: null,
            method: null,
            error: 'Command timeout',
          });
        }
      }, 5000);

      try {
        childProcess = spawn(this.getExecutable(), ['whoami', '--json']);
      } catch {
        clearTimeout(timeout);
        processCompleted = true;
        resolve({
          authenticated: false,
          email: null,
          method: null,
          error: 'Mistral CLI not found or not installed',
        });
        return;
      }

      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        if (processCompleted) {
          return;
        }
        processCompleted = true;
        clearTimeout(timeout);

        if (code === 0) {
          let identity: { email?: unknown; user?: { email?: unknown } } | null = null;
          try {
            const parsed = JSON.parse(stdout.trim()) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              identity = parsed as { email?: unknown; user?: { email?: unknown } };
            }
          } catch {
            // Older CLI versions may return a human-readable identity.
          }

          const jsonEmail = typeof identity?.email === 'string'
            ? identity.email
            : typeof identity?.user?.email === 'string'
              ? identity.user.email
              : null;
          const emailMatch = stdout.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
          const email = jsonEmail || emailMatch?.[1] || null;
          if (email) {
            resolve({ authenticated: true, email, method: 'oauth2' });
            return;
          }

          // Fallback: any non-empty stdout without an explicit "not logged in" style error
          // means whoami succeeded (exit code 0) and the user is authenticated.
          if (stdout.trim().length > 0) {
            resolve({ authenticated: true, email: 'Mistral account', method: 'oauth2' });
            return;
          }

          resolve({ authenticated: false, email: null, method: null, error: 'Not logged in' });
          return;
        }

        resolve({ authenticated: false, email: null, method: null, error: stderr || 'Not logged in' });
      });

      childProcess.on('error', () => {
        if (processCompleted) {
          return;
        }
        processCompleted = true;
        clearTimeout(timeout);

        resolve({
          authenticated: false,
          email: null,
          method: null,
          error: 'Mistral CLI not found or not installed',
        });
      });
    });
  }
}
