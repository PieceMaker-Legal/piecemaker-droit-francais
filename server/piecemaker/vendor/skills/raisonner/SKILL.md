---
name: raisonner
description: "Writes and verifies the legal reasoning for one legal document (YAML, then Catala). Runs in the reasoning-maker sub-agent."
context: fork
agent: reasoning-maker
disable-model-invocation: true
---

Écrivez ou complétez le raisonnement de l’acte, puis faites-le vérifier. Nommez dans les `#[doc]` les prémisses à établir.

Demande de l’avocat : $ARGUMENTS
