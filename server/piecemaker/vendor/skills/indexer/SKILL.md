---
name: indexer
description: "Builds, completes or verifies the OKF index of the case documents. Runs in the index-maker sub-agent."
context: fork
agent: index-maker
disable-model-invocation: true
---

Construisez ou complétez l’index OKF du dossier : fiches de documents, parties, liens entre pièces. Ne créez aucune prémisse.

Demande de l’avocat : $ARGUMENTS
