import type { SlashCommand } from '@/shared/types';

import { displaySkillLabel } from '@/piecemaker/chat/useSlashCommandPills';

const isSkillCommand = (command: SlashCommand) =>
  command.type === 'skill' || command.metadata?.type === 'skill';

/**
 * CloudCLI's CommandMenu renders `command.name` verbatim, so Claude-plugin
 * skills show up as `/plugin-name:skill-name` in the dropdown — the namespace
 * CloudCLI needs internally to keep same-named skills from different plugins
 * apart, but not something a user should have to read.
 *
 * `command.name` must stay untouched here: CloudCLI's own `handleCommandSelect`
 * / `insertCommandIntoInput` insert and execute whatever `.name` the selected
 * command carries, so renaming it would break both. This only stamps a
 * `metadata.displayLabel`, read by the small CommandMenu patch that shows it
 * instead of `.name` when present — the exact command still gets inserted
 * and executed unchanged.
 */
export function prepareCommandMenuCommands(commands: SlashCommand[]): SlashCommand[] {
  return commands.map((command) => {
    if (!isSkillCommand(command)) {
      return command;
    }

    return {
      ...command,
      metadata: {
        ...command.metadata,
        displayLabel: displaySkillLabel(command),
      },
    };
  });
}
