export function catalaDocumentation(content: string, options?: { test?: boolean }): {
  entries: Array<{ startLine: number; endLine: number; doc: string; hasDoc: boolean; title: string }>;
  errors: Array<{ line: number; message: string }>;
};
export function scenarioFacts(content: string, options?: { test?: boolean }): Array<{ line: number; variable: string; value: string; source: string }>;
