export function catalaDocumentation(content: string): {
  entries: Array<{ startLine: number; endLine: number; doc: string; hasDoc: boolean; title: string; source: string; citation: string; question: string }>;
  errors: Array<{ line: number; message: string }>;
};
