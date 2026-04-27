---
title: TypeScript client
description: scripts/hyperterm.ts — showImage, showSvg, showHtml, update, clear, onEvent.
sidebar:
  order: 6
---

The TypeScript client at `scripts/hyperterm.ts` mirrors the Python API. Built for Bun (and Node ≥ 18) — single file, zero dependencies beyond the runtime.

## Detection

Same rule as the Python client — `ht.*` calls are safe no-ops outside τ-mux (`HYPERTERM_PROTOCOL_VERSION` env var unset). Same script runs unchanged in a normal terminal.

## API

```typescript
import { ht } from "./hyperterm";

// Create
const id = ht.showImage("photo.png", { x: 100, y: 50, draggable: true });
const svgId = ht.showSvg("<svg>…</svg>", { x: 200, y: 200 });
const widgetId = ht.showHtml('<button>Click</button>', { interactive: true });
const canvasId = ht.showCanvas2d(buffer, { x: 0, y: 0, width: 400, height: 300 });

// Mutate
ht.update(id, { x: 200, y: 300 });
ht.update(id, { width: 600, opacity: 0.8 });

// Remove
ht.clear(id);

// Events
ht.onEvent((e) => {
  console.log(e);        // { id, event, x?, y?, … }
});
```

`showImage` accepts:

- A path string — read from disk.
- A `Uint8Array` / `Buffer` — sent as-is.
- A `Blob` — converted via `arrayBuffer()`.

## Async iteration

`ht.events()` returns an `AsyncIterable<HtEvent>`:

```typescript
for await (const e of ht.events()) {
  if (e.event === "click" && e.id === btnId) handleClick(e);
}
```

## Bun-specific bits

When run under Bun the client uses `Bun.file(fd).stream()` for fd 5 reads — slightly faster than `fs.createReadStream`.

## Common patterns

### Self-updating dashboard

```typescript
import { ht } from "./hyperterm";

const cpu = ht.showHtml("<div>CPU: ?</div>", { x: 20, y: 20, width: 200, height: 80 });

setInterval(async () => {
  const pct = await readCpuPercent();
  ht.update(cpu, { data: `<div>CPU: ${pct.toFixed(1)}%</div>` });
}, 1000);
```

### Interactive panel

```typescript
import { ht } from "./hyperterm";

const btn = ht.showHtml(
  '<button id="b">Run tests</button>',
  { x: 20, y: 20, width: 200, height: 60, interactive: true },
);

ht.onEvent(async (e) => {
  if (e.id === btn && e.event === "click") {
    await runTests();
    ht.update(btn, { data: "<div>Done.</div>" });
  }
});
```

## Source

- `scripts/hyperterm.ts` — the client.
- `scripts/README_typescript.md` — repo-side reference.

## Read more

- [Sideband overview](/sideband/overview/)
- [Python client](/sideband/python-client/)
- [Demos](/sideband/demos/)
