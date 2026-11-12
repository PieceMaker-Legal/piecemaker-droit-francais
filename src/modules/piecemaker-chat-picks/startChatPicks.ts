import { startChatPickComposer } from '@/modules/piecemaker-chat-picks/chatPickComposer';
import { startPanelPicker } from '@/modules/piecemaker-chat-picks/panelPicker';

export function startChatPicks(): () => void {
  const stopComposer = startChatPickComposer();
  const stopPicker = startPanelPicker();
  return () => { stopPicker(); stopComposer(); };
}
