# HyperTerm Canvas: Built-in Browser Pane

HyperTerm Canvas includes a built-in WebKit browser that can be split alongside terminal panes. Browser panes share the same tiling layout, workspace management, and CLI/socket API as terminal panes — they're first-class surfaces. A rich scriptable API allows AI agents to navigate, interact with DOM elements, inspect page state, and automate web workflows without leaving the terminal.

---

## 1. Opening a Browser Pane

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘⇧L` | Open browser in split alongside the focused pane |

### Command palette

- **Open Browser Split** — split right (same as `⌘⇧L`)
- **New Browser Workspace** — open a dedicated workspace with a browser pane

### Menu

**View → Split Browser Right** (`⌘⇧L`) and **View → Split Browser Down** are available in the application menu.

### CLI

```bash
ht browser open https://example.com        # new workspace with browser
ht browser open-split https://example.com   # split alongside current pane
```

### Socket API

```json
{"id":"1","method":"browser.open","params":{"url":"https://example.com"}}
{"id":"2","method":"browser.open_split","params":{"url":"https://example.com","direction":"right"}}
```

---

## 2. Architecture

### How it works

Each browser pane is an `<electrobun-webview>` custom element — an Out-Of-Process IFrame (OOPIF) that:

- Runs in a fully isolated browser process (crash + memory isolation)
- Loads any URL (http, https, about:blank)
- Has its own navigation history (back/forward)
- Shares cookies with other browser panes via a common partition (`persist:browser-shared`)
- Communicates with the host webview via `host-message` events and preload scripts

### Stack

```
Bun Main Process
  └── BrowserSurfaceManager      URL / title / zoom / console / error state (no PTY)
  └── BrowserHistoryStore         JSON-persisted navigation history
  └── RPC Handler (browser.*)     40+ socket API methods

Electrobun Webview
  └── SurfaceManager              Tiling layout (shared with terminal panes)
  └── BrowserPaneView             Address bar + <electrobun-webview> + event wiring

<electrobun-webview> (OOPIF)
  └── Preload script              Title observer, console capture, error capture
  └── Loaded web page             (sandboxed browsing)
```

### Surface IDs

Terminal surfaces use `surface:N` IDs. Browser surfaces use `browser:N` IDs. Both coexist in the same workspace layout tree.

### What browser surfaces DON'T have

- No PTY (no stdin/stdout)
- No sideband channels (fd 3/4/5)
- No process tree metadata
- No terminal search or scrollback

---

## 3. Address Bar

Every browser pane has a compact address bar with:

| Element | Behavior |
|---------|----------|
| **Back button** (`◀`) | Navigate back. Disabled when no history. `⌘[` shortcut. |
| **Forward button** (`▶`) | Navigate forward. Disabled when no forward history. `⌘]` shortcut. |
| **Reload button** (`↻`) | Reload page. Spinner animation while loading. `⌘R` shortcut. |
| **Lock icon** | 🔒 for HTTPS (green), ⚠ for HTTP (amber), blank for other schemes. |
| **URL input** | Type a URL or search query. `⌘L` to focus. Enter to navigate. Escape to revert. |
| **DevTools button** (`🛠`) | Toggle WebKit inspector. `⌥⌘I` shortcut. |

### Smart URL detection

The address bar distinguishes between URLs and search queries:

- `https://example.com` → navigates directly
- `localhost:3000` → navigates to `http://localhost:3000`
- `example.com` → navigates to `https://example.com`
- `what is javascript` → searches using the configured search engine

### Search engines

Configure in **Settings → Browser → Search Engine**:

| Engine | Base URL |
|--------|----------|
| Google (default) | `https://www.google.com/search?q=` |
| DuckDuckGo | `https://duckduckgo.com/?q=` |
| Bing | `https://www.bing.com/search?q=` |
| Kagi | `https://kagi.com/search?q=` |

---

## 4. Keyboard Shortcuts (Browser Pane Focused)

When a browser pane has focus, these shortcuts apply instead of terminal shortcuts:

