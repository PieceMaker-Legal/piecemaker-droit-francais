"""Connexion du serveur à PISTE par le presse-papiers de l'utilisateur."""

import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import requests

from config.settings import JUDILIBRE_API_URL, LEGIFRANCE_API_URL, LEGIFRANCE_OAUTH_URL
from tools.legifrance_client import legifrance_client

DELAI_SECONDES = 20
LONGUEUR_MAX = 200
PISTE_INJOIGNABLE = "PISTE ne répond pas. Vérifiez la connexion Internet puis réessayez."

_client_id: Optional[str] = None


def fichier_env() -> Path:
    chemin = (os.getenv("LEGIFRANCE_ENV_FILE") or "").strip()
    return Path(chemin).expanduser() if chemin else Path.home() / ".config" / "mcp-legifrance" / ".env"


def connecte() -> bool:
    return bool(legifrance_client.client_id and legifrance_client.client_secret)


def lire_presse_papiers() -> Optional[str]:
    commande = (
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"]
        if sys.platform == "win32"
        else ["pbpaste"]
    )
    try:
        return subprocess.run(commande, capture_output=True, text=True, timeout=DELAI_SECONDES).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def _acces_refuse(nom: str, statut: int) -> str:
    return (
        f"Les identifiants sont reconnus, mais l'application n'a pas accès à {nom} (HTTP {statut}). "
        f"Vérifiez que les CGU de {nom} sont acceptées (étape 2) et que {nom} est coché dans "
        "« Sélectionner les API » de l'application PRODUCTION (étape 3). Juste après l'enregistrement, "
        "PISTE peut demander une à deux minutes avant d'ouvrir l'accès."
    )


def valider(client_id: str, client_secret: str) -> Optional[str]:
    try:
        reponse = requests.post(
            LEGIFRANCE_OAUTH_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "openid",
            },
            timeout=DELAI_SECONDES,
        )
        if not reponse.ok:
            return (
                "PISTE refuse ces identifiants. Recopiez le Client ID et le Client Secret affichés dans "
                "« Identifiants Oauth » de l'application PRODUCTION (et non de l'application SANDBOX créée "
                "automatiquement)."
            )
        try:
            jeton = reponse.json().get("access_token")
        except ValueError:
            jeton = None
        if not jeton:
            return "PISTE n'a pas renvoyé de jeton d'accès. Réessayez dans un instant."

        entetes = {"Authorization": f"Bearer {jeton}", "Accept": "application/json"}
        legifrance = requests.post(
            f"{LEGIFRANCE_API_URL}/search",
            headers=entetes,
            json={
                "fond": "CODE_DATE",
                "recherche": {
                    "champs": [{
                        "typeChamp": "ALL",
                        "criteres": [{"typeRecherche": "UN_DES_MOTS", "valeur": "code civil", "operateur": "ET"}],
                        "operateur": "ET",
                    }],
                    "filtres": [],
                    "pageNumber": 1,
                    "pageSize": 1,
                    "operateur": "ET",
                    "sort": "SIGNATURE_DATE_DESC",
                    "typePagination": "DEFAUT",
                },
            },
            timeout=DELAI_SECONDES,
        )
        if not legifrance.ok:
            return _acces_refuse("Légifrance", legifrance.status_code)

        judilibre = requests.get(f"{JUDILIBRE_API_URL}/healthcheck", headers=entetes, timeout=DELAI_SECONDES)
        if not judilibre.ok:
            return _acces_refuse("JUDILIBRE", judilibre.status_code)
    except requests.RequestException:
        return PISTE_INJOIGNABLE
    return None


def enregistrer(client_id: str, client_secret: str) -> None:
    fichier = fichier_env()
    valeurs: Dict[str, str] = {}
    autres = []
    if fichier.exists():
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            cle, egal, valeur = ligne.partition("=")
            if egal and cle.strip().replace("_", "").isalnum():
                valeurs[cle.strip()] = valeur.strip()
            elif ligne.strip():
                autres.append(ligne)
    valeurs.update(
        LEGIFRANCE_CLIENT_ID=client_id,
        LEGIFRANCE_CLIENT_SECRET=client_secret,
        LEGIFRANCE_ENV="production",
    )
    corps = "\n".join([*autres, *(f"{cle}={valeur}" for cle, valeur in valeurs.items())]) + "\n"
    fichier.parent.mkdir(parents=True, exist_ok=True)
    temporaire = fichier.with_name(f"{fichier.name}.tmp-{os.getpid()}")
    descripteur = os.open(temporaire, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descripteur, "w", encoding="utf-8") as sortie:
        sortie.write(corps)
    os.replace(temporaire, fichier)


def _reponse(texte: str, erreur: bool = False) -> Dict[str, Any]:
    return {"content": [{"type": "text", "text": texte}], "isError": erreur}


def handle_connexion(args: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    global _client_id

    if connecte():
        return _reponse("Le serveur est déjà connecté à PISTE.")

    etape = args.get("etape")
    if etape not in ("client_id", "client_secret"):
        return _reponse("`etape` doit valoir client_id ou client_secret.", erreur=True)

    valeur = lire_presse_papiers()
    if valeur is None:
        return _reponse(
            f"Le presse-papiers est inaccessible sur cet ordinateur. L'utilisateur peut écrire lui-même "
            f"LEGIFRANCE_CLIENT_ID et LEGIFRANCE_CLIENT_SECRET dans {fichier_env()}, puis ouvrir une nouvelle session.",
            erreur=True,
        )
    if not valeur or len(valeur) > LONGUEUR_MAX or any(c.isspace() for c in valeur):
        return _reponse(
            "Le presse-papiers ne contient pas un identifiant PISTE. L'utilisateur doit copier la valeur "
            "dans « Identifiants Oauth », puis confirmer.",
            erreur=True,
        )

    if etape == "client_id":
        _client_id = valeur
        return _reponse(
            "Client ID reçu. L'utilisateur doit maintenant cliquer sur « Consulter le secret », copier le "
            "Client Secret et confirmer. Appelle ensuite cet outil avec etape=client_secret."
        )

    if not _client_id:
        return _reponse("Le Client ID manque : commence par etape=client_id.", erreur=True)
    if valeur == _client_id:
        return _reponse(
            "Le presse-papiers contient encore le Client ID. L'utilisateur doit copier le Client Secret, puis confirmer.",
            erreur=True,
        )

    refus = valider(_client_id, valeur)
    if refus:
        return _reponse(refus, erreur=True)

    enregistrer(_client_id, valeur)
    legifrance_client.client_id = _client_id
    legifrance_client.client_secret = valeur
    legifrance_client.access_token = None
    legifrance_client.token_expires_at = None
    _client_id = None
    return _reponse(
        f"Connexion réussie. Les identifiants sont enregistrés dans {fichier_env()}. Les outils de recherche "
        "sont disponibles. Si le client ne les affiche pas encore, ouvre une nouvelle session. L'utilisateur "
        "peut vider son presse-papiers."
    )
