const PLAN_COMMAND = /(^|\s)\/plan(?=\s|$)/g;

export function readPlanCommand(prompt: string): { prompt: string; plan: boolean } {
  const stripped = prompt.replace(PLAN_COMMAND, '$1');
  if (stripped === prompt) return { prompt, plan: false };
  const cleaned = stripped.replace(/[ \t]{2,}/g, ' ').trim();
  return { prompt: cleaned || prompt.trim(), plan: true };
}
