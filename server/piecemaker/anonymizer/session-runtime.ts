import path from 'node:path';

import type { providerRuntimeService } from '@/modules/providers/index.js';

type SessionProxy = { runInProject<T>(projectId: string | null, run: () => T): T };
type ProjectRow = { project_id: string; project_path: string };

export function projectOfDirectory(directory: string, projects: ProjectRow[]): string | null {
  if (!directory) return null;
  const target = path.resolve(directory);
  const owner = projects
    .filter(({ project_path: root }) => target === path.resolve(root) || target.startsWith(`${path.resolve(root)}${path.sep}`))
    .sort((a, b) => b.project_path.length - a.project_path.length)[0];
  return owner?.project_id ?? null;
}

export function installSessionProxyRuntime(runtime: Pick<typeof providerRuntimeService, 'run'>, proxy: SessionProxy, projects: () => ProjectRow[]) {
  const run = runtime.run.bind(runtime);
  runtime.run = (provider, command, options, writer) => proxy.runInProject(
    projectOfDirectory(String(options.cwd ?? options.projectPath ?? ''), projects()),
    () => run(provider, command, options, writer),
  );
}
