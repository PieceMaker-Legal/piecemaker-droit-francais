export type PluginContext = {
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
};

export type PluginAPI = {
  readonly context: PluginContext;
  onContextChange(callback: (context: PluginContext) => void): () => void;
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
};

export type TimesheetScope = 'all' | 'project';

export type TimesheetEntry = {
  sessionId: string;
  provider: string;
  projectId: string | null;
  projectName: string;
  projectPath: string;
  sessionName: string;
  startedAt: string | null;
  endedAt: string | null;
  activeSeconds: number;
  elapsedSeconds: number;
  conclusion: string;
  conclusionAt: string | null;
};
