# Native Webview E2E — Plan

Status: **proposal**, not yet built. One branch's worth of work split
across two tiers. Tier 1 covers what's driveable through the existing
socket RPC surface; Tier 2 adds a tiny test-only IPC that unlocks the
webview-local behaviors Tier 1 can't reach. Screenshots (§7) and
daily-driver collision isolation (§8) are cross-cutting concerns
that ride on both tiers.

## 0. Current state

- `tests/*.test.ts` — 666 unit + DOM tests (bun test). Cover pure
  parsers, reducers, and happy-dom views.
- `tests-e2e/*.spec.ts` — 43 Playwright specs. They spawn
  `tests-e2e/server-boot.ts` which starts `WebServer` + `SessionManager`
  in a Bun subprocess **without** the Electrobun webview. In other
  words: the current "e2e" suite tests the web-mirror backend against
  a browser, not the real app.
- Native Electrobun webview has **zero** e2e coverage today. Every
  keyboard shortcut, dialog, drag-drop overlay, settings panel
  change, and pane-bar chip render is unreviewed by any automated
  test after a UI change.

## 1. Why this is tractable for us (and not for most Electrobun apps)

The socket RPC surface (`/tmp/hyperterm.sock`) already exposes:

| Capability | Methods |
| --- | --- |
| Workspaces | `workspace.{list,current,create,select,close,rename,next,previous}` |
| Surfaces | `surface.{list,metadata,split,close,focus,rename,read}` |
| Panes | `pane.list` |
| Agents | `agent.create` |
| Browser panes (DOM automation) | `browser.{click,dblclick,hover,focus,check,uncheck,type,fill,press,select,scroll,highlight,get,…}` |
| PTY input | `writeStdin` (Electrobun RPC) |
| Notifications | `notification.{list,clear}` + `ht notify` CLI |
| Scripts | `runScript` in a workspace |

`bin/ht` already wraps every method. `surface.read` round-trips
through the webview's `readScreen` handler and returns the xterm
buffer as plain text. Observation is solved; we're missing the
driver harness around it.

## 2. Goals

- **Drive a real running app.** Spawn the Electrobun app (not a
  subset), let it go through its actual startup, and exercise user
  flows end-to-end.
- **Parallelisable.** N Playwright workers × one app each, no shared
  socket / settings / state.
- **Hermetic.** Tests never touch `~/Library/Application
  Support/hyperterm-canvas/`. Failures don't pollute the dev
  environment.
- **Coexistent.** Tests run without disturbing a live HyperTerm
  Canvas that the developer is actively using — including Claude
  Code running as a shell process inside one of the daily-driver's
  panes. No focus theft, no state collision, no clipboard clobber.
  See §8.
- **Visually observable.** Every test can record the window as a
  PNG at key steps. Images attach to the Playwright report and feed
  a design-review workflow that pipes screenshots into Claude Opus
  for visual QA. See §7.
- **Fast enough for CI.** <5 min wall clock for the full suite on
  `macos-latest`. Individual tests <5s steady state.
- **Typed from the outside.** A TypeScript RPC client that mirrors
  `HyperTermRPC["bun"]["requests"]` + socket methods, so tests get
  completion + compile-time shape checks.
- **Crisp failure output.** On any assertion fail: the app's stderr,
  the last N lines of every surface's screen buffer, a JSON dump of
  workspace + surface state, plus a final `failure.png` screenshot.

## 3. Non-goals

- Not a pixel-diff regression suite. We capture PNGs for human (and
  Claude) review, but we do not byte-compare against a baseline by
  default — font smoothing, window chrome, and macOS accent-color
  variance make pixel-diff brittle on CI.
- Not a replacement for unit tests. Every pure helper stays covered
  by `bun test`. E2E catches integration-level regressions the units
  can't see.
- Not driving the macOS accessibility tree. If Tier 1 + Tier 2 still
  leaves a gap, we revisit; we do **not** reach for `osascript` as a
  default.
- Not shipping test code in production binaries (see Tier 2 gate).

---

## 4. Architecture overview

```
┌─── Playwright worker (Bun/Node) ───────────────────────────────┐
│                                                                │
│   test.ts                                                      │
│      ↓ uses fixture:                                           │
│   HyperTermApp (class) ─ typed wrapper over socket RPC         │
│      ↓                                                         │
│   socket $HT_CONFIG_DIR/ht.sock  (JSON-RPC)                    │
│                                                                │
│   screenshot(name)  ──▶  screencapture -l <windowId> → PNG     │
│                                                                │
└────────────────────────────────┬───────────────────────────────┘
                                 │
┌────────────────────────────────▼───────────────────────────────┐
│  Spawned Electrobun app subprocess                             │
│                                                                │
│    HT_CONFIG_DIR=/tmp/ht-e2e-<worker>                          │
│    HT_WEB_MIRROR_PORT=<unique>                                 │
│    HYPERTERM_TEST_MODE=1   (Tier 2 only)                       │
│    HT_E2E=1                (accessory mode — §8)               │
│                                                                │
│    Bun main process ↔ Electrobun RPC ↔ Webview                 │
│                                                                │
│    · Webview runs the real SurfaceManager, PanelManager, etc. │
│    · Socket server binds to $HT_CONFIG_DIR/ht.sock             │
│    · Accessory activation policy: no Dock icon, no focus steal │
│    · Tier 2 only: registers __test.* RPC handlers in-webview   │
└────────────────────────────────────────────────────────────────┘
```

Two tiers ride on the same process model. Tier 1 ships alone; Tier 2
layers in without invalidating Tier 1 tests. Screenshots (§7) and
collision isolation (§8) apply to both tiers uniformly.

---

## 5. Tier 1 — Socket-RPC E2E harness

### 5.1 Prerequisite — `HT_CONFIG_DIR` override (15 min)

`src/bun/index.ts:52` currently does:

```ts
const configDir = join(Utils.paths.config, "hyperterm-canvas");
```

