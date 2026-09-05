/**
 * "Activation par dossier" view of the "Skills et agents" section: MCP
 * servers, Claude Code plugins, and the library of skills/agents installed
 * per workspace, served by `server/piecemaker/activation/routes.cjs`
 * (mounted at `/api/piecemaker/activation`).
 *
 * Skills and agents never live at the global `~/.claude` / `~/.codex` level
 * any more — they sit in a library (`~/.piecemaker/library/` plus the
 * bundled PieceMaker components) and are copied into the open workspace's
 * `.claude`/`.codex` folder on demand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';

import { cn } from '@/shared/utils';
import { ScrollArea } from '@/shared/ui';

import { pmGet, pmPost, PieceMakerApiError } from '../api';
import { useDossierCases } from '../DossierContext';

type Item = {
  id: string;
  name: string;
  description?: string;
  origin: 'project' | 'user' | 'plugin';
  source: string;
  enabled: boolean;
  toggleable: boolean;
  reason?: string;
};

type LibraryItem = {
  id: string;
  name: string;
  description?: string;
  origin: 'piecemaker' | 'library';
  source: string;
  installed: { claude: boolean; codex: boolean | null };
};

type Leftover = {
  id: string;
  name: string;
  description?: string;
  assistant: 'claude' | 'codex';
  family: 'skill' | 'agent';
  source: string;
};

type ActivationSnapshot = {
  workspacePath: string;
  claude: { mcp: Item[]; plugins: Item[] };
  codex: { mcp: Item[] };
  library: { skills: LibraryItem[]; agents: LibraryItem[] };
  globalLeftovers: { skills: Leftover[]; agents: Leftover[] };
};

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof PieceMakerApiError) return cause.message;
  return cause instanceof Error ? cause.message : fallback;
}

function Toggle({
  checked,
  disabled,
  onToggle,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

function Dash() {
  return <span className="text-xs text-muted-foreground">—</span>;
}

function GroupHeading({ title, columns = true }: { title: string; columns?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 pb-2 pt-4">
      <h3 className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {columns && (
        <>
          <span className="w-32 shrink-0 text-center text-xs font-medium text-muted-foreground">Claude</span>
          <span className="w-32 shrink-0 text-center text-xs font-medium text-muted-foreground">Codex</span>
        </>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2 last:border-b-0">{children}</div>;
}

function RowLabel({ name, description, reason }: { name: string; description?: string; reason?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm text-foreground">{name}</p>
      {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      {reason && <p className="truncate text-xs text-amber-600 dark:text-amber-500">{reason}</p>}
    </div>
  );
}

export default function SkillsActivation() {
  const { projectPath } = useDossierCases();
  const [snapshot, setSnapshot] = useState<ActivationSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectPath) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await pmGet<ActivationSnapshot>('/activation', { workspacePath: projectPath });
      setSnapshot(response);
    } catch (cause) {
      setLoadError(errorMessage(cause, "Impossible de charger l'activation du dossier."));
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleMcpOrPlugin = useCallback(
    async (assistant: 'claude' | 'codex', family: 'mcp' | 'plugin', item: Item) => {
      if (!projectPath || !item.toggleable) return;
      const key = `${assistant}:${family}:${item.id}`;
      setPendingKey(key);
      setActionError(null);
      try {
        const response = await pmPost<{ ok: true; item: Item }>('/activation/toggle', {
          workspacePath: projectPath,
          assistant,
          family,
          id: item.id,
          enabled: !item.enabled,
        });
        setSnapshot((current) => {
          if (!current) return current;
          if (assistant === 'claude' && family === 'mcp') {
            return { ...current, claude: { ...current.claude, mcp: current.claude.mcp.map((entry) => (entry.id === item.id ? response.item : entry)) } };
          }
          if (assistant === 'claude' && family === 'plugin') {
            return { ...current, claude: { ...current.claude, plugins: current.claude.plugins.map((entry) => (entry.id === item.id ? response.item : entry)) } };
          }
          return { ...current, codex: { ...current.codex, mcp: current.codex.mcp.map((entry) => (entry.id === item.id ? response.item : entry)) } };
        });
      } catch (cause) {
        setActionError(errorMessage(cause, 'Le changement a échoué.'));
      } finally {
        setPendingKey(null);
      }
    },
    [projectPath],
  );

  const toggleLibrary = useCallback(
    async (family: 'skill' | 'agent', assistant: 'claude' | 'codex', libraryItem: LibraryItem) => {
      if (!projectPath) return;
      const key = `library:${family}:${assistant}:${libraryItem.id}`;
      const currentlyInstalled = assistant === 'claude' ? libraryItem.installed.claude : Boolean(libraryItem.installed.codex);
      setPendingKey(key);
      setActionError(null);
      try {
        const response = await pmPost<{ ok: true; item: LibraryItem }>('/activation/library', {
          workspacePath: projectPath,
          assistant,
          family,
          id: libraryItem.id,
          installed: !currentlyInstalled,
        });
        setSnapshot((current) => {
          if (!current) return current;
          const list = family === 'skill' ? current.library.skills : current.library.agents;
          const nextList = list.map((entry) => (entry.id === libraryItem.id ? response.item : entry));
          return {
            ...current,
            library: family === 'skill' ? { ...current.library, skills: nextList } : { ...current.library, agents: nextList },
          };
        });
      } catch (cause) {
        setActionError(errorMessage(cause, "L'installation a échoué."));
      } finally {
        setPendingKey(null);
      }
    },
    [projectPath],
  );

  const adopt = useCallback(
    async (leftover: Leftover) => {
      const confirmed = window.confirm(
        'Ce composant est actuellement actif dans tous les dossiers. Le déplacer vers la bibliothèque le retire de tous les dossiers ; il faudra l’installer dossier par dossier. Continuer ?',
      );
      if (!confirmed) return;
      const key = `adopt:${leftover.assistant}:${leftover.family}:${leftover.id}`;
      setPendingKey(key);
      setActionError(null);
      try {
        await pmPost('/activation/library/adopt', {
          assistant: leftover.assistant,
          family: leftover.family,
          id: leftover.id,
        });
        await load();
      } catch (cause) {
        setActionError(errorMessage(cause, 'Le déplacement a échoué.'));
      } finally {
        setPendingKey(null);
      }
    },
    [load],
  );

  const mcpIds = useMemo(() => {
    if (!snapshot) return [];
    const ids = new Set<string>();
    for (const item of snapshot.claude.mcp) ids.add(item.id);
    for (const item of snapshot.codex.mcp) ids.add(item.id);
    return [...ids].sort((a, b) => a.localeCompare(b));
  }, [snapshot]);

  const leftovers = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.globalLeftovers.skills, ...snapshot.globalLeftovers.agents];
  }, [snapshot]);

  if (!projectPath) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Ouvrez un dossier pour gérer son activation par dossier.
      </div>
    );
  }

  if (isLoading && !snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement de l'activation…
      </div>
    );
  }

  if (loadError && !snapshot) {
    return (
      <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{loadError}</span>
      </div>
    );
  }

  if (!snapshot) return null;

  const claudeMcpById = new Map(snapshot.claude.mcp.map((item) => [item.id, item] as const));
  const codexMcpById = new Map(snapshot.codex.mcp.map((item) => [item.id, item] as const));

  return (
    <ScrollArea className="min-h-0 flex-1">
      {actionError && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      <GroupHeading title="Serveurs MCP" />
      {mcpIds.length === 0 && <p className="px-4 pb-2 text-xs text-muted-foreground">Aucun serveur MCP configuré.</p>}
      {mcpIds.map((id) => {
        const claudeItem = claudeMcpById.get(id);
        const codexItem = codexMcpById.get(id);
        const label = claudeItem ?? codexItem;
        if (!label) return null;
        return (
          <Row key={`mcp:${id}`}>
            <RowLabel name={label.name} description={label.description} reason={(claudeItem?.reason) || (codexItem?.reason)} />
            <div className="flex w-32 shrink-0 items-center justify-center gap-2">
              {claudeItem ? (
                <Toggle
                  checked={claudeItem.enabled}
                  disabled={!claudeItem.toggleable || pendingKey === `claude:mcp:${id}`}
                  onToggle={() => toggleMcpOrPlugin('claude', 'mcp', claudeItem)}
                  ariaLabel={`Activer ${label.name} pour Claude`}
                />
              ) : (
                <Dash />
              )}
            </div>
            <div className="flex w-32 shrink-0 items-center justify-center gap-2">
              {codexItem ? (
                <Toggle
                  checked={codexItem.enabled}
                  disabled={!codexItem.toggleable || pendingKey === `codex:mcp:${id}`}
                  onToggle={() => toggleMcpOrPlugin('codex', 'mcp', codexItem)}
                  ariaLabel={`Activer ${label.name} pour Codex`}
                />
              ) : (
                <Dash />
              )}
            </div>
          </Row>
        );
      })}

      <GroupHeading title="Plugins Claude" />
      {snapshot.claude.plugins.length === 0 && <p className="px-4 pb-2 text-xs text-muted-foreground">Aucun plugin installé.</p>}
      {snapshot.claude.plugins.map((item) => (
        <Row key={`plugin:${item.id}`}>
          <RowLabel name={item.name} description={item.description} reason={item.reason} />
          <div className="flex w-32 shrink-0 items-center justify-center">
            <Toggle
              checked={item.enabled}
              disabled={!item.toggleable || pendingKey === `claude:plugin:${item.id}`}
              onToggle={() => toggleMcpOrPlugin('claude', 'plugin', item)}
              ariaLabel={`Activer le plugin ${item.name}`}
            />
          </div>
          <div className="flex w-32 shrink-0 items-center justify-center">
            <Dash />
          </div>
        </Row>
      ))}

      <GroupHeading title="Bibliothèque — compétences (skills)" />
      {snapshot.library.skills.length === 0 && <p className="px-4 pb-2 text-xs text-muted-foreground">Bibliothèque vide.</p>}
      {snapshot.library.skills.map((item) => (
        <Row key={`skill:${item.id}`}>
          <RowLabel name={item.name} description={item.description} />
          <div className="flex w-32 shrink-0 items-center justify-center">
            <Toggle
              checked={item.installed.claude}
              disabled={pendingKey === `library:skill:claude:${item.id}`}
              onToggle={() => toggleLibrary('skill', 'claude', item)}
              ariaLabel={`Installer ${item.name} pour Claude dans ce dossier`}
            />
          </div>
          <div className="flex w-32 shrink-0 items-center justify-center">
            <Toggle
              checked={Boolean(item.installed.codex)}
              disabled={pendingKey === `library:skill:codex:${item.id}`}
              onToggle={() => toggleLibrary('skill', 'codex', item)}
              ariaLabel={`Installer ${item.name} pour Codex dans ce dossier`}
            />
          </div>
        </Row>
      ))}

      <GroupHeading title="Bibliothèque — collabs IA (agents)" />
      {snapshot.library.agents.length === 0 && <p className="px-4 pb-2 text-xs text-muted-foreground">Bibliothèque vide.</p>}
      {snapshot.library.agents.map((item) => (
        <Row key={`agent:${item.id}`}>
          <RowLabel name={item.name} description={item.description} />
          <div className="flex w-32 shrink-0 items-center justify-center">
            <Toggle
              checked={item.installed.claude}
              disabled={pendingKey === `library:agent:claude:${item.id}`}
              onToggle={() => toggleLibrary('agent', 'claude', item)}
              ariaLabel={`Installer ${item.name} pour Claude dans ce dossier`}
            />
          </div>
          <div className="flex w-32 shrink-0 items-center justify-center">
            <Dash />
          </div>
        </Row>
      ))}

      {leftovers.length > 0 && (
        <>
          <GroupHeading title="Composants globaux à migrer" columns={false} />
          {leftovers.map((leftover) => (
            <Row key={`leftover:${leftover.assistant}:${leftover.family}:${leftover.id}`}>
              <RowLabel name={leftover.name} description={leftover.description} />
              <div className="w-16 shrink-0 text-xs text-muted-foreground">
                {leftover.assistant === 'claude' ? 'Claude' : 'Codex'} · {leftover.family === 'skill' ? 'skill' : 'agent'}
              </div>
              <button
                type="button"
                disabled={pendingKey === `adopt:${leftover.assistant}:${leftover.family}:${leftover.id}`}
                onClick={() => void adopt(leftover)}
                className="shrink-0 rounded-md border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Déplacer vers la bibliothèque
              </button>
            </Row>
          ))}
        </>
      )}

      <div className="h-4" />
    </ScrollArea>
  );
}
