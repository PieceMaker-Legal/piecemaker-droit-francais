import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { agentApi } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import type { AgentDecision, AgentMessage, AgentOutput, AgentState, AgentWidget } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import { PROVIDER_LABELS } from '@/modules/piecemaker-workspace-tabs/agent/agentFormat';
import { openAgentOutput } from '@/modules/piecemaker-workspace-tabs/agent/openAgentOutput';
import type { AgentActions } from '@/modules/piecemaker-workspace-tabs/agent/useAgentState';

const cardClass = 'rounded-xl border border-border bg-muted/40 px-3 py-3';
const secondaryButton = 'rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-40';
const primaryButton = 'rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40';

function DecisionCard({ decision, origin, act }: { decision: AgentDecision; origin?: string; act: AgentActions }) {
  return <div className={cardClass} data-decision={decision.id}>
    {origin && <p className="mb-1 text-xs text-muted-foreground">{origin}</p>}
    <p className="text-sm font-medium text-foreground">{decision.question}</p>
    {decision.reason && <p className="mt-1 text-xs text-muted-foreground">{decision.reason}</p>}
    <div className="mt-3 space-y-2">
      {decision.options.map((option, index) => <button key={option.label} type="button"
        disabled={decision.chosen !== null || decision.withdrawn || Boolean(decision.closedBy)}
        aria-pressed={decision.chosen === index}
        onClick={() => void act('decision', { decisionId: decision.id, option: index })}
        className="block w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-accent">
        <span className="text-sm text-foreground">{option.label}{decision.chosen === index && ' ✓'}</span>
        {index === decision.recommended && <span className="ml-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-[11px] text-blue-600 dark:text-blue-300">Recommandée</span>}
        <span className="mt-0.5 block text-xs text-muted-foreground">{option.consequence}</span>
      </button>)}
    </div>
  </div>;
}

