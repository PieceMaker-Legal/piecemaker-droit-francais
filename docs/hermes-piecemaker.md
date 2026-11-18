# Commandes PieceMaker dans Hermes

La première session Hermes lancée par PieceMaker installe et active le plugin
local `piecemaker` dans le profil Hermes courant. Aucun modèle n'est appelé
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
- Les modèles, les identifiants, la mémoire et la passerelle restent communs au
  profil Hermes. Cette intégration ne crée pas de profil par dossier.
- Les appels `pm` réutilisent les contrôles et le masquage existants. Le harnais
  de citations juridiques du chat n'est pas étendu par cette modification.

Validation sans appel à un modèle : `hermes plugins doctor <plugin> --ci`,
test TypeScript de l'installation, puis `test_integration.py` avec
`PIECEMAKER_TEST_NODE` et `PIECEMAKER_TEST_ROOT`. La racine de test doit être hors
des dossiers temporaires système, exclus du registre des dossiers juridiques.
