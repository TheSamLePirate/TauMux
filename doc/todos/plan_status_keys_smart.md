# Plan 02 — Smart status-key system

## Source quotes (`doc/issues_now.md`)

> # HT Status
> - Parse the key and content so:
> - status in sidebar: based on the content length of body, make it a
>   col or a line
>
> - Make `ht set-status` shown on UI have 2 type of status key: normal
>   and starting with `_`. `_key` are not shown on the sidebar but are
>   part of the status bar key.
>
> if a key ends by `_pct`, show it as a percentage (`cpu_pct` becomes
> `cpu` and the content is shown as a percentage — graph: h-bar / v-bar
> / gauge).
>
> Let's build a system to make status key very smart (text, longtext,
> pct, number, dataGraph). For example if key is `cpu_hist_lineGraph`
> and body is `23,55,77,55,44,22,77,88` → `cpu_hist`: linegraph of the
> data.
>
> Make a status key `plan_array` with body
> `[["P1 : look at the code","done"],["P2 : Edit the code","active"],["P3 : Commit","waiting"]]`
> that will show the plan multiline.
>
> - On layout settings for the status bar key, allow the user to input
>   its own key on the system (order, arrange, activate / deactivate).

## Big idea

`ht set-status <key> <value>` today produces a flat string pill. The
user wants the key name to encode rendering intent via suffixes and a
visibility prefix, so any shareBin script (or pi/Claude hook) can paint
expressive content into both the **sidebar workspace card** and the
**bottom status bar** without registering custom renderers.

This is a one-time investment in the status protocol. Once shipped, all
existing scripts (`ht-bridge`, `ht-notify-summary`, demo scripts) get
richer visuals "for free" by renaming a key.

## Current state

- `bin/ht set-status` (`bin/ht:383`) → `sidebar.set_status` RPC.
  Params: `{workspace_id?, surface_id?, key, value, icon?, color?}`.
- `src/views/terminal/status-keys.ts` exposes a static registry
  (`workspace`, `cpu`, `mem`, `git`, …) plus four "ht bridge" keys
  (`ht-status`, `ht-title`, `ht-warning`, `ht-all`) that pull from
  `htStatuses: HtStatusEntry[]` in `StatusContext`.
- `HtStatusEntry` is `{key, value, icon?, color?}` — value is always a
  string.
- Sidebar workspace card renders all entries as flat label/value rows.
- The settings UI lets users pick & order the **registry keys**, not
  the `htStatuses` keys. So today the user cannot reorder bridge entries
  in the bottom bar; they can only toggle whether the catch-all
  `ht-all` appears.

## Design — key-name DSL

A single `ht set-status <key> <value>` produces a `HtStatusEntry`
with five derived fields parsed from the key name:

```
                           hidden? renderer suffix(es)
                                ↓        ↓
   _foo_bar_pct_gauge_warn
   ↑    ↑     ↑        ↑
   |    |     |        semantic colour token (optional)
   |    |     renderer chain
   |    display name (after stripping leading _)
   leading _ → don't render in sidebar card
```

### Parsing rules

1. **Hidden flag** — leading `_` means: do not render in the sidebar
   workspace card. The key is still available to the bottom status bar
   (so a shareBin script can publish a private metric).
2. **Display name** — strip the leading `_`, then split on `_`. The
   *display name* is everything **before the first known renderer
   suffix**. Suffixes are matched right-to-left.
3. **Renderer chain** — known suffixes: `text`, `longtext`, `num`,
   `pct`, `bytes`, `ms`, `bar`, `vbar`, `gauge`, `lineGraph`,
   `sparkline`, `array`, `kv`, `link`, `code`, `md`, `image` (data
   URI), `time` (ISO → "5m ago"), `eta` (epoch ms → countdown).
4. **Semantic suffix** — final token in `ok`/`warn`/`err`/`info` maps
   the entry to a `--tau-*` colour token. Overrides `--color` flag.
5. **Multiple suffixes compose** — `cpu_hist_lineGraph_warn` =
   line graph rendered in warn colour. `tasks_array_md` = array where
   each cell is markdown.

### Body grammar

The renderer dictates how `<value>` is parsed:

| Renderer    | Body grammar                                       | Example                                            |
| ----------- | -------------------------------------------------- | -------------------------------------------------- |
| `text`      | raw string                                         | `building`                                         |
| `longtext`  | raw string, can wrap                               | `compile failed in 3 files: …`                     |
| `num`       | parseable number                                   | `42`                                               |
| `pct`       | `0..100` or `0..1`                                 | `73` or `0.73`                                     |
| `bytes`     | int (bytes)                                        | `1048576` → `1.0 MB`                               |
| `ms`        | int (ms)                                           | `4321` → `4.32 s`                                  |
| `bar`       | `pct` semantics                                    | `60`                                               |
| `vbar`      | comma list of nums (last n samples)                | `1,3,2,5,8,3`                                      |
| `gauge`     | `pct` semantics                                    | `83`                                               |
| `lineGraph` | comma list of nums                                 | `23,55,77,55,44,22,77,88`                          |
| `sparkline` | same as lineGraph but inline-sized                 | `1,2,3,4`                                          |
| `array`     | JSON array of arrays (table rows)                  | `[["P1: look","done"],["P2: edit","active"]]`      |
| `kv`        | JSON object — one row per key                      | `{"branch":"main","ahead":3}`                      |
| `link`      | `<label>\|<url>`                                   | `dashboard\|https://x.com`                         |
| `code`      | raw string, mono font                              | `error: TS2304`                                    |
| `md`        | markdown (small subset: bold, code, links)         | `**done** in \`5s\``                               |
| `image`     | data URI / http URL                                | `data:image/png;base64,…`                          |
| `time`      | ISO 8601 / epoch ms                                | `1700000000000` → `4d ago`                         |
| `eta`       | epoch ms in the future                             | `1700000000000` → `in 12m`                         |