function WidgetCard({ widget, messageId, act }: { widget: AgentWidget; messageId: string; act: AgentActions }) {
  const [draft, setDraft] = useState(widget.state?.text ?? widget.draft?.body ?? '');
  const buttons = widget.buttons ?? (widget.draft ? [{ action_id: 'envoyer', label: 'Envoyer', style: 'primary' as const }] : []);
  return <div className={cardClass}>
    {widget.title && <p className="text-sm font-medium text-foreground">{widget.title}</p>}
    {widget.body && <div className="prose prose-sm mt-1 max-w-none text-sm dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{widget.body}</ReactMarkdown></div>}
    {widget.steps && <ul>{widget.steps.map((step, index) => <li key={index}>{step.label} · {{ todo: 'À faire', doing: 'En cours', done: 'Terminé' }[step.status]}</li>)}</ul>}
    {widget.rows && <table><thead><tr><th />{widget.columns?.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
      <tbody>{widget.rows.map((row, index) => <tr key={index}><th>{row.label}</th>{row.cells.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table>}
    {widget.draft && <>
      {(widget.draft.to || widget.draft.subject) && <p className="mt-2 text-xs text-muted-foreground">{[widget.draft.to, widget.draft.subject].filter(Boolean).join(' · ')}</p>}
      <textarea aria-label="Brouillon" disabled={Boolean(widget.state?.clicked)} value={draft} onChange={(event) => setDraft(event.target.value)} rows={6}
        className="mt-2 w-full resize-y rounded-lg border border-border bg-background p-2 text-sm text-foreground outline-none" />
    </>}
    <div className="mt-3 flex flex-wrap gap-2">
      {buttons.map((button) => <button key={button.action_id} type="button" disabled={Boolean(widget.state?.clicked)} className={button.style === 'primary' ? primaryButton : secondaryButton}
        onClick={() => void act('widget', { messageId, actionId: button.action_id, text: widget.draft ? draft : undefined })}>{button.label}{widget.state?.clicked === button.action_id && ' ✓'}</button>)}
    </div>
  </div>;
}

function Request({ title, detail, accept, onAnswer }: { title: string; detail: string; accept: string; onAnswer: (yes: boolean) => void }) {
  return <div className={cardClass}>
    <p className="text-sm font-medium text-foreground">{title}</p>
    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-2 text-xs text-muted-foreground">{detail}</pre>
    <div className="mt-3 flex gap-2"><button type="button" className={primaryButton} onClick={() => onAnswer(true)}>{accept}</button><button type="button" className={secondaryButton} onClick={() => onAnswer(false)}>Refuser</button></div>
  </div>;
}

function MessageCard({ message, act }: { message: AgentMessage; act: AgentActions }) {
  if (message.approval) return <Request title={`Autorisation demandée : ${message.approval.toolName}`} detail={JSON.stringify(message.approval.input, null, 2)} accept="Autoriser"
    onAnswer={(allow) => void act('approval', { messageId: message.id, allow })} />;
  if (message.folderRequest) return <Request title="Accès à un dossier" detail={message.folderRequest.folder} accept="Autoriser"
    onAnswer={(allow) => void act('folder', { messageId: message.id, allow })} />;
  if (message.setup) return <Request title="Mise en route du projet" accept="Accepter"
    detail={[message.setup.instructions, ...message.setup.threads.map((item) => `• ${item.title}`)].filter(Boolean).join('\n')}
    onAnswer={(accept) => void act('setup', { messageId: message.id, accept })} />;
  if (message.widget) return <WidgetCard widget={message.widget} messageId={message.id} act={act} />;
  if (!message.connect) return null;
  const target = PROVIDER_LABELS[message.connect.target] ?? message.connect.target;
  return <div className={cardClass}>
    <p className="text-sm text-foreground">{message.connect.reason || `${target} n’est pas connecté.`}</p>
    <button type="button" className={`${secondaryButton} mt-3`} onClick={() => window.dispatchEvent(new CustomEvent('piecemaker:open-settings', { detail: { tab: 'agents' } }))}>
      {message.connect.reconnect ? 'Reconnecter' : 'Connecter'} {target}
    </button>
  </div>;
}

export function pendingCards(state: AgentState) {
  const connected = new Set(state.providers.filter((provider) => provider.authenticated).map((provider) => provider.provider as string));
  const connects = new Set<string>();
  const messages = [...state.messages].reverse().filter((message) => {
    if (message.approval) return message.approval.status === 'pending';
    if (message.folderRequest) return message.folderRequest.status === 'pending';
    if (message.setup) return message.setup.status === 'pending';
    if (message.widget) return Boolean(message.widget.buttons?.length || message.widget.draft) && !message.widget.state?.clicked;
    if (!message.connect || connected.has(message.connect.target) || connects.has(message.connect.target)) return false;
    connects.add(message.connect.target);
    return true;
  });
  const decisions = state.decisions.filter((decision) => decision.chosen === null && !decision.closedBy && !decision.withdrawn);
  return { messages, decisions, count: messages.length + decisions.length };
}

export function AgentCards({ state, act }: { state: AgentState; act: AgentActions }) {
  const { messages, decisions } = pendingCards(state);
  return <div className="space-y-2">
    {decisions.map((decision) => <DecisionCard key={decision.id} decision={decision} act={act}
      origin={decision.owner === 'orchestrator' ? undefined : state.threads.find((thread) => decision.owner !== 'orchestrator' && thread.id === decision.owner.threadId)?.title} />)}
    {messages.map((message) => <MessageCard key={message.id} message={message} act={act} />)}
  </div>;
}

export type AgentChatCardData = { messageId: string; widget?: AgentWidget; decisions: AgentDecision[]; outputs: AgentOutput[] };

export function AgentChatCard({ card, project }: { card: AgentChatCardData; project: string }) {
  const [error, setError] = useState('');
  const act: AgentActions = async (path, body = {}) => {
    try {
      setError('');
      return await agentApi.post(path, project, body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  };
  return <div className="space-y-2">
    {card.outputs.map((output, index) => <button key={index} type="button" className={secondaryButton} onClick={() => openAgentOutput(project, output)}>{output.title || output.ref}</button>)}
    {card.widget && <WidgetCard widget={card.widget} messageId={card.messageId} act={act} />}
    {card.decisions.map(decision => <DecisionCard key={decision.id} decision={decision} act={act} />)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
