export function catalaDocumentation(content: string, options?: { test?: boolean; contract?: boolean }): {
  entries: Array<{ startLine: number; endLine: number; doc: string; hasDoc: boolean; title: string }>;
  errors: Array<{ line: number; message: string }>;
};
export function clauseHeading(title: string, next: string, contract?: boolean): boolean;
