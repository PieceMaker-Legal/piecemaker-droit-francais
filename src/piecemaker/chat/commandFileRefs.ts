const SHELL_TOKEN = /[^\s"'`|;&<>()]+/g;
const NON_PATH = /[()<>{}[\]=;,"'`|*?!$&]|:\/\//;
const FILE_EXTENSION = /[^.]\.(?=[a-z0-9]{1,10}$)[a-z0-9]*[a-z][a-z0-9]*$/i;

export type CommandFileRef = { start: number; end: number; path: string };

const stripLineSuffix = (value: string) => value.replace(/:\d+(?::\d+)?$/, '');

function looksLikeCommandFileRef(value: string): boolean {
  const cleaned = stripLineSuffix(value.trim());
  if (!cleaned || NON_PATH.test(cleaned)) return false;
  const lastSegment = cleaned.split(/[\\/]/).pop() ?? '';
  return FILE_EXTENSION.test(lastSegment);
}

/** Chemins cités dans une commande, au même critère qu'un nom de fichier entre backticks. */
export function commandFileRefs(command: string): CommandFileRef[] {
  const refs: CommandFileRef[] = [];
  SHELL_TOKEN.lastIndex = 0;
  let match = SHELL_TOKEN.exec(command);
  while (match) {
    const raw = match[0];
    const trimmed = raw.replace(/[.,]+$/, '');
    const path = stripLineSuffix(trimmed);
    if (looksLikeCommandFileRef(path)) {
      refs.push({ start: match.index, end: match.index + path.length, path });
    }
    match = SHELL_TOKEN.exec(command);
  }
  return refs;
}
