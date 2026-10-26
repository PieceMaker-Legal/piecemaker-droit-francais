import fs from 'node:fs';
import path from 'node:path';

import { piecemakerVibeBinDirectory } from '@/shared/vibe-cli.js';

import { VIBE_PACKAGE } from './vibe-install.js';

export const vibeStreamingEntrypoint = `
import asyncio
import json
import os
import sys
from vibe.cli import programmatic
from vibe.app_server.events import HistoryEntryAdded, HistoryEntryUpdated
from vibe.app_server.models import PublicMessageEntry, PublicReasoningEntry

if sys.platform == "win32":
    from vibe.core.utils import shell as shell_utils
    from vibe.core.tools.builtins import bash as bash_tool
    os.environ["PATH"] = os.path.dirname(sys.executable) + os.pathsep + os.environ.get("PATH", "")
    original_spawn_shell_command = shell_utils.spawn_shell_command

    async def spawn_windows_shell_command(command, *, cwd=None):
        if shell_utils.uses_posix_shell():
            return await original_spawn_shell_command(command, cwd=cwd)
        return await asyncio.create_subprocess_shell(
            command, cwd=cwd, env=shell_utils._shell_environment(),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.DEVNULL,
        )

    shell_utils.spawn_shell_command = spawn_windows_shell_command
    bash_tool.spawn_shell_command = spawn_windows_shell_command

class StreamingOutput(programmatic.ProgrammaticOutput):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._streamed_text = {}
        self._streamed_reasoning = {}

    def consume(self, event):
        if (self._format is programmatic.OutputFormat.STREAMING
            and isinstance(event, (HistoryEntryAdded, HistoryEntryUpdated))
            and isinstance(event.entry, PublicReasoningEntry)
            and event.entry.turn_id is not None):
            entry = event.entry
            if entry.text and self._streamed_reasoning.get(entry.id) != entry.text:
                self._streamed_reasoning[entry.id] = entry.text
                print(json.dumps({"type": "piecemaker_reasoning", "sessionId": entry.session_id,
                    "id": entry.id, "turnId": entry.turn_id, "createdAt": entry.created_at,
                    "content": entry.text}, ensure_ascii=False), file=self._stream, flush=True)
        if (self._format is programmatic.OutputFormat.STREAMING
            and isinstance(event, (HistoryEntryAdded, HistoryEntryUpdated))
            and isinstance(event.entry, PublicMessageEntry)
            and event.entry.role == "assistant"
            and event.entry.turn_id is not None):
            entry = event.entry
            previous = self._streamed_text.get(entry.id, "")
            text = entry.text
            if not text.startswith(previous):
                raise RuntimeError("Vibe replaced text already streamed to the chat")
            delta = text[len(previous):]
            if delta:
                self._streamed_text[entry.id] = text
                print(json.dumps({"type": "piecemaker_text_delta", "sessionId": entry.session_id,
                    "id": entry.id, "content": delta}, ensure_ascii=False), file=self._stream, flush=True)
        super().consume(event)

    def _emit_completed(self, entry):
        if entry.id in self._streamed_reasoning:
            if entry.generation_status is programmatic.PublicEntryGenerationStatus.COMPLETED:
                self._emitted.add(entry.id)
            return
        if entry.id in self._streamed_text and entry.id not in self._emitted:
            if entry.generation_status is programmatic.PublicEntryGenerationStatus.COMPLETED:
                self._emitted.add(entry.id)
                print(json.dumps({"type": "piecemaker_text_end", "sessionId": entry.session_id,
                    "id": entry.id, "turnId": entry.turn_id, "createdAt": entry.created_at}), file=self._stream, flush=True)
                return
        super()._emit_completed(entry)

programmatic.ProgrammaticOutput = StreamingOutput
from vibe.cli.entrypoint import main
main()
`;

let streamingUnavailableWarned = false;

export function vibeStreamingCommand(executable: string): { executable: string; args: string[] } {
  const pinnedBinDirectory = piecemakerVibeBinDirectory();
  const python = path.join(pinnedBinDirectory, process.platform === 'win32' ? 'python.exe' : 'python');
  if (path.dirname(executable) !== pinnedBinDirectory || !fs.existsSync(python)) {
    if (!streamingUnavailableWarned) {
      streamingUnavailableWarned = true;
      console.warn(`[Mistral] ${executable} n’est pas le Vibe ${VIBE_PACKAGE} installé par PieceMaker : réponses sans affichage en direct.`);
    }
    return { executable, args: [] };
  }
  return { executable: python, args: ['-u', '-c', vibeStreamingEntrypoint] };
}
