---
title: Client TypeScript
description: scripts/hyperterm.ts — showImage, showSvg, showHtml, update, clear, onEvent.
sidebar:
  order: 6
---

Le client TypeScript situé dans `scripts/hyperterm.ts` reflète l'API Python. Conçu pour Bun (et Node ≥ 18) — fichier unique, zéro dépendance au-delà du runtime.

## Détection

Même règle que le client Python — les appels `ht.*` sont des no-op sûrs en dehors de τ-mux (variable d'environnement `HYPERTERM_PROTOCOL_VERSION` non définie). Le même script s'exécute sans changement dans un terminal classique.

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

`showImage` accepte :

- Une chaîne de chemin — lue depuis le disque.
- Un `Uint8Array` / `Buffer` — envoyé tel quel.
- Un `Blob` — converti via `arrayBuffer()`.

## Itération asynchrone

`ht.events()` retourne un `AsyncIterable<HtEvent>` :

```typescript
for await (const e of ht.events()) {
  if (e.event === "click" && e.id === btnId) handleClick(e);
}
```

## Spécificités Bun

Lorsqu'il est exécuté sous Bun, le client utilise `Bun.file(fd).stream()` pour les lectures fd 5 — légèrement plus rapide que `fs.createReadStream`.

## Patterns courants

### Tableau de bord auto-actualisé

```typescript
import { ht } from "./hyperterm";

const cpu = ht.showHtml("<div>CPU: ?</div>", { x: 20, y: 20, width: 200, height: 80 });

setInterval(async () => {
  const pct = await readCpuPercent();
  ht.update(cpu, { data: `<div>CPU: ${pct.toFixed(1)}%</div>` });
}, 1000);
```

### Panneau interactif

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

- `scripts/hyperterm.ts` — le client.
- `scripts/README_typescript.md` — référence côté dépôt.

## Pour aller plus loin

- [Vue d'ensemble du sideband](/fr/sideband/overview/)
- [Client Python](/fr/sideband/python-client/)
- [Démos](/fr/sideband/demos/)
