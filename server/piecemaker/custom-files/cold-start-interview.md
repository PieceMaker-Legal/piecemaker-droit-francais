# Entretien initial — profil de pratique commun

## Objectif

Apprendre comment votre pratique travaille réellement et consigner les réponses dans un profil de pratique vivant, que vous pouvez lire et modifier en français courant. Le profil commun contient : cadre d'exercice, nom de l'entreprise ou du cabinet, secteur, activité, taille, juridictions, autorités de régulation. Les positions propres à une spécialité restent en dehors de cet entretien.

## Vérification au démarrage

Lisez `~/.piecemaker/custom/perso.md` :
- **N'existe pas** → démarrez l'entretien.
- **Contient `<!-- ENTRETIEN EN PAUSE À : -->`** → saluez l'utilisateur et proposez de reprendre à partir de cette section.
- **Contient des marqueurs `[À COMPLÉTER]` sans commentaire de pause** → le modèle n'a jamais été rempli ; proposez de recommencer ou de reprendre à partir du premier marqueur.
- **Renseigné (aucun marqueur de remplacement ni commentaire de pause)** → déjà configuré ; passez cette étape sauf si l’utilisateur demande de refaire l’entretien.

La présence de la seule instruction de lecture de ce guide, d'un titre ou de la mention « État : non renseigné » ne constitue pas un profil renseigné. Si le profil est partiel, confirmez les informations déjà enregistrées et ne reposez pas les questions déjà traitées.

## Vérifier le profil de pratique partagé

Recherchez `~/.piecemaker/custom/perso.md`.

- **S'il contient un profil renseigné :** lisez-le. Confirmez en une phrase : « Vous êtes [nom], [cadre d'exercice], chez [entreprise], dans le secteur [secteur], et exercez dans [juridictions]. C'est bien cela ? (Ou dites « mettre à jour » pour modifier le profil partagé.) » Si l'utilisateur confirme, ne reposez pas les questions déjà renseignées.
- **S'il ne contient pas encore de profil renseigné :** le profil commun reste à renseigner. Après l'orientation et le choix de parcours, posez les questions sur l'entreprise et consignez les réponses dans le profil partagé dans `perso.md`. Dites à l'utilisateur : « J'ai enregistré votre profil de pratique dans perso.md — les sessions qui lisent ce fichier pourront reprendre ces informations sans reposer ces questions. »

## Vérification du périmètre d'accès

Si un document partagé par l'utilisateur est inaccessible, signalez la limitation réelle et proposez un moyen de le partager. Ne déduisez pas le périmètre d'accès aux fichiers du seul répertoire de travail. Respectez les règles de protection et d'anonymisation déjà applicables.

## Avant le début de l'entretien

Avant toute autre question, affichez le préambule qui présente d'abord les deux parcours — 3 à 4 lignes courtes, pas davantage :

> Cet entretien apprend comment votre pratique fonctionne et enregistre votre profil commun dans `perso.md`.
> **2 minutes** pour votre rôle et votre domaine de pratique ; **15 minutes** pour préciser aussi le contexte de votre structure, les juridictions et les intégrations disponibles.
> Rapide ou complet ? Vous pourrez approfondir à tout moment.

Attendez que l'utilisateur choisisse avant d'afficher quoi que ce soit d'autre.

## Après le choix du parcours rapide ou complet

Expliquez avec vos propres mots : cet entretien vise à comprendre votre façon réelle de travailler et à consigner ces éléments dans un fichier texte brut. Vous pourrez modifier toutes vos réponses plus tard.

> « La configuration crée un nouveau profil professionnel à partir de vos réponses. Elle ne consulte ni votre historique personnel, ni vos autres conversations, ni le fichier CLAUDE.md de votre répertoire personnel. Si vous avez mentionné un élément pertinent plus tôt dans cette conversation (par exemple, votre entreprise), je vous demanderai avant de l'utiliser. Rien ne sera ajouté à votre configuration sauf si vous le saisissez ou l'approuvez. »

En dehors du profil déjà enregistré dans `perso.md`, ne lisez pas le fichier personnel `~/CLAUDE.md`, `~/user.md` ni d'autres fichiers de mémoire pour préremplir l'entretien. Les seules données à utiliser sont les réponses saisies par l'utilisateur et les documents qu'il indique ou colle ici.

**Parcours rapide :** demandez uniquement le rôle et le ou les domaines de pratique. Signalez les éléments non approfondis avec `[PAR DÉFAUT — non approfondi dans le parcours rapide]`, sans inventer de faits sur l'utilisateur. Terminez en indiquant qu'il peut demander l'entretien complet ou reprendre une seule partie.

**Parcours complet :** suivez le déroulement de l'entretien ci-dessous.

## Rythme de l'entretien

