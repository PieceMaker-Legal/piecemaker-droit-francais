/**
 * "Configuration" section of the Dossier tab: the card of installed PieceMaker
 * components (replacing the standalone PieceMaker-Installer admin page's own
 * configuration screen, now backed by the same `GET /api/piecemaker/configuration`
 * handler) plus the settings and institutional-terms editors.
 *
 * `GET /configuration` also returns Ollama models, Telegram bots and hooks
 * status, and per-case folders — all deliberately left out of this screen (and out
 * of its types below) because they belong to other surfaces (models: local Ollama
 * management; telegram/hooks: infra not exposed to end users; folders:
 * case↔bot links, owned by CaseFilesSection) or to git history, which this tab does
 * not surface at all.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui';
import { pmGet, PieceMakerApiError } from '@/piecemaker/dossier/api';

import ConfigurationComponentCard from '@/piecemaker/dossier/sections/ConfigurationComponentCard';
import ConfigurationAnonymizer from '@/piecemaker/dossier/sections/ConfigurationAnonymizer';
import ConfigurationSettings from '@/piecemaker/dossier/sections/ConfigurationSettings';
import ConfigurationInstitutionalTerms from '@/piecemaker/dossier/sections/ConfigurationInstitutionalTerms';

/** One CLI client detected on this machine (Claude Code, Codex...). */
export type ConfigurationClientEntry = { name: string; version: string };

export type ConfigurationClient = {
  name: string;
  installed: boolean;
  summary: string;
  clients: ConfigurationClientEntry[];
  pluginInstalled: boolean;
};

export type ConfigurationTerminal = {
  name: string;
  installed: boolean;
  summary: string;
  shell: string;
};

/** A single local MCP server tracked by the backend (currently: Légifrance only). */
export type ConfigurationMcpItem = {
  name: string;
  installed: boolean;
  configured: boolean;
  detail: string;
};

export type ConfigurationMcp = {
  name: string;
  installed: boolean;
  configured: boolean;
  summary: string;
  items: ConfigurationMcpItem[];
};

export type ConfigurationGliner = {
  name: string;
  installed: boolean;
  summary: string;
  coreml: boolean;
  model: string;
  engine: string;
};

export type ConfigurationMineru = {
  name: string;
  installed: boolean;
  optional: boolean;
  summary: string;
};

/** The component kinds this screen shows; also the `component` values `/configuration/install` accepts (gliner, mineru). */
export type ConfigurationComponentKey = 'client' | 'terminal' | 'mcp' | 'gliner' | 'mineru';

export const INSTALLABLE_COMPONENTS: ReadonlySet<ConfigurationComponentKey> = new Set(['gliner', 'mineru']);

export type ConfigurationOverviewResponse = {
  components: {
    client: ConfigurationClient;
    terminal: ConfigurationTerminal;
    mcp: ConfigurationMcp;
    gliner: ConfigurationGliner;
    mineru: ConfigurationMineru;
    // hooks / telegram also present on the wire — out of scope, not typed.
  };
  // models (Ollama) / folders also present on the wire — out of scope, not typed.
};

/** One running or finished `/configuration/install` job, as polled by ConfigurationComponentCard. */
export type ConfigurationInstallJob = {
  id: string;
  component: string;
  state: 'running' | 'done' | 'failed';
  progress: string;
  error: string;
};

export default function ConfigurationSection() {
  // Holds the last successful overview so a manual refresh (or an install finishing)
  // can replace it without flashing the whole card grid back to a loading state.
  const [overview, setOverview] = useState<ConfigurationOverviewResponse | null>(null);
  // Distinguishes "first load, nothing to show yet" from "reloading in the background".
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await pmGet<ConfigurationOverviewResponse>('/configuration');
      setOverview(data);
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Composants installés</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading} aria-label="Actualiser">
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </CardHeader>
        <CardContent>
          {loading && !overview && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lecture de l’état des composants (client, terminal, MCP, moteurs Python)…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>Impossible de lire la configuration : {error}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
                  Réessayer
                </Button>
              </div>
            </div>
          )}

          {overview && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ConfigurationComponentCard
                componentKey="client"
                title="Client en ligne de commande"
                installed={overview.components.client.installed}
                summary={overview.components.client.summary}
                onInstalled={load}
              >
                {overview.components.client.clients.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {overview.components.client.clients.map((client) => (
                      <li key={client.name}>{client.name} {client.version}</li>
                    ))}
                  </ul>
                )}
                {!overview.components.client.pluginInstalled && overview.components.client.installed && (
                  <p className="mt-1 text-xs text-muted-foreground">Extension PieceMaker non détectée dans ce client.</p>
                )}
              </ConfigurationComponentCard>

              <ConfigurationComponentCard
                componentKey="terminal"
                title="Terminal intégré"
                installed={overview.components.terminal.installed}
                summary={overview.components.terminal.summary}
                onInstalled={load}
              />

              <ConfigurationComponentCard
                componentKey="mcp"
                title="Serveur MCP Légifrance"
                installed={overview.components.mcp.installed}
                summary={overview.components.mcp.summary}
                onInstalled={load}
              >
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {overview.components.mcp.items.map((item) => (
                    <li key={item.name}>
                      {item.name} — {item.installed ? (item.configured ? 'configuré' : 'installé, identifiants manquants') : 'absent'}
                    </li>
                  ))}
                </ul>
              </ConfigurationComponentCard>

              <ConfigurationComponentCard
                componentKey="gliner"
                title="Anonymisation (GLiNER)"
                installed={overview.components.gliner.installed}
                summary={overview.components.gliner.summary}
                onInstalled={load}
              >
                <p className="mt-1 text-xs text-muted-foreground">
                  Modèle {overview.components.gliner.model} · moteur {overview.components.gliner.engine}
                </p>
              </ConfigurationComponentCard>

              <ConfigurationComponentCard
                componentKey="mineru"
                title="Conversion OCR (MinerU)"
                installed={overview.components.mineru.installed}
                summary={overview.components.mineru.summary}
                optional={overview.components.mineru.optional}
                onInstalled={load}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <ConfigurationAnonymizer />
      <ConfigurationSettings />
      <ConfigurationInstitutionalTerms />
    </div>
  );
}
