export function catalaDocumentation(content: string, options?: { test?: boolean }): {
  entries: Array<{ startLine: number; endLine: number; doc: string; hasDoc: boolean; title: string }>;
  errors: Array<{ line: number; message: string }>;
};
export function scenarioFacts(content: string, options?: { test?: boolean }): Array<{ line: number; variable: string; value: string; source: string }>;
export const NO_PREMISE: RegExp;
export function premiseCoverage(files: Array<{ name: string; content: string }>, options?: { exists?: (source: string) => boolean }): {
  inputs: Array<{ name: string; file: string; line: number; context: boolean }>;
  errors: Array<{ file: string; line: number; input: string; message: string; origin?: { file: string; line: number } }>;
  warnings: Array<{ file: string; line: number; input: string; message: string }>;
  used: string[];
  cited: string[];
  mentions: Array<{ file: string; line: number; source: string }>;
};
