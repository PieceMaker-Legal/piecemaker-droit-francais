import { CornerDownRight, File, Link2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { AgentDecision, AgentMessage as Message, AgentOutput, AgentState, AgentThread, AgentWidget } from '@/modules/piecemaker-agent/api';
import { openSession, PROVIDER_LABELS, THREAD_STATE_COLORS, THREAD_STATE_LABELS } from '@/modules/piecemaker-agent/format';
import type { AgentActions } from '@/modules/piecemaker-agent/useAgentState';

type Props = { message: Message; state: AgentState; act: AgentActions; ack: boolean; onOpenOutput: (output: AgentOutput) => void };

const cardClass = 'mt-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3';
const secondaryButton = 'rounded-lg bg-white/10 px-3 py-1.5 text-sm text-zinc-100 hover:bg-white/15 disabled:opacity-40';
const primaryButton = 'rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-40';

function Markdown({ text }: { text: string }) {
  return <div className="pm-agent-markdown text-[15px] leading-7 text-zinc-100">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a> }}>{text}</ReactMarkdown>
  </div>;
}

export function ThreadCard({ thread }: { thread: AgentThread }) {
  return <button type="button" disabled={!thread.sessionId} onClick={() => thread.sessionId && openSession(thread.sessionId)}
    className="mt-3 flex w-full max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left hover:bg-white/[0.06]">
    <Sparkles className="h-4 w-4 shrink-0 text-zinc-400" />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium text-zinc-100">{thread.title}</span>
      <span className="block truncate text-xs text-zinc-400">{PROVIDER_LABELS[thread.provider]} · {thread.ackThread}</span>
    </span>
    <span className="flex items-center gap-1.5 text-xs text-zinc-300"><span className={`h-2 w-2 rounded-full ${THREAD_STATE_COLORS[thread.state]}`} />{THREAD_STATE_LABELS[thread.state]}</span>
  </button>;
}

function DecisionCard({ decision, act }: { decision: AgentDecision; act: AgentActions }) {
  return <div className={cardClass} data-decision={decision.id}>
    <p className="text-sm font-medium text-zinc-100">{decision.question}</p>
    {decision.reason && <p className="mt-1 text-xs text-zinc-400">{decision.reason}</p>}
    <div className="mt-3 space-y-2">
      {decision.options.map((option, index) => <button key={option.label} type="button" disabled={Boolean(decision.closedBy)}
        onClick={() => void act('decision', { decisionId: decision.id, option: index })}
        className={`block w-full rounded-xl border px-3 py-2 text-left ${decision.chosen === index ? 'border-zinc-300 bg-white/10' : 'border-white/10 hover:bg-white/[0.06]'} disabled:cursor-default`}>
        <span className="text-sm text-zinc-100">{option.label}</span>
        {index === decision.recommended && <span className="ml-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-[11px] text-blue-300">Recommandée</span>}
        {decision.chosen === index && <span className="ml-2 text-[11px] text-zinc-400">Choisie</span>}
        <span className="mt-0.5 block text-xs text-zinc-400">{option.consequence}</span>
      </button>)}
    </div>
    {decision.withdrawn && <p className="mt-2 text-xs text-zinc-500">Décision retirée</p>}
  </div>;
}

function WidgetCard({ widget, messageId, act }: { widget: AgentWidget; messageId: string; act: AgentActions }) {
  const [draft, setDraft] = useState(widget.state?.text ?? widget.draft?.body ?? '');
  const buttons = widget.buttons ?? (widget.draft ? [{ action_id: 'envoyer', label: 'Envoyer', style: 'primary' as const }] : []);
  return <div className={cardClass}>
    {widget.title && <p className="text-sm font-medium text-zinc-100">{widget.title}</p>}
    {widget.body && <div className="mt-1"><Markdown text={widget.body} /></div>}
    {widget.draft && <>
      {(widget.draft.to || widget.draft.subject) && <p className="mt-2 text-xs text-zinc-400">{[widget.draft.to, widget.draft.subject].filter(Boolean).join(' · ')}</p>}
      <textarea aria-label="Brouillon" value={draft} onChange={(event) => setDraft(event.target.value)} rows={6}
        className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-zinc-100 outline-none" />
    </>}
    {widget.rows && <table className="mt-2 w-full text-left text-sm text-zinc-200">
      <thead><tr><th />{(widget.columns ?? []).map((column) => <th key={column} className="px-2 py-1 font-medium text-zinc-400">{column}</th>)}</tr></thead>
      <tbody>{widget.rows.map((row) => <tr key={row.label} className="border-t border-white/10"><th className="px-2 py-1 font-medium">{row.label}</th>{row.cells.map((cell, index) => <td key={index} className="px-2 py-1">{cell}</td>)}</tr>)}</tbody>
    </table>}
    {widget.steps && <ol className="mt-2 space-y-1 text-sm">{widget.steps.map((step) => <li key={step.label} className="flex items-center gap-2 text-zinc-200">
      <span className={`h-2 w-2 rounded-full ${step.status === 'done' ? 'bg-emerald-500' : step.status === 'doing' ? 'bg-blue-500' : 'bg-zinc-600'}`} />{step.label}</li>)}</ol>}
    {buttons.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
      {buttons.map((button) => <button key={button.action_id} type="button" aria-pressed={widget.state?.clicked === button.action_id}
        className={button.style === 'primary' ? primaryButton : secondaryButton}
        onClick={() => void act('widget', { messageId, actionId: button.action_id, text: widget.draft ? draft : undefined })}>{button.label}</button>)}
    </div>}
  </div>;
}

