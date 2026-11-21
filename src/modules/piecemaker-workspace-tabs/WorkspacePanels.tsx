import { ArrowLeft, Maximize2, Minimize2, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, Dispatch, PointerEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { BrowserUsePanel, useBrowserUseEnabled } from '@/modules/browser-use';
import { GitPanel } from '@/modules/git-panel';
import { PluginTabContent, usePlugins } from '@/modules/plugins';
import { AgentPanel } from '@/modules/piecemaker-workspace-tabs/agent/AgentPanel';
import { openAgentOutput } from '@/modules/piecemaker-workspace-tabs/agent/openAgentOutput';
import { NestedWorkspaceContext, SubagentContext, useSubagentHost } from '@/modules/piecemaker-workspace-tabs/agent/subagent';
import { useAgentSession } from '@/modules/piecemaker-workspace-tabs/agent/useAgentSession';
import { PanelAnonymizationButton } from '@/modules/piecemaker-workspace-tabs/PanelAnonymizationButton';
import { PanelPickButton } from '@/modules/piecemaker-workspace-tabs/PanelPickButton';
import { WorkspaceColumnSeparator } from '@/modules/piecemaker-workspace-tabs/WorkspaceColumnSeparator';
import { WorkspaceFilesPanel } from '@/modules/piecemaker-workspace-tabs/WorkspaceFilesPanel';
import type { WorkspaceFilesSlots } from '@/modules/piecemaker-workspace-tabs/WorkspaceFilesPanel';
import { AgentSessionContext, CloseWorkspacePanelContext, WorkspacePanelsContext } from '@/modules/piecemaker-workspace-tabs/context/WorkspacePanelsContext';
import { WorkspaceViewerContext } from '@/modules/piecemaker-workspace-tabs/context/WorkspaceViewerContext';
import { useAutoPanel } from '@/modules/piecemaker-workspace-tabs/useAutoPanel';
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
  onMenuClick?: () => void;
};

type NestedProps = {
  nested?: boolean;
  onPanelsChange?: (open: boolean) => void;
};

type WorkspaceColumn = {
  id: AppTab | 'viewer';
  tabs: AppTab[];
  width: number;
  split: number;
};

