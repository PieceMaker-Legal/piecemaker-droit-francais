import importlib.util
from pathlib import Path
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("launcher", Path(__file__).with_name("launcher.py"))
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_windows_keeps_launcher_alive_until_server_exits(self):
        with mock.patch.object(launcher, "bootstrap"), \
             mock.patch.object(launcher, "configure_environment"), \
             mock.patch.object(launcher.os, "name", "nt"), \
             mock.patch.object(launcher.sys, "argv", ["launcher.py"]), \
             mock.patch.object(launcher.subprocess, "run", return_value=mock.Mock(returncode=3)) as run, \
             mock.patch.object(launcher.os, "execv") as execv:
            with self.assertRaises(SystemExit) as exit_info:
                launcher.main()
        self.assertEqual(exit_info.exception.code, 3)
        execv.assert_not_called()
        self.assertTrue(run.call_args.args[0][1].endswith("mcp_stdio_server.py"))

    def test_posix_replaces_process(self):
        with mock.patch.object(launcher, "bootstrap"), \
             mock.patch.object(launcher, "configure_environment"), \
             mock.patch.object(launcher.os, "name", "posix"), \
             mock.patch.object(launcher.sys, "argv", ["launcher.py"]), \
             mock.patch.object(launcher.subprocess, "run") as run, \
             mock.patch.object(launcher.os, "execv") as execv:
            launcher.main()
        execv.assert_called_once()
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
