import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import types


spec = importlib.util.spec_from_file_location("legifrance_launcher", Path(__file__).resolve().parents[1] / "scripts" / "launcher.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class SharedRuntimeTests(unittest.TestCase):
    def test_shared_bootstrap_does_not_install(self):
        with patch.dict(launcher.os.environ, {"PIECEMAKER_SHARED_PYTHON": "1"}), patch.object(launcher.importlib.util, "find_spec", return_value=object()), patch.object(launcher.subprocess, "run") as run:
            launcher.bootstrap()
            run.assert_not_called()

    def test_missing_dependency_fails_without_install(self):
        with patch.dict(launcher.os.environ, {"PIECEMAKER_SHARED_PYTHON": "1"}), patch.object(launcher.importlib.util, "find_spec", return_value=None), patch.object(launcher.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "environnement Python commun"):
                launcher.bootstrap()
            run.assert_not_called()

    def test_windows_holds_the_shared_server_process(self):
        with patch.dict(launcher.os.environ, {"PIECEMAKER_SHARED_PYTHON": "1"}), patch.object(launcher, "bootstrap"), patch.object(launcher, "configure_environment"), patch.object(launcher.os, "name", "nt"), patch.object(launcher.sys, "argv", ["launcher.py"]), patch.object(launcher.subprocess, "run", return_value=types.SimpleNamespace(returncode=7)) as run:
            with self.assertRaises(SystemExit) as result:
                launcher.main()
            self.assertEqual(result.exception.code, 7)
            self.assertEqual(run.call_args.args[0][0], launcher.sys.executable)


if __name__ == "__main__":
    unittest.main()
