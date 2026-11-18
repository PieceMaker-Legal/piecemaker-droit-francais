# Commandes PieceMaker dans Hermes

## Rôle d'Hermes

Hermes est un provider facultatif. Dans un dossier, il travaille comme les autres
providers : il lit l'`AGENTS.md` du dossier (donc `~/.piecemaker/custom/perso.md`),
tient la mémoire de l'acte dans `.piecemaker/memoires/<nom>.md` et passe par `pm`.
Il apporte en plus deux usages : l'accès par téléphone, par sa passerelle, et les
rappels d'échéances. Sans Hermes, seuls ces deux usages manquent.

PieceMaker n'ajoute pas de « brain » séparé : ce qui vaut pour tous les dossiers
est dans `~/.piecemaker` (profil de pratique, Bibliothèque, ontologie et
arborescence, citations vérifiées, suivi des dossiers).

## Profil dédié

Le serveur utilise le profil Hermes `piecemaker` (`~/.hermes/profiles/piecemaker`),
sauf si `HERMES_HOME` est déjà défini. Toutes ses commandes Hermes (sessions,
passerelle, plugin, modèles, sessions listées) visent ce profil.

- Création : au premier usage (session, onglet Passerelle ou rappels), par
  `hermes profile create piecemaker --clone`. Le clone reprend les modèles et les
  identifiants de l'utilisateur, sans les canaux de messagerie. Le profil
  personnel n'est jamais modifié. Un profil `piecemaker` que PieceMaker n'a pas
  créé (sans `.piecemaker-owned`) est refusé.
- Mémoire : `memory.memory_enabled` et `memory.user_profile_enabled` sont mis à
  `false` à chaque démarrage, et les mémoires copiées par le clone sont vidées. La
  mémoire Hermes est commune à toutes les sessions d'un profil : un fait d'un
  dossier pourrait ressortir dans un autre.
- Passerelle : Réglages › Agents › Hermes › Passerelle lance
  `hermes -p piecemaker gateway setup`. Le téléphone se connecte donc à ce profil,
  pas au profil personnel.
- Les sessions Hermes lancées avant ce profil restent dans le profil personnel et
  n'apparaissent plus dans PieceMaker.

## Rappels d'échéances

Réglages › Agents › Hermes › Passerelle › Rappels d'échéances crée la tâche
planifiée Hermes `piecemaker-rappels` (heure et destination au choix, par défaut
8 h vers `telegram`). La tâche lance le script `piecemaker-rappels.py` du profil,
sans modèle (`--no-agent`). Le script lit le port de l'instance PieceMaker ouverte
et appelle `GET /api/piecemaker/local/suivi/rappels` (boucle locale seulement) :
échéances non faites en retard ou dans les 7 jours, tous dossiers confondus. Une
sortie vide n'envoie rien. Hermes exécute la tâche tant que sa passerelle tourne ;
PieceMaker fermé, la tâche échoue sans envoi. Le message contient le nom des
dossiers et l'intitulé des échéances : il part vers la plateforme choisie.

## Commandes

La première session Hermes lancée par PieceMaker installe et active le plugin
local `piecemaker` dans le profil Hermes `piecemaker` (voir ci-dessous). Aucun modèle n'est appelé
pendant cette installation. Le moteur Hermes reste inchangé.

Le plugin fournit l'outil `piecemaker`, le skill PieceMaker et les fonctions
Python `commande`, `sql`, `catala` et `suivi` :

```python
from piecemaker import sql, commande

documents = sql("SELECT id, label FROM piecemaker_nodes WHERE project_id = dossier() AND kind = 'document'")
print(documents)
print(commande("catala", "lister"))
```

`commande(outil, *arguments, **options)` reprend les noms des commandes de `pm`.
Pour Catala, utilisez `pm catala` dans le terminal Hermes.
Les résultats JSON deviennent des objets Python ; les autres résultats restent
du texte. Les erreurs deviennent des exceptions. Les sorties trop longues ou
tronquées du terminal sont refusées plutôt qu'interprétées comme un résultat.

Le plugin utilise le dossier de la session, jamais le répertoire de la
passerelle Hermes. Chaque serveur publie son PID, ses dossiers et ses chemins
d'exécution dans `<profil Hermes>/plugins/piecemaker/bindings/`. Deux instances
actives pour le même dossier provoquent un refus. Les instances arrêtées sont
ignorées. `CLOUDCLI_HOME` est requis ; aucun port ni compte distant n'est créé.

Les hooks natifs `pre_tool_call` et `post_tool_call` adaptent les outils Hermes
aux scripts existants `protect-originals`, `guard-secrets` et
`classify-ai-documents`. Aucune consigne de protection n'est ajoutée au prompt.
Les écritures directes des fichiers de levée et de configuration de protection
du dossier sont refusées. Une erreur du raccordement bloque l'appel concerné.

Dans un dossier protégé, Python accepte les imports des fonctions PieceMaker
et les traitements de données simples. Les imports arbitraires, lectures
directes et évaluations dynamiques sont refusés. Le noyau Python est réinitialisé
à chaque appel pour ne pas conserver du code antérieur à l'activation du bouclier.
Les outils natifs restent disponibles pour les autres opérations permises.

## Limites

- Les hooks ne constituent pas un confinement système. Le filtre des commandes
  terminal conserve les limites de `protect-originals` : interpréteurs, chemins
  calculés et commandes indirectes peuvent contourner son analyse textuelle.
- Les autres outils ou plugins Hermes n'héritent pas automatiquement du contrôle
  de fichiers. Les outils navigateur, vision et processus connus sont refusés
  dans les dossiers protégés ; un nouvel outil doit être examiné avant activation.
- L'activation utilise `hermes plugins enable`, qui recharge la passerelle lorsque
  Hermes le permet. Si Hermes annonce un redémarrage nécessaire, ne pas utiliser
  la session avant ce redémarrage. Le serveur ne redémarre aucun processus.
- Le profil `piecemaker` est commun à tous les dossiers. Il n'y a pas de profil
  par dossier : la mémoire Hermes y est donc coupée.
- Les appels `pm` réutilisent les contrôles et le masquage existants. Le harnais
  de citations juridiques du chat n'est pas étendu par cette modification.

Validation sans appel à un modèle : `hermes plugins doctor <plugin> --ci`,
test TypeScript de l'installation, puis `test_integration.py` avec
`PIECEMAKER_TEST_NODE` et `PIECEMAKER_TEST_ROOT`. La racine de test doit être hors
des dossiers temporaires système, exclus du registre des dossiers juridiques.