function Approval({ title, detail, status, accept, onAnswer }: { title: string; detail: string; status: string; accept: string; onAnswer: (yes: boolean) => void }) {
  const done: Record<string, string> = { allowed: 'Autorisé', denied: 'Refusé', accepted: 'Acceptée', declined: 'Refusée', resolved: 'Traitée' };
  return <div className={cardClass}>
    <p className="text-sm font-medium text-zinc-100">{title}</p>
    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-2 text-xs text-zinc-300">{detail}</pre>
    {status === 'pending'
      ? <div className="mt-3 flex gap-2"><button type="button" className={primaryButton} onClick={() => onAnswer(true)}>{accept}</button><button type="button" className={secondaryButton} onClick={() => onAnswer(false)}>Refuser</button></div>
      : <p className="mt-2 text-xs text-zinc-400">{done[status] ?? status}</p>}
  </div>;
}

function OutputCard({ output, onOpen }: { output: AgentOutput; onOpen: (output: AgentOutput) => void }) {
  const Icon = output.kind === 'link' ? Link2 : output.kind === 'artifact' ? Sparkles : File;
  return <button type="button" onClick={() => onOpen(output)} className="mr-2 mt-3 inline-flex max-w-xs items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/[0.06]">
    <Icon className="h-4 w-4 shrink-0 text-zinc-400" /><span className="truncate">{output.title ?? output.ref}</span>
  </button>;
}

export function AgentMessage({ message, state, act, ack, onOpenOutput }: Props) {
  const thread = message.threadId ? state.threads.find((item) => item.id === message.threadId) : undefined;
  const decisions = message.decisionIds.map((id) => state.decisions.find((item) => item.id === id)).filter((item): item is AgentDecision => Boolean(item));
  const userReactions = new Set(message.reactions.filter((reaction) => reaction.by === 'user').map((reaction) => reaction.emoji));
  const shown = [...new Set(message.reactions.map((reaction) => reaction.emoji))];

  if (message.author === 'user') {
    return <article className="group flex flex-col items-end py-3" data-author="user" data-message={message.id}>
      <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-white/[0.08] px-4 py-2.5 text-[15px] leading-7 text-zinc-100">{message.text}</div>
      {shown.length > 0 && <div className="mt-1 flex gap-1 text-sm">{shown.map((emoji) => <span key={emoji}>{emoji}</span>)}</div>}
    </article>;
  }

  return <article className="group py-3" data-author={message.author} data-message={message.id}>
    {thread && !ack && <button type="button" onClick={() => thread.sessionId && openSession(thread.sessionId)} className="mb-1 flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
      <CornerDownRight className="h-3.5 w-3.5" />{thread.title}
    </button>}
    {message.text && (message.author === 'system' ? <p className="text-sm text-zinc-400">{message.text}</p> : <Markdown text={message.text} />)}
    {thread && ack && <ThreadCard thread={thread} />}
    {decisions.map((decision) => <DecisionCard key={decision.id} decision={decision} act={act} />)}
    {message.approval && <Approval title={`Autorisation demandée : ${message.approval.toolName}`} detail={JSON.stringify(message.approval.input, null, 2)} status={message.approval.status} accept="Autoriser"
      onAnswer={(allow) => void act('approval', { messageId: message.id, allow })} />}
    {message.folderRequest && <Approval title="Accès à un dossier" detail={message.folderRequest.folder} status={message.folderRequest.status} accept="Autoriser"
      onAnswer={(allow) => void act('folder', { messageId: message.id, allow })} />}
    {message.setup && <Approval title="Mise en route du projet" status={message.setup.status} accept="Accepter"
      detail={[message.setup.instructions, ...message.setup.threads.map((item) => `• ${item.title}`)].filter(Boolean).join('\n')}
      onAnswer={(accept) => void act('setup', { messageId: message.id, accept })} />}
    {message.widget && <WidgetCard widget={message.widget} messageId={message.id} act={act} />}
    {message.connect && <div className={cardClass}>
      <p className="text-sm text-zinc-200">{message.connect.reason || `${PROVIDER_LABELS[message.connect.target] ?? message.connect.target} n’est pas connecté.`}</p>
      <button type="button" className={`${secondaryButton} mt-3`} onClick={() => window.dispatchEvent(new CustomEvent('piecemaker:open-settings', { detail: { tab: 'agents' } }))}>
        {message.connect.reconnect ? 'Reconnecter' : 'Connecter'} {PROVIDER_LABELS[message.connect.target] ?? message.connect.target}
      </button>
    </div>}
    {message.attachments.length > 0 && <div>{message.attachments.map((output) => <OutputCard key={`${output.kind}:${output.ref}`} output={output} onOpen={onOpenOutput} />)}</div>}
    <div className={`mt-1 flex gap-1 text-sm ${shown.length ? '' : 'opacity-0 group-hover:opacity-100'}`}>
      {[...new Set([...shown, '👍', '👎'])].map((emoji) => <button key={emoji} type="button" aria-pressed={userReactions.has(emoji)}
        className={`rounded-full px-1.5 ${userReactions.has(emoji) ? 'bg-white/15' : 'hover:bg-white/10'}`}
        onClick={() => void act('react', { messageId: message.id, emoji, on: !userReactions.has(emoji) })}>{emoji}</button>)}
    </div>
  </article>;
}