| Shortcut | Action |
|----------|--------|
| `⌘L` | Focus address bar |
| `⌘[` | Navigate back |
| `⌘]` | Navigate forward |
| `⌘R` | Reload page |
| `⌥⌘I` | Toggle developer tools |
| `⌘F` | Find in page |
| `⌘=` / `⌘-` | Zoom in / out |
| `⌘0` | Reset zoom |
| `⌘D` | Split right (opens terminal) |
| `⌘⇧D` | Split down (opens terminal) |
| `⌘W` | Close browser pane |
| `Escape` | Blur address bar / close find bar |

Global shortcuts (work regardless of surface type):

| Shortcut | Action |
|----------|--------|
| `⌘⇧L` | Open new browser split |
| `⌘⇧P` | Command palette |
| `⌘,` | Settings |
| `⌘B` | Toggle sidebar |
| `⌘⌥←↑→↓` | Focus neighboring pane |
| `⌃⌘]` / `⌃⌘[` | Next / prev workspace |
| `⌘1…9` | Jump to workspace N |

---

## 5. Browser Automation CLI (`ht browser`)

The `ht browser` command group provides full browser automation. Commands target a browser surface — pass it positionally or with `--surface`.

```bash
# Positional surface targeting (cmux-compatible)
ht browser browser:2 click "#submit"

# Flag-based targeting
ht browser --surface browser:2 click "#submit"

# Omit surface to target the focused browser pane
ht browser click "#submit"
```

### Navigation

```bash
ht browser open https://example.com                 # open in new workspace
ht browser open-split https://example.com            # split alongside current pane
ht browser browser:2 navigate https://example.org
ht browser browser:2 back
ht browser browser:2 forward
ht browser browser:2 reload
ht browser browser:2 url                              # print current URL
ht browser browser:2 identify                         # surface metadata
```

### Waiting

Block until a condition is met, with configurable timeout:

```bash
ht browser browser:2 wait --load-state complete --timeout-ms 15000
ht browser browser:2 wait --selector "#checkout" --timeout-ms 10000
ht browser browser:2 wait --text "Order confirmed"
ht browser browser:2 wait --url-contains "/dashboard"
ht browser browser:2 wait --function "window.__appReady === true"
```

### DOM Interaction

```bash
ht browser browser:2 click "button[type='submit']"
ht browser browser:2 dblclick ".item-row"
ht browser browser:2 hover "#menu"
ht browser browser:2 focus "#email"
ht browser browser:2 check "#terms"
ht browser browser:2 uncheck "#newsletter"
ht browser browser:2 scroll-into-view "#pricing"
ht browser browser:2 type "#search" "query text"
ht browser browser:2 fill "#email" "user@example.com"      # set value directly
ht browser browser:2 fill "#email" ""                        # clear input
ht browser browser:2 press Enter
ht browser browser:2 select "#region" "us-east"
ht browser browser:2 scroll --dy 800
ht browser browser:2 scroll --selector "#log-view" --dx 0 --dy 400
ht browser browser:2 highlight "#checkout"                   # red outline for 3s
```

### Inspection

```bash
ht browser browser:2 snapshot                                # accessibility tree
ht browser browser:2 get title
ht browser browser:2 get url
ht browser browser:2 get text "h1"
ht browser browser:2 get html "main"
ht browser browser:2 get value "#email"
ht browser browser:2 get attr "a.primary" --attr href
ht browser browser:2 get count ".row"
ht browser browser:2 get box "#checkout"                     # bounding box
ht browser browser:2 get styles "#total" --property color
ht browser browser:2 is visible "#checkout"
ht browser browser:2 is enabled "button[type='submit']"
ht browser browser:2 is checked "#terms"
```

### JavaScript & Injection

```bash
ht browser browser:2 eval "document.title"
ht browser browser:2 addscript "document.querySelector('#name')?.focus()"
ht browser browser:2 addstyle "#debug-banner { display: none !important; }"
```

### Console & Errors

Console messages and JavaScript errors are captured by a preload script and stored bun-side (capped at 500 console entries and 200 errors per surface).

```bash
ht browser browser:2 console                     # list captured console messages
ht browser browser:2 console clear               # clear captured messages
ht browser browser:2 errors                      # list captured JS errors
ht browser browser:2 errors clear                # clear captured errors
```