- **Partez du principe que la réponse existe quelque part.** Lorsqu'une question porte sur des informations probablement déjà consignées — description de l'entreprise, guide de conduite, guide de style, manuel, liste des juridictions, portefeuille de dossiers — demandez un lien ou un document avant de demander à l'utilisateur de répondre de mémoire. « Collez un lien ou un document, ou donnez-moi la version courte » est la formulation par défaut pour tout ce qui dépasse une phrase. Un enquêteur qui oblige les gens à ressaisir ce qu'ils ont déjà écrit a échoué dès sa première mission.
- **Taille des lots — comptez les sous-questions.** « Ne posez jamais plus de 2 ou 3 questions à la fois » signifie 2 ou 3 *questions auxquelles il faut répondre*, sous-questions comprises. Une question avec 5 sous-questions en compte 5. Le critère : l'utilisateur peut-il répondre sans faire défiler la page ? Si les questions ne tiennent pas sur un écran, il y en a trop. Dans la mesure du possible, privilégiez les questions structurées à choix rapide : elles évitent d'avoir à faire défiler ou à saisir du texte.

**Attendez de vraies réponses.** Certaines questions appellent des réponses rapides à choisir. D'autres nécessitent que l'utilisateur saisisse du texte, décrive quelque chose ou téléverse un document. Lorsqu'une question exige plus qu'une réponse rapide :

- **Posez la question et attendez.** Formulez-la simplement : « Il faut saisir une réponse à cette question — j'attends. » Ne posez pas la question suivante avant d'avoir reçu la réponse.
- **Pour les documents partagés :** « Collez le contenu, indiquez un chemin de fichier ou dites « passer pour le moment ». Si vous passez cette étape, je signalerai la lacune dans votre configuration pour que vous puissiez la combler plus tard. » Puis attendez réellement.
- **Avant d'écrire le profil de pratique :** passez l'entretien en revue. Énumérez chaque question passée ou à laquelle une valeur de remplacement a été donnée. Dites : « Avant d'écrire votre configuration, voici les points encore en suspens : [liste]. Souhaitez-vous répondre à certains maintenant ou les laisser comme valeurs de remplacement ? » Attendez la réponse avant d'écrire.
- **N'écrivez jamais** le profil de pratique en laissant des lacunes sans le signaler. Chaque valeur de remplacement doit correspondre à une décision délibérée de l'utilisateur de passer la question, et non à une question restée sans réponse parce qu'elle a défilé.
- **Pause et reprise.** Dites d'emblée à l'utilisateur : « Si vous devez vous arrêter, dites « pause » (ou « stop », ou « je reviendrai plus tard ») et j'enregistrerai votre progression. Demandez de reprendre l’entretien plus tard et je reprendrai là où nous nous sommes arrêtés. » Lorsque l'utilisateur met l'entretien en pause, écrivez une configuration partielle dans `~/.piecemaker/custom/perso.md`, avec en tête un commentaire `<!-- ENTRETIEN EN PAUSE À : [nom de la section] — demander de reprendre l’entretien -->` et des marqueurs `[EN ATTENTE]` (distincts de `[À COMPLÉTER]`) pour les champs sans réponse. Lorsque la configuration est relancée et qu'une configuration en pause est détectée, saluez l'utilisateur : « Bon retour. Vous vous êtes arrêté à [section]. Vos réponses précédentes sont enregistrées. Souhaitez-vous reprendre là où vous en étiez ou recommencer ? » Ne reposez pas les questions déjà traitées.

**Vérifiez les faits juridiques indiqués par l'utilisateur pendant la configuration.** Lorsque l'utilisateur répond à une question de l'entretien en citant une règle précise, un numéro de loi, une décision, un délai, un seuil, une juridiction ou un numéro d'enregistrement — et que vous pouvez vérifier cette information — effectuez cette vérification avant de l'inscrire dans la configuration. Si sa réponse contredit ce que vous savez ou ce qu'il a fourni, signalez-le : « Vous avez indiqué que le seuil est X ; la source vérifiée indique Y. Pouvez-vous confirmer lequel doit figurer dans le profil ? `[PRÉMISSE SIGNALÉE — À VÉRIFIER]` » Un fait erroné consigné dans perso.md se répercute dans tous les résultats futurs ; le repérer à ce stade est l'une des interventions les plus utiles du produit.

Si la vérification n'est pas possible, conservez la déclaration comme non vérifiée et indiquez la source manquante. Ne présentez pas un souvenir du modèle comme une vérification.

## L'entretien

### Partie 0 : Qui utilise cet outil ?

> Qui utilisera cet outil au quotidien : avocat, juriste d'entreprise, autre professionnel du droit, non-juriste ayant accès à un avocat, ou non-juriste sans accès régulier à un avocat ?

Consignez le rôle. Si l'utilisateur est avocat, demandez son barreau de rattachement. Ne le demandez pas au juriste d'entreprise. Adaptez les questions à son cadre d'exercice ; ne lui imposez pas une catégorie qui ne correspond pas à sa pratique.

### Partie 1 : Le contexte de pratique

Posez les questions de façon conversationnelle, un groupe à la fois. Les points ci-dessous sont une trame pour l'assistant, pas un questionnaire à afficher en bloc.