export function withWorkspacePanels<Props extends WorkspaceProps>(Workspace: ComponentType<Props>) {
  return function WorkspacePanels(props: Props & NestedProps) {
    const { activeTab, setActiveTab } = props;
    const { t } = useTranslation();
    const { plugins } = usePlugins();
    const browserEnabled = useBrowserUseEnabled();
    const [mainTab, setMainTab] = useState<AppTab>(props.activeTab === 'shell' ? 'shell' : 'chat');
    const [columns, setColumns] = useState<WorkspaceColumn[]>([]);
    const [expanded, setExpanded] = useState<AppTab | 'viewer' | null>(null);
    const [expandedCompanion, setExpandedCompanion] = useState<AppTab | 'viewer' | null>(null);
    const [dockWidth, setDockWidth] = useState(48);
    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerTarget, setViewerTarget] = useState<HTMLElement | null>(null);
    const [viewerWidth, setViewerWidth] = useState<number | null>(null);
    const [filesSlots, setFilesSlots] = useState<WorkspaceFilesSlots | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dockRef = useRef<HTMLElement>(null);
    const dividerCoordinateRef = useRef(0);
    const columnRefs = useRef(new Map<AppTab | 'viewer', HTMLDivElement>());
    const subagent = useSubagentHost(props.selectedProject?.fullPath ?? null, !props.nested);
    const [subagentTab, setSubagentTab] = useState<AppTab>('chat');
    const [subagentFull, setSubagentFull] = useState(false);
    const closeViewerRef = useRef<(() => void) | null>(null);
    const isAgentSession = useAgentSession(props.selectedProject?.fullPath ?? null, props.selectedSession?.id ?? null);
    const enabledColumns = columns.map((column) => ({ ...column, tabs: column.tabs.filter((tab) => tab === 'tasks' ? false
      : tab === 'agent' ? isAgentSession
      : tab === 'browser' ? browserEnabled
        : tab.startsWith('plugin:') ? plugins.some((plugin) => plugin.enabled && tab === `plugin:${plugin.name}`) : true) })).filter((column) => column.tabs.length > 0);
    const enabledPanels = enabledColumns.flatMap((column) => column.tabs);
    const filesHost = enabledPanels.includes('files') ? filesSlots : null;
    const expandedTab = expanded === 'viewer' ? viewerOpen ? filesHost ? 'files' : expanded : null : expanded && enabledPanels.includes(expanded) ? expanded : null;
    const viewerColumn: WorkspaceColumn | null = viewerOpen && !filesHost
      ? { id: 'viewer', tabs: [], width: viewerWidth ?? (enabledColumns.length ? enabledColumns.reduce((sum, column) => sum + column.width, 0) / enabledColumns.length : 1), split: 100 }
      : null;
    const allLayoutColumns: WorkspaceColumn[] = [...enabledColumns, ...(viewerColumn ? [viewerColumn] : [])];
    const expandedColumn = expandedTab === 'viewer' ? viewerColumn : enabledColumns.find((column) => column.tabs.includes(expandedTab as AppTab)) ?? null;
    const companionColumn = expandedCompanion === 'viewer' ? viewerColumn : enabledColumns.find((column) => column.tabs.includes(expandedCompanion as AppTab)) ?? null;
    const hasExpandedPair = Boolean(expandedTab && expandedColumn && companionColumn && expandedColumn.id !== companionColumn.id);
    const layoutColumns: WorkspaceColumn[] = hasExpandedPair
      ? [expandedColumn!, companionColumn!, ...allLayoutColumns.filter((column) => column.id !== expandedColumn!.id && column.id !== companionColumn!.id)]
      : allLayoutColumns;
    const registerViewer = useCallback((open: boolean) => {
      setViewerOpen(open);
      if (open && expandedTab && expandedTab !== 'files' && expandedTab !== 'viewer') {
        if (filesHost) {
          setExpandedCompanion('files');
          setColumns((current) => {
            const expandedColumn = current.find((column) => column.tabs.includes(expandedTab));
            const filesColumn = current.find((column) => column.tabs.includes('files'));
            if (!expandedColumn || !filesColumn || expandedColumn.id !== filesColumn.id) return current;
            const remainingTabs = expandedColumn.tabs.filter((tab) => tab !== 'files');
            const width = expandedColumn.width / 2;
            const leftColumn = { ...expandedColumn, id: expandedColumn.id === 'files' ? remainingTabs[0] ?? expandedTab : expandedColumn.id, tabs: remainingTabs, width };
            return current.flatMap((column) => column.id === expandedColumn.id ? [leftColumn, { id: 'files', tabs: ['files'], width, split: 100 }] : [column]);
          });
        } else {
          setExpandedCompanion('viewer');
        }
      }
      if (!open) {
        setExpanded((current) => current === 'viewer' ? null : current);
        setExpandedCompanion(null);
      }
    }, [expandedTab, filesHost]);
    useEffect(() => {
      if (viewerOpen && props.isMobile) setExpanded(filesHost ? 'files' : 'viewer');
    }, [viewerOpen, props.isMobile, filesHost]);
    const toggleViewerExpand = useCallback(() => {
      setExpanded(expandedTab === 'viewer' ? null : 'viewer');
      setExpandedCompanion(null);
    }, [expandedTab]);
    const toggleFilesExpand = useCallback(() => {
      setExpanded(expandedTab === 'files' ? null : 'files');
      setExpandedCompanion(null);
    }, [expandedTab]);
    const bindViewerColumn = useCallback((element: HTMLDivElement | null) => {
      if (element) columnRefs.current.set('viewer', element);
      else columnRefs.current.delete('viewer');
      setViewerTarget(element);
    }, []);

    const open = useCallback((tab: AppTab) => {
      if (tab === 'chat' || tab === 'shell') {
        setMainTab(tab);
        setExpanded(null);
        setExpandedCompanion(null);
      } else {
        if (expandedTab && !columns.some((column) => column.tabs.includes(tab))) setExpandedCompanion(tab);
        setColumns((current) => {
          if (current.some((column) => column.tabs.includes(tab))) return current;
          if (expandedTab) {
            const expandedColumnIndex = expandedTab === 'viewer' ? -1 : current.findIndex((column) => column.tabs.includes(expandedTab));
            const newColumn = { id: tab, tabs: [tab], width: current.length ? current.reduce((sum, column) => sum + column.width, 0) / current.length : 1, split: 50 };
            if (expandedColumnIndex < 0) return [...current, newColumn];
            return [...current.slice(0, expandedColumnIndex + 1), newColumn, ...current.slice(expandedColumnIndex + 1)];
          }
          const agentColumn = isAgentSession && tab !== 'agent' ? current.find((column) => column.tabs.length === 1 && column.tabs[0] === 'agent') : undefined;
          if (agentColumn) return current.map((column) => column === agentColumn ? { ...column, tabs: [tab, 'agent'] } : column);
          const available = current.find((column) => column.tabs.length < 2);
          return available ? current.map((column) => column === available ? { ...column, tabs: [...column.tabs, tab] } : column)
            : [...current, { id: tab, tabs: [tab], width: current.length ? current.reduce((sum, column) => sum + column.width, 0) / current.length : columnRefs.current.get('viewer')?.getBoundingClientRect().width || 1, split: 50 }];
        });
      }
    }, [columns, expandedTab, isAgentSession]);

    const close = useCallback((tab: AppTab) => {
      if (tab === 'files' && filesHost && viewerOpen) {
        closeViewerRef.current?.();
        setViewerOpen(false);
      }
      setColumns((current) => current.map((column) => ({ ...column, tabs: column.tabs.filter((item) => item !== tab) })).filter((column) => column.tabs.length > 0));
      setExpanded((current) => current === tab ? null : current);
      setExpandedCompanion(null);
      if (props.activeTab === tab) props.setActiveTab(mainTab);
    }, [mainTab, props, filesHost, viewerOpen]);

    useAutoPanel(props.selectedSession?.id ?? null, props.selectedProject?.fullPath ?? null, open, close);

    const { onPanelsChange } = props;
    const panelsOpen = enabledPanels.length > 0 || viewerOpen;
    useEffect(() => onPanelsChange?.(panelsOpen), [onPanelsChange, panelsOpen]);
    const subagentThread = subagent.current?.thread.id ?? null;
    useEffect(() => {
      setSubagentTab('chat');
      setSubagentFull(false);
    }, [subagentThread]);
    const subagentOpening = subagent.current?.open ?? null;
    const subagentFolder = subagent.current?.project.fullPath ?? null;
    useEffect(() => {
      if (!subagentOpening || !subagentFolder) return;
      const timer = window.setTimeout(() => openAgentOutput(subagentFolder, subagentOpening), 0);
      return () => window.clearTimeout(timer);
    }, [subagentOpening, subagentFolder]);

    useEffect(() => {
      setColumns([]);
      setExpanded(null);
      setExpandedCompanion(null);
      setViewerWidth(null);
    }, [props.selectedProject?.projectId]);
    const openRef = useRef(open);
    openRef.current = open;
    useEffect(() => openRef.current(props.activeTab), [props.activeTab, props.selectedProject?.projectId]);
    useEffect(() => {
      if (isAgentSession && !props.isMobile) openRef.current('agent');
    }, [isAgentSession, props.isMobile, props.selectedSession?.id]);

    const select: Dispatch<SetStateAction<AppTab>> = useCallback((action) => {
      const tab = typeof action === 'function' ? action(activeTab) : action;
      open(tab);
      setActiveTab(tab);
    }, [activeTab, setActiveTab, open]);

    const setDockSize = (requestedPercent: number) => {
      let percent = Math.max(0, Math.min(100, requestedPercent));
      const availableWidth = containerRef.current?.getBoundingClientRect().width;
      const currentWidth = dockRef.current?.getBoundingClientRect().width;
      const first = layoutColumns[0];
      const firstWidth = first && columnRefs.current.get(first.id)?.getBoundingClientRect().width;
      if (availableWidth && currentWidth && firstWidth) {
        const nextWidth = Math.max(currentWidth - firstWidth + Math.min(32, firstWidth), Math.min(availableWidth - 6, availableWidth * percent / 100));
        const delta = nextWidth - currentWidth;
        const widths = new Map(layoutColumns.map((column, index) => [column.id, (columnRefs.current.get(column.id)?.getBoundingClientRect().width ?? 0) + (index === 0 ? delta : 0)]));
        setColumns((current) => current.map((column) => ({ ...column, width: widths.get(column.id) ?? column.width })));
        if (widths.has('viewer')) setViewerWidth(widths.get('viewer')!);
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
      if (left.id === 'viewer') setViewerWidth(totalWeight * nextLeft / total);
      if (right.id === 'viewer') setViewerWidth(totalWeight * (total - nextLeft) / total);
    };

    const resizeRows = (column: WorkspaceColumn, delta: number) => {
      const height = (columnRefs.current.get(column.id)?.getBoundingClientRect().height ?? 0) - 6;
      if (height <= 0) return;
      const minimum = Math.min(80 / height * 100, 50);
      setColumns((current) => current.map((item) => item.id === column.id ? { ...item, split: Math.max(minimum, Math.min(100 - minimum, item.split + delta / height * 100)) } : item));
    };

    return (
      <WorkspaceViewerContext.Provider value={filesHost ? { target: filesHost.viewer, tabsTarget: filesHost.tabs, register: registerViewer, closeRef: closeViewerRef, expanded: expandedTab === 'files', toggleExpand: toggleFilesExpand }
        : { target: viewerTarget, tabsTarget: null, register: registerViewer, closeRef: closeViewerRef, expanded: expandedTab === 'viewer', toggleExpand: toggleViewerExpand }}>
      <WorkspacePanelsContext.Provider value={enabledPanels}>
      <CloseWorkspacePanelContext.Provider value={close}>
      <AgentSessionContext.Provider value={isAgentSession}>
      <SubagentContext.Provider value={subagent.api}>
        <div ref={containerRef} className="piecemaker-workspace-panels">
          <div className="piecemaker-workspace-primary" hidden={Boolean(expandedTab)}>
            <Workspace {...props} activeTab={mainTab} setActiveTab={select} />
          </div>
          {!props.isLoading && props.selectedProject && layoutColumns.length > 0 && <>
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
              {layoutColumns.map((column, columnIndex) => <Fragment key={`${props.selectedProject!.projectId}:${column.id}`}>
                {columnIndex > 0 && (!expandedTab || hasExpandedPair && column.id === companionColumn?.id) && <WorkspaceColumnSeparator orientation="vertical" label={`Largeur colonnes ${columnIndex} et ${columnIndex + 1}`} value={layoutColumns[columnIndex - 1].width / (layoutColumns[columnIndex - 1].width + column.width) * 100} onMove={(delta) => resizeColumns(layoutColumns[columnIndex - 1], column, delta)} />}
                <div className="piecemaker-workspace-column" aria-label={column.id === 'viewer' ? 'Colonne visionneuse' : undefined} hidden={Boolean(expandedTab && (hasExpandedPair ? column.id !== expandedColumn?.id && column.id !== companionColumn?.id : column.id === 'viewer' ? expandedTab !== 'viewer' : expandedTab === 'viewer' || !column.tabs.includes(expandedTab)))} style={{ flexGrow: hasExpandedPair || !expandedTab ? column.width : 1 }} ref={column.id === 'viewer' ? bindViewerColumn : (element) => { if (element) columnRefs.current.set(column.id, element); else columnRefs.current.delete(column.id); }}>
                  {column.tabs.map((tab, rowIndex) => {
                    const plugin = plugins.find((item) => tab === `plugin:${item.name}`);
                    const label = plugin?.displayName ?? t(`tabs.${tab}`);
                    const hidden = Boolean(expandedTab && (hasExpandedPair ? tab !== expandedTab && tab !== expandedCompanion : expandedTab !== tab));
                    const style = { flexGrow: hasExpandedPair || expandedTab || column.tabs.length === 1 ? 1 : rowIndex === 0 ? column.split : 100 - column.split };
                    const panelActions = <>
                      <PanelPickButton tab={tab} closeOnPick={props.isMobile} />
                      <PanelAnonymizationButton tab={tab} />
                      <button type="button" aria-label={`${expandedTab === tab ? 'Réduire' : 'Agrandir'} ${label}`} onClick={() => { setExpanded(expandedTab === tab ? null : tab); setExpandedCompanion(null); }}>{expandedTab === tab ? <Minimize2 /> : <Maximize2 />}</button>
                      <button type="button" aria-label={`Fermer ${label}`} onClick={() => close(tab)}><X /></button>
                    </>;
                    return <Fragment key={tab}>
                      {rowIndex > 0 && !expandedTab && <WorkspaceColumnSeparator orientation="horizontal" label={`Hauteur fenêtres colonne ${columnIndex + 1}`} value={column.split} onMove={(delta) => resizeRows(column, delta)} />}
                      {tab === 'files' ? <WorkspaceFilesPanel label={label} selectedProject={props.selectedProject} documentOpen={viewerOpen} expanded={expandedTab === tab} hidden={hidden} style={style} onSlots={setFilesSlots} onToggleExpand={toggleFilesExpand} onClose={() => close(tab)} />
                      : <Card className="piecemaker-workspace-panel" hidden={hidden} style={style}>
                        {tab === 'agent' ? <AgentPanel key={props.selectedProject!.fullPath} projectId={props.selectedProject!.projectId} projectPath={props.selectedProject!.fullPath} panelActions={panelActions} onShowSettings={props.onShowSettings} /> : <>
                          <header className="piecemaker-workspace-panel-header">
                            <span className="truncate text-sm font-medium">{label}</span>
                            {panelActions}
                          </header>
                          <div className="piecemaker-workspace-panel-content">
                            {tab === 'git' && <GitPanel selectedProject={props.selectedProject} isMobile={props.isMobile} onFileOpen={(filePath) => openInEditor(filePath)} onProjectSelect={props.onProjectSelect} onProjectsRefresh={props.onProjectsRefresh} />}
                            {tab === 'browser' && <BrowserUsePanel isVisible={!expandedTab || expandedTab === tab} onShowSettings={props.onShowSettings} />}
                            {plugin && <PluginTabContent pluginName={plugin.name} selectedProject={props.selectedProject} selectedSession={props.selectedSession} onOpenFileInEditor={openInEditor} />}
                          </div>
                        </>}
                      </Card>}
                    </Fragment>;
                  })}
                </div>
              </Fragment>)}
            </aside>
          </>}
          {subagent.current && <section className={`pm-subagent ${subagentFull ? 'is-full' : ''}`} style={{ width: subagentFull || props.isMobile ? '100%' : `${dockWidth}%` }} aria-label={`Fil ${subagent.current.thread.title}`}>
            <header className="pm-subagent-bar">
              <button type="button" aria-label="Revenir à l’agent central" title="Revenir à l’agent central" onClick={subagent.close}><ArrowLeft /></button>
              <span className="pm-subagent-title">{subagent.current.thread.title}</span>
              <span className="pm-subagent-folder">{subagent.current.project.displayName}</span>
            </header>
            <div className="pm-subagent-body">
              <NestedWorkspaceContext.Provider value={true}>
                <WorkspacePanels key={subagent.current.thread.id} {...({
                  ...props,
                  nested: true,
                  selectedProject: subagent.current.project,
                  selectedSession: subagent.current.session,
                  activeTab: subagentTab,
                  setActiveTab: setSubagentTab,
                  onMenuClick: () => undefined,
                  onNavigateToSession: subagent.followSession,
                  onPanelsChange: setSubagentFull,
                } as Props & NestedProps)} />
              </NestedWorkspaceContext.Provider>
            </div>
          </section>}
        </div>
      </SubagentContext.Provider>
      </AgentSessionContext.Provider>
      </CloseWorkspacePanelContext.Provider>
      </WorkspacePanelsContext.Provider>
      </WorkspaceViewerContext.Provider>
    );
  };
}