`pct` accepts both 0–100 and 0–1. Heuristic: if the parsed number is
strictly between 0 and 1, multiply by 100. Else clamp 0..100.

### Sidebar layout heuristic

> "based on the content length of body, make it a col or a line"

Rule: in the sidebar workspace card, an entry is rendered as a **row**
(label + value side by side) when the rendered value's pixel width
fits in the card. Otherwise it falls back to a **stacked block** (label
on its own line, value below). Threshold: measure with a hidden span at
init time, or just count chars: `valueText.length * 7 > cardWidth - labelWidth`.

The renderers themselves declare a hint — `inline | block | both` —
since e.g. `lineGraph` is always block; `pct` is always inline; `array`
is always block. Override per-entry via a `--layout block|inline` CLI
flag (last resort).

## Settings UI

Today, `STATUS_KEY_IDS` is a fixed list. The user wants:

> On layout setting for the status bar key, allow the user to input its
> own key on the system (order, arrange, activate/desactivate)

Two sections in the Status Bar settings:

1. **Built-in keys** — existing checkboxes + drag-reorder (already
   present; cf. `AppSettings.statusBarKeys`).
2. **Discovered ht keys** — a live list of every `ht set-status` key
   that has fired since startup, with the same checkbox + reorder UI.
   Selection persists keyed by `key` name. New keys default to
   visible/end.

Discovery: when `sidebar.set_status` runs, push the key name into a
`Set<string>` on the bun side, debounce-broadcast to the webview as
`htKeysSeen` socket-action. The settings panel binds to it.

## Files to touch

- **Protocol parsing** (shared, used by both views):
  - new `src/shared/status-key.ts` — `parseStatusKey(key, value)` →
    `{displayName, hidden, renderers[], semantic?, parsed: any}`.
- **Webview rendering**:
  - `src/views/terminal/status-keys.ts` — replace flat `renderHtEntry`
    with a dispatcher that calls `parseStatusKey` then routes to
    `renderers/text.ts | pct.ts | lineGraph.ts | array.ts | …`.
  - new `src/views/terminal/status-renderers/` directory — one tiny
    file per renderer, all using primitives from `tau-primitives.ts`
    (`Meter`, `Sparkline` if exists else add).
  - `src/views/terminal/sidebar.ts` — workspace-card row rendering
    must call the same dispatcher with layout hint = `block`.
- **Bun side**:
  - `src/bun/rpc-handlers/sidebar.ts` — add `htKeysSeen: Set<string>`
    to app context; broadcast it on change.
  - `src/bun/index.ts` — wire broadcast.
- **Settings**:
  - `src/shared/settings.ts` — add `htStatusKeyOrder: string[]` and
    `htStatusKeyHidden: string[]`.
  - `src/views/terminal/settings-panel.ts` — second list with discovered
    keys + reorder.
- **CLI / docs**:
  - `bin/ht` — extend `set-status` help with the suffix table.
  - `doc/system-rpc-socket.md` — full grammar.
  - new `shareBin/demo_status_keys` — exercises every renderer.

## Tests

- `tests/status-key-parser.test.ts` — table-driven: `_foo_bar_pct_warn`
  → `{hidden:true, displayName:"foo bar", renderers:["pct"], semantic:"warn"}`.
  Cover edge cases (`_` only, no suffix, multiple suffixes, semantic
  vs renderer collision).
- `tests/status-key-renderers.test.ts` — dom-snapshot each renderer.
- `tests/status-key-layout.test.ts` — short value renders inline,
  long value renders block.

## Migration

- Existing `set-status status <v>` keys keep working — `status` /
  `title` / `warning` are the implicit `text` renderer.
- Rename `cpu` → `cpu_pct` in `pi-extensions/ht-notify-summary/`,
  `claude-integration/ht-bridge/` once the new renderers ship.
- Document a "before / after" cheat sheet in `doc/system-rpc-socket.md`.

## Risks / open questions

- The renderer chain is finicky to spec. **Decision**: ship `text`,
  `longtext`, `pct`, `num`, `lineGraph`, `array`, `link`, `time`,
  `eta` in v1. Defer `kv`, `md`, `image`, `bar`, `vbar`, `gauge`,
  `code`, `sparkline`, `bytes`, `ms` to v2 once we've used v1 in anger.
- Performance: a `lineGraph` re-paints every `set-status` call. Cap
  entries with renderer `lineGraph` or `sparkline` to 256 samples.
- Naming clash: `_pct` is already a Python convention. Document the
  meaning explicitly.

## Effort

L — the parser is small, but ~10 renderers × tests + settings UI
revamp + sidebar layout pass. Two-three days end-to-end.
