---
name: premisses
description: Chercher dans les pièces les prémisses qu’un programme Catala attend, dans le sous-agent premise-maker. Argument : le nom du programme.
context: fork
agent: premise-maker
disable-model-invocation: true
---

Établissez les prémisses attendues par le programme Catala `.piecemaker/catala/$ARGUMENTS/`. Partez de ses `source: okf:/_premises/…`. Ne créez aucune prémisse qu’aucune condition ne demande.

Si aucun programme n’est désigné, lancez `pm catala lister`, puis demandez lequel traiter.
