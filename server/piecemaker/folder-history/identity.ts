export type Identity = { name: string; email: string };

const PROVIDER_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  mistral: 'Mistral',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

export function agentIdentity(provider: string, model?: unknown): Identity {
  const label = PROVIDER_NAMES[provider] ?? provider;
  const modelName = typeof model === 'string' ? model.trim() : '';
  return { name: modelName ? `${label} ${modelName}` : label, email: `${provider}@localhost` };
}
