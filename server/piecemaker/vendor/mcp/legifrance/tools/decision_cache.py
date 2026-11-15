import json
import os
import re
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

ID_VALIDE = re.compile(r"[A-Za-z0-9_-]{1,80}")


def _fichier(identifiant: str, dossier: str = "decisions") -> Optional[Path]:
    if not ID_VALIDE.fullmatch(identifiant or ""):
        return None
    racine = os.environ.get("PIECEMAKER_HOME") or str(Path.home() / ".piecemaker")
    return Path(racine) / dossier / f"{identifiant}.json"


def _lire(identifiant: str, dossier: str = "decisions") -> Dict[str, Any]:
    fichier = _fichier(identifiant, dossier)
    if fichier is None:
        return {}
    try:
        entree = json.loads(fichier.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return entree if isinstance(entree, dict) else {}


def _ecrire(identifiant: str, entree: Dict[str, Any], dossier: str = "decisions") -> None:
    fichier = _fichier(identifiant, dossier)
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


def _version_close(reponse: Dict[str, Any]) -> bool:
    fin = (reponse.get("article") or {}).get("dateFin")
    return isinstance(fin, (int, float)) and fin < datetime.now(timezone.utc).timestamp() * 1000


def obtenir_article(identifiant: str, telecharger: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    entree = _lire(identifiant, "articles")
    en_cache = entree.get("reponse")
    if isinstance(en_cache, dict) and (_version_close(en_cache) or str(entree.get("at", "")).startswith(date.today().isoformat())):
        return en_cache
    reponse = telecharger()
    article = reponse.get("article") if isinstance(reponse, dict) else None
    texte = article.get("texte") if isinstance(article, dict) else None
    if isinstance(texte, str) and texte.strip():
        _ecrire(identifiant, {
            "kind": "legifrance-article",
            "id": identifiant,
            "titre": str(article.get("num") or ""),
            "texte": texte,
            "caracteres": len(texte),
            "source": "mcp-legifrance",
            "at": date.today().isoformat(),
            "reponse": reponse,
        }, "articles")
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
