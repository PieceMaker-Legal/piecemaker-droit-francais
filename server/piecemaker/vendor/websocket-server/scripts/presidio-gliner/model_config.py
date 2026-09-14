"""Sélection et chargement du checkpoint GLiNER local de PieceMaker.

GLiNER2.5 utilise une architecture ``boundary`` que l'ancienne classe
``GLiNER2`` (architecture ``span``) ne sait pas charger. ``AutoExtractor``
choisit la bonne implémentation. Le checkpoint historique n'est conservé ici
que pour que l'installateur puisse détecter qu'une migration est nécessaire :
il n'est jamais sélectionné à l'exécution.
"""

import os


PREFERRED_GLINER_MODEL = "fastino/gliner2.5-multi-v1"
LEGACY_GLINER_MODELS = ("fastino/gliner2-multi-v1",)


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


def is_model_cached(model_id: str) -> bool:
    """Retourne vrai si la configuration et les poids sont déjà locaux."""
    try:
        from huggingface_hub import try_to_load_from_cache

        for filename in ("config.json", "model.safetensors"):
            cached_path = try_to_load_from_cache(repo_id=model_id, filename=filename)
            if not isinstance(cached_path, str) or not os.path.exists(cached_path):
                return False
        return True
    except Exception:  # noqa: BLE001 - le cache ne doit jamais bloquer un scan
        return False
