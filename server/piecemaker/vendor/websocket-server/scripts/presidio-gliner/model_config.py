"""Sélection et chargement du checkpoint GLiNER local de PieceMaker.

Le checkpoint GLiNER2-PII (architecture ``span``) se charge avec ``GLiNER2``
depuis le dossier snapshot épinglé, jamais depuis l'id Hugging Face ``main``.
Les checkpoints historiques ne sont conservés ici que pour que l'installateur
puisse détecter qu'une migration est nécessaire : ils ne sont jamais
sélectionnés à l'exécution.
"""

import json
import os
from pathlib import Path


_CHECKPOINT = json.loads(Path(__file__).with_name("gliner-checkpoint.json").read_text(encoding="utf-8"))

PREFERRED_GLINER_MODEL = _CHECKPOINT["modelId"]
PREFERRED_GLINER_REVISION = _CHECKPOINT["revision"]
REQUIRED_SNAPSHOT_FILES = tuple(item["path"] for item in _CHECKPOINT["files"])
LEGACY_GLINER_MODELS = ("fastino/gliner2.5-multi-v1", "fastino/gliner2-multi-v1")

REQUIRED_GLINER2_RELEASE = (2, 0)


def gliner2_runtime() -> dict:
    """Dit si le gliner2 de l'interpréteur courant sait charger l'architecture boundary."""
    required = ".".join(str(number) for number in REQUIRED_GLINER2_RELEASE)
    try:
        import gliner2
    except ImportError as exc:
        return {
            "installed": False,
            "version": None,
            "boundary_capable": False,
            "required_release": required,
            "reason": str(exc),
        }
    try:
        from gliner2 import AutoExtractor  # noqa: F401
    except ImportError as exc:
        return {
            "installed": True,
            "version": getattr(gliner2, "__version__", None),
            "boundary_capable": False,
            "required_release": required,
            "reason": str(exc),
        }
    return {
        "installed": True,
        "version": getattr(gliner2, "__version__", None),
        "boundary_capable": True,
        "required_release": required,
        "reason": None,
    }


def hugging_face_hub() -> str:
    hf_home = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
    return os.environ.get("HUGGINGFACE_HUB_CACHE") or os.environ.get("HF_HUB_CACHE") or os.path.join(hf_home, "hub")


def model_repo_directory(model_id: str) -> str:
    return os.path.join(hugging_face_hub(), f"models--{model_id.replace('/', '--')}")


def gliner_snapshot_directory(model_id: str = PREFERRED_GLINER_MODEL) -> str:
    return os.path.join(model_repo_directory(model_id), "snapshots", PREFERRED_GLINER_REVISION)


def write_refs_main(model_id: str = PREFERRED_GLINER_MODEL) -> None:
    refs_dir = os.path.join(model_repo_directory(model_id), "refs")
    os.makedirs(refs_dir, exist_ok=True)
    with open(os.path.join(refs_dir, "main"), "wb") as handle:
        handle.write(PREFERRED_GLINER_REVISION.encode("ascii"))


def is_model_cached(model_id: str) -> bool:
    """Retourne vrai si le snapshot épinglé (ou un checkpoint historique) est local."""
    if model_id == PREFERRED_GLINER_MODEL:
        root = gliner_snapshot_directory(model_id)
        return all(os.path.isfile(os.path.join(root, relative)) for relative in REQUIRED_SNAPSHOT_FILES)
    try:
        from huggingface_hub import try_to_load_from_cache

        for filename in ("config.json", "model.safetensors"):
            cached_path = try_to_load_from_cache(repo_id=model_id, filename=filename)
            if not isinstance(cached_path, str) or not os.path.exists(cached_path):
                return False
        return True
    except Exception:  # noqa: BLE001 - le cache ne doit jamais bloquer un scan
        return False