Socket, settings, browser history, cookies all live under it. To
isolate test runs we need:

```ts
const configDir =
  process.env["HT_CONFIG_DIR"] ??
  join(Utils.paths.config, "hyperterm-canvas");
```

One-line change, no behavior impact in the default case. This is the
single most important piece of prep; everything else composes from
it.

### 5.2 Spawn model

Two supported modes:

| Mode | Command | When |
| --- | --- | --- |
| `dev` | `bun start` (via spawn) | local dev, PR CI — faster startup, same code paths |
| `packaged` | `build/stable/macos-arm64/HyperTermCanvas.app/Contents/MacOS/HyperTermCanvas` | release CI — catches packaging regressions (postBuild CLI inject, bundle integrity) |

Default to `dev`. `HT_E2E_APP=packaged` flips it. Both paths honor
`HT_CONFIG_DIR`, `HT_E2E`, `HT_WEB_MIRROR_PORT`, and
`HYPERTERM_TEST_MODE`.

**Readiness signal.** Wait for the socket file to exist at
`$HT_CONFIG_DIR/ht.sock` AND respond to `system.ping` (2s poll, 30s
cap). Don't parse stdout; too noisy and too easy to race.

**Teardown.** On test completion: send `system.shutdown` (new
RPC — graceful exit), then SIGTERM after 2s, SIGKILL after 5s.
Remove `$HT_CONFIG_DIR` on success; preserve on failure for
debugging.

### 5.3 State isolation per worker

Each Playwright worker gets:

- `HT_CONFIG_DIR=/tmp/ht-e2e-<pid>-<workerIndex>` — fresh, wiped
  afterward. Contains: `ht.sock`, `settings.json`, `browser-history.json`,
  `cookies.json`, `layout.json`.
- `HT_WEB_MIRROR_PORT=<unique>` — optional; random free port picked
  via `get-port`-style helper. Only needed if the test touches the
  web mirror.
- `HOME=<configDir>/home` — so anything the app or spawned shells
  write to `~/` lands in a throwaway dir.
- `HT_E2E=1` — general "we're in test mode" marker. Triggers
  accessory-mode activation (§8) and skips the startup
  "install `ht` CLI" nag.

### 5.4 Typed RPC client

A thin wrapper — `tests-e2e-native/client.ts`:

```ts
import type { HyperTermRPC } from "../src/shared/types";

// Every socket method, typed from the domain handlers.
export interface SocketRpc {
  workspace: {
    list(): Promise<WorkspaceSnapshot[]>;
    current(): Promise<WorkspaceSnapshot | null>;
    create(params: { name?: string; color?: string }): Promise<{ id: string }>;
    select(params: { workspaceId: string }): Promise<void>;
    close(params: { workspaceId: string }): Promise<void>;
    rename(params: { workspaceId: string; name: string }): Promise<void>;
    next(): Promise<void>;
    previous(): Promise<void>;
  };
  surface: {
    list(): Promise<SurfaceSnapshot[]>;
    metadata(params: { surfaceId?: string }): Promise<SurfaceMetadata | null>;
    split(params: { direction: "horizontal" | "vertical"; cwd?: string }): Promise<{ surfaceId: string }>;
    close(params: { surfaceId: string }): Promise<void>;
    focus(params: { surfaceId: string }): Promise<void>;
    rename(params: { surfaceId: string; title: string }): Promise<void>;
    read(params: { surfaceId?: string; lines?: number; scrollback?: boolean }): Promise<string>;
  };
  pane: { list(): Promise<PaneSnapshot[]> };
  browser: { /* all browser.* methods, each typed */ };
  notification: {
    list(): Promise<Notification[]>;
    clear(): Promise<void>;
  };
  /** Escape hatch — for methods we haven't typed yet. */
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export function connect(socketPath: string): Promise<SocketRpc>;
```

Implementation notes:

- Single persistent socket per app instance. Reuse across all RPC
  calls in that test.
- Length-prefixed JSON framing (4-byte BE size, same as the server).
- Per-call id + Promise map. 10s default timeout; configurable.
- `close()` disconnects; `rpc.__raw.end()` for escape hatch.
- Types derived from the real `HandlerDeps` shapes where possible so
  drift fails the typecheck.

### 5.5 Playwright fixture

`tests-e2e-native/fixtures.ts`:

```ts
export interface AppFixture {
  rpc: SocketRpc;
  /** The first surface the app opens at boot. */
  initialSurfaceId: string;
  /** Seconds since the app booted; useful for assertions. */
  uptimeMs(): number;
  /** Convenience: write into a surface's PTY and wait for the next screen change. */
  runCommand(surfaceId: string, command: string): Promise<string>;
  /** Convenience: poll `surface.read` until `predicate(text)` returns true or timeout. */
  waitForScreen(surfaceId: string, predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>;
  /** Capture + attach a screenshot. See §7. */
  snap(name: string): Promise<void>;
  screenshot(name: string, opts?: ScreenshotOpts): Promise<string>;
}

export const test = base.extend<{ app: AppFixture }>({
  app: async ({}, use, testInfo) => {
    const { rpc, teardown, info } = await spawnApp({
      workerIndex: testInfo.workerIndex,
      projectName: testInfo.project.name,
    });
    await use({ rpc, initialSurfaceId: info.surfaceId, uptimeMs: info.uptimeMs, ... });
    await teardown({ preserveState: testInfo.status !== "passed" });
  },
});
```

One app per test. Can relax to "one app per file" with `test.describe.serial`
for tests that share state — don't default to it; the isolation
cost is lower than the flake risk.

### 5.6 Assertion helpers

`tests-e2e-native/assertions.ts`:

