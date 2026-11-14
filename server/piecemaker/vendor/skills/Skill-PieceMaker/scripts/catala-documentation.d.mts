export function catalaDocumentation(content: string, options?: { test?: boolean }): {
  entries: Array<{ startLine: number; endLine: number; doc: string; hasDoc: boolean; title: string }>;
  errors: Array<{ line: number; message: string }>;
};
export function premiseCases(content: string): Array<{ name: string; type: string; line: number }>;
export function premiseSource(name: string): string;
export function premiseValues(content: string): Array<{ name: string; expression: string; line: number }>;
