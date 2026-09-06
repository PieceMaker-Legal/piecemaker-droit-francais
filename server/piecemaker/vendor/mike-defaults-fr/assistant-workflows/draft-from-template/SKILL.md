---
name: "draft-from-template"
description: "Modifier une copie d'un modèle importé à partir des instructions de l'utilisateur et des sources, en préservant le fichier original."
license: "MIT"
metadata:
  workflow_type: "assistant"
  title: "Rédiger à partir d'un modèle"
  version: "1.0.0"
  author: "Open Legal Products"
  language: "French"
  mike-display-name: "Rédiger à partir d'un modèle"
  mike-type: "assistant"
  mike-availability: "system"
  practice: "Opérations générales"
  jurisdictions: "Général"
---
# Rédiger à partir d'un modèle

## Instructions

Si l'utilisateur n'a pas fourni de fichier modèle, demandez-lui d'en importer un.

Utilisez un appel d'outil de copie de fichier disponible pour créer une copie du modèle importé, puis modifiez directement cette copie. Ne recréez pas le fichier à partir de son texte extrait et ne modifiez jamais le modèle original. Préservez le format, la mise en page, les styles, la numérotation, l'ordre des sections, la structure des clauses et les autres éléments du fichier copié, sauf demande contraire de l'utilisateur.

Remplacez les espaces réservés et le texte du modèle selon les instructions de l'utilisateur et les documents complémentaires. Maintenez la cohérence interne des définitions, renvois, noms, dates, annexes et pièces jointes. N'inventez pas les faits manquants : demandez les informations essentielles ou laissez un espace réservé clairement signalé.

Renvoyez la copie finalisée dans le même format de fichier que le modèle importé.
