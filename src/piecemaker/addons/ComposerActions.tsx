import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Layers3, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import i18n from '@/modules/i18n/config';
import { Button } from '@/shared/ui';
import { downloadAddonsDocument, getAddonsQuickActions, getAddonsWorkflow, getOrganisationAgent, getOrganisationAgents } from '@/piecemaker/addons/api';
import { DocumentPickerDialog } from '@/piecemaker/addons/pickers/DocumentPickerDialog';
import { WorkflowPickerDialog } from '@/piecemaker/addons/pickers/WorkflowPickerDialog';
import type { AddonsWorkflow } from '@/piecemaker/addons/types';

type AddonsQuickAction = {
  id: string;
  name?: string | null;
  prompt?: string | null;
  document_upload: boolean;
  enabled: boolean;
  workflow: AddonsWorkflow;
};

type ComposerActionsProps = {
  enabled: boolean;
};

type OrganisationAgent = {
  path: string;
  name: string;
  content?: string;
};

export function appendAddonsWorkflowDraft(workflow: AddonsWorkflow, prompt?: string | null, agents: OrganisationAgent[] = []) {
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-slot="prompt-input-textarea"]');
  if (!textarea) return;
  const instructions = workflow.skill_md?.trim();
  const context = [
    i18n.t('addons:composer.workflowSelected', { title: workflow.metadata.title }),
    instructions ? i18n.t('addons:composer.workflowInstructions', { instructions }) : '',
    agents.some((agent) => agent.content) ? i18n.t('addons:composer.subAgentsContext', { list: agents.filter((agent) => agent.content).map((agent) => `## ${agent.name}\n${agent.content}`).join('\n\n') }) : '',
    prompt?.trim() ? i18n.t('addons:composer.requestPrefix', { prompt: prompt.trim() }) : '',
  ].filter(Boolean).join('\n\n');
  const draft = [textarea.value.trim(), context].filter(Boolean).join('\n\n');
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(textarea, draft);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

export function AddonsComposerActions({ enabled }: ComposerActionsProps) {
  const { t } = useTranslation('addons');
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [quickActions, setQuickActions] = useState<AddonsQuickAction[]>([]);
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [agents, setAgents] = useState<OrganisationAgent[]>([]);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const refreshTarget = () => setTarget(enabled ? document.querySelector<HTMLElement>('[data-slot="prompt-input"]') : null);
    refreshTarget();
    const observer = new MutationObserver(refreshTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void getAddonsQuickActions().then(async (actions) => {
      if (cancelled) return;
      const resolved = await Promise.all((actions as AddonsQuickAction[]).filter((action) => action.enabled).slice(0, 4).map(async (action) => ({ ...action, workflow: await getAddonsWorkflow(action.workflow.id) as AddonsWorkflow })));
      if (!cancelled) setQuickActions(resolved.filter((action) => action.workflow.metadata?.type === 'assistant'));
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : t('errors.quickActionsUnavailable')); });
    return () => { cancelled = true; };
  }, [enabled, t]);

  const openPicker = () => {
    setError('');
    setWorkflowPickerOpen(true);
  };

  const selectWorkflow = (workflow: AddonsWorkflow, prompt?: string | null) => {
    setWorkflowPickerOpen(false);
    appendAddonsWorkflowDraft(workflow, prompt, agents);
  };

  const selectQuickAction = (action: AddonsQuickAction) => {
    selectWorkflow(action.workflow, action.prompt);
    if (!action.document_upload) return;
    setError('');
    setDocumentPickerOpen(true);
  };

  const attachDocuments = (documentIds: string[]) => {
    setDocumentPickerOpen(false);
    setError('');
    void Promise.all(documentIds.map(downloadAddonsDocument)).then((files) => {
      const form = document.querySelector<HTMLFormElement>('[data-slot="prompt-input"]');
      if (!form || !files.length) return;
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      form.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : t('errors.documentsCannotBeAttached')));
  };

  const loadAgents = () => {
    setError('');
    void getOrganisationAgents().then((available) => setAgents((current) => current.length ? current : available)).then(() => setAgentsOpen(true)).catch((cause) => setError(cause instanceof Error ? cause.message : t('errors.subAgentsUnavailable')));
  };

  const addAgent = (agent: OrganisationAgent) => {
    if (agent.content) return;
    setError('');
    void getOrganisationAgent(agent.path).then((loaded) => {
      setAgents((current) => current.map((item) => item.path === agent.path ? { ...item, content: loaded.content } : item));
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-slot="prompt-input-textarea"]');
      if (!textarea) return;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      descriptor?.set?.call(textarea, `${textarea.value.trim()}\n\n${t('composer.subAgentContext', { name: agent.name, content: loaded.content })}`.trim());
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    }).catch((cause) => setError(cause instanceof Error ? cause.message : t('errors.subAgentUnavailable')));
  };

  if (!enabled || !target) return null;
  return <>
    {createPortal(<div data-pm-addons-composer-actions="true" className="mb-3 flex flex-col items-center gap-2 px-2 text-center">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={openPicker}>
          <Layers3 className="h-3.5 w-3.5" />
          {t('composer.workflowButton')}
        </Button>
        {quickActions.map((action) => <button key={action.id} type="button" onClick={() => selectQuickAction(action)} className="inline-flex h-8 items-center justify-center rounded-full border border-border/70 bg-background px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground">
          {action.name?.trim() || action.workflow.metadata.title}
        </button>)}
        <div className="relative">
          <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={loadAgents}>
            <Bot className="h-3.5 w-3.5" />
            {t('composer.subAgentsButton')}
          </Button>
          {agentsOpen && <div className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-lg border border-border bg-popover p-2 text-left shadow-lg">
            <div className="mb-1 flex items-center justify-between px-1 text-xs font-medium text-muted-foreground"><span>{t('composer.subAgentsPopoverTitle')}</span><button type="button" onClick={() => setAgentsOpen(false)}>{t('common.close')}</button></div>
            {agents.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">{t('composer.noSubAgents')}</p> : agents.map((agent) => <button key={agent.path} type="button" onClick={() => addAgent(agent)} disabled={!!agent.content} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"><span className="truncate">{agent.name}</span><span>{agent.content ? t('composer.added') : t('composer.add')}</span></button>)}
          </div>}
        </div>
      </div>
      {quickActions.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Sparkles className="h-3 w-3" />{t('composer.quickActionsLabel')}</span>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>, target.parentElement ?? target)}
    <WorkflowPickerDialog open={workflowPickerOpen} onClose={() => setWorkflowPickerOpen(false)} onSelect={selectWorkflow} />
    <DocumentPickerDialog open={documentPickerOpen} onClose={() => setDocumentPickerOpen(false)} onConfirm={attachDocuments} />
  </>;
}
