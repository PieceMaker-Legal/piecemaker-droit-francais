# Bordereau

```
pm bordereau contrat.pdf Courriers/mise-en-demeure.pdf
```

Donnez les chemins relatifs au dossier. L’ordre des arguments fixe les numéros. La commande écrit `Pièces tamponnées/Pièce n°N.pdf` et laisse les originaux intacts.

- Une pièce en échec laisse son numéro vide : corrigez et relancez toute la liste.
- Une liste plus courte laisse en place les anciens numéros supérieurs : signalez-le à l’avocat.
- Sans tampon, la commande échoue : lancez `pm afficher --volet tampon` et demandez à l’avocat de le créer.
