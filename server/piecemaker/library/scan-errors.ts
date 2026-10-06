export type LibraryScanError = { source: string; message: string };

export function recordScanError(errors: LibraryScanError[] | undefined, source: string, error: unknown) {
  if (!errors) return;
  errors.push({ source, message: error instanceof Error ? error.message : String(error) });
}
