# Réparation des certificats macOS — 24 octobre 2026

Le sujet 1 de l’[audit d’installation](audit-installation-simplification-2026-10-24.md)
est corrigé dans `desktop-bootstrap/lib/certificates-darwin.mjs`.
La présence d’un certificat public de CA encore valide ne suffit plus à réutiliser
l’ensemble. Le défaut reproduit — suppression de la clé de CA, suivie d’un faux
`regenerated: false` — provoque désormais un arrêt explicite sans modification
des fichiers existants.

## Règle de réparation

| État constaté | Comportement |
| --- | --- |
| Aucun des huit fichiers cryptographiques n’existe | Génération initiale ; l’autorisation de confiance reste celle du parcours d’installation. |
| CA et clé appariées, CA autosignée valide pour au moins trente jours ; dérivés et P12 valides | Réutilisation sans écriture ; `regenerated: false`. |
| Même CA valide ; paire TLS ou paire de signature absente, invalide, non appariée ou à renouveler | Réémission de la paire défectueuse sous cette CA conservée. |
| Même CA valide ; P12 absent, illisible, incohérent ou secret absent/incorrect | Reconstruction du P12 et de son secret ; conservation d’une paire de signature valide. |
| Matériel partiellement présent ; CA ou clé absente, corrompue, non appariée, non autosignée ou à renouveler | Arrêt avant toute réparation, avec indication du dossier et des actions de récupération. |

Les huit fichiers sont la CA et sa clé, les deux paires TLS/signature, le P12 et
son secret. La validité inclut l’appariement des clés, les signatures, les dates,
les usages serveur/signature de code et les hôtes TLS `localhost`, `127.0.0.1`
et `::1`. Le P12 doit contenir la paire de signature courante et la CA courante.

Une réparation conserve les octets de la CA et des dérivés sains. Les nouveaux
fichiers sont générés dans un répertoire temporaire privé puis copiés seulement
après la réussite des commandes de génération. Une erreur OpenSSL à cette étape
laisse les fichiers en place inchangés. Les clés, le P12 et le secret créés ont
le mode `0600`. Le numéro de série utilisé pendant la génération reste dans le
répertoire temporaire. Le secret du P12 passe par l’entrée standard d’OpenSSL,
sans figurer dans ses arguments ni dans le message d’erreur de la commande.

## CA perdue ou à renouveler

La clé privée perdue ne peut pas être reconstruite à partir du certificat public.
L’installation demande de restaurer la paire CA/clé depuis une sauvegarde sûre.
À défaut, le renouvellement impose de retirer explicitement la confiance de
l’ancienne autorité, d’archiver le dossier de certificats, puis de relancer
l’installation et d’autoriser la nouvelle autorité.

L’ancienne autorité doit être identifiée par son certificat ou son empreinte,
pas par son seul nom. Si son certificat public a disparu du disque, son
identification et le traitement de la confiance résiduelle dans le trousseau
restent manuels. Le générateur ne déduit jamais l’absence de confiance d’un
échec de `security verify-cert` et ne consulte aucun marqueur de confiance.
Si tout le matériel a disparu, il ne peut pas deviner une ancienne confiance :
la génération initiale reste possible avec le consentement normal.

## Vérification

`desktop-bootstrap/lib/certificates-darwin.test.mjs` utilise de vrais certificats
et P12 OpenSSL dans un dossier temporaire, sans appeler les fonctions de
confiance ou de signature macOS. Aucun trousseau utilisateur n’est touché.

La matrice comporte 32 cas, soit 33 tests comptabilisés par Node avec le parent :

- génération initiale et réutilisation sans modification ;
- suppression et corruption de chacun des six fichiers dérivés ;
- suppression et corruption des deux fichiers de CA, clé de CA non appariée,
  signature de CA altérée et disparition simultanée des deux fichiers de CA ;
- CA expirée, à moins de trente jours de l’expiration ou pas encore valide,
  avec horloge contrôlée sur de vrais certificats ;
- clé TLS non appariée, usages TLS/signature inversés, SAN incomplet,
  certificat TLS à renouveler et autre autorité portant le même nom ;
- échec OpenSSL avant publication, mauvais contenu du P12 et CA absente du P12.

Deux exécutions locales avec Node 24.11.1, OpenSSL 4.0.3 puis LibreSSL 3.3.6
fourni par macOS : 33 tests réussis dans chaque exécution, aucun échec ni test
ignoré. La validation des refus compare les empreintes et
permissions de tous les fichiers avant et après l’appel. Les réparations sont
revérifiées cryptographiquement ; les suppressions/corruptions vérifient aussi
la conservation des éléments sains et la réutilisation au second appel.

```sh
node --test desktop-bootstrap/lib/certificates-darwin.test.mjs
```

Ce test ne qualifie pas le consentement graphique, l’import dans le trousseau,
la signature de l’application ni un nouveau paquet Electron distribué.
