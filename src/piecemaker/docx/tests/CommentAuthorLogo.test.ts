import { describe, expect, it } from 'vitest';

import { aiAvatarHosts } from '@/piecemaker/docx/CommentAuthorLogo';

function card(author: string) {
  return `<div style="display: flex;"><div style="border-radius: 50%;">${author.slice(0, 2)}</div><div><div>${author}</div></div></div>`;
}

describe('aiAvatarHosts', () => {
  it('keeps only the avatars of comments written by Claude, Codex or Mistral', () => {
    const container = document.createElement('div');
    container.innerHTML = `<div class="docx-unified-sidebar">${['Claude', 'Jean Dupont', 'Codex', 'Mistral'].map(card).join('')}</div>`;
    const hosts = aiAvatarHosts(container);
    expect(hosts.map(({ provider }) => provider)).toEqual(['claude', 'codex', 'mistral']);
    expect(hosts.every(({ host }) => host.classList.contains('docx-comment-avatar-ai'))).toBe(true);
    expect(container.querySelectorAll('.docx-comment-avatar-ai')).toHaveLength(3);
  });
});
