---
name: premisses
description: "Finds in the case documents the premises that a Catala program needs. Runs in the premise-maker sub-agent. Argument: the program name."
context: fork
agent: premise-maker
disable-model-invocation: true
---

Établissez les prémisses attendues par le programme Catala `.piecemaker/catala/$ARGUMENTS/`. Partez de ses `source: okf:/_premises/…`. Ne créez aucune prémisse qu’aucune condition ne demande.

Si aucun programme n’est désigné, lancez `pm catala lister`, puis demandez lequel traiter.
