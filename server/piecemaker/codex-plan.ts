import type { CodexOptions } from '@openai/codex-sdk';

import type { providerRuntimeService } from '@/modules/providers/index.js';
import { readPlanCommand } from '@/modules/providers/list/mistral/mistral-plan-command.js';

const PLAN_INSTRUCTIONS = [
  'Collaboration mode: Plan.',
  'Explore and read as needed, but do not modify, move, create or delete any file.',
  'Deliver your final plan wrapped exactly in <proposed_plan> and </proposed_plan> tags, each on its own line, with nothing after the closing tag.',
  'Keep the tags unchanged even when the plan is written in another language.',
].join(' ');

export function withCodexPlanMode(codexOptions: CodexOptions | undefined): CodexOptions {
  return { ...codexOptions, config: { ...codexOptions?.config, developer_instructions: PLAN_INSTRUCTIONS } };
}

export function installCodexPlanRuntime(runtime: Pick<typeof providerRuntimeService, 'run'>) {
  const run = runtime.run.bind(runtime);
  runtime.run = async (provider, command, options, writer) => {
    if (provider !== 'codex') return run(provider, command, options, writer);
    const planCommand = readPlanCommand(command);
    if (!planCommand.plan && options.permissionMode !== 'plan') return run(provider, command, options, writer);
    return run(provider, planCommand.plan ? planCommand.prompt : command, {
      ...options,
      permissionMode: 'plan',
      libraryCodexOptions: withCodexPlanMode(options.libraryCodexOptions as CodexOptions | undefined),
    }, writer);
  };
}
