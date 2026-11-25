import type { ChatAttachmentDescriptor } from '@/shared/image-attachments.js';

export const RUNNABLE_PROVIDERS = ['claude', 'codex', 'mistral'] as const;
export type RunnableProvider = typeof RUNNABLE_PROVIDERS[number];
export type ProviderChoice = RunnableProvider | 'auto';
export type ThreadProviderChoice = RunnableProvider | 'chat';

export type ThreadState = 'queued' | 'working' | 'blocked' | 'review_ready' | 'done' | 'failed' | 'stopped';
export const THREAD_STATES: ThreadState[] = ['queued', 'working', 'blocked', 'review_ready', 'done', 'failed', 'stopped'];

export type DeliverableKind = 'document' | 'piece' | 'artifact';
export type DeliverableState = 'brouillon' | 'a_relire' | 'valide';
export const DELIVERABLE_STATES: DeliverableState[] = ['brouillon', 'a_relire', 'valide'];

export type Trust = 'principal' | 'relay' | 'system';

export type Output = { kind: 'file' | 'link' | 'artifact'; ref: string; title?: string };

export type Reaction = { emoji: string; by: 'user' | 'orchestrator' | 'system' };

export type WidgetButton = { action_id: string; label: string; style?: 'primary' | 'secondary' | 'danger' };
export type Widget = {
  type: 'buttons' | 'draft' | 'comparison' | 'steps';
  title?: string;
  body?: string;
  buttons?: WidgetButton[];
  draft?: { to?: string; subject?: string; body: string };
  columns?: string[];
  rows?: Array<{ label: string; cells: string[] }>;
  steps?: Array<{ label: string; status: 'todo' | 'doing' | 'done' }>;
  state?: { clicked?: string; text?: string; at?: string };
};

export type Approval = { threadId: string; requestId: string; toolName: string; input: unknown; status: 'pending' | 'allowed' | 'denied' | 'resolved' };
export type FolderRequest = { threadId: string | null; folder: string; status: 'pending' | 'allowed' | 'denied' };
export type SetupProposal = {
  instructions?: string;
  threads: Array<{ title: string; instructions: string; provider?: ProviderChoice; folder?: string }>;
  status: 'pending' | 'accepted' | 'declined';
};

export type ChatMessage = {
  id: string;
  author: 'user' | 'orchestrator' | 'system';
  authorName?: string;
  text: string;
  at: string;
  editedAt?: string;
  uploads?: ChatAttachmentDescriptor[];
  posted?: boolean;
  notify?: boolean;
  attachments: Output[];
  decisionIds: string[];
  threadId?: string;
  widget?: Widget;
  connect?: { target: string; reconnect: boolean; reason?: string };
  approval?: Approval;
  folderRequest?: FolderRequest;
  setup?: SetupProposal;
  reactions: Reaction[];
};

export type DecisionOption = { label: string; consequence: string };
export type Decision = {
  id: string;
  question: string;
  options: DecisionOption[];
  recommended: number;
  reason?: string;
  chosen: number | null;
  closedBy: 'user' | 'orchestrator' | 'thread' | null;
  withdrawn: boolean;
  owner: { threadId: string } | 'orchestrator';
  at: string;
};

export type ThreadReply = { at: string; text: string; outputs: Output[] };

export type Thread = {
  id: string;
  title: string;
  provider: RunnableProvider;
  model: string;
  effort: string | null;
  projectPath: string;
  sessionId: string | null;
  key: string;
  instructions: string;
  ackProject: string;
  ackThread: string;
  state: ThreadState;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  reminderAt: string | null;
  retries: number;
  replies: ThreadReply[];
  error: string | null;
  pendingRequests: string[];
  inbox: string[];
  external: boolean;
};

export type Deliverable = {
  id: string;
  kind: DeliverableKind;
  ref: string;
  title: string;
  state: DeliverableState;
  threadId: string | null;
  updatedAt: string;
};

export type Schedule = {
  id: string;
  kind: 'once' | 'cron';
  text: string;
  at: string | null;
  cron: string | null;
  thread: { title: string; instructions: string; provider: ProviderChoice; folder?: string } | null;
  lastFiredAt: string | null;
  stoppedAt?: string | null;
  createdAt: string;
};

export type Settings = {
  instructions: string;
  orchestratorProvider: ProviderChoice;
  orchestratorModel: string;
  defaultProvider: ThreadProviderChoice;
  defaultModels: Partial<Record<RunnableProvider, string>>;
  concurrency: Record<RunnableProvider, number>;
  folders: string[];
  recycleAfter: number;
  dream?: DreamSettings;
};

