import { Maximize2, Minimize2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, Dispatch, PointerEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { BrowserUsePanel, useBrowserUseEnabled } from '@/modules/browser-use';
import { FileTree } from '@/modules/file-tree';
import { GitPanel } from '@/modules/git-panel';
import { PluginTabContent, usePlugins } from '@/modules/plugins';
import { WorkspacePanelsContext } from '@/modules/piecemaker-workspace-tabs/context/WorkspacePanelsContext';
import { TaskMasterPanel, useTasksSettings } from '@/modules/task-master';
import { openInEditor } from '@/piecemaker/editor-tabs/editorPanels';
import type { AppTab, Project, ProjectSession, SettingsMainTab } from '@/shared/types';
import { Card } from '@/shared/ui';
import '@/modules/piecemaker-workspace-tabs/workspacePanels.css';

type WorkspaceProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isMobile: boolean;
  isLoading: boolean;
  onShowSettings: (tab?: SettingsMainTab) => void;
  onProjectSelect: (project: Project) => void;
  onProjectsRefresh: () => void;
};

export function withWorkspacePanels<Props extends WorkspaceProps>(Workspace: ComponentType<Props>) {
  return function WorkspacePanels(props: Props) {
    const { activeTab, setActiveTab } = props;
    const { t } = useTranslation();
    const { plugins } = usePlugins();
    const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
    const browserEnabled = useBrowserUseEnabled();
    const [mainTab, setMainTab] = useState<AppTab>(props.activeTab === 'shell' ? 'shell' : 'chat');
    const [panels, setPanels] = useState<AppTab[]>([]);
    const [expanded, setExpanded] = useState<AppTab | null>(null);
    const [dockWidth, setDockWidth] = useState(48);
    const [panelWidths, setPanelWidths] = useState<Partial<Record<AppTab, number>>>({});
    const panelResizeRef = useRef<{ tab: AppTab; x: number; width: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dockRef = useRef<HTMLElement>(null);
    const enabledPanels = panels.filter((tab) => tab === 'tasks' ? tasksEnabled && isTaskMasterInstalled
      : tab === 'browser' ? browserEnabled
        : tab.startsWith('plugin:') ? plugins.some((plugin) => plugin.enabled && tab === `plugin:${plugin.name}`) : true);
    const expandedTab = expanded && enabledPanels.includes(expanded) ? expanded : null;

    const open = useCallback((tab: AppTab) => {
      if (tab === 'chat' || tab === 'shell') {
        setMainTab(tab);
        setExpanded(null);
      } else {
        setPanels((current) => current.includes(tab) ? current : [...current, tab]);
      }
    }, []);

    useEffect(() => {
      setPanels([]);
      setExpanded(null);
      setPanelWidths({});
    }, [props.selectedProject?.projectId]);
    useEffect(() => open(props.activeTab), [props.activeTab, props.selectedProject?.projectId, open]);

    const select: Dispatch<SetStateAction<AppTab>> = useCallback((action) => {
      const tab = typeof action === 'function' ? action(activeTab) : action;
      open(tab);
      setActiveTab(tab);
    }, [activeTab, setActiveTab, open]);

    const close = (tab: AppTab) => {
      setPanels((current) => current.filter((item) => item !== tab));
      if (expanded === tab) setExpanded(null);
      if (props.activeTab === tab) props.setActiveTab(mainTab);
    };

    const resizeDock = (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    };
    const setDockSize = (requestedPercent: number) => {
      const percent = Math.max(0, Math.min(100, requestedPercent));
      const availableWidth = containerRef.current?.getBoundingClientRect().width;
      const currentWidth = dockRef.current?.getBoundingClientRect().width;
      if (availableWidth && currentWidth && currentWidth > 16) {
        const nextWidth = Math.min(availableWidth - 6, availableWidth * percent / 100);
        const ratio = Math.max(0, nextWidth - 16) / (currentWidth - 16);
        setPanelWidths((current) => Object.fromEntries(Object.entries(current).map(([tab, width]) => [tab, Math.max(96, width * ratio)])));
      }
      setDockWidth(percent);
    };
    const moveDivider = (event: PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect?.width) setDockSize((rect.right - event.clientX) / rect.width * 100);
    };

    const resizePanel = (tab: AppTab, requestedWidth: number) => {
      const availableWidth = containerRef.current?.getBoundingClientRect().width;
      if (!availableWidth) return;
      const width = Math.max(96, Math.min(availableWidth - 22, requestedWidth));
      setPanelWidths((current) => ({ ...current, [tab]: width }));
      setDockWidth((current) => enabledPanels.length === 1 ? (width + 22) / availableWidth * 100 : Math.max(current, (width + 22) / availableWidth * 100));
    };

    return (
      <WorkspacePanelsContext.Provider value={enabledPanels}>
        <div ref={containerRef} className="piecemaker-workspace-panels">
          <div className="piecemaker-workspace-primary" hidden={Boolean(expandedTab)}>
            <Workspace {...props} activeTab={mainTab} setActiveTab={select} />
          </div>
          {!props.isLoading && props.selectedProject && enabledPanels.length > 0 && <>
            {!expandedTab && !props.isMobile && <div
              role="separator" aria-label="Largeur des volets" aria-orientation="vertical"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(dockWidth)} tabIndex={0}
              className="piecemaker-workspace-divider"
              onPointerDown={resizeDock} onPointerMove={moveDivider}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                setDockSize(dockWidth + (event.key === 'ArrowLeft' ? 2 : -2));
              }}
            />}
            <aside ref={dockRef} className={`piecemaker-workspace-dock ${expandedTab ? 'is-expanded' : ''} ${enabledPanels.length > 2 ? 'has-columns' : ''}`} style={{ width: expandedTab || props.isMobile ? '100%' : `${dockWidth}%` }} aria-label="Volets des outils">
              {enabledPanels.map((tab) => {
                const plugin = plugins.find((item) => tab === `plugin:${item.name}`);
                const label = plugin?.displayName ?? t(`tabs.${tab === 'tasks' ? 'library' : tab}`);
                return <Card key={`${props.selectedProject!.projectId}:${tab}`} hidden={Boolean(expandedTab && expandedTab !== tab)} style={{ width: panelWidths[tab] }} className={`piecemaker-workspace-panel ${expandedTab === tab ? 'is-expanded' : ''}`}>
                  {!expandedTab && <div
                    role="separator" aria-orientation="vertical"
                    aria-label={`Largeur ${label} bord gauche`}
                    tabIndex={0} className="piecemaker-workspace-panel-resize"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      panelResizeRef.current = { tab, x: event.clientX, width: event.currentTarget.parentElement!.getBoundingClientRect().width };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      const drag = panelResizeRef.current;
                      if (drag?.tab !== tab || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      resizePanel(tab, drag.width - (event.clientX - drag.x));
                    }}
                    onPointerUp={(event) => {
                      panelResizeRef.current = null;
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                    onPointerCancel={() => { panelResizeRef.current = null; }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      resizePanel(tab, event.currentTarget.parentElement!.getBoundingClientRect().width + (event.key === 'ArrowRight' ? -10 : 10));
                    }}
                  />}
                  <header className="piecemaker-workspace-panel-header">
                    <span className="truncate text-sm font-medium">{label}</span>
                    <button type="button" aria-label={`${expandedTab === tab ? 'Réduire' : 'Agrandir'} ${label}`} onClick={() => setExpanded(expandedTab === tab ? null : tab)}>{expandedTab === tab ? <Minimize2 /> : <Maximize2 />}</button>
                    <button type="button" aria-label={`Fermer ${label}`} onClick={() => close(tab)}><X /></button>
                  </header>
                  <div className="piecemaker-workspace-panel-content">
                    {tab === 'files' && <FileTree selectedProject={props.selectedProject} onFileOpen={openInEditor} />}
                    {tab === 'git' && <GitPanel selectedProject={props.selectedProject} isMobile={props.isMobile} onFileOpen={openInEditor} onProjectSelect={props.onProjectSelect} onProjectsRefresh={props.onProjectsRefresh} />}
                    {tab === 'tasks' && <TaskMasterPanel isVisible={!expandedTab || expandedTab === tab} />}
                    {tab === 'browser' && <BrowserUsePanel isVisible={!expandedTab || expandedTab === tab} onShowSettings={props.onShowSettings} />}
                    {plugin && <PluginTabContent pluginName={plugin.name} selectedProject={props.selectedProject} selectedSession={props.selectedSession} onOpenFileInEditor={openInEditor} />}
                  </div>
                </Card>;
              })}
            </aside>
          </>}
        </div>
      </WorkspacePanelsContext.Provider>
    );
  };
}
