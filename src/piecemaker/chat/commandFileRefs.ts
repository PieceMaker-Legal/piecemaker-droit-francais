// Un argument entre quotes, ou un mot dont les espaces sont échappés par `\`.
const SHELL_WORD = /"([^"\n]+)"|'([^'\n]+)'|((?:\\ |[^\s"'`|;&<>()])+)/g;
// Un chemin a un séparateur, une extension ou commence par `~` ; une adresse n'en est pas un.
const PATH_LIKE = /[\\/.~]/;
const NOT_A_PATH = /:\/\/|^-/;

export type CommandFileRef = { start: number; end: number; path: string };

/**
 * Candidats chemins d'une commande. Ce ne sont que des candidats : seul le
 * serveur dit si le fichier existe, comme les liens fichier de VS Code.
 */
export function commandFileRefs(command: string): CommandFileRef[] {
  const refs: CommandFileRef[] = [];
  for (const match of command.matchAll(SHELL_WORD)) {
    const quoted = match[1] ?? match[2];
    const word = quoted ?? match[3].replace(/[.,]+$/, '');
    const path = quoted ?? word.replace(/\\ /g, ' ');
    if (!PATH_LIKE.test(path) || NOT_A_PATH.test(path)) continue;
    const start = match.index + (quoted === undefined ? 0 : 1);
    refs.push({ start, end: start + word.length, path });
  }
  return refs;
}
