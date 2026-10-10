const BLOCK_START = '# PieceMaker : historique du dossier (début)';
const BLOCK_END = '# PieceMaker : historique du dossier (fin)';

const IGNORED_DIRECTORIES = ['.git', '.piecemaker', '.claude', '.codex', '.cursor', '.grok', '.opencode', '.vibe', '.agents', 'node_modules'];
const IGNORED_FILES = ['.DS_Store', '.env', '.env.*', '*.env', '~$*', '.~lock.*', '*.lock', '*.tmp', 'mapping*.json', '*_sensitive_map.json'];
const SENSITIVE_FILES = ['.env', '.env.*', '*.env', 'mapping*.json', '*_sensitive_map.json'];

const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');

const ignoredFilePatterns = IGNORED_FILES.map(globToRegExp);
const sensitiveFilePatterns = SENSITIVE_FILES.map(globToRegExp);

const segmentsOf = (relativePath: string) => relativePath.split(/[\\/]+/).filter(Boolean);

export function excludeBlock(): string {
  return [
    BLOCK_START,
    ...IGNORED_DIRECTORIES.filter((directory) => directory !== '.git').map((directory) => `${directory}/`),
    ...IGNORED_FILES,
    BLOCK_END,
  ].join('\n');
}

export function hasExcludeBlock(content: string): boolean {
  return content.includes(BLOCK_START) && content.includes(BLOCK_END);
}

export function withExcludeBlock(content: string): string {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  if (start >= 0 && end > start) {
    return `${content.slice(0, start)}${excludeBlock()}${content.slice(end + BLOCK_END.length)}`;
  }
  const prefix = content && !content.endsWith('\n') ? `${content}\n` : content;
  return `${prefix}${excludeBlock()}\n`;
}

export function isIgnoredPath(relativePath: string): boolean {
  const segments = segmentsOf(relativePath);
  if (segments.length === 0) return true;
  if (segments.some((segment) => IGNORED_DIRECTORIES.includes(segment))) return true;
  const name = segments[segments.length - 1];
  return ignoredFilePatterns.some((pattern) => pattern.test(name));
}

export function isSensitivePath(relativePath: string): boolean {
  const segments = segmentsOf(relativePath);
  if (segments.includes('.piecemaker')) return true;
  const name = segments[segments.length - 1] ?? '';
  return sensitiveFilePatterns.some((pattern) => pattern.test(name));
}
