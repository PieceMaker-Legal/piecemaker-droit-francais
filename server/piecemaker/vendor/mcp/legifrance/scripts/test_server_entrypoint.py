import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class ServerEntrypointTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is required")
    def test_python_protocol_uses_utf8_even_with_legacy_console_encoding(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copyfile(Path(__file__).resolve().parent.parent / "server.mjs", root / "server.mjs")
            (root / "scripts").mkdir()
            (root / "scripts" / "launcher.py").write_text(
                'import json\nprint(json.dumps({"text": "Réponse légale"}, ensure_ascii=False))\n',
                encoding="utf-8",
            )
            (root / "config.json").write_text(json.dumps({"pythonPath": sys.executable}), encoding="utf-8")
            result = subprocess.run(
                [shutil.which("node"), str(root / "server.mjs")],
                env={**os.environ, "PIECEMAKER_HOME": str(root), "PYTHONIOENCODING": "cp1252"},
                capture_output=True,
                check=True,
                timeout=15,
            )
            self.assertEqual(json.loads(result.stdout.decode("utf-8")), {"text": "Réponse légale"})


if __name__ == "__main__":
    unittest.main()