```ts
// Semantic matchers wrapping the RPC surface.
export const expectSurface = (rpc: SocketRpc, surfaceId: string) => ({
  async toHaveTitle(title: string): Promise<void>;
  async toHaveCwd(cwd: string): Promise<void>;
  async toHaveForegroundCommand(cmd: RegExp): Promise<void>;
  async toHaveListeningPort(port: number): Promise<void>;
  async toShowOnScreen(text: string | RegExp, opts?: { timeoutMs?: number }): Promise<void>;
});

export const expectWorkspace = (rpc: SocketRpc, workspaceId: string) => ({
  async toHavePaneCount(n: number): Promise<void>;
  async toContainSurface(surfaceId: string): Promise<void>;
  async toBeActive(): Promise<void>;
});

export const expectApp = (rpc: SocketRpc) => ({
  async toHaveWorkspaceCount(n: number): Promise<void>;
  async toHaveNotificationCount(n: number): Promise<void>;
});
```

All helpers are polling — they retry up to `timeoutMs` (default
2000ms). Underneath they use Playwright's
`expect.poll` so assertion failures show the right stack.

### 5.7 Test coverage plan

Target ~60 Tier-1 tests across seven spec files. For each: the
behavior under test and the RPC path that exercises it.

**`workspace.spec.ts` (~8)**

- Create → appears in list, is active
- Create with color → color round-trips
- Rename → reflected in list and titlebar title (via metadata)
- Close non-active → list shrinks, active unchanged
- Close active → falls back to next workspace
- `next` / `previous` → cycles in order
- 5 workspaces: jump by ordinal
- Rapid create/close (10 iterations) — no leaks in `surface.list`

**`surface.spec.ts` (~10)**

- Split horizontal/vertical → two surfaces in pane tree, focus on new
- Close one of two → remaining is sole surface
- Focus one of two → `surface.current` tracks
- Rename → reflected in `metadata.title`
- Split × 4 in various directions → tree structure matches expected
- Close all → workspace closes (or lingers empty, depending on
  current behavior; test locks it in)

**`pty.spec.ts` (~10)**

- `echo hello` → screen contains `hello`
- `pwd` → matches `surface.metadata.cwd`
- `cd /tmp; pwd` → metadata cwd updates within 1.5s (1 Hz poller)
- Start `sleep 30` → metadata foregroundPid ≠ shell pid, command
  contains "sleep"
- Ctrl-C (via `writeStdin` with `\x03`) → fg returns to shell
- Long-running output (`seq 1 1000`) → readScreen shows tail
- `clear` → screen buffer resets
- Foreign-locale-safe `LC_ALL=C ps` check — CPU/RSS parse correctly

**`metadata.spec.ts` (~8)**

- Start `python3 -m http.server 8080` → port 8080 appears in
  `listeningPorts` within 1.5s
- Kill the server → port drops
- `git init && git add .` → `metadata.git.staged > 0`
- `cd` to non-repo dir → `metadata.git` is null
- package.json in cwd → `metadata.packageJson.name` matches
- Process tree: spawn bash → bash → cat, tree shows all three

**`browser.spec.ts` (~10)**

- Create browser surface with URL → `surface.metadata.surfaceType`
  === "browser"
- Navigate via `browser.navigate` → address bar reflects (read via
  `browser.get` on address input)
- `browser.fill` a form, `browser.click` submit, assert on
  response text via `browser.get`
- `browser.scroll` top/bottom, assert on visible text
- Cookies: `browser.cookies.set/list/delete`
- `browser.eval` returns serialised value
- Reload → URL preserved
- Intercept terminal URL click → browser surface opens (drive by
  PTY-echoing a URL then `ht surface.click-url`, or similar)

**`sideband.spec.ts` (~8)**

- Run `scripts/demo_image.py` → panel of type `image` appears
  (observable via `surface.metadata.panels` — need a new lightweight
  read RPC, noted in §10)
- Demo SVG + HTML + canvas2d renderers each create a panel
- Panel flush (write `flush` op) → binary channel resets
- Oversized byteLength → error event on fd 5, panel doesn't render
- Interactive panel: click via browser-style RPC (Tier 2 gate — may
  move here if we add `panel.click`)

**`script-runner.spec.ts` (~6)**

- `runScript { workspaceId, cwd, command: "node -v" }` → new surface
  appears, echoes command, exits clean
- `runScript` with failing command → surface exits non-zero, status
  pill flips to error
- Two runScripts in flight → each lands in its own surface, both
  tracked

### 5.8 File layout

```
tests-e2e-native/
  fixtures.ts           — spawnApp, AppFixture, teardown
  client.ts             — typed socket RPC wrapper
  assertions.ts         — expectSurface / expectWorkspace / expectApp
  screenshot.ts         — capture helpers (§7)
  clipboard.ts          — snapshot/restore pbpaste (§8)
  helpers/
    wait.ts             — polling primitives
    tmpdir.ts           — worker-scoped HT_CONFIG_DIR mgmt
    ports.ts            — free TCP port picker
    shell.ts            — runCommand helper (writeStdin + waitForScreen)
  specs/
    workspace.spec.ts
    surface.spec.ts
    pty.spec.ts
    metadata.spec.ts
    browser.spec.ts
    sideband.spec.ts
    script-runner.spec.ts

playwright-native.config.ts   — projects: [{ name: "native-dev", … }]

package.json:
  "test:native"                : "playwright test --config=playwright-native.config.ts"
  "test:native:packaged"       : "HT_E2E_APP=packaged bun run test:native"
  "test:native:design-review"  : "playwright test --config=playwright-native.config.ts --grep @design-review"
```

### 5.9 CI integration

Add a job to `.github/workflows/ci.yml`:

```yaml
native-e2e:
  runs-on: macos-latest
  needs: [unit-tests]
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
    - run: bun install --frozen-lockfile
    - run: bunx playwright install --with-deps
    - run: bun run test:native
    - uses: actions/upload-artifact@v4
      if: always()
      with:
        name: native-e2e-screenshots
        path: test-results/screenshots/
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: native-e2e-logs
        path: |
          /tmp/ht-e2e-*/**
          test-results/
```

`native-dev` runs on every PR. `native-packaged` runs only on the
release tag — it needs `bun run build:stable` first (~3 min), which
is too slow for per-PR.

