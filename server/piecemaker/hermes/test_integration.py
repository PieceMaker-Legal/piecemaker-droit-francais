import base64
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("piece_plugin", ROOT / "plugin/__init__.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class Context:
    def __init__(self, cwd):
        self.cwd = str(cwd)
        self.hooks = {}
        self.tools = {}

    def session_cwd(self):
        return self.cwd

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def register_tool(self, **entry):
        self.tools[entry["name"]] = entry["handler"]


class Integration(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=os.environ["PIECEMAKER_TEST_ROOT"])
        self.root = Path(self.directory.name).resolve()
        self.case = self.root / "dossier-fictif"
        self.case.mkdir()
        self.registry = self.root / "registry"
        self.registry.mkdir()
        self.previous_home = os.environ.get("PIECEMAKER_HOME")
        os.environ["PIECEMAKER_HOME"] = str(self.registry)
        source = {"sources": {"test": [str(self.case)]}}
        for name in ["projects.json", "anonymized-projects.json"]:
            (self.registry / name).write_text(json.dumps(source))
        (self.case / "piece.pdf").write_text("Document fictif")
        (self.case / "mapping_default.json").write_text("{}")
        (self.case / ".env").write_text("FAKE_VALUE=fictif")
        (self.case / "note.md").write_text("Note fictive")
        self.binding = {"pid": os.getpid(), "projects": [str(self.case)],
            "node": os.environ["PIECEMAKER_TEST_NODE"], "guard": str(ROOT / "guard.mjs"),
            "home": str(self.root), "port": 3003, "cli": str(self.root / "pm.mjs")}
        Path(self.binding["cli"]).write_text("export async function run(args, {cwd}) { if (args[0] === 'bad') throw new Error('commande refusée'); return JSON.stringify({args, cwd, home:process.env.CLOUDCLI_HOME, port:process.env.PIECEMAKER_APP_PORT}); }")
        self.old_root = plugin.ROOT
        self.plugin = self.root / "plugin"
        self.plugin.mkdir()
        (self.plugin / "bindings").mkdir()
        (self.plugin / "bindings/test.json").write_text(json.dumps(self.binding))
        for name in ["piecemaker.py", "bridge.mjs"]:
            (self.plugin / name).write_bytes((self.old_root / name).read_bytes())
        plugin.ROOT = self.plugin
        self.ctx = Context(self.case)
        plugin.register(self.ctx)

    def tearDown(self):
        plugin.ROOT = self.old_root
        if self.previous_home is None:
            os.environ.pop("PIECEMAKER_HOME", None)
        else:
            os.environ["PIECEMAKER_HOME"] = self.previous_home
        sys.modules.pop("piecemaker", None)
        sys.modules.pop("hermes_tools", None)
        self.directory.cleanup()

    def test_hooks_use_session_directory_and_preserve_markdown_access(self):
        hook = self.ctx.hooks["pre_tool_call"]
        for tool, args in [("read_file", {"path": "piece.pdf"}), ("read_file", {"path": "mapping_default.json"}),
            ("read_file", {"path": ".env"}), ("search_files", {"path": str(self.case), "pattern": "fictif"}),
            ("terminal", {"command": "cat piece.pdf"}), ("patch", {"path": "piece.pdf"})]:
            with self.subTest(tool=tool, args=args):
                self.assertEqual(hook(tool, args)["action"], "block")
        self.assertNotIn("action", hook("read_file", {"path": "note.md"}))
        control = self.case / ".piecemaker"
        control.mkdir()
        self.assertEqual(hook("write_file", {"path": ".piecemaker/protection-bypass.json"})["action"], "block")
        (control / "protection-bypass.json").write_text('{"scope":"dossier"}')
        self.assertNotIn("action", hook("read_file", {"path": "piece.pdf"}))

    def test_python_commands_use_cli_without_shell_interpolation(self):
        code = 'from piecemaker import sql\nresult = sql("SELECT \'$(false);`false`\'")\nprint(result)'
        modified = self.ctx.hooks["pre_tool_call"]("execute_code", {"code": code})
        self.assertEqual(modified["action"], "modify")
        self.assertTrue(modified["args"]["reset"])
        terminals = []
        def terminal(command, timeout):
            terminals.append(command)
            self.assertIsNone(self.ctx.hooks["pre_tool_call"]("terminal", {"command": command}))
            result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=timeout)
            return {"output": result.stdout, "exit_code": result.returncode}
        sys.modules["hermes_tools"] = types.SimpleNamespace(terminal=terminal)
        namespace = {}
        exec(modified["args"]["code"], namespace)
        result = namespace["result"]
        self.assertEqual(result["args"], ["dossier", "sql", "SELECT '$(false);`false`'"])
        self.assertEqual(result["cwd"], str(self.case))
        self.assertEqual(result["home"], str(self.root))
        self.assertEqual(len(terminals), 1)

    def test_python_raw_reads_and_dynamic_execution_are_blocked(self):
        for code in ['open("piece.pdf").read()', 'import os\nos.system("cat piece.pdf")',
            'from pathlib import Path\nPath("piece.pdf").read_bytes()', 'eval("1")',
            'from piecemaker import sql\nprint(sql.__globals__)', 'from piecemaker import sql as open']:
            with self.subTest(code=code):
                self.assertEqual(self.ctx.hooks["pre_tool_call"]("execute_code", {"code": code})["action"], "block")

    def test_native_command_and_errors(self):
        call = self.ctx.tools["piecemaker"]
        result = json.loads(call({"outil": "okf", "arguments": ["examinee", "piece.pdf"], "options": {"motif": "--dossier=/ailleurs"}}))
        self.assertEqual(result["result"]["args"], ["okf", "examinee", "piece.pdf", "--motif=--dossier=/ailleurs"])
        self.assertFalse(json.loads(call({"outil": "catala", "arguments": ["exec"]}))["ok"])
        self.assertFalse(json.loads(call({"outil": "bad"}))["ok"])
        self.assertFalse(json.loads(call({"outil": "sql", "options": {"dossier": "/ailleurs"}}))["ok"])
        self.assertFalse(json.loads(call({"outil": "sql", "arguments": ["--dossier", "/ailleurs"]}))["ok"])

    def test_real_pm_lists_catala_programs_without_a_model(self):
        self.binding["cli"] = str(ROOT.parent / "vendor/skills/Skill-PieceMaker/scripts/pm.mjs")
        (self.plugin / "bindings/test.json").write_text(json.dumps(self.binding))
        program = self.case / ".piecemaker/catala/exemple"
        program.mkdir(parents=True)
        (program / "clerk.toml").touch()
        result = json.loads(self.ctx.tools["piecemaker"]({"outil": "catala", "arguments": ["lister"]}))
        self.assertTrue(result["ok"], result)
        self.assertIn("exemple : jamais vérifié", result["result"])

    def test_missing_guard_and_ambiguous_instances_block(self):
        self.binding["guard"] = str(self.root / "absent.mjs")
        (self.plugin / "bindings/test.json").write_text(json.dumps(self.binding))
        hook = self.ctx.hooks["pre_tool_call"]
        self.assertEqual(hook("read_file", {"path": "piece.pdf"})["action"], "block")
        (self.plugin / "bindings/duplicate.json").write_text(json.dumps(self.binding))
        self.assertEqual(hook("read_file", {"path": "note.md"})["action"], "block")


if __name__ == "__main__":
    unittest.main()