- **Cadre d'exercice et domaine :** exercice individuel, cabinet, service juridique interne, administration, aide juridique, clinique ou autre ; domaine ou domaines réellement pratiqués.
- **Structure, secteur et activité :** nom de l'entreprise ou du cabinet, secteur, ce que la structure fait ou vend, pour qui et comment. Proposez d'abord un lien ou un document, ou une version en une phrase.
- **Taille :** seul, petite équipe ou structure plus importante ; taille de l'équipe et de la structure lorsque pertinente.
- **Juridictions et autorités :** où exercez-vous et quelles autorités de régulation sont pertinentes pour votre activité ? Proposez de lire une liste existante.

Ne reposez pas les questions auxquelles le profil ou les documents partagés répondent déjà ; confirmez les réponses ambiguës.

### Partie 2 : Quelles intégrations sont connectées ?

Vérifiez les connecteurs pertinents pour la pratique et effectivement disponibles dans cet environnement.

**Vérifiez ce qui est réellement connecté, pas ce qui est configuré.** Un connecteur répertorié dans `.mcp.json` est *disponible*. Un connecteur qui répond effectivement est *connecté*. Ce sont deux choses différentes, et les confondre détruit la confiance. Pour chaque connecteur utilisé :

- Si vous pouvez tester la connexion (en appelant un outil MCP simple, comme une fonction de liste ou de recherche), ne signalez ✓ qu'après une réponse positive.
- Si vous ne pouvez pas la tester (aucun moyen de la sonder depuis ici), signalez ⚪ « configuré, mais non vérifié — ouvrez les paramètres MCP pour confirmer » avec une courte indication expliquant comment vérifier.
- Ne signalez jamais ✓ sur la seule base de la configuration.

Pour les connecteurs non connectés, expliquez comment les connecter seulement si la marche à suivre est connue dans cet environnement. Indiquez quelle fonctionnalité utilisera une solution manuelle.

Présentez ensuite les résultats sous cette forme :

> - ✓ [Intégration] — connectée (testée)
> - ⚪ [Intégration] — configurée, mais non vérifiée. Ouvrez vos paramètres MCP pour confirmer.
> - ✗ [Intégration] — introuvable. [Fonctionnalité] utilisera [solution manuelle]. [Comment la connecter.]

Vous n'avez pas besoin de toutes ces intégrations. Les fonctionnalités essentielles fonctionnent avec le seul accès aux fichiers. Si vous en configurez une plus tard, demandez de revérifier les intégrations.

L'utilisateur peut demander de « revérifier les intégrations » après l'ajout ou le retrait d'un connecteur. Relancez uniquement cette vérification et mettez à jour la section « Intégrations disponibles » dans `perso.md`, sans refaire l'entretien ni modifier le rôle ou le profil.

## Rédaction du profil de pratique

Écrivez les réponses dans `~/.piecemaker/custom/perso.md`, 200 lignes max, en conservant son instruction de lecture du présent guide et toute consigne personnelle existante. Utilisez les mots de l'utilisateur autant que possible. C'est un document sur sa pratique qu'il lira et modifiera, en prose avec quelques tableaux ponctuels.

Consignez uniquement les éléments recueillis : rôle, contexte d'exercice, structure, secteur, activité, taille, juridictions, autorités et intégrations disponibles. Conservez les lacunes explicitement acceptées et les réponses enregistrées lors d'une pause. Indiquez la date de dernière mise à jour.

## Après la rédaction

1. **Affichez le résumé.** « Voici ce que j'ai retenu. Jetez un œil au profil de pratique et dites-moi ce que j'ai mal compris. » Signalez clairement les lacunes.
2. **Montrez ce que les outils disponibles peuvent faire.** Proposez : « Souhaitez-vous voir comment je peux vous aider ? » Si oui, présentez des tâches concrètes adaptées à sa pratique. Vérifiez quelles compétences existent réellement avant de les proposer. Passez cette étape si l'utilisateur a déjà indiqué une première tâche concrète pendant l'entretien.
3. **Avant une première tâche qui cite des sources :** vérifiez la disponibilité d'un outil de recherche adapté. Sans source consultée, signalez les références comme non vérifiées.
4. **Terminez en rappelant que le profil est modifiable.**

> Terminé. Votre profil de pratique se trouve dans `~/.piecemaker/custom/perso.md` — un fichier texte brut que vous pouvez lire et modifier directement. Vous pouvez changer toutes vos réponses :
>
> - Modifiez directement le fichier pour un changement rapide.
> - Demandez de refaire tout l'entretien ou une seule section.
> - Demandez de revérifier les intégrations connectées.

## Votre profil de pratique évolue

Après avoir rédigé le profil de pratique, terminez par cette note :

> **Votre profil de pratique évolue.** Il s'améliore au fil de votre utilisation des outils :
>
> - Si le résultat d'une compétence ne vous convient pas, c'est généralement une position à ajuster. Le résultat vous indiquera laquelle.
> - Vous pouvez toujours dire « modifie mon guide de conduite pour privilégier X » ; enregistrez la modification dans `perso.md`.
> - Demandez de reprendre une section de l’entretien pour refaire une partie de l'entretien, ou modifiez directement le fichier de configuration.
