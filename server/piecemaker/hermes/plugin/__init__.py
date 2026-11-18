import ast
import base64
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMMANDS = {"commande", "sql", "raisonnement", "suivi"}
FUNCTIONS = COMMANDS | {"print", "len", "str", "int", "float", "bool", "list", "dict", "set", "tuple", "sorted", "sum", "min", "max", "enumerate", "range", "zip", "abs", "round"}
METHODS = {"get", "items", "keys", "values", "append", "extend", "strip", "split", "join", "lower", "upper", "replace", "startswith", "endswith", "count"}


def binding_for(cwd):
    matches = []
    directory = Path(cwd).resolve()
    for filename in (ROOT / "bindings").glob("*.json"):
        entry = json.loads(filename.read_text())
        try:
            os.kill(entry["pid"], 0)
        except ProcessLookupError:
            continue
        for project in entry["projects"]:
            root = Path(project).resolve()
            if directory == root or root in directory.parents:
                matches.append((len(root.parts), entry))
                break
    if not matches:
        raise LookupError("Ouvrez cette session depuis PieceMaker.")
    matches.sort(key=lambda item: item[0], reverse=True)
    if len(matches) > 1 and matches[0][0] == matches[1][0]:
        raise RuntimeError("Ce dossier est ouvert dans plusieurs instances PieceMaker.")
    return matches[0][1]


def guard(binding, cwd, event, tool="", args=None, result=None):
    child = subprocess.run([binding["node"], binding["guard"]],
        input=json.dumps({"cwd": cwd, "event": event, "tool": tool, "args": args, "result": result}),
        text=True, capture_output=True, timeout=8, env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"})
    if child.returncode:
        raise RuntimeError("Vérification PieceMaker indisponible.")
    return json.loads(child.stdout)


def python_allowed(code):
    tree = ast.parse(code)
    forbidden = (ast.Import, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda,
        ast.With, ast.AsyncWith, ast.Try, ast.Raise, ast.Delete, ast.Global, ast.Nonlocal)
    for node in ast.walk(tree):
        if isinstance(node, forbidden):
            return False
        if isinstance(node, ast.ImportFrom):
            if node.module != "piecemaker" or node.level or any(alias.name not in COMMANDS or alias.asname for alias in node.names):
                return False
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            return False
        if isinstance(node, ast.Attribute) and node.attr not in METHODS:
            return False
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS:
                continue
            if isinstance(node.func, ast.Attribute) and node.func.attr in METHODS:
                continue
            return False
    return True


def register(ctx):
    def pre_tool(tool_name, args, **kwargs):
        cwd = ctx.session_cwd()
        if not cwd:
            return {"action": "block", "message": "Dossier de session introuvable."}
        try:
            binding = binding_for(cwd)
        except LookupError:
            return None
        except Exception:
            return {"action": "block", "message": "Dossier PieceMaker ambigu ou indisponible."}
        try:
            if tool_name == "execute_code":
                code = args.get("code", "")
                status = guard(binding, cwd, "status")
                if status.get("protected") and not python_allowed(code):
                    return {"action": "block", "message": "Utilisez les fonctions Python piecemaker et des traitements de données simples, ou les outils de fichiers."}
                prelude = "import sys\nsys.path.insert(0, " + repr(str(ROOT)) + ")\nimport piecemaker\npiecemaker._bind(" + repr(binding) + ", " + repr(cwd) + ")\n"
                return {"action": "modify", "args": {"code": prelude + code, **({"reset": True} if status.get("protected") else {})}}
            if tool_name == "terminal":
                command = args.get("command", "")
                try:
                    encoded = command.rsplit(" ", 1)[-1]
                    request = json.loads(base64.b64decode(encoded, validate=True))
                    if request.get("binding") == binding and request.get("cwd") == cwd:
                        expected = [binding["node"], str(ROOT / "bridge.mjs"), encoded]
                        import shlex
                        exact = ('set "ELECTRON_RUN_AS_NODE=1" && ' + subprocess.list2cmdline(expected)) if os.name == "nt" else 'ELECTRON_RUN_AS_NODE=1 ' + shlex.join(expected)
                        if command == exact:
                            return None
                except (ValueError, TypeError, KeyError):
                    pass
            if tool_name in {"read_file", "search_files", "terminal", "write_file", "patch"}:
                return guard(binding, cwd, "pre", tool_name, args)
            if guard(binding, cwd, "status").get("protected") and tool_name in {"vision_analyze", "execute_code", "process", "image_generate", "browser_exec"}:
                return {"action": "block", "message": "Utilisez les outils de fichiers ou les commandes PieceMaker pour ce dossier."}
        except Exception:
            return {"action": "block", "message": "Vérification PieceMaker indisponible. Réessayez depuis PieceMaker."}

    def post_tool(tool_name, args, result=None, **kwargs):
        if tool_name not in {"write_file", "terminal"}:
            return
        cwd = ctx.session_cwd()
        try:
            guard(binding_for(cwd), cwd, "post", tool_name, args, result)
        except Exception:
            return

    def command(args, **kwargs):
        try:
            cwd = ctx.session_cwd()
            binding = binding_for(cwd)
            request = base64.b64encode(json.dumps({**args, "binding": binding, "cwd": cwd}).encode()).decode()
            result = subprocess.run([binding["node"], str(ROOT / "bridge.mjs"), request],
                text=True, capture_output=True, timeout=300, env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"})
            return result.stdout or json.dumps({"ok": False, "error": "Commande PieceMaker indisponible."})
        except Exception as error:
            return json.dumps({"ok": False, "error": str(error)})

    ctx.register_hook("pre_tool_call", pre_tool)
    ctx.register_hook("post_tool_call", post_tool)
    skill = ROOT / "skills/piecemaker/SKILL.md"
    if skill.is_file():
        ctx.register_skill("piecemaker", skill)
    ctx.register_tool(name="piecemaker", toolset="piecemaker", handler=command, schema={
        "name": "piecemaker", "description": "Exécute une commande pm dans le dossier courant. En Python : from piecemaker import commande, sql, raisonnement, suivi. Utilisez commande(outil, *arguments, **options).",
        "parameters": {"type": "object", "properties": {
            "outil": {"type": "string", "enum": ["check", "tab", "dossier", "tabular_review", "bordereau", "raisonnement", "suivi_dossiers", "memoire", "okf"]},
            "arguments": {"type": "array", "items": {"type": "string"}},
            "options": {"type": "object"}}, "required": ["outil"]}})
