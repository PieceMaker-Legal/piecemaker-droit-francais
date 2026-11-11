---
name: raisonner
description: "Writes and verifies the Catala program for one legal document. Runs in the reasoning-maker sub-agent."
context: fork
agent: reasoning-maker
disable-model-invocation: true
---

Écrivez ou complétez le programme Catala de l’acte, puis faites-le vérifier. Nommez dans les `#[doc]` les prémisses à établir.

Demande de l’avocat : $ARGUMENTS
