# Reprise après épuisement du quota

Quand un fournisseur atteint sa limite d'utilisation, le chat remplace son message par une carte (`src/modules/piecemaker-quota/QuotaLimitCard.tsx`, branchée dans `MessageComponent.tsx`).

## Détection

`shared/piecemaker/quota-limit.ts` (`detectQuotaLimit`), partagé par le client et le serveur, reconnaît un message court (800 caractères au plus) d'assistant ou d'erreur :

- Claude : `Claude AI usage limit reached|<horodatage>` et la bannière `You've hit your … limit · resets 3pm (Europe/Paris)` / `… limit reached ∙ resets Mon 7am` ; l'heure est lue dans le fuseau indiqué.
- Codex : `You've hit your usage limit … try again at 7:04 PM` / `at Nov 23rd, 2026 7:04 PM` / `try again in 2 hours 5 minutes`.
- Mistral et autres : `rate limit exceeded`, `too many requests`, `rate_limit_error`, `quota exceeded`, `capacity exceeded`, `error 429` ; pas d'heure de levée.

Un `429` seul n'est pas reconnu (« article 429 »). Tests : `server/piecemaker/quota-limit.test.ts`.

## Carte

- **Reprendre automatiquement quand la limite est levée** : programme dans la même session le message `RESUME_MESSAGE` par les messages programmés existants (`/api/scheduled-messages`, envoyés par le serveur même si l'interface est fermée), une minute après la levée, ou 30 minutes après le message quand l'heure est inconnue. Décocher annule le message programmé.
- **Reprendre avec <modèle>** (premier modèle de la chaîne d'un autre fournisseur) et **Autre modèle** : `POST /api/piecemaker/quota/handoff` (`server/piecemaker/quota-handoff.ts`) ouvre une session du nouveau fournisseur dans le même dossier et y lance un tour avec la fin de la conversation (12 derniers échanges texte, 4 000 caractères chacun, messages de limite exclus) ; le chat affiche seulement « Reprise du travail de la session précédente ». Le mode d'autorisation de la session d'origine est repris.

## Paramètres › Modèles

`QuotaSettingsTab.tsx`, préférence serveur `piecemakerQuotaResume` (`{ mode, chain }`, via `/api/user/preferences`) :

- liste des modèles de chaque fournisseur connecté ;
- reprise automatique : `off` (la carte demande), `wait` (la carte programme la reprise d'elle-même), `chain` (bascule aussitôt sur le modèle suivant de la chaîne si le message a moins de 15 minutes) ;
- chaîne de priorité ordonnée des modèles de secours.

Une carte déjà traitée (case changée, bascule faite) est notée dans `localStorage` (`piecemaker-quota-handled`) pour ne pas être rejouée automatiquement.
