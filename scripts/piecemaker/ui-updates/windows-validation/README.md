# Essai Windows — Mistral SDK

Ce paquet installe **PieceMaker Validation**, avec son profil distinct de l’application habituelle. Il conserve la version applicative de la branche ; `validation-build.json` donne le commit exact. Ce test ne publie ni release ni mise à jour automatique de l’application habituelle.

1. Extraire l’archive de validation et lancer `PieceMaker-Validation-…-win-x64.exe`.
2. Ouvrir **PieceMaker Validation**, terminer les écrans de premier démarrage, puis attendre que **GLiNER2-PII** soit indiqué installé dans les paramètres des modèles locaux. Les bibliothèques Python sont embarquées ; les poids du modèle sont téléchargés au premier lancement.
3. Dans les paramètres Mistral, cliquer **Se connecter avec Mistral**, autoriser le compte Pro ou Team dans le navigateur, puis **Vérifier la connexion**. La page du fournisseur peut encore afficher « Mistral Vibe Code » ; les conversations utilisent le SDK JavaScript.
4. Créer un dossier fictif avec un fichier `preuve.md` contenant `Code fictif : ZETABIO-8264`. Dans le chat Mistral, demander la lecture de ce fichier et la restitution du code. Vérifier l’appel de lecture affiché, puis recharger et poursuivre la conversation.
5. Tester un skill activé et un outil MCP configuré. Le dictionnaire justice.fr peut être indisponible pendant la maintenance du site ; utiliser un autre outil pour vérifier le raccord MCP.
6. Fermer puis rouvrir l’application : le compte et la conversation doivent être conservés. Tester ensuite une petite analyse tabulaire sur le Markdown fictif.

Les fichiers `installation-verification.json`, `mistral-sdk-verification.json` et `gliner-verification.json` décrivent les contrôles exécutés sur la machine Windows jetable de CI. La connexion avec votre abonnement reste une vérification manuelle sur votre poste.
