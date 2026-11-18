import { MCP_PROVIDER_NAMES } from '@/shared/constants';

const AVATAR_SELECTOR = '.docx-unified-sidebar div[style*="border-radius: 50%"]';
const AI_PROVIDERS = ['claude', 'codex', 'mistral'] as const;
type AiProvider = (typeof AI_PROVIDERS)[number];

function aiProvider(author: string): AiProvider | null {
  const name = author.trim().toLowerCase();
  return AI_PROVIDERS.find((provider) => MCP_PROVIDER_NAMES[provider].toLowerCase() === name) ?? null;
}

export function aiAvatarHosts(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(AVATAR_SELECTOR)].flatMap((host) => {
    const provider = aiProvider(host.nextElementSibling?.firstElementChild?.textContent ?? '');
    host.classList.toggle('docx-comment-avatar-ai', provider !== null);
    return provider ? [{ provider, host }] : [];
  });
}
