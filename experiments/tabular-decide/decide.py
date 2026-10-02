import json
import os
import sys
import time
from pathlib import Path

THREADS = 3
os.environ["OMP_NUM_THREADS"] = str(THREADS)
os.environ["MKL_NUM_THREADS"] = str(THREADS)
os.environ["VECLIB_MAXIMUM_THREADS"] = str(THREADS)
os.environ["TOKENIZERS_PARALLELISM"] = "false"
HERE = Path(__file__).resolve().parent
os.environ["HF_HOME"] = str(HERE / ".hf")
os.nice(15)

import torch

torch.set_num_threads(THREADS)
torch.set_num_interop_threads(1)

from gliner2 import AutoExtractor

MODEL = "fastino/GLiNER2.5-multi-Decide"
COLUMNS = json.loads((HERE / "columns.json").read_text())
CORPUS = json.loads((HERE / "corpus.json").read_text())["decisions"]
LABELS = {
    "solution": {
        "Cassation totale": "L'arrêt de la cour d'appel est cassé et annulé en toutes ses dispositions",
        "Cassation partielle": "L'arrêt de la cour d'appel est cassé seulement sur certains chefs",
        "Rejet": "Le pourvoi est rejeté, aucune cassation",
        "Autre": "Autre issue : irrecevabilité, déchéance, non-lieu à statuer, renvoi",
    },
}


def tasks():
    result = {}
    for column in COLUMNS:
        labels = LABELS.get(column["key"]) or ["Oui", "Non"]
        result[column["key"]] = {"labels": labels, "prompt": column["prompt"]}
    return result


def paragraphs(text):
    found = []
    position = 0
    for line in text.split("\n"):
        start = text.index(line, position)
        position = start + len(line)
        stripped = line.strip()
        if stripped.startswith("#") or stripped.startswith("Source :") or len(stripped.split()) < 5:
            continue
        found.append(stripped)
    return found


def classify_document(model, text, config):
    if config["mode"] == "full":
        return model.classify_text(text, tasks(), include_confidence=True)
    return model.classify_text_long(
        text,
        tasks(),
        include_confidence=True,
        chunk_size=config["chunk_size"],
        chunk_overlap=config["chunk_overlap"],
        batch_size=config["batch_size"],
    )


def cite(model, text, answers, config):
    parts = paragraphs(text)
    if not parts:
        return {}
    scored = model.batch_classify_text(parts, tasks(), batch_size=config["batch_size"], include_confidence=True)
    citations = {}
    for key, answer in answers.items():
        best = None
        for part, result in zip(parts, scored):
            if result[key]["label"] != answer["label"]:
                continue
            if best is None or result[key]["confidence"] > best["confidence"]:
                best = {"quote": part, "confidence": result[key]["confidence"]}
        citations[key] = best
    return citations


def run(model, config, decisions, with_citations):
    rows = []
    for decision in decisions:
        text = (HERE / "corpus" / f"{decision['id']}.md").read_text()
        started = time.perf_counter()
        with torch.inference_mode():
            answers = classify_document(model, text, config)
            answered = time.perf_counter()
            citations = cite(model, text, answers, config) if with_citations else {}
        finished = time.perf_counter()
        rows.append({
            "id": decision["id"],
            "chars": len(text),
            "answer_seconds": round(answered - started, 3),
            "citation_seconds": round(finished - answered, 3),
            "seconds": round(finished - started, 3),
            "answers": answers,
            "citations": citations,
        })
        print(decision["id"], rows[-1]["seconds"], {key: value["label"] for key, value in answers.items()}, flush=True)
    return rows


SWEEP = [
    {"name": "chunk384-b1", "mode": "long", "chunk_size": 384, "chunk_overlap": 64, "batch_size": 1},
    {"name": "chunk384-b4", "mode": "long", "chunk_size": 384, "chunk_overlap": 64, "batch_size": 4},
    {"name": "chunk384-b8", "mode": "long", "chunk_size": 384, "chunk_overlap": 64, "batch_size": 8},
    {"name": "chunk256-b8", "mode": "long", "chunk_size": 256, "chunk_overlap": 32, "batch_size": 8},
    {"name": "chunk192-b8", "mode": "long", "chunk_size": 192, "chunk_overlap": 32, "batch_size": 8},
    {"name": "chunk192-b16", "mode": "long", "chunk_size": 192, "chunk_overlap": 32, "batch_size": 16},
]


def main():
    command = sys.argv[1]
    started = time.perf_counter()
    model = AutoExtractor.from_pretrained(MODEL)
    model.eval()
    load_seconds = round(time.perf_counter() - started, 2)
    results = HERE / "results"
    results.mkdir(exist_ok=True)
    if command == "sweep":
        sample = CORPUS[:: max(1, len(CORPUS) // 8)][:8]
        report = []
        for config in SWEEP:
            rows = run(model, config, sample, False)
            total = round(sum(row["seconds"] for row in rows), 2)
            report.append({"config": config, "decisions": len(rows), "seconds": total, "labels": [{key: value["label"] for key, value in row["answers"].items()} for row in rows]})
            print(config["name"], total, flush=True)
        (results / "decide-sweep.json").write_text(json.dumps({"threads": THREADS, "load_seconds": load_seconds, "report": report}, ensure_ascii=False, indent=2) + "\n")
        return
    config = next(entry for entry in SWEEP if entry["name"] == sys.argv[2])
    rows = run(model, config, CORPUS, True)
    (results / "decide.json").write_text(json.dumps({"model": MODEL, "threads": THREADS, "load_seconds": load_seconds, "config": config, "rows": rows}, ensure_ascii=False, indent=2) + "\n")


main()
