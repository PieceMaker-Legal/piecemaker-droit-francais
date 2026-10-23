# Mistral, Word et cycle Electron macOS — 22 octobre 2026

Essai local sur Mac Apple Silicon, avec un dossier et des documents entièrement fictifs. Le Python partagé est CPython 3.12.15 avec Vibe 2.25.0 ; les commandes d’installation utilisent le Node 24.22.0 de l’application Electron.

## Périmètre

Le banc est isolé dans `~/.piecemaker-mac-cycle/`, avec une identité, un protocole, un port et un profil Electron distincts. Le plan de désinstallation a été lu depuis le vrai processus Electron : ses chemins appartiennent au banc ou à son identité macOS. Les profils personnels des fournisseurs sont conservés.

L’application de test utilise le shell, les dépendances natives et l’interface compilée de l’application déjà installée, avec le serveur et la surcouche PieceMaker du dépôt actuel. Aucun build Vite, remplacement de l’application habituelle, incrément de version, push ou publication n’est effectué. Ce parcours ne qualifie donc pas une nouvelle DMG distribuée, la notarisation, macOS Intel ou Windows.

## Défauts corrigés pendant l’essai

- L’import à froid du Python dépassait 120 secondes, à la construction puis après extraction. Les vérifications disposent désormais de cinq minutes. Un échec laisse la configuration précédente sélectionnée ; les contrôles ne sont pas supprimés.
- L’éditeur Word émettait `w:csTheme`, rejeté par le schéma OOXML. La sauvegarde serveur corrige cet attribut en `w:cstheme` dans les parties Word, conserve les autres contenus et ne réencode pas une archive déjà valide. Une archive illisible ne remplace pas le document existant.
- Le retrait Mac ciblait une autorité par son nom et supprimait des ressources partagées. Il identifie maintenant le certificat de cette installation par son empreinte et conserve modèles Hugging Face, configuration MinerU et trousseau de signature partagés. Les comptes et la Bibliothèque restent conservés.

## Contrôles exécutés

La première installation depuis l’archive locale vérifiée de 364 Mio a pris environ 182 secondes ; sa réutilisation environ 26 secondes. Le banc interdit pip et les téléchargements à destination. Une empreinte d’archive incorrecte est refusée sans modifier le Python sélectionné.

Une nouvelle conversation Mistral a créé un Word fictif, changé son montant avec suivi des modifications et ajouté un commentaire. Le processus a été observé avec `lsof` : il exécute bien le Python partagé. L’historique et l’identifiant natif de la conversation sont conservés.

L’éditeur intégré a ouvert un Word produit par Mistral et enregistré une saisie. Avant le correctif, `docx validate` reproduisait l’erreur d’attribut ; après le correctif, l’enregistrement par l’interface passe la validation OOXML.

Le mécanisme existant `replaceDirectory` a été exécuté sur le vrai bundle de test : un échec de copie restaure l’application précédente ; le remplacement suivant réussit. Le bundle a été signé localement et sa signature vérifiée. Après relancement, le jeton API reste accepté et Mistral reprend la même conversation, modifie le montant à 1 600 EUR et conserve le commentaire. Le fichier passe la validation OOXML.

Le retrait a été déclenché par le pont natif `piecemakerDesktop.uninstall()` de l’application empaquetée. La disparition du bundle et du runtime a été observée. Le fichier Word, `auth.db` et le marqueur de Bibliothèque sont conservés.

La réinstallation du même bundle et du Python partagé réussit en environ 175 secondes. Le compte existant reste reconnu par l’API. Mistral reprend la même conversation avec succès et confirme le montant, le commentaire et le suivi actif. Le premier contrôle avait atteint le plafond cumulatif de 24 tours du banc ; sa reprise avec un plafond de 64 réussit. Le document reste identique à celui conservé lors du retrait et passe de nouveau `docx validate`.

Microsoft Word sur le Mac ouvre ensuite ce document sans demande de réparation : le texte, les révisions successives et le commentaire sont visibles. Seul le document fictif de contrôle est fermé après lecture. L’application Electron de test est arrêtée en fin d’essai.

La conservation du compte est vérifiée par l’API ; elle ne prouve pas une reconnexion transparente dans toutes les fenêtres Electron. La fenêtre du banc affiche une demande de connexion à la fin du parcours.

## Activation des mises à jour

Le mécanisme de livraison continue existant est testé séparément dans un vrai Electron sur ce Mac, avec un flux HTTPS local et une signature de test. Les onze phases réussissent : téléchargement sans remplacer l’interface en cours, activation au lancement suivant, fonctionnement hors ligne, refus d’une signature invalide, d’un runtime incompatible et d’une archive corrompue, retour arrière après interface vide ou exception de démarrage, et absence de nouvelle tentative de la version rejetée.

Le comportement retenu est donc : téléchargement en arrière-plan, puis activation au prochain lancement après avoir quitté l’application. Sur macOS, fermer une fenêtre ne quitte pas nécessairement le logiciel ; utiliser « Quitter PieceMaker » ou Cmd+Q. Ce résultat porte sur les mises à jour continues de l’interface. Le remplacement du bundle natif est contrôlé séparément ci-dessus ; une mise à jour silencieuse de toute l’application distribuée n’est pas qualifiée par ce banc.

## Limite de reprise constatée

Cette limite a ensuite été levée avec Vibe 3.0.2 ; voir le [complément et ses essais](mistral-vibe-3.md). Le constat ci-dessous reste celui du runtime 2.25.0.

La première conversation de contrôle, ouverte avec le Vibe personnel avant sélection du Python partagé, ne peut pas être importée par le runtime public : Vibe demande le paquet interne « Unified Harness ». Aucune conversion ni suppression de cette session n’est effectuée. La reprise validée ici concerne une conversation créée avec le Vibe 2.25.0 embarqué.

## Vérifications du code

Les 3 tests du service Word et les 53 tests ciblés bootstrap, remplacement, retrait natif, entrée Electron et stockage des mises à jour réussissent. `npm run build:server` et le lint des fichiers concernés réussissent. Les preuves détaillées et le Word fictif restent hors dépôt, dans le dossier du banc. Aucun document réel, contenu de dossier ou secret n’est ajouté à Git.
