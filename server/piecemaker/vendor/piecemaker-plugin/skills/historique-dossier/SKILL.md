---
name: historique-dossier
description: Consulter l'historique d'un dossier PieceMaker (qui a modifié quoi, à quel tour) et revenir à une version antérieure d'un fichier. À utiliser dès que l'utilisateur demande ce qui a été fait dans le dossier, de comparer avec une version précédente, d'annuler une modification ou de restaurer un fichier.
---

# Historique du dossier

PieceMaker versionne chaque dossier dans un dépôt Git **local** (`.git` à la racine du dossier, aucun remote) :

- un commit par tour de chat : sujet = demande de l'utilisateur, corps = conclusion de l'IA ;
- un commit « Modifications hors IA » pour ce que l'avocat a modifié lui-même (Word, Finder, éditeur), listant les fichiers ;
- un commit « État initial du dossier » au premier passage.

Tu ne commites jamais toi-même : PieceMaker commite tout seul à la fin de ton tour.

## Consulter

```bash
git log --oneline -20                      # derniers tours
git log --oneline -- "Conclusions.md"      # versions d'un fichier
git show --stat <sha>                      # fichiers touchés par un tour
git diff <sha> -- "Conclusions.md"         # différences avec une version
git show <sha>:"Conclusions.md"            # contenu d'une version (Markdown uniquement)
```

## Revenir à une version

```bash
git restore --source <sha> -- "Conclusions.md"
```

Le fichier est réécrit dans le dossier ; la restauration apparaîtra dans le commit de ton tour. Annonce à l'utilisateur la version restaurée (sha et sujet du commit).

## Interdit

- `git reset`, `git checkout <branche>`, `git switch`, `git rebase`, `git commit --amend`, `git stash`, `git clean` : ils réécrivent ou effacent l'historique de l'avocat.
- `git commit`, `git push`, `git remote`, `git fetch`, `git pull` : aucun commit manuel, aucun envoi hors du poste.
- Lire une pièce protégée ou un mapping par Git (`git show <sha>:piece.pdf`, `git cat-file`, `--text`) : refusé par PieceMaker, lis le Markdown anonymisé.
