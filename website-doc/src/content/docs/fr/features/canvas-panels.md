---
title: Panneaux canvas
description: Superpositions flottantes SVG, HTML, image et canvas2d pilotées par des descripteurs de fichier supplémentaires. Éléments DOM indépendants — déplaçables, redimensionnables, interactifs.
sidebar:
  order: 5
---

Les panneaux canvas sont des superpositions flottantes rendues au-dessus de la couche de texte du terminal. Les scripts qui s'exécutent dans le terminal les définissent via le [protocole sideband](/fr/sideband/overview/) — chaque panneau est un élément DOM indépendant avec sa propre position, taille et contenu.

## Ce que vous pouvez rendre

| Type | Renderer |
|------|----------|
| `image` | `<img>` depuis une URL blob (PNG, JPEG, WebP, GIF) |
| `svg` | Chaîne SVG en `innerHTML` |
| `html` | Chaîne HTML en `innerHTML` (widgets interactifs, formulaires, graphiques) |
| `canvas2d` | Un élément `<canvas>` avec des octets dessinés via `drawImage` |

Les types personnalisés s'enregistrent via `registerRenderer()` dans `content-renderers.ts`.

## Modes de positionnement

| Position | Comportement |
|----------|----------|
| `float` | Fixé au viewport. Reste en place quand le terminal défile. Par défaut. |
| `inline` | Défile avec le texte du terminal. Ancré à la ligne où il a été créé. |
| `fixed` | Pas de chrome (pas d'en-tête / fermeture / poignée de glissement) — superposition brute rendue telle quelle. |

## Interaction

- **Glisser** — cliquez-glissez l'en-tête du panneau (par défaut pour `float`).
- **Redimensionner** — glissez le coin inférieur droit (par défaut pour `float`).
- **Transfert de souris** — définissez `interactive: true` et le panneau transfère les événements click / move vers fd 5 pour que le script puisse réagir.
- **Clavier** — les panneaux ne reçoivent jamais de saisie clavier. Les frappes vont toujours à xterm.js → stdin.

## Cycle de vie

```
1. Script writes to fd 3:                          { "id": "x", "type": "svg", … }
2. (If byteLength > 0) script writes raw bytes to fd 4
3. τ-mux creates a panel, renders into a DOM element
4. Script writes update / clear ops to fd 3 to mutate / remove
5. (If interactive) τ-mux writes events to fd 5
```

Le panneau est détruit quand :

- Le script écrit `{"id":"x","type":"clear"}` sur fd 3.
- L'utilisateur clique sur le bouton de fermeture (panneaux avec chrome).
- Le shell se termine — tous les panneaux pour la surface sont effacés.

## Performance

Chaque panneau est son propre élément DOM avec des transformations CSS. Il n'y a pas de canvas partagé. L'empilement est purement z-index. Le glissement et le redimensionnement utilisent les événements pointer, pas les frames d'animation — le navigateur peut optimiser la couche du compositeur.

## Fichiers source

- `src/views/terminal/panel-manager.ts` — cycle de vie des panneaux, dispatch fd 3.
- `src/views/terminal/panel.ts` — un seul panneau : glissement, redimensionnement, rendu.
- `src/views/terminal/content-renderers.ts` — registre extensible de renderers.
- `src/bun/sideband-parser.ts` — lecteur JSONL multi-canal + binaire.
- `src/bun/event-writer.ts` — écrivain JSONL fd 5.

## Pour aller plus loin

- [Vue d'ensemble du sideband](/fr/sideband/overview/)
- [Métadonnées (fd 3)](/fr/sideband/metadata-fd3/) — référence complète des options de panneau.
- [Données binaires (fd 4)](/fr/sideband/data-fd4/)
- [Événements (fd 5)](/fr/sideband/events-fd5/)
- [Démos](/fr/sideband/demos/)
