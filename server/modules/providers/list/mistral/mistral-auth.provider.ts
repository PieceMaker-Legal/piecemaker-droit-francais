import {
  currentVibeCliHost,
  findVibeApiKey,
  isVibeInstalled,
  type VibeCliHost,
} from '@/shared/vibe-cli.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

export class MistralProviderAuth implements IProviderAuth {
  constructor(private readonly host: () => VibeCliHost = currentVibeCliHost) {}

  async getStatus(): Promise<ProviderAuthStatus> {
    const host = this.host();

    if (!isVibeInstalled(host)) {
      return {
        installed: false,
        provider: 'mistral',
        authenticated: false,
        email: null,
        method: null,
        error: 'Mistral Vibe CLI is not installed',
      };
    }

    const source = findVibeApiKey(host);

    return {
      installed: true,
      provider: 'mistral',
      authenticated: source !== null,
      email: source ? 'Mistral API key' : null,
      method: source ? 'api_key' : null,
      error: source ? undefined : 'Not logged in. Run vibe --setup',
    };
  }
}
