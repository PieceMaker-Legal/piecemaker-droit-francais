"""Rappels d'échéances PieceMaker, lancés par une tâche planifiée Hermes (--no-agent).

Le script lit le port de l'instance PieceMaker ouverte et imprime les échéances
du suivi de tous les dossiers. Sortie vide : Hermes n'envoie rien. Aucun modèle
n'est appelé.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

HOME = Path(__file__).resolve().parents[1]


def running_instances():
    found = []
    for filename in (HOME / "plugins" / "piecemaker" / "bindings").glob("*.json"):
        try:
            entry = json.loads(filename.read_text())
            # os.kill(pid, 0) termine le processus sous Windows : n'y vérifier que la date.
            if os.name != "nt":
                os.kill(entry["pid"], 0)
            found.append((filename.stat().st_mtime, entry))
        except (OSError, ValueError, KeyError):
            continue
    return [entry for _, entry in sorted(found, key=lambda item: item[0], reverse=True)]


def main():
    instances = running_instances()
    if not instances:
        sys.exit("PieceMaker est fermé : rappels d'échéances indisponibles.")
    jours = os.environ.get("PIECEMAKER_RAPPELS_JOURS", "7")
    url = f"http://127.0.0.1:{instances[0]['port']}/api/piecemaker/local/suivi/rappels?jours={jours}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=60) as response:
        sys.stdout.write(response.read().decode("utf-8"))


if __name__ == "__main__":
    main()
