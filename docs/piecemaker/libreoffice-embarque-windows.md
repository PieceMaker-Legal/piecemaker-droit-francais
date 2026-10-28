# LibreOffice dans le paquet Windows

## Réutilisation du mécanisme existant

`server/piecemaker/vendor/installer/steps/10-libreoffice.mjs` gérait déjà
l'installation système de LibreOffice et sa vérification. Cette étape est
conservée et étendue pour préparer le composant du paquet de bureau.
Il n'existe pas de second module d'installation LibreOffice dans
`desktop-bootstrap/lib/`.

Le parcours historique de développement peut toujours réutiliser une installation
système ou passer par son gestionnaire de paquets. Dans le paquet Windows,
LibreOffice est fourni dans `resources/libreoffice` ; l'utilisateur n'a pas
à installer LibreOffice séparément. NSIS installe et retire ce répertoire avec
l'application. Les installations système et profils personnels restent distincts.

## Construction et utilisation

La construction récupère le MSI officiel Windows x64 LibreOffice 26.8.1.1,
vérifie son SHA-256 épinglé puis crée une image administrative avec
`msiexec /a`. Elle inclut les fichiers extraits et leurs licences dans les
ressources electron-builder, avec un lien vers les sources correspondantes.
Le MSI de construction n'est pas inclus une seconde fois.

Sources techniques :

- [Version officielle](https://download.documentfoundation.org/libreoffice/stable/26.8.1/).
- [Empreinte du MSI x64 dans le manifeste Microsoft WinGet](https://github.com/microsoft/winget-pkgs/blob/master/manifests/t/TheDocumentFoundation/LibreOffice/26.8.1.1/TheDocumentFoundation.LibreOffice.installer.yaml).
- [Sources LibreOffice correspondantes](https://download.documentfoundation.org/libreoffice/src/26.8.1/).
- [Image administrative Windows Installer](https://learn.microsoft.com/en-us/windows/win32/msi/administrative-installation).
- [Licences LibreOffice](https://www.libreoffice.org/licenses/).

La fonction existante `findSoffice()` reste l'unique détection du convertisseur.
Elle respecte une surcharge explicite `SOFFICE_PATH`, puis cherche sous Windows
`resources/libreoffice/program/soffice.com` à côté de l'exécutable courant,
avant les installations système. Le mode console attend la fin du traitement.
La conversion garde le profil temporaire isolé déjà utilisé pour chaque appel.

La taille du paquet et l'espace disque nécessaire augmentent ; aucun chiffre
de taille finale n'est avancé avant la construction.

## Contrôles

Les tests locaux vérifient le rejet d'un MSI altéré avant extraction, les
ressources et notices conservées, l'absence de duplication du MSI et le parcours
de tamponnage PDF/image/texte existant.

Le workflow Windows commence désormais par extraire le vrai MSI et convertir
un DOCX et un XLSX fictifs avec ce moteur, puis les tamponner via les vraies
routes HTTP. Il contrôle les PDF, les numéros et les empreintes des originaux.
Cette étape doit réussir avant de construire l'installateur complet.

Après installation NSIS, le même test exécute le Node de l'application et les
routes réellement installées, sans `SOFFICE_PATH`, pour vérifier la détection
du moteur embarqué. La preuve est écrite dans `office-verification.json`.
La taille finale et le contrôle après installation NSIS restent en attente.

Le [contrôle natif Windows du commit a6e5fc8](https://github.com/PieceMaker-Legal/piecemaker-droit-francais/actions/runs/40712916939/job/122903039549)
a réussi le 28 octobre 2026 : MSI officiel téléchargé, empreinte vérifiée,
image administrative extraite, DOCX et XLSX convertis puis tamponnés avec
les PDF, image et Markdown fictifs ; numéros et intégrité des originaux vérifiés.
Les deux tests de packaging réussissent également.

Le [rapport Tampon initial](tampon-windows-2026-10-28.md) décrit le constat
antérieur : LibreOffice absent de l'ancien EXE Validation. Les nouveaux fichiers
ne modifient pas rétroactivement ce programme installé.
