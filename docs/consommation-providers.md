# Consommation des providers et compteur de contexte

## Vue rapide (bouton jauge à côté du compteur de tokens)

`GET /api/piecemaker/provider-limits` (`server/piecemaker/provider-limits.ts`, `?refresh=1` pour ignorer le cache d'une minute) renvoie, pour Claude, Codex et Mistral, l'état de connexion (statuts partagés avec l'orchestrateur) et les fenêtres `five_hour` / `seven_day` : pourcentage consommé et heure de reprise. Seuls les providers connectés sont interrogés et affichés.

| Provider | Source | Ce qui est lu |
|---|---|---|
| Claude | requête `usage` du SDK Agent (même donnée que `/usage` dans Claude Code), sans prompt ni appel au modèle | `rate_limits.five_hour` et `rate_limits.seven_day` ; un compte clé API / Bedrock / Vertex n'a pas de limite d'abonnement |
| Codex | `account/rateLimits/read` du `codex app-server` embarqué | fenêtre principale (5 h) et secondaire (semaine), classées par durée |
| Mistral | aucune | l'API Mistral ne publie ni fenêtre de 5 h ni fenêtre hebdomadaire : ses limites sont par minute et par mois, suivies dans la console Mistral |

Le module front est `src/modules/piecemaker-provider-limits/`, branché par une ligne à côté de chaque `TokenUsageSummary` dans `ChatComposer.tsx`.

## Compteur de tokens

Tous les providers suivent la méthode Claude : le compteur montre le contexte occupé par le dernier appel au modèle (prompt + réponse) sur la fenêtre du modèle, pour savoir quand compacter, et non le cumul de la conversation.

- Claude : `input + cache_read + cache_creation + output` du dernier tour, fenêtre rapportée par le SDK (amont CloudCLI).
- Codex : `last_token_usage.total_tokens` sur `model_context_window` (`server/piecemaker/codex-events.ts`).
- Mistral (SDK) : `promptTokens + completionTokens` du dernier appel, sur `maxContextLength` du modèle (repli 128 000), émis en direct, conservé dans l'historique de la conversation et servi par la route `token-usage` (`installMistralTokenUsage`). L'orchestrateur s'en sert aussi pour décider de recycler une session Mistral.