### Cookies

```bash
ht browser-cookie-list                             # list all stored cookies
ht browser-cookie-list example.com                 # list cookies matching domain
ht browser-cookie-get https://example.com/path     # get cookies for a URL
ht browser-cookie-set session abc123 --domain .example.com --secure true
ht browser-cookie-delete .example.com session      # delete specific cookie
ht browser-cookie-clear                            # clear all stored cookies
ht browser-cookie-clear .example.com               # clear cookies for a domain
ht browser-cookie-import cookies.json              # import JSON cookie file
ht browser-cookie-import cookies.txt --format netscape  # import Netscape format
ht browser-cookie-export                           # export all as JSON
ht browser-cookie-export --format netscape         # export as Netscape format
ht browser-cookie-capture --surface browser:1      # capture cookies from page
```

### Other

```bash
ht browser browser:2 devtools                    # toggle WebKit inspector
ht browser browser:2 find-in-page "search text"  # find in page
ht browser history                               # list browser history
ht browser history clear                         # clear browser history
ht browser list                                  # list all browser surfaces
ht browser browser:2 close                       # close browser surface
```

---

## 6. Socket API Methods (`browser.*`)

All methods accept `surface_id` (or `surface`) to target a browser surface.

### Lifecycle

| Method | Params | Returns |
|--------|--------|---------|
| `browser.list` | — | `[{id, url, title, zoom}]` |
| `browser.open` | `url?` | `"OK"` |
| `browser.open_split` | `url?, direction?` | `"OK"` |
| `browser.close` | `surface_id` | `"OK"` |
| `browser.identify` | `surface_id?` | `{id, url, title, zoom, partition}` |

### Navigation

| Method | Params | Returns |
|--------|--------|---------|
| `browser.navigate` | `surface_id, url` | `"OK"` |
| `browser.back` | `surface_id` | `"OK"` |
| `browser.forward` | `surface_id` | `"OK"` |
| `browser.reload` | `surface_id` | `"OK"` |
| `browser.url` | `surface_id` | URL string or `null` |

### Waiting

| Method | Params | Returns |
|--------|--------|---------|
| `browser.wait` | `surface_id, selector?, text?, url_contains?, load_state?, function?, timeout_ms?` | `"true"` or `"timeout"` |

### DOM Interaction

| Method | Params | Returns |
|--------|--------|---------|
| `browser.click` | `surface_id, selector` | `"OK"` |
| `browser.dblclick` | `surface_id, selector` | `"OK"` |
| `browser.hover` | `surface_id, selector` | `"OK"` |
| `browser.focus` | `surface_id, selector` | `"OK"` |
| `browser.check` | `surface_id, selector` | `"OK"` |
| `browser.uncheck` | `surface_id, selector` | `"OK"` |
| `browser.scroll_into_view` | `surface_id, selector` | `"OK"` |
| `browser.type` | `surface_id, selector, text` | `"OK"` |
| `browser.fill` | `surface_id, selector, text` | `"OK"` |
| `browser.press` | `surface_id, key` | `"OK"` |
| `browser.select` | `surface_id, selector, value` | `"OK"` |
| `browser.scroll` | `surface_id, selector?, dx?, dy?` | `"OK"` |
| `browser.highlight` | `surface_id, selector` | `"OK"` |

### Inspection

| Method | Params | Returns |
|--------|--------|---------|
| `browser.snapshot` | `surface_id` | `"OK"` (result async) |
| `browser.get` | `surface_id, what, selector?, attr?, property?` | value string (async) |
| `browser.is` | `surface_id, check, selector` | `"true"` or `"false"` (async) |

### JavaScript & Injection

| Method | Params | Returns |
|--------|--------|---------|
| `browser.eval` | `surface_id, script` | `"OK"` |
| `browser.addscript` | `surface_id, script` | `"OK"` |
| `browser.addstyle` | `surface_id, css` | `"OK"` |

### Console & Errors

