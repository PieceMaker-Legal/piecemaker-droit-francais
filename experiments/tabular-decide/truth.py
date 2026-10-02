import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
CORPUS = json.loads((HERE / "corpus.json").read_text())["decisions"]
DISPOSITIF = re.compile(r"PAR CES MOTIFS|DISPOSITIF", re.IGNORECASE)


def dispositif(text):
    matches = list(DISPOSITIF.finditer(text))
    return text[matches[-1].start():] if matches else ""


def solution(text):
    tail = dispositif(text) or text
    if re.search(r"\bCASSE\b", tail):
        return "Cassation partielle" if re.search(r"mais seulement|sauf en ce qu|seulement en ce qu", tail, re.IGNORECASE) else "Cassation totale"
    if re.search(r"\bREJETTE\b", tail):
        return "Rejet"
    return "Autre"


def main():
    manual_path = HERE / "truth-manual.json"
    manual = json.loads(manual_path.read_text()) if manual_path.exists() else {}
    truth = {}
    views = []
    for decision in CORPUS:
        text = (HERE / "corpus" / f"{decision['id']}.md").read_text()
        truth[decision["id"]] = {
            "solution": solution(text),
            "inaptitude": "Oui" if re.search(r"inapt", text, re.IGNORECASE) else "Non",
            **manual.get(decision["id"], {}),
        }
        keyword = [line.strip() for line in text.split("\n") if re.search(r"harc[eè]lement|sécurité|prévention", line, re.IGNORECASE) and line.strip() not in dispositif(text)]
        views.append(f"### {decision['id']} [{truth[decision['id']]['solution']}]\n" + "\n".join(f"- {line[:420]}" for line in keyword[-5:]) + f"\n>> {dispositif(text).strip()[:1500]}\n")
    (HERE / "truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2) + "\n")
    (HERE / "work").mkdir(exist_ok=True)
    (HERE / "work" / "views.md").write_text("\n".join(views))


main()