### 5.10 Milestones (Tier 1)

- **M1 (0.5d)** — `HT_CONFIG_DIR` override + accessory-mode hook
  under `HT_E2E=1` (§8) + typed SocketRpc client + spawnApp fixture
  + one smoke test ("app boots, workspace.list returns one workspace").
- **M2 (1d)** — Workspace + surface lifecycle specs (~18 tests).
  Validates the full fixture story.
- **M3 (1d)** — PTY + metadata specs (~18 tests). First tests that
  exercise the 1 Hz metadata poller under real load.
- **M4 (1d)** — Browser-pane specs (~10 tests). Leans heavily on
  existing `browser.*` methods.
- **M5 (0.5d)** — Sideband + script-runner specs (~14 tests).
  Requires small additions listed in §10.
- **M6 (0.5d)** — Screenshot infrastructure (§7): `snap` fixture,
  index.json, afterEach failure hook, 1–2 @design-review tagged
  tests per spec file.
- **M7 (0.5d)** — Clipboard isolation fixture (§8.1), CI wiring,
  artifact upload, retry-once policy on `native-dev`.

Total Tier 1: ~5 days engineering. ~60 tests.

---

## 6. Tier 2 — Test-only webview IPC

Tier 1 can't see or drive: keyboard shortcuts (⌘B sidebar toggle,
⌘⇧P palette, ⌘, settings, ⌘⌥P process manager, ⌘F search),
the prompt dialogs, the settings panel UI, or the drag-drop overlay.
Tier 2 adds the smallest possible IPC to close that gap.

### 6.1 Security gate

Two checks must both be true for the `__test.*` handlers to register:

1. `process.env["HYPERTERM_TEST_MODE"] === "1"` — explicit opt-in at
   app launch.
2. **AND** `process.env["HT_CONFIG_DIR"]` starts with `/tmp/` (or
   platform-equivalent). Belt-and-braces: even a stray env var in a
   user shell can't expose these handlers against the real config
   dir.

Production release builds never set the env var, so the handlers
don't even compile in when stripped by the bundler (tree-shake on a
`const TEST_MODE = process.env["HYPERTERM_TEST_MODE"] === "1";` top-level check).
Verified via a `grep '__test\.' build/…/main.js` assertion in the
release workflow.

### 6.2 Protocol

Two Bun-side handlers (register only under the gate), one webview
route (register only when `window.__htTestMode__ === true`, set via
Electrobun `extraJs` injection at launch under the same gate).

**Bun side — `src/bun/rpc-handlers/__test.ts`:**

```ts
export function registerTestHandlers(deps: HandlerDeps): Record<string, Handler> {
  if (!testModeEnabled()) return {};
  return {
    "__test.dispatchEvent":       (p) => deps.requestWebview!("__test.dispatchEvent", p),
    "__test.keydown":             (p) => deps.requestWebview!("__test.keydown", p),
    "__test.readWebviewState":    ()  => deps.requestWebview!("__test.readWebviewState", {}),
    "__test.readPaletteCommands": ()  => deps.requestWebview!("__test.readPaletteCommands", {}),
    "__test.readDialog":          ()  => deps.requestWebview!("__test.readDialog", {}),
    "__test.readSettingsField":   (p) => deps.requestWebview!("__test.readSettingsField", p),
    "__test.setSettingsField":    (p) => deps.requestWebview!("__test.setSettingsField", p),
    "__test.getWindowId":         ()  => deps.requestWebview!("__test.getWindowId", {}),
    "__test.getWindowBounds":     ()  => deps.requestWebview!("__test.getWindowBounds", {}),
  };
}
```

Merged into the dispatch table inside `createRpcHandler` after the
other domains, same pattern as `registerSidebar` / `registerAgent`.
Adding `__test.*` to `HyperTermRPC["webview"]["requests"]` under a
conditional type keeps the satisfies check clean.

**Webview side — `src/views/terminal/__test-handlers.ts`:**

```ts
export function registerTestHandlers(surfaceManager: SurfaceManager): RequestHandler {
  if (!window.__htTestMode__) return {};
  return {
    "__test.dispatchEvent": ({ type, detail }) => {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    },
    "__test.keydown": ({ key, meta = false, shift = false, ctrl = false, alt = false }) => {
      document.dispatchEvent(new KeyboardEvent("keydown", {
        key, metaKey: meta, shiftKey: shift, ctrlKey: ctrl, altKey: alt, bubbles: true, cancelable: true,
      }));
    },
    "__test.readWebviewState": () => ({ /* see §6.3 */ }),
    "__test.readPaletteCommands": () => (palette.isVisible() ? palette.getFilteredCommands() : []),
    "__test.readDialog": () => readActiveDialog(),
    "__test.readSettingsField": ({ key }) => /* … */,
    "__test.setSettingsField": ({ key, value }) => /* … */,
    "__test.getWindowId": () => electrobun.getNativeWindowId?.() ?? null,
    "__test.getWindowBounds": () => /* x, y, w, h of the NSWindow in screen coords */,
  };
}
```

Registered in `src/views/terminal/index.ts` only when the Electrobun
preload script has set `window.__htTestMode__ = true` — which it
does only when `HYPERTERM_TEST_MODE=1` was set in the spawning
process. One condition, one code path.

### 6.3 RPC surface (exhaustive)

| Method | Purpose |
| --- | --- |
| `__test.keydown` | Drive any shortcut. `{ key, meta?, shift?, ctrl?, alt? }` |
| `__test.dispatchEvent` | Escape hatch for any `ht-*` CustomEvent |
| `__test.readWebviewState` | Sidebar visibility, focus, palette/settings/process-manager open state, font size, fullscreen id |
| `__test.readPaletteCommands` | When palette is open: current filtered item list |
| `__test.readDialog` | Active prompt/confirm dialog — title, message, inputs |
| `__test.readSettingsField` | Current value of any `AppSettings` key |
| `__test.setSettingsField` | Mutate a settings field (for testing dependent code paths without walking the UI) |
| `__test.getWindowId` | CGWindowID for `screencapture -l <id>` (§7) |
| `__test.getWindowBounds` | NSWindow frame in screen coords — fallback for `screencapture -R` |

