# Assistance : journal et rapport

## Journal local

`server/piecemaker/support/log.ts` recopie `console.log/info/warn/error` du
serveur dans `<PIECEMAKER_HOME>/logs/piecemaker.log` (codes couleur retirés).
Au premier démarrage d'une nouvelle version, l'ancien journal devient
`piecemaker-version-precedente.log` : le journal courant couvre donc tout ce
qui s'est passé depuis la dernière mise à jour. Au-delà de 50 Mo, l'écriture
s'arrête jusqu'au démarrage suivant. Rien ne quitte le poste.

## Rapport d'assistance

Icône bouée à côté de « Paramètres » dans la barre latérale (ouverte, repliée et mobile) : l'utilisateur décrit son problème, le serveur
(`POST /api/piecemaker/support/report`, `support/report.ts`) assemble :

- la description ;
- le poste (version, système, mémoire, état du proxy d'anonymisation) ;
- le diagnostic Mistral : emplacements de Vibe examinés dans l'ordre (vibe et
  python présents ou non), Vibe retenu, `vibe --version`, provenance de la clé
  API, dernier échec d'installation, versions des Python candidats ;
- le journal depuis la mise à jour (10 derniers Mo) et les 500 dernières lignes
  de la version précédente.

Avant affichage, le dossier personnel devient `~`, le nom du compte
`<utilisateur>`, puis le texte passe par le dictionnaire d'anonymisation
(noms connus des dossiers anonymisés → codes). Le rapport est téléchargé
directement, sans aperçu, et l'utilisateur l'envoie lui-même : aucun envoi
automatique, donc pas de serveur de réception ni de sous-traitant à déclarer.

Limite : seuls les noms déjà connus du dictionnaire sont remplacés ; un nom de
dossier non anonymisé peut subsister dans un chemin.
