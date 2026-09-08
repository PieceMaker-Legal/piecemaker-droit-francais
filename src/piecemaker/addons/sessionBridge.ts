type SessionBridge = { projectPath: string | null; pathname: string; navigate: (path: string) => void };

let value: SessionBridge = { projectPath: null, pathname: window.location.pathname, navigate: () => {} };
const listeners = new Set<() => void>();

export function publishWorkflowSessionBridge(next: SessionBridge) { value = next; listeners.forEach((listener) => listener()); }
export function workflowSessionBridge() { return value; }
export function subscribeWorkflowSessionBridge(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