export type DreamSettings = { enabled: boolean; provider: ProviderChoice; model: string; cron: string };

export type DreamRun = { running: boolean; lastRunAt: string | null; lastResult: string | null; lastError: string | null };

export type WakeEventType =
  | 'message' | 'reaction' | 'decision' | 'widget_action' | 'approval' | 'folder_access' | 'setup'
  | 'thread_reply' | 'thread_message' | 'thread_decision' | 'thread_blocked' | 'thread_failed' | 'thread_stopped' | 'thread_retry'
  | 'lookup_result' | 'reminder' | 'send_later' | 'routine' | 'quiet' | 'time_limit' | 'catch_up';

export type WakeEvent = {
  type: WakeEventType;
  trust: Trust;
  at: string;
  text: string;
  messageId?: string;
  threadId?: string;
  attrs?: Record<string, string>;
};

export type OrchestratorState = {
  chatSessionId: string | null;
  chatProvider: RunnableProvider | null;
  recoverPostsFrom?: string;
  needsRecap: boolean;
  heldUpdates: WakeEvent[];
  sessionId: string | null;
  key: string;
  provider: RunnableProvider | null;
  turns: number;
  running: boolean;
  pending: WakeEvent[];
  holdingUntil: string | null;
  quietAt: string | null;
  lastUserAt: string | null;
  postsSinceUser: number;
  userId: number | null;
  recaps: number;
};

export type Lookup = { id: string; sessionId: string; question: string; at: string };

export type ProjectState = {
  version: 1;
  revision: number;
  settings: Settings;
  messages: ChatMessage[];
  decisions: Decision[];
  threads: Thread[];
  deliverables: Deliverable[];
  schedules: Schedule[];
  lookups: Lookup[];
  dream?: DreamRun;
  orchestrator: OrchestratorState;
};

export type Memory = { text: string; revision: number; updatedAt: string | null };

export type ProviderStatus = { provider: RunnableProvider; installed: boolean; authenticated: boolean };

export type PermissionRequest = { requestId: string; toolName: string; input: unknown };

export type TurnResult = { started: boolean; error: string | null };

export type TurnOptions = {
  attachments?: ChatAttachmentDescriptor[];
  provider: RunnableProvider;
  model: string;
  effort: string | null;
  permissionMode: string;
  allowedTools: string[];
  disallowedTools: string[];
};

export type OrchestratorDependencies = {
  now(): Date;
  contextRatio(sessionId: string, provider: RunnableProvider): Promise<number | null>;
  previousPostIds(sessionId: string): Promise<Set<string>>;
  chatChanged(sessionId: string): void;
  changeChatProvider(sessionId: string, provider: RunnableProvider): void;
  sessionModel(sessionId: string): string | null;
  sessionExists?(sessionId: string): boolean;
  providers(userId: number | null): Promise<ProviderStatus[]>;
  permissions(provider: RunnableProvider, userId: number | null): Promise<Pick<TurnOptions, 'allowedTools' | 'disallowedTools'>>;
  defaultModel(provider: RunnableProvider, purpose?: 'lookup'): Promise<string>;
  models(provider: RunnableProvider): Promise<Array<{ value: string; label: string }>>;
  openSession(provider: RunnableProvider, projectPath: string, title: string, hidden?: boolean): string;
  runTurn(sessionId: string, userId: number | null, content: string, options: TurnOptions): Promise<TurnResult>;
  lastAnswer(sessionId: string): Promise<string>;
  herissonReport?(sessionId: string, projectPath: string, since: string): Promise<string | null>;
  history(sessionId: string, limit: number): Promise<Array<{ role: string; text: string }>>;
  wasAborted(sessionId: string): boolean;
  isProcessing(sessionId: string): boolean;
  abort(provider: RunnableProvider, sessionId: string): Promise<boolean>;
  pending(sessionId: string): PermissionRequest[];
  resolve(requestId: string, allow: boolean): void;
  notify(userId: number | null, sessionId: string | null, title: string, text: string): void;
  approvedFolders(): string[];
  artifacts(projectPath: string): Array<{ url: string; title: string; updated_at?: string }>;
  connectors(projectPath: string): string[];
  centralRoot?: string | (() => string);
  prepareCentral?(root: string): void;
  prepareDossier?(central: string, folder: string): void;
};
