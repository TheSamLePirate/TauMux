---
title: Browser
description: ht browser — 40+ commands for built-in browser pane automation.
sidebar:
  order: 8
---

`ht browser` controls the [built-in browser panes](/features/browser-panes/). Designed for agents, CI scripts, and visual regression workflows.

## Top-level

```bash
ht browser open <url>                 # open in current pane (creates one if needed)
ht browser open-split <url>           # open as a new split
ht browser list                       # list browser surfaces
```

Every other command targets a specific browser surface:

```bash
ht browser <id> <command> [args]
# example:
ht browser browser:2 navigate https://example.org
ht browser browser:2 click "button[type='submit']"
```

Inside a browser pane, `HT_SURFACE` is auto-set so you can omit the id:

```bash
ht browser navigate https://example.org    # uses HT_SURFACE
```

## Navigation

| Command | Purpose |
|---|---|
| `navigate <url>` | Go to URL. |
| `goto <url>` | Alias for `navigate`. |
| `back` | History back. |
| `forward` | History forward. |
| `reload` | Reload the page. |
| `url` / `get-url` | Print the current URL. |
| `identify` | Surface id, title, URL. |

## Waiting

```bash
ht browser browser:1 wait --selector "#dashboard" --timeout-ms 15000
ht browser browser:1 wait --text "Welcome" --timeout-ms 15000
ht browser browser:1 wait --load-state complete
```

Pick at most one of `--selector`, `--text`, `--load-state`. `--timeout-ms` defaults to 30000.

## Interacting

| Command | Args | Purpose |
|---|---|---|
| `click <selector>` | | Click. |
| `dblclick <selector>` | | Double click. |
| `hover <selector>` | | Hover. |
| `focus <selector>` | | Focus. |
| `check <selector>` / `uncheck <selector>` | | Toggle a checkbox. |
| `scroll-into-view <selector>` | | Scroll element into viewport. |
| `type <selector> <text>` | | Type text into focused field. |
| `fill <selector> <text>` | | Set value. |
| `press <key>` | | Send a key (e.g. `Enter`, `Escape`, `Control+a`). |
| `keydown <key>` / `keyup <key>` | | Lower-level key events. |
| `select <selector> <value>` | | Select an `<option>`. |
| `scroll <x> <y>` | | Scroll the page. |
| `highlight <selector>` | | Visual highlight (debug). |

## Inspecting

```bash
ht browser browser:1 snapshot                  # accessibility tree
ht browser browser:1 get title
ht browser browser:1 get url
ht browser browser:1 get text "#welcome"       # textContent of selector
ht browser browser:1 get value "#email"
ht browser browser:1 is visible "#dashboard"
ht browser browser:1 is enabled "button[type='submit']"
ht browser browser:1 is checked "#agree"
```

## Injecting

```bash
ht browser browser:1 addscript "console.log('hello')"
ht browser browser:1 addstyle "body { background: red }"
ht browser browser:1 eval "document.title"
ht browser browser:1 eval "await fetch('/api/health').then(r => r.json())"
```

`eval` returns the JSON-serialized result. Async expressions are awaited automatically.

## Console / errors

```bash
ht browser browser:1 console                   # tail console logs
ht browser browser:1 console --clear           # clear the buffer
ht browser browser:1 errors                    # tail JS errors
ht browser browser:1 errors --clear
```

## History

```bash
ht browser browser:1 history                   # list visited URLs (deduped)
ht browser browser:1 history --search "github"
ht browser browser:1 history --clear
```

## Find in page

```bash
ht browser browser:1 find-in-page "search query"
ht browser browser:1 stop-find
```

## DevTools

```bash
ht browser browser:1 devtools                  # toggle WebKit inspector
```

## Close

```bash
ht browser browser:1 close
```

## Read more

- [Browser panes](/features/browser-panes/)
- [JSON-RPC browser methods](/api/browser/)
