import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type { AgentOutput, AgentState } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import { age, cronLabel, PROVIDER_LABELS } from '@/modules/piecemaker-workspace-tabs/agent/agentFormat';
import type { AgentActions } from '@/modules/piecemaker-workspace-tabs/agent/useAgentState';

type ScheduledArtifact = { ref: string; title: string; at: string };
type ScheduledItem = {
  id: string;
  kind: 'reminder' | 'once' | 'cron';
  title: string;
  explanation: string;
  recurrence: string;
  at: string | null;
  artifact: ScheduledArtifact | null;
};

function latestArtifact(state: AgentState, threadIds: Set<string>): ScheduledArtifact | null {
  const found: ScheduledArtifact[] = [];
  const named = (output: AgentOutput) => output.title ?? state.artifacts.find((artifact) => artifact.url === output.ref)?.title ?? 'Artéfact';
  for (const thread of state.threads) {
    if (!threadIds.has(thread.id)) continue;
    for (const reply of thread.replies) {
      for (const output of reply.outputs ?? []) if (output.kind === 'artifact') found.push({ ref: output.ref, title: named(output), at: reply.at });
    }
  }
  for (const deliverable of state.deliverables) {
    if (deliverable.kind === 'artifact' && deliverable.threadId && threadIds.has(deliverable.threadId)) found.push({ ref: deliverable.ref, title: deliverable.title, at: deliverable.updatedAt });
  }
  return found.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

function scheduledItems(state: AgentState): ScheduledItem[] {
  const threadsTitled = (title: string) => new Set(state.threads.filter((thread) => thread.title === title).map((thread) => thread.id));
  return [
    ...state.threads.filter((thread) => thread.reminderAt).map((thread): ScheduledItem => ({
      id: thread.id, kind: 'reminder', title: thread.title, explanation: 'Rappel sur ce fil de discussion.',
      recurrence: 'Une seule fois', at: thread.reminderAt, artifact: latestArtifact(state, new Set([thread.id])),
    })),
    ...state.schedules.filter((schedule) => schedule.kind === 'cron' || !schedule.lastFiredAt).map((schedule): ScheduledItem => schedule.kind === 'cron'
      ? {
          id: schedule.id, kind: 'cron', title: schedule.thread?.title ?? 'Routine',
          explanation: [schedule.thread?.instructions, schedule.thread?.provider ? `Fournisseur : ${PROVIDER_LABELS[schedule.thread.provider]}` : ''].filter(Boolean).join('\n\n'),
          recurrence: schedule.cron ? cronLabel(schedule.cron) : 'Récurrente', at: schedule.nextRunAt,
          artifact: schedule.thread ? latestArtifact(state, threadsTitled(schedule.thread.title)) : null,
        }
      : {
          id: schedule.id, kind: 'once', title: schedule.text.split('\n')[0] || 'Message différé', explanation: schedule.text,
          recurrence: 'Une seule fois', at: schedule.nextRunAt, artifact: null,
        }),
  ].sort((a, b) => (a.at ?? '~').localeCompare(b.at ?? '~'));
}

export function AgentScheduled({ state, act, onOpenArtifact }: { state: AgentState; act: AgentActions; onOpenArtifact: (url: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const items = scheduledItems(state);
  if (!items.length) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune tâche planifiée.</p>;
  return <ul className="px-3 py-3">{items.map((item) => {
    const open = openId === item.id;
    return <li key={item.id} className="border-b border-border py-1">
      <button type="button" aria-expanded={open} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent" onClick={() => setOpenId(open ? null : item.id)}>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">{item.title}</span>
      </button>
      {open && <div className="flex gap-3 px-2 pb-3 pt-1">
        {item.artifact && <button type="button" aria-label={`Ouvrir l’artéfact : ${item.artifact.title}`} onClick={() => onOpenArtifact(item.artifact!.ref)}
          className="flex w-32 shrink-0 flex-col overflow-hidden rounded-xl border border-border text-left hover:border-ring">
          <span className="h-20 w-full bg-gradient-to-br from-muted to-muted/30" />
          <span className="px-2 pt-1.5 text-sm leading-snug text-foreground line-clamp-2">{item.artifact.title}</span>
          <span className="px-2 pb-1.5 text-xs text-muted-foreground">{age(item.artifact.at)}</span>
        </button>}
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          {item.explanation && <p className="whitespace-pre-wrap text-foreground/80">{item.explanation}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>Répétition</dt><dd className="text-foreground/80">{item.recurrence}</dd>
            <dt>Prochaine</dt><dd className="text-foreground/80">{item.at ? <time dateTime={item.at}>{new Date(item.at).toLocaleString('fr-FR')}</time> : 'Aucune prochaine exécution'}</dd>
          </dl>
          <button type="button" className="rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent" aria-label={`Annuler : ${item.title}`}
            onClick={() => void act('schedule/cancel', { kind: item.kind, id: item.id })}>Annuler</button>
        </div>
      </div>}
    </li>;
  })}</ul>;
}
