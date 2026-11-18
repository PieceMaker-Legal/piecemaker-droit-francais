import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    script = root / 'scripts/piecemaker/ponytail-update.sh'
    script.parent.mkdir(parents=True)
    shutil.copyfile(Path(__file__).with_name('ponytail-update.sh'), script)
    (root / '.claude').mkdir()
    binary = root / 'bin/claude'
    binary.parent.mkdir()
    binary.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$PWD/calls"\n[ ! -f "$PWD/fail" ]\n')
    binary.chmod(0o755)
    env = dict(os.environ, PATH=str(binary.parent) + os.pathsep + os.environ['PATH'])
    stamp = root / '.claude/ponytail-last-update'

    def run():
        return subprocess.run(['sh', str(script)], env=env, capture_output=True, text=True)

    result = run()
    assert result.returncode == 0, result.stderr
    assert int(result.stdout.strip()) == int(stamp.read_text())
    assert (root / 'calls').read_text().splitlines() == [
        'plugin marketplace update ponytail',
        'plugin update ponytail@ponytail --scope local',
    ]
    calls = (root / 'calls').read_text()
    recent = str(int(time.time()) - 604799) + '\n'
    stamp.write_text(recent)
    result = run()
    assert result.returncode == 0 and result.stdout == ''
    assert stamp.read_text() == recent and (root / 'calls').read_text() == calls
    expired = str(int(time.time()) - 604801) + '\n'
    stamp.write_text(expired)
    assert run().returncode == 0
    assert len((root / 'calls').read_text().splitlines()) == 4
    stamp.write_text(expired)
    (root / 'fail').touch()
    assert run().returncode != 0
    assert stamp.read_text() == expired
    assert len((root / 'calls').read_text().splitlines()) == 5
print('OK : installation, délai de sept jours, expiration et échec sans nouveau timestamp.')
