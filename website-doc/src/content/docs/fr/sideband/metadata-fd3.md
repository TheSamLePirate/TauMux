---
title: Métadonnées (fd 3)
description: Définitions de panneaux, mises à jour, effacements — JSONL sur fd 3.
sidebar:
  order: 2
---

Le canal de métadonnées est en JSONL sur fd 3. Un objet JSON par ligne — chacun définit un panneau, en mute un existant ou l'efface.

## Types de contenu

| Type | Moteur de rendu |
|------|----------|
| `image` | `<img>` depuis une URL blob (PNG, JPEG, WebP, GIF). Nécessite `byteLength` + octets sur fd 4. |
| `svg` | Chaîne SVG en `innerHTML`. Le SVG peut arriver soit inline dans `data` (chaîne UTF-8), soit via `byteLength` sur fd 4. |
| `html` | Chaîne HTML en `innerHTML`. Même mode de livraison que `svg`. |
| `canvas2d` | Un `<canvas>` rendu via `drawImage`. Nécessite `byteLength` + octets sur fd 4 (image raster). |
| `update` | Mute des champs sur un id de panneau existant. |
| `clear` | Supprime un panneau par id. |

Les types de contenu personnalisés s'enregistrent via `registerRenderer()` dans `src/views/terminal/content-renderers.ts`.

## Options de panneau

| Champ | Type | Description |
|-------|------|-------------|
| `id` | string | Identifiant unique du panneau (par surface). |
| `type` | string | Tout type de contenu ou `update` / `clear`. |
| `position` | enum | `float` (fixé au viewport, par défaut), `inline` (défile avec le terminal), `fixed` (sans habillage). |
| `x`, `y` | number | Position en pixels (origine : coin supérieur gauche du panneau). |
| `width`, `height` | number \| `"auto"` | Dimensions. |
| `draggable` | boolean | Autorise le glisser (défaut : true pour `float`, false sinon). |
| `resizable` | boolean | Autorise le redimensionnement (défaut : true pour `float`, false sinon). |
| `interactive` | boolean | Transfère les événements souris vers fd 5. |
| `byteLength` | number | Taille de la charge utile binaire sur le canal de données. |
| `dataChannel` | string | Canal de données nommé (défaut : `"data"` = fd 4). |
| `data` | string | Charge utile UTF-8 inline (alternative à `byteLength`, pour le contenu textuel). |
| `format` | string | Pour `image` : `png` / `jpeg` / `webp` / `gif`. |
| `opacity` | number | 0.0–1.0. |
| `zIndex` | number | Ordre d'empilement. |

## Exemples

### Panneau image

```jsonl
{"id":"photo","type":"image","format":"png","x":100,"y":50,"width":400,"height":300,"byteLength":24576}
```

Suivi de 24 576 octets PNG bruts sur fd 4.

### SVG inline

```jsonl
{"id":"chart","type":"svg","x":50,"y":50,"width":400,"height":300,"data":"<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='blue'/></svg>"}
```

### Widget HTML interactif

```jsonl
{"id":"btn","type":"html","x":20,"y":20,"width":200,"height":80,"interactive":true,"data":"<button onclick='alert(1)'>Click</button>"}
```

### Mettre à jour un panneau existant

```jsonl
{"id":"photo","type":"update","x":200,"y":150}
```

Seuls les champs que vous passez sont modifiés. Impossible de changer `type` — effacez et recréez à la place.

### Effacer

```jsonl
{"id":"photo","type":"clear"}
```

Supprime le panneau et libère son élément DOM. Ses événements ne sont plus livrés.

## Bonnes pratiques

- **Utilisez des `id` que vous pouvez relier à l'état côté script.** Ils sont renvoyés à chaque événement.
- **Préférez `inline` à `float` pour une sortie ponctuelle** — ils défilent naturellement avec le texte du terminal.
- **Choisissez `byteLength` vs `data` consciemment.** `data` convient pour de petites charges utiles ; au-delà de 64 KiB, utilisez `byteLength` pour éviter l'échappement de chaîne JSON.
- **Ne diffusez pas de trames brutes à 60 fps** — pour de l'animation de type canvas, utilisez `update` pour envoyer de petites mutations plutôt que de réémettre la charge utile complète.

## Source

- `src/views/terminal/panel-manager.ts` — répartition fd 3.
- `src/bun/sideband-parser.ts` — lecteur JSONL + binaire.
- `src/shared/types.ts` — types des options de panneau.

## Pour aller plus loin

- [Vue d'ensemble du sideband](/fr/sideband/overview/)
- [Données binaires (fd 4)](/fr/sideband/data-fd4/)
- [Événements (fd 5)](/fr/sideband/events-fd5/)
