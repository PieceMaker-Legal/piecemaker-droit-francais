import { useState } from 'react';

import { AgentChat } from '@/modules/piecemaker-agent/AgentChat';
import { AgentPanel } from '@/modules/piecemaker-agent/AgentPanel';
import type { AgentPanelTab } from '@/modules/piecemaker-agent/AgentPanel';
import type { AgentOutput } from '@/modules/piecemaker-agent/api';
import { openAgentOutput } from '@/modules/piecemaker-agent/openAgentOutput';
import { useAgentState } from '@/modules/piecemaker-agent/useAgentState';

type Props = { projectName: string; projectPath: string; isMobile: boolean; onMenu?: () => void };

export function AgentWorkspace({ projectName, projectPath, isMobile, onMenu }: Props) {
  const { state, error, act } = useAgentState(projectPath);
  const [panelOpen, setPanelOpen] = useState(!isMobile);
  const [tab, setTab] = useState<AgentPanelTab>('threads');
  const [expanded, setExpanded] = useState(false);
  const openOutput = (output: AgentOutput) => openAgentOutput(projectPath, output);

  if (!state) {
    return <div className="flex h-full items-center justify-center bg-zinc-950 text-sm text-zinc-400" data-agent-workspace>
      {error ? `PieceMaker Agent indisponible : ${error}` : 'Chargement de PieceMaker Agent…'}
    </div>;
  }

  return <div className="flex h-full min-h-0 bg-zinc-950 text-zinc-100" data-agent-workspace>
    <div className="min-w-0 flex-1" hidden={panelOpen && (expanded || isMobile)}>
      <AgentChat projectName={projectName} projectPath={projectPath} state={state} error={error} act={act} panelOpen={panelOpen}
        onOpenPanel={(next) => { if (next) setTab(next); setPanelOpen(true); }} onOpenOutput={openOutput} onMenu={isMobile ? onMenu : undefined} />
    </div>
    {panelOpen && <div className={`min-h-0 border-l border-white/10 ${expanded || isMobile ? 'flex-1' : 'w-[380px] shrink-0'}`}>
      <AgentPanel state={state} act={act} projectPath={projectPath} tab={tab} onTab={setTab} expanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)} onCollapse={() => { setPanelOpen(false); setExpanded(false); }}
        onOpenArtifact={(url) => openOutput({ kind: 'artifact', ref: url })} />
    </div>}
  </div>;
}
