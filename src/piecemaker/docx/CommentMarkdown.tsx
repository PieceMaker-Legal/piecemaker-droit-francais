import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const COMMENT_TEXT_SELECTOR = '.docx-comment-card div[style*="line-height: 20px"]:not(.docx-comment-markdown)';
const MARKDOWN_PLUGINS = [remarkGfm, remarkBreaks];
const hosts = new WeakMap<HTMLElement, HTMLElement>();

export function CommentMarkdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{children}</ReactMarkdown>;
}

function markdownHost(text: HTMLElement) {
  const host = hosts.get(text) ?? document.createElement('div');
  if (text.nextElementSibling !== host) text.after(host);
  hosts.set(text, host);
  host.setAttribute('style', text.getAttribute('style') ?? '');
  host.className = 'docx-comment-markdown';
  text.classList.add('docx-comment-text-source');
  return host;
}

export function commentTextHosts(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(COMMENT_TEXT_SELECTOR)]
    .map((text) => ({ text: text.textContent ?? '', host: markdownHost(text) }));
}
