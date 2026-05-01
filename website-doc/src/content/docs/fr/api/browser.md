---
title: browser.*
description: Plus de 40 méthodes pour automatiser les panneaux navigateur intégrés.
sidebar:
  order: 8
---

Les méthodes `browser.*` opèrent sur un [panneau navigateur](/fr/features/browser-panes/). La plupart prennent `{ surfaceId: string, … }` — omettez `surfaceId` pour cibler la surface navigateur ayant le focus (ou `HT_SURFACE`).

## Cycle de vie

| Méthode | Params | Résultat |
|---|---|---|
| `browser.list` | `{}` | `{ browsers: Array<{ surfaceId, url, title, … }> }` |
| `browser.open` | `{ url: string, surfaceId?: string }` | `{ surfaceId }` |
| `browser.open_split` | `{ url: string, direction?: "left"\|"right"\|"up"\|"down" }` | `{ surfaceId }` |
| `browser.close` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.identify` | `{ surfaceId?: string }` | `{ surfaceId, url, title }` |

## Navigation

| Méthode | Params | Résultat |
|---|---|---|
| `browser.navigate` | `{ surfaceId?: string, url: string }` | `{ ok: true }` |
| `browser.back` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.forward` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.reload` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.url` | `{ surfaceId?: string }` | `{ url }` |

## Attente

| Méthode | Params | Résultat |
|---|---|---|
| `browser.wait` | `{ surfaceId?: string, selector?: string, text?: string, loadState?: "domcontentloaded"\|"load"\|"complete", timeoutMs?: number }` | `{ ok: true }` |

Fournissez au plus un seul de `selector`, `text`, `loadState`. Timeout par défaut 30 000 ms.

## Interaction

| Méthode | Params | Résultat |
|---|---|---|
| `browser.click` | `{ surfaceId?: string, selector: string }` | `{ ok: true }` |
| `browser.dblclick` | `{ surfaceId?: string, selector: string }` | `{ ok: true }` |
| `browser.hover` | `{ surfaceId?: string, selector: string }` | `{ ok: true }` |
| `browser.focus` | `{ surfaceId?: string, selector: string }` | `{ ok: true }` |
| `browser.check` / `browser.uncheck` | `{ surfaceId?: string, selector: string }` | `{ ok: true }` |
| `browser.scroll_into_view` | `{ surfaceId?: string, selector: string }` | `{ ok: true }` |
| `browser.type` | `{ surfaceId?: string, selector: string, text: string }` | `{ ok: true }` |
| `browser.fill` | `{ surfaceId?: string, selector: string, value: string }` | `{ ok: true }` |
| `browser.press` | `{ surfaceId?: string, key: string }` | `{ ok: true }` |
| `browser.select` | `{ surfaceId?: string, selector: string, value: string }` | `{ ok: true }` |
| `browser.scroll` | `{ surfaceId?: string, x?: number, y?: number }` | `{ ok: true }` |
| `browser.highlight` | `{ surfaceId?: string, selector: string, durationMs?: number }` | `{ ok: true }` |

## Inspection

| Méthode | Params | Résultat |
|---|---|---|
| `browser.snapshot` | `{ surfaceId?: string }` | `{ accessibilityTree: object }` |
| `browser.get` | `{ surfaceId?: string, what: "title"\|"url"\|"text"\|"value"\|"html", selector?: string }` | `{ value: string }` |
| `browser.is` | `{ surfaceId?: string, what: "visible"\|"enabled"\|"checked"\|"focused", selector: string }` | `{ value: boolean }` |
| `browser.eval` | `{ surfaceId?: string, expression: string }` | `{ result: any }` |

## Injection

| Méthode | Params | Résultat |
|---|---|---|
| `browser.addscript` | `{ surfaceId?: string, source: string }` | `{ ok: true }` |
| `browser.addstyle` | `{ surfaceId?: string, source: string }` | `{ ok: true }` |

## Recherche / DevTools

| Méthode | Params | Résultat |
|---|---|---|
| `browser.find` | `{ surfaceId?: string, query: string }` | `{ ok: true }` |
| `browser.stop_find` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.devtools` | `{ surfaceId?: string }` | `{ ok: true }` |

## Console + erreurs + historique

| Méthode | Params | Résultat |
|---|---|---|
| `browser.console_list` | `{ surfaceId?: string, follow?: boolean }` | `{ entries: Array<{ level, text, ts }> }` |
| `browser.console_clear` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.errors_list` | `{ surfaceId?: string, follow?: boolean }` | `{ entries: Array<{ message, source, ts }> }` |
| `browser.errors_clear` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.history` | `{ search?: string, limit?: number }` | `{ entries: Array<{ url, title, visits, lastAt }> }` |
| `browser.clear_history` | `{}` | `{ ok: true }` |

`follow: true` ouvre un flux — les événements supplémentaires arrivent sous forme de trames `{ id, event: { … } }` jusqu'à annulation.

## CLI

Mappé 1:1 par [`ht browser`](/fr/cli/browser/).
