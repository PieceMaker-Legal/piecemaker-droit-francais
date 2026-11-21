export const ARTIFACTS_TAB = 'plugin:piecemaker-artifacts';
export const ARTIFACTS_SHOW_EVENT = 'piecemaker:artifacts-show';
export const ARTIFACTS_SHOW_KEY = '__piecemakerArtifactsShow';

export function openArtifactInPanel(project: string, artifact: string) {
  Object.assign(window, { [ARTIFACTS_SHOW_KEY]: { project, artifact } });
  window.dispatchEvent(new CustomEvent('piecemaker:open-panel', { detail: { tab: ARTIFACTS_TAB } }));
  window.dispatchEvent(new Event(ARTIFACTS_SHOW_EVENT));
}
