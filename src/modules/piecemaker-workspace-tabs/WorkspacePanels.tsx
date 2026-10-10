import { Maximize2, Minimize2, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, Dispatch, PointerEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { BrowserUsePanel, useBrowserUseEnabled } from '@/modules/browser-use';
import { FileTree } from '@/modules/file-tree';
import { GitPanel } from '@/modules/git-panel';
import { PluginTabContent, usePlugins } from '@/modules/plugins';
import { WorkspaceColumnSeparator } from '@/modules/piecemaker-workspace-tabs/WorkspaceColumnSeparator';
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

type WorkspaceColumn = {
  id: AppTab;
  tabs: AppTab[];
  width: number;
  split: number;
};

export function withWorkspacePanels<Props extends WorkspaceProps>(Workspace: ComponentType<Props>) {
  return function WorkspacePanels(props: Props) {
    const { activeTab, setActiveTab } = props;
    const { t } = useTranslation();
    const { plugins } = usePlugins();
    const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
    const browserEnabled = useBrowserUseEnabled();
    const [mainTab, setMainTab] = useState<AppTab>(props.activeTab === 'shell' ? 'shell' : 'chat');
    const [columns, setColumns] = useState<WorkspaceColumn[]>([]);
    const [expanded, setExpanded] = useState<AppTab | null>(null);
    const [dockWidth, setDockWidth] = useState(48);
    const containerRef = useRef<HTMLDivElement>(null);
    const dockRef = useRef<HTMLElement>(null);
    const dividerCoordinateRef = useRef(0);
    const columnRefs = useRef(new Map<AppTab, HTMLDivElement>());
    const enabledColumns = columns.map((column) => ({ ...column, tabs: column.tabs.filter((tab) => tab === 'tasks' ? tasksEnabled && isTaskMasterInstalled
      : tab === 'browser' ? browserEnabled
        : tab.startsWith('plugin:') ? plugins.some((plugin) => plugin.enabled && tab === `plugin:${plugin.name}`) : true) })).filter((column) => column.tabs.length > 0);
    const enabledPanels = enabledColumns.flatMap((column) => column.tabs);
    const expandedTab = expanded && enabledPanels.includes(expanded) ? expanded : null;

    const open = useCallback((tab: AppTab) => {
      if (tab === 'chat' || tab === 'shell') {
        setMainTab(tab);
        setExpanded(null);
      } else {
        setColumns((current) => {
          if (current.some((column) => column.tabs.includes(tab))) return current;
          const available = current.find((column) => column.tabs.length < 2);
          return available ? current.map((column) => column === available ? { ...column, tabs: [...column.tabs, tab] } : column)
            : [...current, { id: tab, tabs: [tab], width: current.length ? current.reduce((sum, column) => sum + column.width, 0) / current.length : 1, split: 50 }];
        });
      }
    }, []);

    useEffect(() => {
      setColumns([]);
      setExpanded(null);
    }, [props.selectedProject?.projectId]);
    useEffect(() => open(props.activeTab), [props.activeTab, props.selectedProject?.projectId, open]);

    const select: Dispatch<SetStateAction<AppTab>> = useCallback((action) => {
      const tab = typeof action === 'function' ? action(activeTab) : action;
      open(tab);
      setActiveTab(tab);
    }, [activeTab, setActiveTab, open]);

    const close = (tab: AppTab) => {
      setColumns((current) => current.map((column) => ({ ...column, tabs: column.tabs.filter((item) => item !== tab) })).filter((column) => column.tabs.length > 0));
      if (expanded === tab) setExpanded(null);
      if (props.activeTab === tab) props.setActiveTab(mainTab);
    };

    const setDockSize = (requestedPercent: number) => {
      let percent = Math.max(0, Math.min(100, requestedPercent));
      const availableWidth = containerRef.current?.getBoundingClientRect().width;
      const currentWidth = dockRef.current?.getBoundingClientRect().width;
      const first = enabledColumns[0];
      const firstWidth = first && columnRefs.current.get(first.id)?.getBoundingClientRect().width;
      if (availableWidth && currentWidth && firstWidth) {
        const nextWidth = Math.max(currentWidth - firstWidth + Math.min(32, firstWidth), Math.min(availableWidth - 6, availableWidth * percent / 100));
        const delta = nextWidth - currentWidth;
        const widths = new Map(enabledColumns.map((column, index) => [column.id, (columnRefs.current.get(column.id)?.getBoundingClientRect().width ?? 0) + (index === 0 ? delta : 0)]));
        setColumns((current) => current.map((column) => ({ ...column, width: widths.get(column.id) ?? column.width })));
        percent = nextWidth / availableWidth * 100;
      }
      setDockWidth(percent);
    };
    const moveDivider = (event: PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const rect = containerRef.current?.getBoundingClientRect();
      const delta = event.clientX - dividerCoordinateRef.current;
      dividerCoordinateRef.current = event.clientX;
      if (rect?.width) setDockSize(dockWidth - delta / rect.width * 100);
    };

    const resizeColumns = (left: WorkspaceColumn, right: WorkspaceColumn, delta: number) => {
      const leftWidth = columnRefs.current.get(left.id)?.getBoundingClientRect().width ?? 0;
      const rightWidth = columnRefs.current.get(right.id)?.getBoundingClientRect().width ?? 0;
      const total = leftWidth + rightWidth;
      if (!total) return;
      const minimum = Math.min(32, total / 2);
      const nextLeft = Math.max(minimum, Math.min(total - minimum, leftWidth + delta));
      const totalWeight = left.width + right.width;
      setColumns((current) => current.map((column) => column.id === left.id ? { ...column, width: totalWeight * nextLeft / total }
        : column.id === right.id ? { ...column, width: totalWeight * (total - nextLeft) / total } : column));
    };

    const resizeRows = (column: WorkspaceColumn, delta: number) => {
      const height = (columnRefs.current.get(column.id)?.getBoundingClientRect().height ?? 0) - 6;
      if (height <= 0) return;
      const minimum = Math.min(80 / height * 100, 50);
      setColumns((current) => current.map((item) => item.id === column.id ? { ...item, split: Math.max(minimum, Math.min(100 - minimum, item.split + delta / height * 100)) } : item));
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
              className="piecemaker-workspace-divider is-dock-edge"
              onPointerDown={(event) => { event.preventDefault(); dividerCoordinateRef.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={moveDivider}
              onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                setDockSize(dockWidth + (event.key === 'ArrowLeft' ? 2 : -2));
              }}
            />}
            <aside ref={dockRef} className={`piecemaker-workspace-dock ${expandedTab ? 'is-expanded' : ''}`} style={{ width: expandedTab || props.isMobile ? '100%' : `${dockWidth}%` }} aria-label="Volets des outils">
              {enabledColumns.map((column, columnIndex) => <Fragment key={`${props.selectedProject!.projectId}:${column.id}`}>
                {columnIndex > 0 && !expandedTab && <WorkspaceColumnSeparator orientation="vertical" label={`Largeur colonnes ${columnIndex} et ${columnIndex + 1}`} value={enabledColumns[columnIndex - 1].width / (enabledColumns[columnIndex - 1].width + column.width) * 100} onMove={(delta) => resizeColumns(enabledColumns[columnIndex - 1], column, delta)} />}
                <div className="piecemaker-workspace-column" hidden={Boolean(expandedTab && !column.tabs.includes(expandedTab))} style={{ flexGrow: expandedTab ? 1 : column.width }} ref={(element) => { if (element) columnRefs.current.set(column.id, element); else columnRefs.current.delete(column.id); }}>
                  {column.tabs.map((tab, rowIndex) => {
                    const plugin = plugins.find((item) => tab === `plugin:${item.name}`);
                    const label = plugin?.displayName ?? t(`tabs.${tab === 'tasks' ? 'library' : tab}`);
                    return <Fragment key={tab}>
                      {rowIndex > 0 && !expandedTab && <WorkspaceColumnSeparator orientation="horizontal" label={`Hauteur fenêtres colonne ${columnIndex + 1}`} value={column.split} onMove={(delta) => resizeRows(column, delta)} />}
                      <Card className="piecemaker-workspace-panel" hidden={Boolean(expandedTab && expandedTab !== tab)} style={{ flexGrow: expandedTab || column.tabs.length === 1 ? 1 : rowIndex === 0 ? column.split : 100 - column.split }}>
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
                      </Card>
                    </Fragment>;
                  })}
                </div>
              </Fragment>)}
            </aside>
          </>}
        </div>
      </WorkspacePanelsContext.Provider>
    );
  };
}
