## Essai du SDK Mistral avec connexion au compte

Cet essai indépendant utilise `@mistralai/mistralai` sous Node 22 ou supérieur.
Il ne lance pas Vibe et ne modifie pas ses fichiers, sa configuration ou ses identifiants.

Sur Windows, extraire entièrement l’artefact `Mistral-SDK-Windows-x64`, puis
double-cliquer sur `Tester-Mistral.cmd`. Node et le SDK sont fournis dans le
paquet : aucune installation préalable de Python, Node ou PieceMaker n’est requise.
Le navigateur ouvre la connexion au compte. Après approbation, la console affiche
la réponse du modèle et reste ouverte pour lire le résultat. `verification.json`
identifie la révision et les versions testées sur le runner Windows ; il ne
prétend pas valider une connexion de compte utilisateur sur ce runner.

Depuis le dépôt dont les dépendances sont installées :

```sh
node scripts/piecemaker/mistral-sdk/try.mjs
```

Le navigateur ouvre le parcours de connexion Mistral. Choisir le compte et
l’espace de travail Pro ou Team, puis approuver la connexion. Le script conserve
la clé obtenue en mémoire pour une seule demande fictive à `mistral-small-latest`.
Il ne sauvegarde ni clé ni session sur disque. Un modèle différent peut être
passé comme premier argument. Le script ne change aucun paramètre de facturation.

L’essai réutilise le protocole PKCE du
[client officiel](https://github.com/mistralai/mistral-vibe/blob/main/vibe/setup/auth/http_browser_sign_in_gateway.py),
indépendamment du programme Vibe. Ce parcours n’est pas une fonctionnalité du SDK ;
il peut évoluer côté Mistral. L’utilisation de la souscription et les modèles
accessibles restent soumis aux droits du compte et de l’espace de travail.
La documentation des [abonnements](https://docs.mistral.ai/fr/admin/billing-usage/subscriptions)
décrit l’allocation mensuelle partagée et les paramètres de paiement à l’usage.

Cet essai en ligne de commande n’ajoute pas de fournisseur au chat PieceMaker.
Il n’est pas inclus dans les installateurs déjà construits ou en cours de construction.

Contrôle sans connexion ni appel au modèle :

```sh
node --test scripts/piecemaker/mistral-sdk/*.test.mjs
```
