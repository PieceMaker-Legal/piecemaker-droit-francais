# Design Rule — CSS, typographie et contrôles

Cette règle formalise les patterns observés dans le dépôt PieceMaker : typographie,
icônes, boutons, toggles et cases à cocher. Elle ne définit aucun markup HTML.

## Sources et principes

- Interface : `Inter`, exposée par `--font-inter` et `--font-sans`.
- Titres éditoriaux et contenu juridique : `EB Garamond`, exposée par
  `--font-eb-garamond` et `--font-serif`.
- Icônes : bibliothèque `lucide-react`, avec un trait par défaut de 2 px.
- Style de surface : liquid glass, avec bordure fine, ombre intérieure et
  transparence légère.
- Couleur d’accent : bleu PieceMaker `rgb(0 136 255)`.
- Rayons : principalement `rounded-full` pour les contrôles, `rounded-md` ou
  `rounded-lg` pour les éléments structurés, et `rounded-xl`/`rounded-2xl`
  pour les surfaces et panneaux.
- Les états interactifs doivent rester visibles au clavier et ne doivent pas
  reposer uniquement sur la couleur.

## Échelle de tailles

| Élément | Taille observée |
| --- | --- |
| Contrôle compact | `24 px` de haut |
| Bouton compact / onglet | `28 px` de haut |
| Bouton standard | `32 px` de haut |
| Bouton shadcn standard | `36 px` de haut |
| Bouton shadcn large | `40 px` de haut |
| Icône petite | `12 px` |
| Icône compacte | `14 px` |
| Icône courante | `16 px` |
| Icône large | `20 px` |
| Toggle | `36 × 20 px` |
| Curseur du toggle | `12 × 12 px` |
| Checkbox native de tableau | `10 × 10 px` |
| Indicateur `CheckSquare` | `14 × 14 px` |

## Règle CSS

```css
@layer components {
  :root {
    --piecemaker-font-ui: var(--font-inter, Inter, sans-serif);
    --piecemaker-font-editorial: var(--font-eb-garamond, "EB Garamond", serif);
    --piecemaker-blue: rgb(0 136 255);
    --piecemaker-text: #374151;
    --piecemaker-muted: #6b7280;
    --piecemaker-border: #e5e7eb;
  }

  .piecemaker-ui {
    font-family: var(--piecemaker-font-ui);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .piecemaker-display,
  .piecemaker-editorial {
    font-family: var(--piecemaker-font-editorial);
  }

  .piecemaker-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border-radius: 9999px;
    font-family: var(--piecemaker-font-ui);
    font-weight: 500;
    white-space: nowrap;
    transition: all 150ms ease;
    cursor: pointer;
  }

  .piecemaker-button--xs {
    height: 1.5rem;
    padding-inline: 0.625rem;
    font-size: 0.6875rem;
  }

  .piecemaker-button--sm {
    height: 1.75rem;
    padding-inline: 0.75rem;
    font-size: 0.75rem;
  }

  .piecemaker-button--normal {
    height: 2rem;
    padding-inline: 1rem;
    font-size: 0.875rem;
  }

  .piecemaker-button--icon {
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
  }

  .piecemaker-button--blue {
    color: white;
    background: rgb(0 136 255 / 90%);
  }

  .piecemaker-button--black {
    color: white;
    background: rgb(3 7 18 / 88%);
  }

  .piecemaker-button--danger {
    color: white;
    background: rgb(220 38 38 / 90%);
  }

  .piecemaker-button--glass {
    color: #374151;
    background: var(--liquid-glass-background-subtle);
    border: 1px solid var(--liquid-glass-border-subtle);
    box-shadow: var(--liquid-glass-shadow-subtle);
    backdrop-filter: blur(20px);
  }

  .piecemaker-button:hover {
    filter: brightness(0.97);
  }

  .piecemaker-button:active {
    transform: scale(0.98);
  }

  .piecemaker-button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .piecemaker-button:focus-visible,
  .piecemaker-toggle:focus-visible,
  .piecemaker-checkbox:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px rgb(0 136 255 / 40%),
      0 0 0 4px var(--app-surface, white);
  }

  .piecemaker-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    width: fit-content;
    color: #4b5563;
    font-family: var(--piecemaker-font-ui);
    font-size: 0.875rem;
  }

  .piecemaker-toggle__track {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
    width: 2.25rem;
    height: 1.25rem;
    border-radius: 9999px;
    background: #d1d5db;
    transition: background-color 200ms ease;
  }

  .piecemaker-toggle__thumb {
    position: absolute;
    top: 0.25rem;
    left: 0.25rem;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
    transition: transform 200ms ease;
  }

  .piecemaker-toggle[aria-checked="true"] .piecemaker-toggle__track {
    background: var(--piecemaker-blue);
  }

  .piecemaker-toggle[aria-checked="true"] .piecemaker-toggle__thumb {
    transform: translateX(1rem);
  }

  .piecemaker-checkbox {
    width: 0.625rem;
    height: 0.625rem;
    margin-inline-end: 0.75rem;
    flex: 0 0 auto;
    border: 1px solid var(--piecemaker-border);
    border-radius: 0.25rem;
    accent-color: #000;
    cursor: pointer;
  }

  .piecemaker-check-square {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.875rem;
    height: 0.875rem;
    flex: 0 0 auto;
    border: 1px solid #d1d5db;
    border-radius: 0.25rem;
  }

  .piecemaker-check-square[data-state="checked"],
  .piecemaker-check-square[data-state="indeterminate"] {
    border-color: #111827;
    background: #111827;
  }

  .piecemaker-check-square__mark {
    width: 0.625rem;
    height: 0.625rem;
    color: white;
  }

  .piecemaker-icon {
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
    stroke-width: 2;
  }

  .piecemaker-icon--small {
    width: 0.75rem;
    height: 0.75rem;
  }

  .piecemaker-icon--compact {
    width: 0.875rem;
    height: 0.875rem;
  }

  .piecemaker-icon--large {
    width: 1.25rem;
    height: 1.25rem;
  }
}
```

## Icônes utilisées

Les icônes proviennent exclusivement de `lucide-react`. Les plus fréquentes
sont :

- `Check`, `ChevronDown`, `ChevronLeft`, `ChevronRight` ;
- `X`, `Plus`, `MoreHorizontal` ;
- `Loader2`, `Search`, `Upload` ;
- `AlertCircle`, `AlertTriangle`, `Lock` ;
- `Trash2`, `Download`, `Copy`, `Eye`, `EyeOff` ;
- `Settings2`, `Users`, `CalendarDays`.

Les icônes intégrées à un contrôle déjà nommé sont décoratives. Les boutons
composés uniquement d’une icône doivent disposer d’un nom accessible et utiliser
un indicateur de focus visible.

## Références du dépôt source

- `docs/design-system.md`
- `frontend/src/app/globals.css`
- `frontend/src/shared/ui/PillButtonUI.tsx`
- `frontend/src/app/components/ui/toggle-switch.tsx`
- `frontend/src/app/components/ui/tab-pill-button.tsx`
- `frontend/src/app/components/ui/check-square.tsx`
- `frontend/src/app/components/shared/TablePrimitive.tsx`
- `frontend/src/shared/ui/LiquidGlassUI.css`
