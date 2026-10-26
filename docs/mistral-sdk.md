# Mistral avec le SDK JavaScript

Le chat Mistral et les sessions de l’analyse tabulaire utilisent `@mistralai/mistralai`. Aucun processus Vibe n’est lancé pour produire leurs réponses. Python reste nécessaire aux composants de conversion, d’anonymisation et de recherche qui l’utilisent.

## Connexion

Réglages → Mistral → **Se connecter avec Mistral** ouvre le parcours navigateur officiel. L’utilisateur autorise son compte, puis revient dans PieceMaker. **Vérifier la connexion** effectue un appel SDK avec une phrase de test fixe. La clé reste côté serveur dans les identifiants de l’utilisateur PieceMaker ; les réponses HTTP de statut ne la contiennent jamais. Une connexion annulée ne peut pas être enregistrée par une autorisation tardive.

Le fournisseur nomme encore sa page d’autorisation « Mistral Vibe Code ». Le parcours PKCE fournit le jeton utilisé par le SDK ; il ne lance pas le CLI Python. Les comptes et conditions d’usage restent ceux de Mistral.

Le statut utilisé par l’interface vient de `/api/piecemaker/mistral-sdk/provider-status`, associé à l’utilisateur authentifié. L’ancien contrat global de statut des CLI ne représente pas ces identifiants par utilisateur ; il n’est plus utilisé par l’interface pour Mistral.

## Chat et outils

Le raccord appartient à `server/piecemaker/mistral-sdk/`. Il remplace le runtime enregistré sans modifier le répartiteur CloudCLI. Les événements gardent le protocole du chat existant. Les conversations SDK sont enregistrées sous le répertoire de composants PieceMaker, dans `mistral-sdk/sessions/`, avec contrôle du propriétaire avant reprise. Les historiques Vibe restent délégués au lecteur historique tant qu’ils n’ont pas été repris avec le SDK.

Les instructions Markdown générales et du dossier sont chargées avec leurs imports `@fichier.md`. Les skills visibles et non désactivés sont annoncés au modèle ; `skill` lit leur contenu complet. `Read`, `Write`, `Edit` et `Bash` permettent leur exécution. Les pièces jointes sont des références de fichiers pour les outils locaux ; ce raccord n’envoie pas directement les images comme entrée vision.

Les serveurs MCP viennent des configurations utilisateur et projet `.vibe/config.toml`, avec repli sur `.mcp.json`. Les serveurs désactivés restent exclus. Stdio, HTTP et SSE sont pris en charge. Un serveur indisponible est signalé dans le contexte du tour. Les erreurs MCP conservent leur statut d’erreur pour le vérificateur de citations.

Les lectures s’exécutent directement ; les autres outils demandent l’autorisation, sauf les modes permissifs explicites. `acceptEdits` autorise les écritures de fichiers ; le mode plan exclut les outils modificateurs. Les hooks existants protègent pièces originales, mapping et secrets configurés. `Edit` et `Write` vérifient aussi le droit de lecture de leur cible. Le harnais juridique et l’historique automatique du dossier restent actifs.

Chaque client SDK capture le proxy de sa session et sa CA locale. Une panne du proxy échoue sans connexion directe de secours. Les limites de tokens et de tours sont prises en charge ; une limite monétaire Vibe reçoit une erreur explicite.

## Analyse tabulaire

Le plugin appelle le serveur PieceMaker par une capacité locale temporaire liée au dossier, sans recevoir la clé Mistral. Le pont local sélectionne l’unique compte SDK connecté ; si aucun compte ou plusieurs comptes sont disponibles, il refuse de choisir implicitement. Cette limite concerne l’analyse tabulaire locale ; le chat sélectionne le compte de son utilisateur.

Le mode inline transmet le texte préparé. Le mode chemin expose uniquement `Read` sur les Markdown du corpus autorisé, après résolution des liens symboliques. Les appels utilisent le proxy associé au dossier. La correction des citations et l’enregistrement des cellules restent gérés par le plugin.

## Validation

Essais Mac depuis les sources, sans build de l’application : connexion des paramètres, appel SDK réel, exécution d’un skill fictif, lecture de fichier, appel MCP Légifrance `Search_Code`, chat par WebSocket, rechargement de l’historique et reprise après redémarrage, sessions tabulaires inline et lecture de Markdown. Aucun document réel n’a servi aux scénarios de test.

Les tests couvrent aussi refus et annulation d’autorisation, mode plan, masquage des skills, protection des pièces et du mapping, confinement du corpus, anonymisation et restitution de données fictives avec hudsucker, puis refus après arrêt du proxy.

Le dictionnaire juridique MCP renvoie une erreur de structure du site externe ; `Search_Code` répond sans erreur. Ce défaut du dictionnaire n’est pas corrigé ici.

Les verrous Python Windows et macOS ARM64 ne demandent plus Vibe. Leurs nouvelles archives et l’installation complète Windows nécessitent une validation CI et une release ultérieures. Aucun ancien environnement personnel n’est supprimé. Le précédent test SDK autonome Windows ne valide pas à lui seul ce raccord applicatif.
