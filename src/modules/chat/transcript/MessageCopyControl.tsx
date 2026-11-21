import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '@/shared/types';
import { copyTextToClipboard } from '@/shared/utils';

type CopyFormat = 'text' | 'markdown';

const INTERACTIVE_TARGET = 'a, button, input, textarea, select, summary, label, [role="button"], [role="link"], [contenteditable], [data-chat-pick]';

// Converts markdown into readable plain text for "Copy as text".
const convertMarkdownToPlainText = (markdown: string): string => {
  let plainText = markdown.replace(/\r\n/g, '\n');
  const codeBlocks: string[] = [];
  plainText = plainText.replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, code: string) => {
    const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push(code.replace(/\n$/, ''));
    return placeholder;
  });
  plainText = plainText.replace(/`([^`]+)`/g, '$1');
  plainText = plainText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1');
  plainText = plainText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  plainText = plainText.replace(/^>\s?/gm, '');
  plainText = plainText.replace(/^#{1,6}\s+/gm, '');
  plainText = plainText.replace(/^[-*+]\s+/gm, '');
  plainText = plainText.replace(/^\d+\.\s+/gm, '');
  plainText = plainText.replace(/(\*\*|__)(.*?)\1/g, '$2');
  plainText = plainText.replace(/(\*|_)(.*?)\1/g, '$2');
  plainText = plainText.replace(/~~(.*?)~~/g, '$1');
  plainText = plainText.replace(/<\/?[^>]+(>|$)/g, '');
  plainText = plainText.replace(/\n{3,}/g, '\n\n');
  plainText = plainText.replace(/@@CODEBLOCK(\d+)@@/g, (_match, index: string) => codeBlocks[Number(index)] ?? '');
  return plainText.trim();
};

/**
 * Rendered by chat's MessageComponent to copy a turn to the clipboard, with a
 * markdown/plain-text format picker.
 */
const MessageCopyControl = ({
  content,
  children,
  className,
  'data-message-timestamp': timestamp,
}: {
  content?: string;
  children: ReactNode;
  className?: string;
  'data-message-timestamp'?: ChatMessage['timestamp'];
}) => {
  const { t } = useTranslation('chat');
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties | null>(null);
  const [copied, setCopied] = useState(false);

  const closeMenu = () => {
    setMenuPosition(null);
    setCopied(false);
  };

  useEffect(() => {
    if (!menuPosition) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && event.target !== triggerRef.current) {
        closeMenu();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuRef.current?.contains(document.activeElement)) {
        triggerRef.current?.focus({ preventScroll: true });
      }
      closeMenu();
    };

    window.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [menuPosition]);

  const openMenu = (x: number, y: number) => {
    setCopied(false);
    setMenuPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - 136)),
      ...(y + 88 > window.innerHeight
        ? { bottom: window.innerHeight - y + 4 }
        : { top: y + 4 }),
    });
  };

  const handleMessageClick = (event: MouseEvent<HTMLDivElement>) => {
    const { target, currentTarget } = event;
    if (event.defaultPrevented || event.button !== 0 || event.detail > 1
      || !(target instanceof Element) || !currentTarget.contains(target)
      || target.closest(INTERACTIVE_TARGET) || window.getSelection()?.isCollapsed === false) {
      return;
    }
    openMenu(event.clientX, event.clientY);
  };

  const handleCopy = async (format: CopyFormat) => {
    if (!content) return;
    const payload = format === 'markdown' ? content : convertMarkdownToPlainText(content);
    if (payload.trim() && await copyTextToClipboard(payload)) {
      setCopied(true);
    }
  };

  const enabled = Boolean(content?.trim());
  const copyLabel = t('copyMessage.copy');

  return (
    <div
      className={enabled ? `relative ${className ?? ''}` : className}
      data-message-timestamp={timestamp}
      onClick={enabled ? handleMessageClick : undefined}
    >
      {enabled && (
        <button
          ref={triggerRef}
          type="button"
          className="sr-only z-10 rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground focus-visible:not-sr-only focus-visible:absolute focus-visible:right-0 focus-visible:top-0"
          aria-expanded={Boolean(menuPosition)}
          aria-controls={menuPosition ? menuId : undefined}
          onClick={(event) => {
            if (menuPosition) {
              closeMenu();
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.right - 128, rect.bottom);
          }}
        >
          {copyLabel}
        </button>
      )}
      {children}
      {enabled && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="group"
          aria-label={copyLabel}
          data-escape-layer
          style={menuPosition}
          className="fixed z-[1000] w-32 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const buttons = event.currentTarget.querySelectorAll('button');
            if (event.target === buttons[event.shiftKey ? 0 : buttons.length - 1]) {
              triggerRef.current?.focus({ preventScroll: true });
              closeMenu();
            }
          }}
        >
          <div aria-live="polite" className="px-1 text-xs font-medium">
            {copied ? t('copyMessage.copied') : copyLabel}
          </div>
          <div className="mt-1 flex gap-1">
            <button
              ref={(button) => {
                if (document.activeElement === triggerRef.current) button?.focus({ preventScroll: true });
              }}
              type="button"
              aria-label={t('copyMessage.copyAsText')}
              className="flex-1 rounded px-1 py-1 text-xs hover:bg-accent focus-visible:bg-accent"
              onClick={() => void handleCopy('text')}
            >
              {t('copyMessage.textShort', { defaultValue: 'TXT' })}
            </button>
            <button
              type="button"
              aria-label={t('copyMessage.copyAsMarkdown')}
              className="flex-1 rounded px-1 py-1 text-xs hover:bg-accent focus-visible:bg-accent"
              onClick={() => void handleCopy('markdown')}
            >
              {t('copyMessage.markdownShort', { defaultValue: 'MD' })}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default MessageCopyControl;
