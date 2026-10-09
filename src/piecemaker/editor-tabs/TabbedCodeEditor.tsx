import { useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { X } from 'lucide-react';

import CodeEditor from '@/modules/code-editor/CodeEditor';
import { CitationPanel } from '@/piecemaker/citations/CitationPanel';
import { IdentityTab } from '@/piecemaker/editor-tabs/IdentityTab';
import { parseEditorPanel } from '@/piecemaker/editor-tabs/editorPanels';
import type { CodeEditorFile } from '@/shared/types';

type CodeEditorProps = ComponentProps<typeof CodeEditor>;

const tabKey = (file: CodeEditorFile) => `${file.projectId ?? ''}\u0000${file.path}`;

function tabLabel(file: CodeEditorFile) {
  const panel = parseEditorPanel(file.path);
  if (panel?.kind === 'citation') return panel.label || 'Citation';
  if (panel?.kind === 'identity') return panel.text;
  return file.name;
}

function TabContent({ props, file, onClose }: { props: CodeEditorProps; file: CodeEditorFile; onClose: () => void }) {
  const panel = parseEditorPanel(file.path);
  if (!panel) return <CodeEditor {...props} file={file} onClose={onClose} />;
  const content = panel.kind === 'citation'
    ? <CitationPanel token={panel.token} onClose={onClose} />
    : <IdentityTab mode={panel.mode} text={panel.text} onClose={onClose} />;
  return props.isSidebar ? content : <div className="fixed inset-0 z-[9999] bg-background">{content}</div>;
}

export default function TabbedCodeEditor(props: CodeEditorProps) {
  const { file, onClose, isSidebar } = props;
  const [openedFile, setOpenedFile] = useState(file);
  const [tabs, setTabs] = useState<CodeEditorFile[]>([file]);
  const [activeKey, setActiveKey] = useState(tabKey(file));

  if (openedFile !== file) {
    setOpenedFile(file);
    setTabs((current) => current.some((tab) => tabKey(tab) === tabKey(file))
      ? current.map((tab) => tabKey(tab) === tabKey(file) ? file : tab)
      : [...current, file]);
    setActiveKey(tabKey(file));
  }

  const active = tabs.find((tab) => tabKey(tab) === activeKey) ?? tabs[tabs.length - 1];

  const closeTab = (key: string) => {
    const index = tabs.findIndex((tab) => tabKey(tab) === key);
    const remaining = tabs.filter((tab) => tabKey(tab) !== key);
    if (!remaining.length) {
      onClose();
      return;
    }
    setTabs(remaining);
    if (key === tabKey(active)) setActiveKey(tabKey(remaining[Math.max(0, index - 1)]));
  };

  const content: ReactNode = <TabContent key={tabKey(active)} props={props} file={active} onClose={() => closeTab(tabKey(active))} />;
  if (!isSidebar) return content;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {tabs.length > 1 && <div role="tablist" aria-label="Documents ouverts" className="flex shrink-0 overflow-x-auto border-b border-border bg-muted/40">
        {tabs.map((tab) => {
          const key = tabKey(tab);
          const selected = key === tabKey(active);
          const label = tabLabel(tab);
          return (
            <div key={key} className={`group flex max-w-56 shrink-0 items-center border-r border-border ${selected ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-background/60'}`}>
              <button type="button" role="tab" aria-selected={selected} title={label} className="min-w-0 truncate py-1.5 pl-3 pr-1 text-xs" onClick={() => setActiveKey(key)} onAuxClick={(event) => { if (event.button === 1) closeTab(key); }}>
                {label}
              </button>
              <button type="button" aria-label={`Fermer ${label}`} className="mr-1 rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100" onClick={() => closeTab(key)}>
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>}
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}
