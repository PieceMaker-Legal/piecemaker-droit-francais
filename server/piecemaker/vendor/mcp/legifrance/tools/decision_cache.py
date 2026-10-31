import json
import os
import re
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

ID_VALIDE = re.compile(r"[A-Za-z0-9_-]{1,80}")


def _fichier(identifiant: str) -> Optional[Path]:
    if not ID_VALIDE.fullmatch(identifiant or ""):
        return None
    racine = os.environ.get("PIECEMAKER_HOME") or str(Path.home() / ".piecemaker")
    return Path(racine) / "decisions" / f"{identifiant}.json"


def _lire(identifiant: str) -> Dict[str, Any]:
    fichier = _fichier(identifiant)
    if fichier is None:
        return {}
    try:
        entree = json.loads(fichier.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return entree if isinstance(entree, dict) else {}


def _ecrire(identifiant: str, entree: Dict[str, Any]) -> None:
    fichier = _fichier(identifiant)
    if fichier is None:
        return
    temporaire = None
    try:
        fichier.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descripteur, temporaire = tempfile.mkstemp(dir=fichier.parent, suffix=".tmp")
        with os.fdopen(descripteur, "w", encoding="utf-8") as sortie:
            json.dump(entree, sortie, ensure_ascii=False)
        os.replace(temporaire, fichier)
    except OSError:
        if temporaire:
            Path(temporaire).unlink(missing_ok=True)


def obtenir(
    identifiant: str,
    telecharger: Callable[[], Dict[str, Any]],
    decrire: Callable[[Dict[str, Any]], Tuple[Any, Any]],
) -> Dict[str, Any]:
    en_cache = _lire(identifiant).get("reponse")
    if isinstance(en_cache, dict):
        return en_cache
    reponse = telecharger()
    titre, texte = decrire(reponse) if isinstance(reponse, dict) else (None, None)
    if isinstance(texte, str) and texte.strip():
        _ecrire(identifiant, {
            "kind": "legifrance-decision",
            "id": identifiant,
            "titre": str(titre or ""),
            "texte": texte,
            "caracteres": len(texte),
            "source": "mcp-legifrance",
            "at": datetime.now(timezone.utc).isoformat(),
            "reponse": reponse,
        })
    return reponse


def controle_du_jour(identifiant: str) -> Optional[str]:
    controle = _lire(identifiant).get("controle")
    if isinstance(controle, dict) and controle.get("date") == date.today().isoformat():
        return controle.get("rendu")
    return None


def memoriser_controle(identifiant: str, rendu: str) -> None:
    entree = _lire(identifiant)
    if entree:
        _ecrire(identifiant, {**entree, "controle": {"date": date.today().isoformat(), "rendu": rendu}})
