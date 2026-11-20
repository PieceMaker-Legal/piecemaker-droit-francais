import type { AgentOutput } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import { openInEditor } from '@/piecemaker/editor-tabs/editorPanels';

export function openAgentOutput(projectPath: string, output: AgentOutput) {
  if (output.kind === 'file') {
    openInEditor(/^(?:[a-z]:[\\/]|[\\/])/i.test(output.ref) ? output.ref : `${projectPath.replace(/[\\/]$/, '')}/${output.ref}`);
  } else if (output.kind === 'artifact') {
    const artifact = output.ref.replace(/^piecemaker:\/\/artifact\/|^\/artifacts\//, '').split(/[/?#]/)[0];
    Object.assign(window, { __piecemakerArtifactsShow: { project: projectPath, artifact } });
    window.dispatchEvent(new CustomEvent('piecemaker:open-panel', { detail: { tab: 'plugin:piecemaker-artifacts' } }));
    window.dispatchEvent(new Event('piecemaker:artifacts-show'));
  } else if (/^https?:\/\//i.test(output.ref)) {
    window.open(output.ref, '_blank', 'noopener,noreferrer');
  }
}