That's it. No `__test.click(x,y)`, no `__test.screenshot()` — we
screenshot from the driver side using stock `screencapture` and the
window id this RPC exposes. If we hit a need the above list doesn't
cover, we'll have a concrete reason; until then, smaller surface ==
fewer security-review blast radius.

### 6.4 Test coverage plan (~35 new tests)

**`keyboard.spec.ts` (~12)** — every row in `KEYBOARD_BINDINGS` and
`HIGH_PRIORITY_BINDINGS`:

- ⌘B toggles `sidebarVisible`
- ⌘⇧P opens palette; Escape closes
- ⌘, opens settings; Escape closes
- ⌘⌥P opens process manager
- ⌘I opens surface details
- ⌘F opens terminal search
- ⌘N creates surface; close test: `workspace.list` length +1
- ⌘D / ⌘⇧D split horizontal / vertical
- ⌘W closes focused surface
- ⌘⌥← / → / ↑ / ↓ focus direction (requires 2+ surface split setup)
- ⌘1..9 jump to workspace
- ⌘+= / ⌘- font size
- Palette-visible gate: ⌘D does NOT split while palette is open
- Browser-pane context: ⌘L focuses address bar only when browser
  is the active surface type
- Settings-panel-visible gate: ⌘B does NOT fire while settings panel
  is open

**`dialogs.spec.ts` (~8)**

- "Rename workspace" dialog: open, title/placeholder match, enter
  new name, `workspace.list` reflects
- "Rename surface" via right-click / context menu equivalent
- Dialog Escape → no mutation
- Dialog Enter with empty value → no mutation
- Prompt dialog appears stacked above settings panel

**`palette.spec.ts` (~6)**

- ⌘⇧P → `readPaletteCommands` returns >0 items
- Type "sidebar" → filtered list narrows
- Enter executes first item (e.g. toggle sidebar) — `readWebviewState`
  reflects
- Escape dismisses — `paletteVisible` → false
- Palette items include every entry in `KEYBOARD_BINDINGS` that has
  a `description` — lock in help-dialog-ready metadata

**`settings.spec.ts` (~6)**

- Open panel, change `fontSize` via `setSettingsField`, verify
  `surfaceManager.getFontSize()` reflects
- Change `paneGap`, create split, verify `surface.metadata.paneRect`
  respects gap
- Change `themePreset`, verify `accentColor` / `ansiColors` match
  preset
- Toggle `terminalBloom`, webview state flips

**`search.spec.ts` (~3)**

- ⌘F opens search, type query, Enter cycles through matches
- Escape closes
- Search with no matches shows "no results" affordance

### 6.5 Milestones (Tier 2)

- **M8 (0.5d)** — Gate + Bun-side handler + webview-side handler +
  one smoke test (⌘B toggles sidebar). Includes
  `__test.getWindowId` + `__test.getWindowBounds` so §7's screenshot
  helper can use the canonical path on Tier-2-enabled runs.
- **M9 (0.5d)** — Complete keyboard.spec + palette.spec (~18 tests).
- **M10 (0.5d)** — Dialogs + settings + search specs (~17 tests).
- **M11 (0.25d)** — CI build-output assertion that `__test.*` is
  absent from the release bundle.

Total Tier 2: ~1.75 days, ~35 tests.

---

## 7. Screenshots & design analysis

Every test records visual state at key points — for design review,
for regression analysis, and as attachments on the Playwright HTML
report. Claude Opus (and any image-capable reviewer) reads these
shots to flag visual regressions, off-palette colors, or layout
drift without running the app locally.

### 7.1 Capture mechanism

macOS's built-in `screencapture` CLI is the primary path:

- `screencapture -l <windowId> -o out.png` — captures a single
  window by its `CGWindowID`. No dock/shadow, exact window bounds.
- Get the window id via Tier 2 `__test.getWindowId`.
- **Fallback when Tier 2 is unavailable** (Tier-1-only builds):
  `screencapture -R x,y,w,h` using bounds from
  `__test.getWindowBounds`. If Tier 2 is off entirely, use
  `screencapture -D 1 -t png -T 0` for a full-screen capture —
  noisier, but gives us something.
- **Last-resort fallback** (no Tier 2, no bounds): `osascript -e
  'tell application "System Events" to tell process "HyperTerm
  Canvas" to get position of window 1 & size of window 1'`. Brittle
  when bundle is shared with the daily driver (§8) but usable in
  isolation.

One helper picks the best path at runtime:

```ts
async function captureWindow(app: AppFixture, outPath: string): Promise<void> {
  if (app.supportsTier2()) {
    const wid = await app.rpc.call<number>("__test.getWindowId");
    if (wid) return runSync(["screencapture", "-l", String(wid), "-o", outPath]);
  }
  const bounds = await app.getWindowBounds();
  if (bounds) return runSync(["screencapture", "-R", `${bounds.x},${bounds.y},${bounds.w},${bounds.h}`, "-o", outPath]);
  // Last-resort full screen — rare on CI, almost never in dev
  return runSync(["screencapture", "-D", "1", "-o", outPath]);
}
```

### 7.2 Fixture API

```ts
export interface AppFixture {
  /** Capture the app window. Returns the saved PNG path. */
  screenshot(name: string, opts?: ScreenshotOpts): Promise<string>;
  /** Capture + attach to the Playwright report in one call — the common case. */
  snap(name: string, annotate?: Record<string, unknown>): Promise<void>;
}

export interface ScreenshotOpts {
  crop?: "window" | "full-screen";
  annotate?: Record<string, unknown>;
}
```

`snap` does four things in one call:

1. Captures via `screenshot`.
2. Reads the current `__test.readWebviewState` snapshot (or falls
   back to `{ workspaceCount, surfaceCount }` from `rpc.workspace.list`
   when Tier 2 is off).
