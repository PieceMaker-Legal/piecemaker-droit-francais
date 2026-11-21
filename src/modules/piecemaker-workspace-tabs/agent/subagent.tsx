import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { agentApi } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import type { AgentOutput, AgentState, AgentThread } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import { useCentralAgent } from '@/modules/piecemaker-workspace-tabs/agent/useCentralAgent';
import type { Project, ProjectSession } from '@/shared/types';

const POLL_MS = 5_000;

export type Subagent = { thread: AgentThread; project: Project; session: ProjectSession; open: AgentOutput | null };

export type SubagentApi = {
  open: (thread: AgentThread, output?: AgentOutput | null) => boolean;
  openOutput: (output: AgentOutput, threadId?: string | null) => boolean;
  close: () => void;
};

export const SubagentContext = createContext<SubagentApi | null>(null);

export function useSubagent() {
  return useContext(SubagentContext);
}

let shadowed = false;

export function setMainWorkspaceShadowed(value: boolean) {
  shadowed = value;
}

export const NestedWorkspaceContext = createContext(false);

export function useWorkspaceListening() {
  const nested = useContext(NestedWorkspaceContext);
  return useCallback(() => nested || !shadowed, [nested]);
}

const trim = (value: string) => value.replace(/[\\/]+$/, '');
const isAbsolute = (value: string) => /^(?:[a-z]:[\\/]|[\\/])/i.test(value);

export function insideFolder(folder: string, target: string) {
  const root = trim(folder);
  return target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`);
}

export function threadForPath(threads: AgentThread[], target: string): AgentThread | null {
  return threads
    .filter((thread) => thread.sessionId && insideFolder(thread.projectPath, target))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

function toProject(thread: AgentThread, state: AgentState | null): Project {
  const name = trim(thread.projectPath).split(/[\\/]/).at(-1) ?? thread.projectPath;
  return { projectId: state?.projectIds?.[thread.projectPath] ?? '', displayName: name, fullPath: thread.projectPath, path: thread.projectPath };
}

function toSession(thread: AgentThread, sessionId: string): ProjectSession {
  return { id: sessionId, title: thread.title, summary: thread.title, provider: thread.provider, __provider: thread.provider };
}

export function useSubagentHost(projectPath: string | null, enabled: boolean) {
  const central = useCentralAgent();
  const isCentral = Boolean(enabled && projectPath && central?.project && trim(central.project) === trim(projectPath));
  const [state, setState] = useState<AgentState | null>(null);
  const [current, setCurrent] = useState<Subagent | null>(null);

  useEffect(() => {
    setCurrent(null);
    setState(null);
    if (!isCentral || !projectPath) return;
    let alive = true;
    const load = () => { if (!document.hidden) void agentApi.state(projectPath).then((next) => { if (alive) setState(next); }).catch(() => undefined); };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [isCentral, projectPath]);

  useEffect(() => {
    setMainWorkspaceShadowed(Boolean(current));
    return () => setMainWorkspaceShadowed(false);
  }, [current]);

  const open = useCallback((thread: AgentThread, output: AgentOutput | null = null) => {
    if (!isCentral || !thread.sessionId) return false;
    setCurrent({ thread, project: toProject(thread, state), session: toSession(thread, thread.sessionId), open: output });
    return true;
  }, [isCentral, state]);

  const openOutput = useCallback((output: AgentOutput, threadId: string | null = null) => {
    if (!isCentral || !state || output.kind === 'link') return false;
    const byId = threadId ? state.threads.find((thread) => thread.id === threadId && thread.sessionId) : null;
    const thread = byId ?? (output.kind === 'file' && isAbsolute(output.ref) ? threadForPath(state.threads, output.ref) : null);
    return thread ? open(thread, output) : false;
  }, [isCentral, open, state]);

  const close = useCallback(() => setCurrent(null), []);
  const followSession = useCallback((sessionId: string) => {
    setCurrent((value) => value && { ...value, session: toSession(value.thread, sessionId), open: null });
  }, []);
  const api = useMemo<SubagentApi | null>(() => isCentral ? { open, openOutput, close } : null, [close, isCentral, open, openOutput]);
  return { api, current, close, followSession };
}

export function useSubagentFileOpen<Args extends unknown[], Result>(openFile: (path: string, ...rest: Args) => Result): (path: string, ...rest: Args) => Result | boolean {
  const subagent = useSubagent();
  return useCallback((path: string, ...rest: Args) => {
    if (subagent && isAbsolute(path) && subagent.openOutput({ kind: 'file', ref: path })) return true;
    return openFile(path, ...rest);
  }, [openFile, subagent]);
}
