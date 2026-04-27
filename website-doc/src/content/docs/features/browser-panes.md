---
title: Browser panes
description: Built-in WebKit browser panes that share workspaces with terminals — and a 40+ command scriptable API for agents.
sidebar:
  order: 2
---

A browser pane is a real WebKit instance hosted as `<electrobun-webview>` inside a τ-mux pane. It sits in the same tiling layout as terminal panes — drag it, split it, close it like any other surface.

## Open one

| Action | Shortcut | CLI |
|---|---|---|
| Open in a new split | `⌘⇧L` | `ht browser open-split <url>` |
| Open in the focused pane | (palette) | `ht browser open <url>` |
| Focus the address bar | `⌘L` | — |
| Back / forward | `⌘[` / `⌘]` | `ht browser <id> back` / `forward` |
| Reload | `⌘R` | `ht browser <id> reload` |
| DevTools | `⌥⌘I` | `ht browser <id> devtools` |
| Find in page | `⌘F` | — |

## Highlights

- **Address bar with smart URL detection.** Type `localhost:3000`, `github.com/x/y`, or a search query — the bar resolves correctly.
- **Search engine integration.** Google, DuckDuckGo, Bing, Kagi. Configure in **Settings → Browser**.
- **Cookie sharing.** All browser panes share the same WebKit session.
- **Session persistence.** URLs are saved and restored across app restarts.
- **Force dark mode.** Optional, in **Settings → Browser**.
- **Terminal link interception.** When enabled, clicking a `http(s)://` link in any terminal opens it in a τ-mux browser pane instead of your default browser.

## Browser automation

The `ht browser` command group exposes 40+ scriptable commands — designed for agents and CI scripts.

```bash
# Navigate, wait, inspect
ht browser open https://example.com/login
ht browser browser:1 wait --load-state complete --timeout-ms 15000
ht browser browser:1 snapshot                 # accessibility tree
ht browser browser:1 get title

# Fill a form
ht browser browser:1 fill "#email" "ops@example.com"
ht browser browser:1 fill "#password" "$PASSWORD"
ht browser browser:1 click "button[type='submit']"
ht browser browser:1 wait --text "Welcome"
ht browser browser:1 is visible "#dashboard"

# Inject code
ht browser browser:1 addscript "console.log('hello')"
ht browser browser:1 addstyle "body { font-size: 20px }"

# Debug
ht browser browser:1 console                  # page console logs
ht browser browser:1 errors                   # page JS errors
```

Full command catalogue: [`ht browser`](/cli/browser/).

## Capabilities matrix

| Capability | Status |
|---|---|
| Navigate, back/forward, reload | ✅ |
| Click, dblclick, hover, focus, check/uncheck | ✅ |
| Type, fill, press, select | ✅ |
| Scroll, scroll-into-view, highlight | ✅ |
| Wait for selector / text / load-state | ✅ |
| Snapshot (accessibility tree) | ✅ |
| Eval arbitrary JS | ✅ |
| Add script / style at document-start | ✅ |
| Find / stop find | ✅ |
| Console + errors capture | ✅ |
| History (search, dedup, clear) | ✅ |
| Multiple browser panes | ✅ |
| Tabs inside one pane | ❌ (each pane is one tab) |
| Cross-origin iframes inspection | ⚠ depends on WebKit |

## Source files

- `src/views/terminal/browser-pane.ts` — `<electrobun-webview>`, address bar, navigation, preload.
- `src/views/terminal/browser-events.ts` — `ht-browser-*` CustomEvent → RPC bridge.
- `src/bun/browser-surface-manager.ts` — URL, title, zoom, console, errors state.
- `src/bun/browser-history.ts` — JSON-persisted history with search + dedup.
- `src/bun/rpc-handlers/browser-*.ts` — handlers for `browser.*` RPC methods.

## Read more

- [`ht browser` CLI](/cli/browser/)
- [Browser API methods](/api/browser/)
- [Settings: Browser](/configuration/settings/)
