import { useCallback, useEffect, useRef, useState } from 'react';

import { checkDocxDocumentReasoning } from '@/modules/docx-reasoning/api';
import type { DocxReasoningCheckState, DocxReasoningReport } from '@/modules/docx-reasoning/api';

function reportFrom(value: unknown): DocxReasoningReport {
  if (value && typeof value === 'object' && 'status' in value && ['unlinked', 'tested', 'review', 'error'].includes(String(value.status))) return value as DocxReasoningReport;
  return { status: 'error', message: 'Le contrôle du document est indisponible.' };
}

export function useDocxReasoning() {
  const generation = useRef(0);
  const [state, setState] = useState<DocxReasoningCheckState>({ phase: 'idle', report: null });
  const reset = useCallback(() => {
    generation.current += 1;
    setState({ phase: 'idle', report: null });
  }, []);
  useEffect(() => () => { generation.current += 1; }, []);
  const dirty = useCallback(() => {
    generation.current += 1;
    setState((previous) => ({ ...previous, phase: 'dirty' }));
  }, []);
  const begin = useCallback(() => {
    const ticket = ++generation.current;
    setState((previous) => ({ ...previous, phase: 'checking' }));
    return ticket;
  }, []);
  const publish = useCallback((ticket: number, report: unknown) => {
    if (ticket === generation.current) setState({ phase: 'ready', report: reportFrom(report) });
  }, []);
  const failed = useCallback((ticket: number, error: unknown) => {
    publish(ticket, { status: 'error', message: error instanceof Error ? error.message : String(error) });
  }, [publish]);
  const check = useCallback(async (projectId: string, filePath: string, version: number) => {
    const ticket = begin();
    try {
      const result = await checkDocxDocumentReasoning(projectId, filePath);
      if (ticket !== generation.current) return;
      if (result.version !== version) { dirty(); return; }
      publish(ticket, result.reasoning);
    } catch (error) { failed(ticket, error); }
  }, [begin, dirty, failed, publish]);
  return { state, reset, dirty, begin, publish, failed, check };
}
