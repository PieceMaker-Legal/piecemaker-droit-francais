import { stat } from 'node:fs/promises';
import path from 'node:path';

import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, stringify } from 'yaml';
import type { Node } from 'yaml';

import { LiteralError, parseLiteral, printLiteral } from './format.js';

export async function resolveReasoningFile(cwd: string): Promise<string> {
  const yaml = path.join(cwd, '.piecemaker', 'raisonnement.yaml');
  const js = path.join(cwd, '.piecemaker', 'raisonnement.js');
  const exists = (file: string) => stat(file).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (await exists(yaml)) return yaml;
  return await exists(js) ? js : yaml;
}

export function parseReasoningDocument(text: string, format?: 'js' | 'yaml') {
  const selected = format ?? (/^\s*(?:\{|export\s+default|module\.exports\s*=)/u.test(text) ? 'js' : 'yaml');
  if (selected === 'js') return { ...parseLiteral(text), format: selected };
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true, lineCounter });
  const issue = document.errors[0] ?? document.warnings[0];
  if (issue) throw new LiteralError(issue.message.replace(/\n[\s\S]*/, ''), lineCounter.linePos(issue.pos[0]).line);
  if (document.comment || document.commentBefore) throw new LiteralError('pas de commentaire : le raisonnement s’écrit uniquement avec ses clés', 1);
  const lines = new Map<string, number>();
  const ancestors = new Set<Node>();
  const convert = (node: Node | null | undefined, at: string): unknown => {
    const line = node?.range ? lineCounter.linePos(node.range[0]).line : lines.get(at) ?? 1;
    lines.set(at, line);
    if (!node) return null;
    if (ancestors.has(node)) throw new LiteralError('boucle entre les alias YAML', line);
    if (node.comment || node.commentBefore) throw new LiteralError('pas de commentaire : le raisonnement s’écrit uniquement avec ses clés', line);
    ancestors.add(node);
    try {
      if (isAlias(node)) {
        const target = node.resolve(document);
        if (!target) throw new LiteralError(`alias YAML inconnu : ${node.source}`, line);
        return convert(target, at);
      }
      if (isMap(node)) {
        const entries = node.items.map((pair) => {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') throw new LiteralError('clé textuelle attendue', line);
          if (pair.key.comment || pair.key.commentBefore) throw new LiteralError('pas de commentaire : le raisonnement s’écrit uniquement avec ses clés', pair.key.range ? lineCounter.linePos(pair.key.range[0]).line : line);
          const key = pair.key.value;
          const route = at ? `${at}.${key}` : key;
          const value = convert(pair.value as Node | null, route);
          lines.set(route, pair.key.range ? lineCounter.linePos(pair.key.range[0]).line : line);
          return [key, value] as const;
        });
        return Object.fromEntries(entries);
      }
      if (isSeq(node)) return node.items.map((item, index) => convert(item as Node | null, `${at}[${index}]`));
      if (isScalar(node) && (node.value === null || ['string', 'boolean', 'number'].includes(typeof node.value))) {
        if (typeof node.value === 'number' && !Number.isFinite(node.value)) throw new LiteralError('nombre fini attendu', line);
        return node.value;
      }
      throw new LiteralError('objet, liste, texte, nombre, true/false ou null attendu', line);
    } finally {
      ancestors.delete(node);
    }
  };
  return { value: convert(document.contents, ''), lines, format: selected };
}

export function printReasoningDocument(value: unknown, format: 'js' | 'yaml'): string {
  return format === 'js' ? printLiteral(value) : stringify(value, { schema: 'core', version: '1.2', lineWidth: 0, blockQuote: 'literal', aliasDuplicateObjects: false }).trimEnd();
}
