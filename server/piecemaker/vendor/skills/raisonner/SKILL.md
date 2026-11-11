---
name: raisonner
description: Écrire et vérifier le raisonnement juridique d’un acte (YAML, puis Catala), dans le sous-agent reasoning-maker.
context: fork
agent: reasoning-maker
disable-model-invocation: true
---

Écrivez ou complétez le raisonnement de l’acte, puis faites-le vérifier. Nommez dans les `#[doc]` les prémisses à établir.

Demande de l’avocat : $ARGUMENTS
