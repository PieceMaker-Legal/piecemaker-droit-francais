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
  /**
   * Checks whether the mistral CLI is available on this host.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('mistral', ['--version'], { stdio: 'ignore', timeout: 5000 });
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
   * Runs mistral auth status and parses the login marker from stdout.
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
        childProcess = spawn('mistral', ['auth', 'status']);
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
          // Parse Mistral auth status output
          const emailMatch = stdout.match(/Email:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
          if (emailMatch?.[1]) {
            resolve({ authenticated: true, email: emailMatch[1], method: 'cli' });
            return;
          }

          // Check for "Logged in" or "Authenticated" indicators
          if (stdout.includes('Logged in') || stdout.includes('Authenticated') || stdout.includes('Active')) {
            resolve({ authenticated: true, email: 'Mistral account', method: 'cli' });
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
