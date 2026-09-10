import spawn from 'cross-spawn';

import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

type AnyRecord = Record<string, unknown>;

export class MistralProviderRuntime implements IProviderRuntime {
  /**
   * Checks whether the mistral CLI is available on this host.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('vibe', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  async run(
    _command: string,
    _options: AnyRecord,
    _writer: ProviderRuntimeWriter,
    _context: ProviderRuntimeContext,
  ): Promise<unknown> {
    throw new Error('Mistral runtime not yet implemented');
  }

  async abort(_sessionId: string): Promise<boolean> {
    return false;
  }
}

export const mistralRuntime = new MistralProviderRuntime();
