import base64
import json
import os
import shlex
import subprocess
from pathlib import Path

_binding = None
_cwd = None


def _bind(binding, cwd):
    global _binding, _cwd
    _binding, _cwd = binding, cwd


def commande(outil, *arguments, **options):
    if _binding is None or not _cwd:
        raise RuntimeError("Utilisez les commandes Python dans une session PieceMaker.")
    from hermes_tools import terminal
    request = base64.b64encode(json.dumps({
        "binding": _binding, "cwd": _cwd, "outil": outil,
        "arguments": list(arguments), "options": options,
    }).encode()).decode()
    argv = [_binding["node"], str(Path(__file__).with_name("bridge.mjs")), request]
    command = ('set "ELECTRON_RUN_AS_NODE=1" && ' + subprocess.list2cmdline(argv)) if os.name == "nt" else 'ELECTRON_RUN_AS_NODE=1 ' + shlex.join(argv)
    result = terminal(command, timeout=300)
    if result.get("exit_code", 0) != 0 or result.get("error"):
        raise RuntimeError(result.get("error") or result.get("output") or "Échec de la commande PieceMaker.")
    output = result.get("output", "")
    try:
        envelope = json.loads(output)
    except (ValueError, TypeError) as error:
        raise RuntimeError("Réponse PieceMaker invalide ou tronquée.") from error
    if not envelope.get("ok"):
        raise RuntimeError(envelope.get("error", "Échec de la commande PieceMaker."))
    return envelope["result"]


def sql(requete):
    return commande("dossier", "sql", requete)


def raisonnement(action, **options):
    return commande("raisonnement", action, **options)


def suivi(action, *arguments, **options):
    return commande("suivi_dossiers", action, *arguments, **options)
