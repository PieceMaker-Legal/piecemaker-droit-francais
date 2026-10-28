import { UnlinkedDocxError, verifyDocxReasoning } from './docx-reasoning.js';

export async function checkDocxReasoning(input: Uint8Array, cwd = '') {
  try {
    const result = await verifyDocxReasoning(input, {
      cwd, reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(), online: false,
      connectors: {
        source: async () => undefined,
        match: (source: string, quote: string) => source.includes(quote) ? quote : null,
        registry: async () => { throw new Error('Registre non relu par le contrôle local.'); },
        bodacc: async () => [],
      },
    });
    if (!result.verification) return { status: 'review' as const, changed: result.changed, context: result.context, sources: 'offline' as const };
    return {
      status: 'tested' as const,
      issues: result.verification.issues.filter((issue) => issue.kind !== 'conseil').map(({ kind, path, text }) => ({ kind, path, text })),
      objectives: result.verification.annotated?.objectifs,
      sources: 'offline' as const,
    };
  } catch (error) {
    if (error instanceof UnlinkedDocxError) return { status: 'unlinked' as const };
    return { status: 'error' as const, message: error instanceof Error ? error.message : String(error), sources: 'offline' as const };
  }
}
