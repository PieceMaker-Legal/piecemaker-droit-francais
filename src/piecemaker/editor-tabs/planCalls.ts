import { openInEditor, planPath, readPlan, storePlan } from '@/piecemaker/editor-tabs/editorPanels';

export type PlanCall =
  | { kind: 'proposed' | 'written'; file: string | null; markdown: string }
  | { kind: 'edited'; file: string; find: string; replace: string; all: boolean };

type Input = Record<string, unknown>;

const PLAN_FILE = /[\\/]\.[^\\/]+[\\/]plans[\\/][^\\/]+\.md$/;
const WRITE_TOOLS = new Set(['Write', 'write_file']);
const EDIT_TOOLS = new Set(['Edit', 'edit']);

const str = (value: unknown): string => typeof value === 'string' ? value : '';

function readInput(value: unknown): Input {
  if (typeof value === 'string') {
    try {
      return readInput(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? value as Input : {};
}

export function planCall(toolName: string, toolInput: unknown): PlanCall | null {
  const input = readInput(toolInput);
  if (toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode') {
    return { kind: 'proposed', file: str(input.planFilePath) || null, markdown: str(input.plan).trim() };
  }
  const file = str(input.file_path) || str(input.path);
  if (!PLAN_FILE.test(file)) return null;
  if (WRITE_TOOLS.has(toolName)) return { kind: 'written', file, markdown: str(input.content).trim() };
  if (EDIT_TOOLS.has(toolName) && str(input.old_string)) {
    return { kind: 'edited', file, find: str(input.old_string), replace: str(input.new_string), all: input.replace_all === true };
  }
  return null;
}

function applyEdit(plan: Extract<PlanCall, { kind: 'edited' }>) {
  const current = readPlan(plan.file);
  if (current === null || !current.includes(plan.find)) return;
  storePlan(plan.file, plan.all ? current.split(plan.find).join(plan.replace) : current.replace(plan.find, () => plan.replace));
}

export function showPlan(plan: PlanCall, fallbackId: string) {
  const id = plan.file ?? fallbackId;
  if (plan.kind === 'edited') applyEdit(plan);
  else if (plan.markdown) storePlan(id, plan.markdown);
  if (readPlan(id) !== null) openInEditor(planPath(id));
}
