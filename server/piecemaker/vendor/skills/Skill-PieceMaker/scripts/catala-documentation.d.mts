export function catalaDocumentation(content: string, options?: { test?: boolean }): {
  entries: Array<{ startLine: number; endLine: number; doc: string; hasDoc: boolean; title: string }>;
  errors: Array<{ line: number; message: string }>;
};
