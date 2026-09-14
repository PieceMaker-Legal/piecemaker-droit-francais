import { Fragment, createElement, useCallback, useMemo } from 'react';
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react';

import type { SlashCommand } from '@/shared/types';

type UseSlashCommandPillsOptions = {
  slashCommands: SlashCommand[];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  renderBase: (text: string) => ReactNode;
};

const isSkillCommand = (command: SlashCommand) =>
  command.type === 'skill' || command.metadata?.type === 'skill';

const readSkillName = (command: SlashCommand) => {
  const metadataSkillName = command.metadata?.skillName;
  if (typeof metadataSkillName === 'string' && metadataSkillName.trim()) {
    return metadataSkillName.trim().replace(/^[/\$]/, '');
  }

  const namespaceSeparator = command.name.lastIndexOf(':');
  if (namespaceSeparator >= 0 && namespaceSeparator < command.name.length - 1) {
    return command.name.slice(namespaceSeparator + 1);
  }

  return command.name.replace(/^[/\$]/, '');
};

export function displaySkillLabel(command: SlashCommand) {
  const prefix = command.name.startsWith('$') ? '$' : '/';
  return `${prefix}${readSkillName(command)}`;
}

export function useSlashCommandPills({
  slashCommands,
  renderBase,
}: UseSlashCommandPillsOptions) {
  const skillCommandNames = useMemo(
    () => new Set(slashCommands.filter(isSkillCommand).map((command) => command.name)),
    [slashCommands],
  );

  const renderInputWithCommandPills = useCallback(
    (text: string) => {
      if (!text || skillCommandNames.size === 0) {
        return renderBase(text);
      }

      const renderedParts: ReactNode[] = [];
      const tokenPattern = /\S+/g;
      let cursor = 0;
      let tokenMatch: RegExpExecArray | null;

      while ((tokenMatch = tokenPattern.exec(text)) !== null) {
        const token = tokenMatch[0];
        const tokenStart = tokenMatch.index;

        if (tokenStart > cursor) {
          renderedParts.push(
            createElement(Fragment, { key: `text-${cursor}` }, renderBase(text.slice(cursor, tokenStart))),
          );
        }

        renderedParts.push(
          skillCommandNames.has(token)
            ? createElement(
                'span',
                {
                  key: `command-${tokenStart}`,
                  className: '-ml-0.5 rounded-md bg-violet-200/70 box-decoration-clone px-0.5 text-transparent dark:bg-violet-300/40',
                },
                token,
              )
            : createElement(Fragment, { key: `text-${tokenStart}` }, renderBase(token)),
        );
        cursor = tokenStart + token.length;
      }

      if (cursor < text.length) {
        renderedParts.push(
          createElement(Fragment, { key: `text-${cursor}` }, renderBase(text.slice(cursor))),
        );
      }

      return renderedParts;
    },
    [renderBase, skillCommandNames],
  );

  return { renderInputWithCommandPills };
}
