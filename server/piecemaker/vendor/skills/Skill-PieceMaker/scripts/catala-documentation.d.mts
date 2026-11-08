export function catalaDocumentation(content: string): {
  entries: Array<{ startLine: number; endLine: number; doc: string; hasDoc: boolean }>;
  errors: Array<{ line: number; message: string }>;
};
