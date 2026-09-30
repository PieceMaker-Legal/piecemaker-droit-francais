import { api } from '@/shared/api';
import { AUTH_TOKEN_REFRESHED_EVENT } from '@/shared/authToken';

export type InjectionHost = {
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
  openTab(): boolean;
};

type InjectionModule = {
  inject?: (host: InjectionHost) => unknown;
};

export type InjectablePlugin = {
  name: string;
  displayName: string;
  enabled: boolean;
};

export type PluginInjectionDependencies = {
  listPlugins(): Promise<InjectablePlugin[]>;
  readManifest(pluginName: string): Promise<unknown>;
  loadModule(pluginName: string, file: string): Promise<InjectionModule>;
  rpc(pluginName: string, method: string, path: string, body?: unknown): Promise<unknown>;
};

async function json(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const defaultDependencies: PluginInjectionDependencies = {
  async listPlugins() {
    const result = await json(await api.plugins.list()) as { plugins?: InjectablePlugin[] };
    return Array.isArray(result.plugins) ? result.plugins : [];
  },
  async readManifest(pluginName) {
    return json(await api.plugins.asset(pluginName, 'manifest.json'));
  },
  async loadModule(pluginName, file) {
    const response = await api.plugins.asset(pluginName, file);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blobUrl = URL.createObjectURL(new Blob([await response.text()], { type: 'application/javascript' }));
    try {
      return await import(/* @vite-ignore */ blobUrl) as InjectionModule;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  },
  async rpc(pluginName, method, path, body) {
    return json(await api.plugins.rpc(pluginName, method, path, body));
  },
};

export function injectionFiles(manifest: unknown): string[] {
  const files = (manifest as { piecemakerInjections?: unknown } | null)?.piecemakerInjections;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is string => typeof file === 'string'
    && /\.m?js$/.test(file)
    && !file.startsWith('/')
    && !file.includes('\\')
    && !file.split('/').includes('..'));
}

export function openPluginTab(displayName: string): boolean {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    .find((element) => element.getAttribute('aria-label') === displayName);
  if (!tab) return false;
  tab.click();
  return true;
}

export function startPluginInjections(dependencies: PluginInjectionDependencies = defaultDependencies): () => void {
  const cleanups: (() => void)[] = [];
  let stopped = false;
  let started = false;

  const load = async () => {
    if (started || stopped) return;
    started = true;
    let plugins: InjectablePlugin[];
    try {
      plugins = await dependencies.listPlugins();
    } catch {
      started = false;
      return;
    }
    await Promise.all(plugins.filter((plugin) => plugin.enabled).map(async (plugin) => {
      try {
        const files = injectionFiles(await dependencies.readManifest(plugin.name));
        for (const file of files) {
          const module = await dependencies.loadModule(plugin.name, file);
          if (stopped || typeof module.inject !== 'function') continue;
          const cleanup = module.inject({
            rpc: (method, path, body) => dependencies.rpc(plugin.name, method, path, body),
            openTab: () => openPluginTab(plugin.displayName),
          });
          if (typeof cleanup === 'function') cleanups.push(cleanup as () => void);
          if (stopped) cleanups.splice(0).forEach((stop) => stop());
        }
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] Injection impossible :`, error);
      }
    }));
  };

  const retry = () => { void load(); };
  window.addEventListener(AUTH_TOKEN_REFRESHED_EVENT, retry);
  void load();

  return () => {
    stopped = true;
    window.removeEventListener(AUTH_TOKEN_REFRESHED_EVENT, retry);
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        console.error('[Plugin] Nettoyage de l’injection impossible :', error);
      }
    }
  };
}
