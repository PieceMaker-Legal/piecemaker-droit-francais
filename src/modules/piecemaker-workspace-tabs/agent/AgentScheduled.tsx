import { useState } from 'react';

import type { AgentOutput, AgentState } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import { age, cronLabel, PROVIDER_LABELS } from '@/modules/piecemaker-workspace-tabs/agent/agentFormat';
import { Section } from '@/modules/piecemaker-workspace-tabs/agent/AgentSection';
import type { AgentActions } from '@/modules/piecemaker-workspace-tabs/agent/useAgentState';

type ScheduledArtifact = { ref: string; title: string; at: string };
type ScheduledItem = {
  id: string;
  kind: 'reminder' | 'once' | 'cron';
  title: string;
  explanation: string;
  recurrence: string;
  at: string | null;
  inactiveSince: string | null;
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
      recurrence: 'Une seule fois', at: thread.reminderAt, inactiveSince: null, artifact: latestArtifact(state, new Set([thread.id])),
    })),
    ...state.schedules.map((schedule): ScheduledItem => schedule.kind === 'cron'
      ? {
          id: schedule.id, kind: 'cron', title: schedule.thread?.title ?? 'Routine',
          explanation: [schedule.thread?.instructions, schedule.thread?.provider ? `Fournisseur : ${PROVIDER_LABELS[schedule.thread.provider]}` : ''].filter(Boolean).join('\n\n'),
          recurrence: schedule.cron ? cronLabel(schedule.cron) : 'Récurrente', at: schedule.nextRunAt, inactiveSince: schedule.stoppedAt ?? null,
          artifact: schedule.thread ? latestArtifact(state, threadsTitled(schedule.thread.title)) : null,
        }
      : {
          id: schedule.id, kind: 'once', title: schedule.text.split('\n')[0] || 'Message différé', explanation: schedule.text,
          recurrence: 'Une seule fois', at: schedule.nextRunAt, inactiveSince: schedule.stoppedAt ?? schedule.lastFiredAt, artifact: null,
        }),
  ].sort((a, b) => (a.at ?? '~').localeCompare(b.at ?? '~'));
}

function ScheduledRow({ item, open, onToggle, act, onOpenArtifact }: { item: ScheduledItem; open: boolean; onToggle: () => void; act: AgentActions; onOpenArtifact: (url: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const inactive = item.inactiveSince !== null;
  return <li className="rounded-xl px-2 py-2 hover:bg-accent" data-scheduled={item.id}>
    <button type="button" aria-expanded={open} className="flex w-full items-center gap-3 text-left" onClick={() => { setConfirming(false); onToggle(); }}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${inactive ? 'bg-zinc-500' : 'bg-blue-500'}`} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{age(item.inactiveSince)}</span>
    </button>
    {open && <div className="ml-5 mt-2 flex gap-3">
      {item.artifact && <button type="button" aria-label={`Ouvrir l’artéfact : ${item.artifact.title}`} onClick={() => onOpenArtifact(item.artifact!.ref)}
        className="flex w-32 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background text-left hover:border-ring">
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
        {!inactive && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" aria-label={`Arrêter : ${item.title}`}
          onClick={() => void act('schedule/cancel', { kind: item.kind, id: item.id })}>Arrêter</button>}
        {inactive && !confirming && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" aria-label={`Supprimer : ${item.title}`} onClick={() => setConfirming(true)}>Supprimer</button>}
        {inactive && confirming && <div role="alertdialog" aria-label={`Supprimer ${item.title} ?`} className="flex items-center gap-3 text-xs">
          <span className="text-foreground">Supprimer définitivement cette tâche ?</span>
          <button type="button" className="rounded-md bg-red-500/15 px-2 py-1 text-red-500 hover:bg-red-500/25" onClick={() => void act('schedule/delete', { kind: item.kind, id: item.id })}>Confirmer</button>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setConfirming(false)}>Garder</button>
        </div>}
      </div>
    </div>}
  </li>;
}

export function AgentScheduled({ state, act, onOpenArtifact }: { state: AgentState; act: AgentActions; onOpenArtifact: (url: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const items = scheduledItems(state);
  if (!items.length) return <p className="px-4 py-8 text-center text-xs text-muted-foreground">Aucune tâche planifiée.</p>;
  const groups: Array<[string, ScheduledItem[]]> = [['Actives', items.filter((item) => item.inactiveSince === null)], ['Inactif', items.filter((item) => item.inactiveSince !== null).sort((a, b) => b.inactiveSince!.localeCompare(a.inactiveSince!))]];
  return <div className="px-3 py-3">{groups.filter(([, list]) => list.length).map(([title, list]) => <Section key={title} title={title} count={list.length}>
    <ul className="-ml-6">{list.map((item) => <ScheduledRow key={item.id} item={item} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} act={act} onOpenArtifact={onOpenArtifact} />)}</ul>
  </Section>)}</div>;
}
