import { requestJson } from '@/shared/authToken';

export type AgentThreadState = 'queued' | 'working' | 'blocked' | 'review_ready' | 'done' | 'failed' | 'stopped';
export type AgentProvider = 'claude' | 'codex' | 'mistral';
export type AgentProviderChoice = AgentProvider | 'auto';
export type AgentOutput = { kind: 'file' | 'link' | 'artifact'; ref: string; title?: string };
export type AgentReaction = { emoji: string; by: 'user' | 'orchestrator' | 'system' };
export type AgentWidget = {
  type: 'buttons' | 'draft' | 'comparison' | 'steps';
  title?: string;
  body?: string;
  buttons?: Array<{ action_id: string; label: string; style?: 'primary' | 'secondary' | 'danger' }>;
  draft?: { to?: string; subject?: string; body: string };
  columns?: string[];
  rows?: Array<{ label: string; cells: string[] }>;
  steps?: Array<{ label: string; status: 'todo' | 'doing' | 'done' }>;
  state?: { clicked?: string; text?: string; at?: string };
};
export type AgentMessage = {
  id: string;
  author: 'user' | 'orchestrator' | 'system';
  text: string;
  at: string;
  editedAt?: string;
  notify?: boolean;
  attachments: AgentOutput[];
  decisionIds: string[];
  threadId?: string;
  widget?: AgentWidget;
  connect?: { target: string; reconnect: boolean; reason?: string };
  approval?: { threadId: string; requestId: string; toolName: string; input: unknown; status: 'pending' | 'allowed' | 'denied' | 'resolved' };
  folderRequest?: { threadId: string | null; folder: string; status: 'pending' | 'allowed' | 'denied' };
  setup?: { instructions?: string; threads: Array<{ title: string; instructions: string; provider?: AgentProviderChoice }>; status: 'pending' | 'accepted' | 'declined' };
  reactions: AgentReaction[];
};
export type AgentDecision = {
  id: string;
  question: string;
  options: Array<{ label: string; consequence: string }>;
  recommended: number;
  reason?: string;
  chosen: number | null;
  closedBy: 'user' | 'orchestrator' | 'thread' | null;
  withdrawn: boolean;
  owner: { threadId: string } | 'orchestrator';
};
export type AgentThread = {
  id: string;
  title: string;
  provider: AgentProvider;
  model: string;
  projectPath: string;
  sessionId: string | null;
  reminderAt: string | null;
  ackThread: string;
  state: AgentThreadState;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  replies: Array<{ at: string; text: string }>;
  error: string | null;
};
export type AgentDeliverable = { id: string; kind: 'document' | 'piece' | 'artifact'; ref: string; title: string; state: 'brouillon' | 'a_relire' | 'valide'; threadId: string | null; updatedAt: string };
export type AgentSchedule = { id: string; kind: 'once' | 'cron'; nextRunAt: string | null; text: string; at: string | null; cron: string | null; thread: { title: string } | null; lastFiredAt: string | null };
export type AgentSettings = {
  instructions: string;
  orchestratorProvider: AgentProviderChoice;
  orchestratorModel: string;
  defaultProvider: AgentProviderChoice;
  defaultModels: Partial<Record<AgentProvider, string>>;
  concurrency: Record<AgentProvider, number>;
  folders: string[];
  recycleAfter: number;
  dream?: AgentDreamSettings;
};
export type AgentDreamSettings = { enabled: boolean; provider: AgentProviderChoice; model: string; hour: number };
export type AgentState = {
  revision: number;
  settings: AgentSettings;
  dream?: { running: boolean; lastRunAt: string | null; lastResult: string | null; lastError: string | null };
  messages: AgentMessage[];
  decisions: AgentDecision[];
  threads: AgentThread[];
  deliverables: AgentDeliverable[];
  schedules: AgentSchedule[];
  orchestrator: { running: boolean; provider: AgentProvider | null; sessionId: string | null };
  providers: Array<{ provider: AgentProvider; installed: boolean; authenticated: boolean }>;
  memory: { text: string; revision: number; updatedAt: string | null };
  artifacts: Array<{ url: string; title: string; updated_at?: string }>;
  files: Array<{ name: string; size: number; updatedAt: string }>;
  storage: { used: number; total: number };
  central: boolean;
  dossiers: Array<{ path: string; selected: boolean }>;
  projectIds?: Record<string, string | null>;
};
export type CentralAgent = { project: string; projectId: string | null; sessionId: string | null };
export type CaseRoadmapLine = { intitule?: string; kind?: string; date?: string; okf?: string; de?: string; avant?: string; delai?: Record<string, number>; [key: string]: unknown };
export type CaseSuivi = { matter?: Record<string, unknown>; evenements?: Record<string, CaseRoadmapLine>; echeances?: Record<string, CaseRoadmapLine> };
export type CaseRoadmap = { synthese?: Record<string, unknown>; etapes?: unknown; suivis?: Record<string, CaseSuivi>; suivisSupprimes?: Record<string, CaseSuivi>; [key: string]: unknown };
export type CasePair = { folder: string; name: string; about: string; roadmap: CaseRoadmap; error: string | null; paths: { about: string; roadmap: string } };

const BASE = '/api/piecemaker/orchestrateur';

export const ACTIVE_THREAD_STATES: AgentThreadState[] = ['queued', 'working', 'blocked'];

export const agentApi = {
  state: (project: string) => requestJson<AgentState>(`${BASE}/state?project=${encodeURIComponent(project)}`),
  sessionId: (project: string) => requestJson<{ sessionId: string | null }>(`${BASE}/session?project=${encodeURIComponent(project)}`),
  openSession: (project: string) => requestJson<{ sessionId: string; provider: AgentProvider | null }>(`${BASE}/session`, { project }),
  central: () => requestJson<CentralAgent>(`${BASE}/central`),
  setBrain: (path: string) => requestJson<CentralAgent>(`${BASE}/central/brain`, { path }, 'PUT'),
  openCentral: () => requestJson<CentralAgent & { sessionId: string; provider: AgentProvider | null }>(`${BASE}/central/session`, {}),
  post: (path: string, project: string, body: Record<string, unknown>) => requestJson<unknown>(`${BASE}/${path}`, { project, ...body }),
  put: (path: string, project: string, body: Record<string, unknown>) => requestJson<unknown>(`${BASE}/${path}`, { project, ...body }, 'PUT'),
  casePair: (project: string, folder: string) => requestJson<CasePair>(`${BASE}/case?project=${encodeURIComponent(project)}&folder=${encodeURIComponent(folder)}`),
  saveAbout: (project: string, folder: string, text: string) => requestJson<CasePair>(`${BASE}/case/about`, { project, folder, text }, 'PUT'),
  saveRoadmap: (project: string, folder: string, roadmap: CaseRoadmap) => requestJson<CasePair>(`${BASE}/case/roadmap`, { project, folder, roadmap }, 'PUT'),
};