3. Writes both as one entry in the screenshot index.
4. Attaches to the Playwright report via
   `testInfo.attach("screenshot-<step>", { path, contentType: "image/png" })`.

### 7.3 Output structure

```
test-results/
  screenshots/
    index.json                        — machine-readable registry
    <spec>/<test-slug>/
      01-boot.png
      02-after-split.png
      03-palette-open.png
      failure.png                     — auto on test fail (§7.4)
  design-review/
    index.md                          — rendered markdown report (§7.5)
```

`index.json` entry:

```json
{
  "spec": "keyboard",
  "test": "cmd-shift-p opens palette",
  "step": "palette-open",
  "path": "screenshots/keyboard/cmd-shift-p-opens-palette/03-palette-open.png",
  "timestamp": "2026-04-17T10:12:33.142Z",
  "state": {
    "sidebarVisible": true,
    "paletteVisible": true,
    "focusedSurfaceId": "s1",
    "activeWorkspaceId": "w1"
  },
  "annotate": { "paletteItemCount": 28 }
}
```

### 7.4 Failure capture

`afterEach` hook — when `testInfo.status === "failed"`, always grab
a final `failure.png` even if the test didn't call `snap`
explicitly. Paired with the existing `$HT_CONFIG_DIR` preservation
on failure, this gives both filesystem state + visual state for
postmortem.

### 7.5 Design-review workflow

Tag canonical-state tests with `@design-review`. A separate runner:

```
bun run test:native:design-review
```

filters to those tests, captures their canonical shots, and produces
a markdown report at `test-results/design-review/index.md` that
embeds each image inline:

```markdown
## keyboard — cmd-shift-p opens palette
![palette-open](../screenshots/keyboard/cmd-shift-p-opens-palette/03-palette-open.png)
**state:** palette=true, sidebar=true, workspace=Alpha, focused=s1
**annotations:** paletteItemCount=28
```

Feed that directory to Claude Opus with a prompt like "review for
visual consistency, flag any off-palette color, off-grid element,
or layout drift from prior runs" — Claude reads the images directly
via its multimodal input. The `state` and `annotations` lines give
it enough context to correlate image to intent without reverse-
engineering it from pixels.

Canonical states worth tagging (opinionated starter list):

- `boot-empty` — cold-start, single workspace, no panes split
- `split-2x1` — horizontal split
- `split-2x2` — four panes
- `sidebar-open` / `sidebar-closed`
- `palette-open-empty` / `palette-open-filtered`
- `settings-panel-{general,appearance,theme,effects,network}`
- `process-manager-open`
- `dialog-rename-workspace` / `dialog-rename-surface`
- `browser-surface` / `agent-surface`
- `notification-present` (sidebar badge visible)
- `sideband-panel-{image,svg,html}` (one per renderer)
- `font-size-small` / `font-size-large` (catches layout bugs at
  extremes)
- `fullscreen-surface`

### 7.6 CI integration

- `test-results/screenshots/` uploaded as an artifact on every run
  (zipped — modest size, ~5–10 MB for the full suite).
- On PR runs: *no* baseline comparison by default. Pixel diffs are
  finicky on CI (font smoothing variance, accent color) and would
  burn reviewer time.
- On release tag runs: publish `design-review/index.md` + images as
  a GH Pages artifact for side-by-side review against the prior
  release.
- Optional opt-in: a per-PR label `[screenshot-diff]` that triggers
  a baseline comparison against `main`, reporting diffs inline on
  the PR. Lives behind a label because the noise isn't worth the
  default.

---

## 8. Running alongside a daily-driver HyperTerm

Tests must not interfere with a live HyperTerm Canvas that the
developer is actively using — including Claude Code running as a
shell process inside one of the daily-driver's panes. The isolation
story:

### 8.1 Collision matrix

| Resource | Shared by default? | Mitigation |
| --- | --- | --- |
| Unix socket path | Yes — daily driver's socket lives at `$configDir/hyperterm.sock` | `HT_CONFIG_DIR` relocates all test state to `/tmp/ht-e2e-<worker>`; socket becomes `$HT_CONFIG_DIR/ht.sock` |
| Settings, layout, cookies, browser history | Yes (under `~/Library/Application Support/hyperterm-canvas/`) | Under `HT_CONFIG_DIR` |
| `$HOME` for test-spawned shells | Yes | `HOME=$HT_CONFIG_DIR/home` — throwaway — any `.bash_history` etc writes don't touch the user's |
| Web mirror port | Collides if both try port 3000 | Test picks a random free port and seeds it into the test app's settings before launch |
| macOS bundle identifier (`CFBundleIdentifier`) | **Yes** — same `.app` → same bundle ID | (a) accessory activation policy in `HT_E2E=1` — no Dock icon, no focus steal; (b) optional separate test bundle (§10 item 8) |
| Dock icon / Cmd-Tab entry | Yes without mitigation | Accessory mode |
| Window focus | Yes — launching normally steals focus | Accessory mode + low-`windowLevel` |
| macOS "Recent items" / LaunchServices DB | Yes if bundle shared | Minimal impact; throwaway `$HOME` limits what gets recorded |
| Permissions (Accessibility, Screen Recording) | Shared via bundle ID | Acceptable — tests benefit from the same grants |
| Keychain | Not shared — cookie store is file-based under `configDir` | ✓ already isolated |
| System clipboard (`pbcopy`/`pbpaste`) | Yes | `clipboardFixture` snapshots `pbpaste` in `beforeEach`, restores in `afterEach` |
| `/tmp` sockets from old runs | Possible stale `ht-e2e-*` dirs | Test launcher wipes `$HT_CONFIG_DIR` before spawn |
| Environment variable leaks | No — test launcher builds an explicit env bag | ✓ |
| `ht` CLI run from outside any pane | Reads default `/tmp/hyperterm.sock` by default | `HT_SOCKET_PATH` is set per-app; CLI invocations from inside the test app hit the test socket, from the daily driver hit the daily socket. No cross-traffic. |

