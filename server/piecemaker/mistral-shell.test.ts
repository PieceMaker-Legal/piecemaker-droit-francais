import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { resolveVibeExecutable } from '@/shared/vibe-cli.js';

import { vibeStreamingCommand, vibeStreamingEntrypoint } from './mistral-streaming.js';

test('Windows Vibe shell preserves quoted paths, cmd chaining and the bundled Python', { skip: process.platform !== 'win32' }, (t) => {
  let command;
  try {
    command = vibeStreamingCommand(resolveVibeExecutable());
  } catch {
    t.skip('A Vibe Python installation is required');
    return;
  }
  if (!command.args.length) {
    t.skip('A Vibe Python installation is required');
    return;
  }
  const script = `
import vibe.cli.entrypoint
vibe.cli.entrypoint.main = lambda: None
${vibeStreamingEntrypoint}
import tempfile
from pathlib import Path
from unittest.mock import patch
from vibe.core.tools.builtins import bash as bash_tool
from vibe.core.utils import shell as shell_utils

async def main():
    with tempfile.TemporaryDirectory(prefix="pm shell ") as directory:
        root = Path(directory)
        child = root / "dossier exemple"
        child.mkdir()
        entry = child / "arguments exemple.cjs"
        entry.write_text("console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))", encoding="utf-8")
        async def run(command):
            proc = await bash_tool.spawn_shell_command(command, cwd=root)
            stdout, stderr = await proc.communicate()
            assert proc.returncode == 0, stderr.decode("utf-8", errors="replace")
            return stdout.decode("utf-8").strip()
        executable = ${JSON.stringify(process.execPath)}
        with patch.object(shell_utils, "uses_posix_shell", return_value=False):
            output = json.loads(await run('cd /d "' + str(child) + '" && "' + executable + '" "' + str(entry) + '" "deux mots" "C:\\\\dossier exemple\\\\piece.md"'))
            assert Path(output["cwd"]) == child, output
            assert output["args"] == ["deux mots", "C:\\\\dossier exemple\\\\piece.md"], output
            assert await run('python --version') == "Python " + sys.version.split()[0]
        with patch.object(shell_utils, "uses_posix_shell", return_value=True):
            from unittest.mock import AsyncMock
            with patch.dict(globals(), {"original_spawn_shell_command": AsyncMock(return_value="posix")}) as patched:
                assert await bash_tool.spawn_shell_command("printf ok", cwd=root) == "posix"
                patched["original_spawn_shell_command"].assert_awaited_once_with("printf ok", cwd=root)

asyncio.run(main())
`;
  const result = spawnSync(command.executable, ['-c', script], {
    encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});
