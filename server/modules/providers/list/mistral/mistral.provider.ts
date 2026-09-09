import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { MistralProviderAuth } from '@/modules/providers/list/mistral/mistral-auth.provider.js';
import { MistralMcpProvider } from '@/modules/providers/list/mistral/mistral-mcp.provider.js';
import { MistralProviderModels } from '@/modules/providers/list/mistral/mistral-models.provider.js';
import { mistralRuntime } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import { MistralSkillsProvider } from '@/modules/providers/list/mistral/mistral-skills.provider.js';
import { MistralSessionsProvider } from '@/modules/providers/list/mistral/mistral-sessions.provider.js';
import { MistralSessionSynchronizer } from '@/modules/providers/list/mistral/mistral-session-synchronizer.provider.js';
import type {
  IProviderAuth,
  IProviderMcp,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

/**
 * Mistral AI provider implementation.
 * Supports OAuth2 authentication via the Mistral CLI.
 */
export class MistralProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = mistralRuntime;
  readonly models: IProviderModels = new MistralProviderModels();
  readonly mcp: IProviderMcp = new MistralMcpProvider();
  readonly auth: IProviderAuth = new MistralProviderAuth();
  readonly skills: IProviderSkills = new MistralSkillsProvider();
  readonly sessions: IProviderSessions = new MistralSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new MistralSessionSynchronizer();

  constructor() {
    super('mistral');
  }
}
