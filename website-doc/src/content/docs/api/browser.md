---
title: browser.*
description: 40+ methods for built-in browser pane automation.
sidebar:
  order: 8
---

Methods on `browser.*` operate on a [browser pane](/features/browser-panes/). Most take `{ surfaceId: string, … }` — omit `surfaceId` to target the focused browser surface (or `HT_SURFACE`).

## Lifecycle

| Method | Params | Result |
|---|---|---|
| `browser.list` | `{}` | `{ browsers: Array<{ surfaceId, url, title, … }> }` |
| `browser.open` | `{ url: string, surfaceId?: string }` | `{ surfaceId }` |
| `browser.open_split` | `{ url: string, direction?: "left"\|"right"\|"up"\|"down" }` | `{ surfaceId }` |
| `browser.close` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.identify` | `{ surfaceId?: string }` | `{ surfaceId, url, title }` |

## Navigation

| Method | Params | Result |
|---|---|---|
| `browser.navigate` | `{ surfaceId?: string, url: string }` | `{ ok: true }` |
| `browser.back` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.forward` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.reload` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.url` | `{ surfaceId?: string }` | `{ url }` |

## Waiting

| Method | Params | Result |
|---|---|---|
| `browser.wait` | `{ surfaceId?: string, selector?: string, text?: string, loadState?: "domcontentloaded"\|"load"\|"complete", timeoutMs?: number }` | `{ ok: true }` |

Supply at most one of `selector`, `text`, `loadState`. Default timeout 30 000 ms.

## Interaction

| Method | Params | Result |
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

| Method | Params | Result |
|---|---|---|
| `browser.snapshot` | `{ surfaceId?: string }` | `{ accessibilityTree: object }` |
| `browser.get` | `{ surfaceId?: string, what: "title"\|"url"\|"text"\|"value"\|"html", selector?: string }` | `{ value: string }` |
| `browser.is` | `{ surfaceId?: string, what: "visible"\|"enabled"\|"checked"\|"focused", selector: string }` | `{ value: boolean }` |
| `browser.eval` | `{ surfaceId?: string, expression: string }` | `{ result: any }` |

## Injection

| Method | Params | Result |
|---|---|---|
| `browser.addscript` | `{ surfaceId?: string, source: string }` | `{ ok: true }` |
| `browser.addstyle` | `{ surfaceId?: string, source: string }` | `{ ok: true }` |

## Find / DevTools

| Method | Params | Result |
|---|---|---|
| `browser.find` | `{ surfaceId?: string, query: string }` | `{ ok: true }` |
| `browser.stop_find` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.devtools` | `{ surfaceId?: string }` | `{ ok: true }` |

## Console + errors + history

| Method | Params | Result |
|---|---|---|
| `browser.console_list` | `{ surfaceId?: string, follow?: boolean }` | `{ entries: Array<{ level, text, ts }> }` |
| `browser.console_clear` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.errors_list` | `{ surfaceId?: string, follow?: boolean }` | `{ entries: Array<{ message, source, ts }> }` |
| `browser.errors_clear` | `{ surfaceId?: string }` | `{ ok: true }` |
| `browser.history` | `{ search?: string, limit?: number }` | `{ entries: Array<{ url, title, visits, lastAt }> }` |
| `browser.clear_history` | `{}` | `{ ok: true }` |

`follow: true` opens a stream — additional events arrive as `{ id, event: { … } }` frames until cancelled.

## CLI

Mapped 1:1 by [`ht browser`](/cli/browser/).
