import type { IProviderMcp } from '@/shared/interfaces.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';

export class MistralMcpProvider implements IProviderMcp {
  async listServers(_options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>> {
    return { user: [], local: [], project: [] };
  }

  async listServersForScope(_scope: McpScope, _options?: { workspacePath?: string }): Promise<ProviderMcpServer[]> {
    return [];
  }

  async upsertServer(_input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    throw new Error('Mistral MCP not yet implemented');
  }

  async removeServer(_input: { name: string; scope?: McpScope; workspacePath?: string }): Promise<{ removed: boolean; provider: 'mistral'; name: string; scope: McpScope }> {
    return { removed: false, provider: 'mistral', name: '', scope: 'user' };
  }
}