### 8.2 Accessory mode under `HT_E2E=1`

When `HT_E2E=1`, the test instance:

- Calls `NSApp.setActivationPolicy(.accessory)` at startup so it
  does not appear in the Dock, does not take focus, and does not
  contribute to Cmd+Tab cycling.
- Sets window level below normal so even if the test app briefly
  gets focus it won't hide the user's windows.
- Skips the startup "install `ht` CLI" prompt (which would
  otherwise nag the test run).
- Opts out of LaunchServices "recent document" registration.
- Skips the macOS first-run bundle sparkle ("`HyperTerm Canvas` is
  an app downloaded from the Internet. Are you sure you want to open
  it?") by setting `com.apple.quarantine` attribute removal on the
  build artifact during `bun run build:stable`.

Implementation lives in the Electrobun bootstrap — a short
conditional in the Obj-C / Zig side, or a call we make via
Electrobun's host API early in `src/bun/index.ts`. If Electrobun
doesn't expose the API, the Zig shim is ~20 lines. This is
**the** key piece — without it, running tests is actively
disruptive to the developer.

### 8.3 Claude Code interaction

Claude Code is a zsh child process inside a pane of the user's
HyperTerm — not a separate app. It has no bundle ID, no window, no
Dock presence. Claude Code sees `HT_SOCKET_PATH` inherited from its
parent shell, which was set by the daily-driver at its launch; any
`ht` command Claude Code runs hits the daily-driver socket — which
is correct.

Test-app shells, by contrast, inherit
`HT_SOCKET_PATH=$HT_CONFIG_DIR/ht.sock`. Nothing crosses.

One subtle point: if Claude Code is the one running the e2e tests
(by invoking `bun run test:native`), the Playwright worker is a
subprocess of Claude Code, which is a subprocess of the
daily-driver's shell. The Playwright worker spawns the test app
with an explicit env bag — `HT_SOCKET_PATH`, `HT_CONFIG_DIR`,
`HOME`, `HT_E2E`, `HYPERTERM_TEST_MODE`, `PATH` — not an inherited
one, so `HT_SOCKET_PATH` leaking from the parent zsh is harmless.
Verified by the fixture: `env` is an allow-listed dict, not
`process.env` passthrough.

### 8.4 Pre-flight check

`spawnApp` before launch:

1. Notice if the daily-driver's socket is present at the default
   path. Log a one-line note ("daily-driver detected at
   `~/Library/…/hyperterm.sock`, test instance isolated via
   `$HT_CONFIG_DIR`"). Do not refuse — we're fully isolated.
2. Remove any stale `$HT_CONFIG_DIR` from a prior failed run.
3. Probe that the chosen web mirror port is actually free.
4. Verify `HT_E2E=1` is set — refuse to launch otherwise (safety
   net against someone accidentally running the e2e fixture against
   their real config).
5. Only then spawn.

### 8.5 Clipboard isolation

System clipboard is genuinely shared — there's no per-app clipboard
on macOS. Tests that touch it (copy/paste shortcuts, clipboard
RPC handlers) must save and restore:

```ts
// tests-e2e-native/clipboard.ts
export async function snapshotClipboard(): Promise<string> {
  const { stdout } = await exec("pbpaste");
  return stdout;
}
export async function restoreClipboard(content: string): Promise<void> {
  const p = Bun.spawn(["pbcopy"], { stdin: "pipe" });
  p.stdin.write(content);
  p.stdin.end();
  await p.exited;
}

// fixture
const prior = await snapshotClipboard();
try { await use(); }
finally { await restoreClipboard(prior); }
```

Run as a `clipboardIsolation` fixture applied to tests tagged
`@clipboard`. Cost: ~50ms per tagged test.

### 8.6 Separate test bundle identifier (optional, M12)

If accessory mode proves insufficient (macOS quirks around shared
bundle state cause cross-run interference that's hard to diagnose),
produce a dedicated test build:

- `scripts/build-test-app.ts` → `.app` with
  `CFBundleIdentifier = com.crazyshell.hyperterm.e2e` and
  `CFBundleName = "HyperTerm E2E"`.
- Separate LaunchServices entry, separate NSUserDefaults domain,
  separate Keychain items. Zero overlap with the user's install.
- CI uses this bundle for `native-packaged` tests; local dev uses
  `bun start` (same bundle, relies on accessory mode + config dir).

Cost: one more build step (~30s). Benefit: belt-and-braces.
Implement only if the first signal of shared-state interference
appears — don't pay for it speculatively.

---

## 9. Shared fixtures

Most specs will want both tiers available. The `app` fixture gains
an optional second namespace when Tier 2 is enabled:

```ts
export interface AppFixture {
  rpc: SocketRpc;              // Tier 1
  ui: WebviewTestRpc;          // Tier 2 — only present if HYPERTERM_TEST_MODE=1
  snap: (name: string, annotate?: Record<string, unknown>) => Promise<void>;  // §7
  screenshot: (name: string, opts?: ScreenshotOpts) => Promise<string>;       // §7
  initialSurfaceId: string;
  // … helpers
}
```

`spawnApp` always sets `HYPERTERM_TEST_MODE=1` for e2e runs;
production builds never see it. Tests opt into Tier-2 helpers by
reading `app.ui`; a missing-at-runtime check throws a clear error
("Tier 2 handlers not registered — is HYPERTERM_TEST_MODE set?").

---

## 10. Small product changes this plan requires

Itemised here so review can accept / reject each separately:

1. **`HT_CONFIG_DIR` env override** in `src/bun/index.ts:52`.
   One-line; zero behavior impact in the default case. (§5.1)
2. **`system.shutdown` RPC method** for graceful teardown. Today the
   socket doesn't expose one; tests fall back to SIGTERM. Implement
   as: close webview, flush settings, exit(0). (§5.2)
3. **`system.ping` RPC method** for readiness check — returns
   `{ pid, uptimeMs }`. Tiny.
4. **`panel.list` RPC method** (or `surface.panels`) — returns the
   webview's current PanelManager panels. Needed for sideband tests
   to assert on panel creation. Read-only.
5. **`HT_E2E` env flag → accessory activation policy.** Boot-time
   hook that calls `NSApp.setActivationPolicy(.accessory)`, sets
   window level low, skips the install-`ht` prompt, skips recent-
   documents registration. Only active when `HT_E2E=1`. **This is
   the single most important change for daily-driver safety** (§8.2).
6. **Tier 2: `__test.*` handler family** behind the two-fact gate
   (§6.1), including `__test.getWindowId` and
   `__test.getWindowBounds` used by the screenshot fallback path
   (§7.1).
7. **(Optional) Separate test bundle identifier** under
   `scripts/build-test-app.ts`. Only implement if shared-bundle
   interference actually bites (§8.6).

All seven are additive. None touch production-critical paths.

---

## 11. Risks & mitigations

- **Electrobun boot time.** `bun start` takes ~1.5–2s on a modern
  Mac before the socket is reachable. Multiplied by N tests this is
  the bulk of wall clock. Mitigations: (a) pool apps within a spec
  file via `describe.serial`, (b) keep the app alive across tests
  that don't need a hermetic boot — `testInfo.config.preserveOutput`
  pattern. Default is one app per test; relax only with explicit
  opt-in.
- **Daily-driver disruption.** Focus theft, Dock pollution, bundle-
  shared state. Covered comprehensively in §8: accessory mode is
  the answer; the optional separate-bundle build is the fallback if
  accessory-only isn't enough.
- **Port collisions** on the web mirror when tests run in parallel.
  Mitigation: `get-port` picks a random free port per worker; write
  it back into the app's settings before boot.
- **Settings migration bugs.** A throwaway `$HT_CONFIG_DIR` has no
  prior settings.json. Tests see the DEFAULT_SETTINGS path. This is
  correct for unit-level isolation but misses migration scenarios.
  Add a `settingsFixture` that seeds specific settings files to
  cover migration paths. Low-priority.
- **CI macOS image drift.** `macos-latest` moves once a year. Pin to
  `macos-14` until a conscious bump.
- **Tier 2 sneaking into prod.** Mitigation: the CI build job runs
  `grep '"__test\\.'` on the bundled JS and fails the build if it
  matches. Belt-and-braces atop the runtime env gate.
- **Screenshot flakes.** `screencapture` occasionally returns an
  empty frame on a freshly-shown window. Mitigation: the `snap`
  helper waits one `requestAnimationFrame` tick (~16ms) after the
  RPC that changed state before capturing; retry once on empty-PNG
  detection.
- **Design-review image volume.** 100 tests × 3 shots × 1 MB each
  = ~300 MB per run. Mitigation: `screencapture -t jpg` for non-
  canonical shots (keep PNG only for `@design-review` tags); zip
  before upload. Review artifact size every quarter.

---

## 12. Out of scope (explicit)

- Pixel-diff regression suite by default (see §7.6 for opt-in).
- Driving the macOS native menu bar / context menus. (The
  `ht-open-context-menu` CustomEvent is driveable via Tier 2
  `__test.dispatchEvent`, but the actual native menu render isn't.)
- Cross-platform (Windows / Linux). Electrobun targets macOS today.
- Performance regression benchmarking. Separate effort, different
  tooling.
- Fuzz testing of sideband parser at e2e level. Covered by
  `tests/parser-fuzz.test.ts` already.

---

## 13. Rollout order

```
┌───────────────────────────────────────────────────────────────┐
│  M1  HT_CONFIG_DIR + HT_E2E accessory mode + typed client     │
│      + spawnApp + smoke                                        │ 0.5d
│  M2  workspace + surface specs                                │ 1.0d
│  M3  pty + metadata specs                                     │ 1.0d
│  M4  browser-pane specs                                       │ 1.0d
│  M5  sideband + script-runner specs                           │ 0.5d
│  M6  screenshot infra (§7) + snap fixture + @design-review    │ 0.5d
│  M7  clipboard isolation + CI wiring + artifact upload        │ 0.5d
├───────────────────────────────────────────────────────────────┤
│  M8  Tier 2 gate + bun handler + webview handler              │
│      + getWindowId/Bounds + smoke                              │ 0.5d
│  M9  keyboard + palette specs                                 │ 0.5d
│  M10 dialogs + settings + search specs                        │ 0.5d
│  M11 build-output assertion                                   │ 0.25d
├───────────────────────────────────────────────────────────────┤
│  M12 (optional) separate test bundle identifier               │ 0.5d
└───────────────────────────────────────────────────────────────┘

Total core: ~6.75 engineering days, ~95 new tests.
Optional M12 on top: +0.5d if/when daily-driver interference bites.
```

Acceptance: full `test:native` green on CI for three consecutive
main builds, no skipped tests, no `.only`. `grep '"__test\\.'`
on the stable bundle returns zero matches. Screenshots attached
on every run. A manual `bun run test:native` while the developer's
daily HyperTerm is open produces zero focus-steal events and zero
modifications to `~/Library/Application Support/hyperterm-canvas/`.

---

## 14. Summary of what this gives us

- Every keyboard shortcut in the app exercised by a test.
- Every workspace / surface / pane mutation round-tripped through a
  real Electrobun webview, not a mock.
- Every chip / metadata field verified against a real subprocess
  tree, not a canned fixture.
- A typed SocketRpc the `ht` CLI and the e2e suite can share.
- A clear line between "production code" and "test scaffolding" via
  the two-fact gate — nothing sneaks into the shipped binary.
- Canonical-state PNG screenshots from every major UI configuration,
  attached to every CI run and feedable to Claude Opus for design
  review without a reviewer needing to run the app.
- Tests that respect the developer's daily HyperTerm Canvas — no
  focus steal, no state collision, no clipboard clobber, safe to
  run while Claude Code is working in another pane.