| Method | Params | Returns |
|--------|--------|---------|
| `browser.console_list` | `surface_id` | `[{level, args, timestamp}]` |
| `browser.console_clear` | `surface_id` | `"OK"` |
| `browser.errors_list` | `surface_id` | `[{message, filename?, lineno?, timestamp}]` |
| `browser.errors_clear` | `surface_id` | `"OK"` |

### Cookies

| Method | Params | Returns |
|--------|--------|---------|
| `browser.cookie_list` | `domain?` | `[{name, value, domain, path, expires, secure, httpOnly, sameSite, source, updatedAt}]` |
| `browser.cookie_get` | `url` | Cookies matching URL (filtered by domain, path, secure, expiry) |
| `browser.cookie_set` | `name, value, domain, path?, expires?, secure?, httpOnly?, sameSite?` | `"OK"` |
| `browser.cookie_delete` | `domain, name, path?` | `"OK"` or `"NOT_FOUND"` |
| `browser.cookie_clear` | `domain?` | `"OK"` or `{deleted: N}` |
| `browser.cookie_import` | `data, format?` | `{imported: N}` |
| `browser.cookie_export` | `format?` | JSON or Netscape string |
| `browser.cookie_capture` | `surface_id` | `{captured: N, domain: "..."}` |

### Other

| Method | Params | Returns |
|--------|--------|---------|
| `browser.find` | `surface_id, query` | `"OK"` |
| `browser.stop_find` | `surface_id` | `"OK"` |
| `browser.devtools` | `surface_id` | `"OK"` |
| `browser.history` | — | `[{url, title, visitCount, lastVisited}]` |
| `browser.clear_history` | — | `"OK"` |

---

## 7. Settings

Settings are in **Settings → Browser**:

| Setting | Default | Description |
|---------|---------|-------------|
| Search Engine | Google | Search engine for non-URL address bar queries |
| Home Page | (empty) | URL to load when opening a new browser pane. Empty = `about:blank`. |
| Force Dark Mode | Off | Inject dark mode CSS into pages that don't provide one |
| Intercept Terminal Links | Off | Open ⌘-clicked URLs in the built-in browser instead of externally |

### Cookie Management (Settings → Browser → Cookies)

The Cookies subsection provides UI buttons for:

| Button | Action |
|--------|--------|
| **Import Cookie File...** | Opens a file picker for `.json`, `.txt`, or `.cookies` files. Auto-detects JSON vs Netscape format. |
| **Export All Cookies** | Downloads all stored cookies as a JSON file. |
| **Clear All Cookies** | Removes all cookies from the store. |

Settings persist to `~/.config/hyperterm-canvas/settings.json` alongside all other app settings.

---

## 8. Browser History

HyperTerm maintains a local browser history store:

- Persisted to `~/Library/Application Support/hyperterm-canvas/browser-history.json`
- Stores URL, title, visit count, and last visited timestamp
- Automatically deduplicates URLs (strips trailing slash, www prefix)
- Capped at 10,000 entries (oldest evicted first)
- Powers `ht browser history` and future address bar autocomplete

---

## 9. Session Persistence

Browser pane URLs and surface types are saved with the workspace layout. On app restart:

- Layout is restored (same workspace structure, same split positions)
- Browser panes reopen with their last URL
- Terminal panes respawn with their last cwd

The `surfaceTypes` and `surfaceUrls` fields in `PersistedWorkspace` drive this.

---

## 10. Security

### OOPIF Isolation

Each `<electrobun-webview>` runs in its own process. A crash in a loaded page doesn't affect the terminal or other browser panes.

### Navigation Rules

By default, browser panes block:
- `javascript:` URLs (XSS vector)
- `data:text/html` URLs (XSS vector)

All other URLs (http, https) are allowed.

### Cookie Sharing

All browser panes share a `persist:browser-shared` partition. Logging into a site in one browser pane means you're logged in across all browser panes.

### Cookie Store

HyperTerm maintains a local cookie store that can import, export, and auto-inject cookies into browser panes:

