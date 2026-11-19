"""Construit data.js pour le template chronologie à partir d'un fichier d'événements (.json ou .csv).

Lancé par ArtifactTemplates run dans l'environnement Python de PieceMaker, dossier courant = le dossier.
Variables : PIECEMAKER_ARTIFACT_OUT (dossier de sortie), PIECEMAKER_ARTIFACT_URL (artifact à remplir).
Bibliothèque standard seulement.
"""
import csv
import json
import os
import re
import sys

DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
TYPES = {"fait", "procedure", "echeance"}


def read(path):
    if path.lower().endswith(".csv"):
        with open(path, encoding="utf-8-sig", newline="") as handle:
            sample = handle.read(4096)
            handle.seek(0)
            dialect = csv.Sniffer().sniff(sample, delimiters=",;")
            return list(csv.DictReader(handle, dialect=dialect))
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def main(argv):
    if len(argv) != 1:
        print("usage: build.py <événements.json|csv>", file=sys.stderr)
        return 2
    rows = read(argv[0])
    events, errors = [], []
    for index, row in enumerate(rows, 1):
        date = str(row.get("date", "")).strip()
        title = str(row.get("titre", "")).strip()
        if not DATE.match(date) or not title:
            errors.append(f"ligne {index} : date « {date} » ou titre manquant")
            continue
        kind = str(row.get("type", "fait")).strip() or "fait"
        events.append({
            "date": date,
            "titre": title,
            "piece": str(row.get("piece", "")).strip() or None,
            "detail": str(row.get("detail", "")).strip() or None,
            "type": kind if kind in TYPES else "fait",
        })
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    events.sort(key=lambda event: event["date"])
    out = os.environ.get("PIECEMAKER_ARTIFACT_OUT", os.path.join("Artifacts", "chronologie"))
    os.makedirs(out, exist_ok=True)
    target = os.path.join(out, "data.js")
    with open(target, "w", encoding="utf-8") as handle:
        handle.write("window.CHRONOLOGIE = ")
        json.dump(events, handle, ensure_ascii=False, indent=1)
        handle.write(";\n")
    relative = os.path.relpath(target)
    url = os.environ.get("PIECEMAKER_ARTIFACT_URL", "<artifact>")
    print(f"{len(events)} événement(s) écrits dans {relative}.")
    print(f'Publier : Artifact publish url={url} files={{"data.js": "{relative}"}}')
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
