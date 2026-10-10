import { ClipboardCheck, Folder, Globe, MessageSquare, MoreVertical, Terminal } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { PluginIcon, usePlugins } from '@/modules/plugins';
import type { AppTab } from '@/shared/types';
import { ActionMenu, Tooltip } from '@/shared/ui';
import '@/modules/piecemaker-workspace-tabs/workspaceIconTabs.css';

type WorkspaceIconTabsProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
};

export function WorkspaceIconTabs({ activeTab, setActiveTab, shouldShowTasksTab, shouldShowBrowserTab }: WorkspaceIconTabsProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const tabs = [
    { id: 'chat' as AppTab, label: t('tabs.chat'), icon: MessageSquare },
    { id: 'files' as AppTab, label: t('tabs.files'), icon: Folder },
    ...(shouldShowTasksTab ? [{ id: 'tasks' as AppTab, label: t('tabs.library'), icon: ClipboardCheck }] : []),
    ...(shouldShowBrowserTab ? [{ id: 'browser' as AppTab, label: t('tabs.browser'), icon: Globe }] : []),
    { id: 'shell' as AppTab, label: t('tabs.shell'), icon: Terminal },
    ...plugins.filter((plugin) => plugin.enabled).map((plugin) => ({
      id: `plugin:${plugin.name}` as AppTab,
      label: plugin.displayName,
      icon: null,
      plugin,
    })),
  ];

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setAvailableWidth(container.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const capacity = Math.max(0, Math.floor((availableWidth + 4) / 44));
  const visibleCount = capacity >= tabs.length ? tabs.length : Math.max(0, capacity - 1);
  const visibleTabs = tabs.slice(0, visibleCount);
  const active = tabs.find((tab) => tab.id === activeTab);
  if (active && visibleCount > 0 && !visibleTabs.includes(active)) visibleTabs[visibleCount - 1] = active;
  const overflowTabs = tabs.filter((tab) => !visibleTabs.includes(tab));

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const index = buttons.indexOf(event.currentTarget);
    const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
      : event.key === 'ArrowLeft' ? (index - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.click();
  };

  return (
    <div ref={containerRef} className="piecemaker-workspace-icon-tabs">
      <div role="tablist" aria-label={t('tabs.views', { defaultValue: 'Workspace views' })}>
        {visibleTabs.map((tab) => (
          <Tooltip key={tab.id} content={tab.label} position="bottom">
            <button
              type="button"
              role="tab"
              aria-label={tab.label}
              aria-selected={tab.id === activeTab}
              tabIndex={tab.id === activeTab ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={handleKeyDown}
              className="piecemaker-workspace-icon-tab"
            >
              {tab.icon ? <tab.icon /> : 'plugin' in tab && <PluginIcon pluginName={tab.plugin.name} iconFile={tab.plugin.icon} className="h-6 w-6 [&>svg]:h-full [&>svg]:w-full" />}
            </button>
          </Tooltip>
        ))}
      </div>
      {overflowTabs.length > 0 && (
        <ActionMenu
          label={t('tabs.more', { defaultValue: 'Autres onglets' })}
          icon={MoreVertical}
          iconOnly
          portal
          variant="ghost"
          size="icon"
          triggerClassName="piecemaker-workspace-icon-tab"
          items={overflowTabs.map((tab) => ({ key: tab.id, label: tab.label, icon: tab.icon ?? undefined, onSelect: () => setActiveTab(tab.id) }))}
        />
      )}
    </div>
  );
}