- Persisted to `~/.config/hyperterm-canvas/cookie-store.json`
- Stores name, value, domain, path, expiry, secure flag, httpOnly flag, sameSite attribute
- Supports import from JSON (EditThisCookie/cookie-editor format) and Netscape/cURL cookie files
- On each page navigation (`dom-ready`), matching cookies are auto-injected via `document.cookie`
- Cookies are matched by domain (with subdomain matching), path prefix, and secure flag
- HTTP-only cookies are stored for reference but cannot be injected via JavaScript
- Expired cookies are filtered out automatically
- Capped at 50,000 entries (oldest evicted by LRU)

**Limitations:**
- Injection happens at `dom-ready`, which is after the page starts loading. Auth-critical cookies may require a page reload after first injection.
- `document.cookie` cannot set HTTP-only cookies — these are tracked in the store but skipped during injection.
- Secure cookies are only injected on HTTPS pages.

### Console/Error Capture

A preload script hooks `console.*` methods and `window.onerror` / `onunhandledrejection`. These are forwarded to the bun process for storage and CLI access. The preload does not interfere with normal page execution.

---

## 11. Overlay Z-Ordering

The `<electrobun-webview>` element renders as a native layer above the parent webview. When overlays open (command palette, settings panel, process manager, prompt dialogs), browser webview elements are hidden via `toggleHidden(true)` and restored when the overlay closes. This prevents the browser content from visually covering app chrome.

When switching workspaces, browser panes in the outgoing workspace are hidden, and those in the incoming workspace are shown and synced to their container dimensions.

---

## 12. Common Patterns

### Navigate, wait, inspect

```bash
ht browser open https://example.com/login
ht browser browser:1 wait --load-state complete --timeout-ms 15000
ht browser browser:1 snapshot
ht browser browser:1 get title
```

### Fill a form and verify

```bash
ht browser browser:1 fill "#email" "ops@example.com"
ht browser browser:1 fill "#password" "$PASSWORD"
ht browser browser:1 click "button[type='submit']"
ht browser browser:1 wait --text "Welcome"
ht browser browser:1 is visible "#dashboard"
```

### Debug failures

```bash
ht browser browser:1 console
ht browser browser:1 errors
```

### Inject custom styles

```bash
ht browser browser:1 addstyle "body { font-size: 18px !important; }"
```

---

## 13. File Map

| File | Role |
|------|------|
| `src/bun/browser-surface-manager.ts` | Bun-side state: URL, title, zoom, console logs, errors |
| `src/bun/browser-history.ts` | JSON-persisted history with search and dedup |
| `src/bun/cookie-store.ts` | JSON-persisted cookie store with domain matching, auto-injection on navigation |
| `src/bun/cookie-parsers.ts` | Import parsers (JSON, Netscape) and export formatters |
| `src/views/terminal/browser-pane.ts` | Webview-side: DOM construction, address bar, `<electrobun-webview>` wiring, URL helpers, preload scripts, find-in-page, dark mode, cookie injection/extraction |
| `src/shared/types.ts` | `PaneLeaf.surfaceType`, browser RPC messages, cookie RPC messages, `PersistedWorkspace` extensions |
| `src/shared/settings.ts` | `browserSearchEngine`, `browserHomePage`, `browserForceDarkMode`, `browserInterceptTerminalLinks` |
| `src/bun/rpc-handler.ts` | 50+ `browser.*` socket API methods (including 9 cookie methods) |
| `src/bun/index.ts` | Browser surface creation/close, cookie injection on `browserDomReady`, RPC message handling, layout persistence |
| `src/views/terminal/surface-manager.ts` | Browser pane integration into tiling layout, workspace switching, overlay z-ordering, cookie injection routing |
| `src/views/terminal/index.ts` | Keyboard shortcuts, event forwarding, overlay management, cookie action event handling |
| `src/views/terminal/settings-panel.ts` | Browser settings section with cookie import/export/clear UI |
| `src/views/terminal/index.css` | Browser pane styles (address bar, nav buttons, find bar, etc.) |
| `src/views/terminal/icons.ts` | `chevronLeft`, `chevronRight`, `reload`, `code` icons |
| `bin/ht` | `ht browser <subcommand>` CLI with 30+ commands, `ht browser-cookie-*` cookie commands |
