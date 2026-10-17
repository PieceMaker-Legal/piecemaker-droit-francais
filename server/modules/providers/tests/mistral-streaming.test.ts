import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { vibeStreamingCommand, vibeStreamingEntrypoint } from '../../../piecemaker/mistral-streaming.js';
import { resolveVibeExecutable } from '../../../shared/vibe-cli.js';

test('Vibe emits partial text before completion and preserves other entries and resumed history', (t) => {
  let command;
  try {
    command = vibeStreamingCommand(resolveVibeExecutable());
  } catch {
    t.skip('A Vibe Python installation is required');
    return;
  }
  const script = `
import io
import json
import vibe.cli.entrypoint
vibe.cli.entrypoint.main = lambda: None
${vibeStreamingEntrypoint}
from vibe.app_server.models import PublicMessageEntry, PublicEntryGenerationStatus, PublicReasoningEntry
output = io.StringIO()
writer = StreamingOutput(programmatic.OutputFormat.STREAMING, output)
def entry(id, text, status="in_progress", turn="turn-1"):
    return PublicMessageEntry(id=id, session_id="session-1", turn_id=turn,
        created_at=1, updated_at=1, generation_status=status, role="assistant",
        content=[{"type": "text", "text": text}])
writer.start([entry("old", "Ancien", "completed", None)])
def reasoning(text, status="in_progress"):
    return PublicReasoningEntry(id="reason-1", session_id="session-1", turn_id="turn-1",
        created_at=1, updated_at=2, generation_status=status, text=text)
writer.consume(HistoryEntryAdded(reasoning("Je")))
rows = [json.loads(line) for line in output.getvalue().splitlines()]
assert rows[-1]["type"] == "piecemaker_reasoning"
assert rows[-1]["content"] == "Je"
writer.consume(HistoryEntryUpdated(reasoning("Je"), reasoning("Je réfléchis →"), []))
writer.consume(HistoryEntryUpdated(reasoning("Je réfléchis →"), reasoning("Je réfléchis →", "completed"), []))
rows = [json.loads(line) for line in output.getvalue().splitlines()]
thoughts = [row for row in rows if row["type"] == "piecemaker_reasoning"]
assert [row["content"] for row in thoughts] == ["Je", "Je réfléchis →"]
assert all(row["id"] == "reason-1" for row in thoughts)
assert not any(row["type"] == "reasoning" for row in rows)
writer.consume(HistoryEntryAdded(entry("new", "Bon")))
rows = [json.loads(line) for line in output.getvalue().splitlines()]
assert rows[-1]["type"] == "piecemaker_text_delta"
assert rows[-1]["content"] == "Bon"
writer.consume(HistoryEntryUpdated(entry("new", "Bon"), entry("new", "Bonjour →", "completed"), []))
writer.consume(HistoryEntryAdded(entry("new", "Bonjour →", "completed")))
writer.consume(HistoryEntryAdded(entry("next", "Suite", "completed")))
rows = [json.loads(line) for line in output.getvalue().splitlines()]
assert [row["content"] for row in rows if row["type"] == "piecemaker_text_delta"] == ["Bon", "jour →", "Suite"]
assert len([row for row in rows if row["type"] == "piecemaker_text_end"]) == 2
assert rows[0]["id"] == "old"
user = entry("user", "Question", "completed")
user.role = "user"
writer.consume(HistoryEntryAdded(user))
assert json.loads(output.getvalue().splitlines()[-1])["role"] == "user"
`;
  const result = spawnSync(command.executable, ['-c', script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});
