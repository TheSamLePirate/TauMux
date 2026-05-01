---
title: Plongée dans l'architecture
description: Pour les contributeurs — agencement des répertoires, frontières de modules, et comment les pièces communiquent.
sidebar:
  order: 2
---

Cette page va plus en profondeur que la doc [Architecture](/fr/concepts/architecture/) côté utilisateur. Si vous contribuez du code, commencez ici.

## Modèle de processus

Deux processus :

1. **Processus principal Bun** (`src/bun/`) — possède les PTYs, parse les canaux sideband, interroge les métadonnées de processus, expose le RPC sur Electrobun + socket Unix + WebSocket.
2. **WebView Electrobun** (`src/views/terminal/`) — rend xterm.js, la barre latérale, le Process Manager, les superpositions canvas, les panneaux navigateur.

Il n'y a pas d'autre serveur, pas de daemon, pas de processus auxiliaire.

## Rôles des répertoires

```
src/
├── bun/                          # Bun main process
│   ├── index.ts                  # BrowserWindow, RPC handlers, socket server, poller wiring
│   ├── session-manager.ts        # Multi-surface PTY manager
│   ├── pty-manager.ts            # Single PTY, Bun.spawn with terminal: true
│   ├── browser-surface-manager.ts # Browser surface state
│   ├── browser-history.ts        # JSON-persisted browser history
│   ├── sideband-parser.ts        # Multi-channel JSONL + binary reader
│   ├── event-writer.ts           # fd 5 JSONL event writer
│   ├── socket-server.ts          # Unix socket JSON-RPC server
│   ├── rpc-handler.ts            # Dispatcher merging per-domain handlers
│   ├── rpc-handlers/             # system / workspace / surface / sidebar / pane / notification / agent / browser-* / telegram
│   │   └── shared.ts             # METHOD_SCHEMAS + validateParams + geometry helpers
│   ├── surface-metadata.ts       # 1 Hz poller + ps/lsof parsers + diff
│   ├── settings-manager.ts       # Load/save with debounced persist
│   ├── web/                      # Web mirror server
│   │   ├── server.ts             # Bun.serve, envelopes, resume, auth
│   │   ├── connection.ts         # SessionBuffer (ring buffer, seq, backpressure)
│   │   └── state-store.ts        # Server-side cache of metadata/panels/sidebar
│   └── native-menus.ts
├── shared/
│   ├── types.ts                  # RPC schema, sideband types, ProcessNode, SurfaceMetadata
│   └── settings.ts               # AppSettings schema + validation + theme presets
├── views/terminal/               # Electrobun webview
│   ├── index.ts                  # RPC handlers + keydown dispatch + CustomEvent wiring
│   ├── surface-manager.ts        # Workspaces, pane layout, xterm + browser instances, chip rendering
│   ├── browser-pane.ts           # <electrobun-webview>, address bar, navigation, preload
│   ├── pane-layout.ts            # Binary tree split computation
│   ├── pane-drag.ts              # Drop-position overlay + commit state machine
│   ├── panel-manager.ts          # Sideband panel lifecycle
│   ├── panel.ts                  # Single panel: drag, resize, render
│   ├── content-renderers.ts      # Extensible content renderer registry
│   ├── sidebar.ts                # Workspaces, status pills, port chips
│   ├── process-manager.ts        # ⌘⌥P overlay
│   ├── settings-panel.ts         # Full settings UI
│   ├── command-palette.ts        # ⌘⇧P fuzzy command search
│   ├── terminal-effects.ts       # WebGL bloom layer
│   └── keyboard-shortcuts.ts     # Bindings array
├── web-client/                   # Web mirror client
│   ├── main.ts                   # Entry; transport + protocol + views
│   ├── store.ts                  # Reducer-driven AppState
│   ├── transport.ts              # WebSocket v2 envelopes, reconnect, resume
│   ├── protocol-dispatcher.ts    # Server-message → store-action dispatch
│   ├── sidebar.ts                # Mirror sidebar render
│   ├── layout.ts                 # Pure computeRects + applyLayout DOM pass
│   └── panel-interaction.ts      # Pointer/drag/resize gesture routing
└── shared/                       # Types shared across both processes
```

## Chemins de code courants

### Ajouter un champ de paramètre

1. Étendez `AppSettings` + `DEFAULT_SETTINGS` + `validateSettings` dans `src/shared/settings.ts`.
2. Ajoutez un renderer dans `src/views/terminal/settings-panel.ts`.
3. Lisez le nouveau champ dans `SurfaceManager.applySettings` (webview uniquement) ou dans le gestionnaire RPC `updateSettings` (côté bun).
4. Optionnellement, ajoutez une entrée de palette de commandes dans `buildPaletteCommands` pour le basculer sans ouvrir le panneau.

### Ajouter une commande CLI / socket

1. Ajoutez la méthode au `src/bun/rpc-handlers/<domain>.ts` correspondant. Elle est fusionnée automatiquement dans la table de dispatch via `createRpcHandler` dans `src/bun/rpc-handler.ts`.
2. Ajoutez un cas dans `bin/ht mapCommand`.
3. Optionnellement, ajoutez un formateur dans `formatOutput` pour la forme lisible par un humain (le chemin `--json` ne nécessite pas de code supplémentaire).

### Ajouter un raccourci clavier

Ajoutez une entrée `Binding<KeyCtx>` à `KEYBOARD_BINDINGS` (ou `HIGH_PRIORITY_BINDINGS`) dans `src/views/terminal/keyboard-shortcuts.ts`. Les champs id / description / category sont récupérés automatiquement par la palette de commandes.

### Ajouter un champ de métadonnées

Voir `doc/system-process-metadata.md` § 7 (référence pour contributeurs).

### Ajouter une puce de barre de panneau

Étendez `renderSurfaceChips` dans `surface-manager.ts` ; ajoutez du CSS dans `index.css`. Suivez les conventions de classes `surface-chip` / `chip-*`.

### Ajouter un type de surface non-PTY

Un type de surface au-delà de terminal / browser / agent / telegram nécessite :

1. D'étendre `PaneLeaf.surfaceType` dans `src/shared/types.ts` et les enregistrements parallèles `surfaceTypes` dans `WorkspaceSnapshot` / `PersistedWorkspace`.
2. D'ajouter `add<Kind>Surface` / `add<Kind>SurfaceAsSplit` / `remove<Kind>Surface` sur `SurfaceManager`.
3. D'apprendre à `applyLayout` à dimensionner le nouveau type (sauter `terminal.fit()`).
4. D'ajouter `surfType === "<kind>"` à la branche `tryRestoreLayout` dans `src/bun/index.ts` pour que les agencements enregistrés soient remontés au lieu de fuir des shells PTY.

Telegram (`src/views/terminal/telegram-pane.ts` + `src/bun/telegram-service.ts`) est l'implémentation de référence la plus petite.

## Contrat RPC

Les trois transports partagent le type de contrat `TauMuxRPC` dans `src/shared/types.ts`. Les gestionnaires côté Electrobun dans `src/bun/index.ts` sont contrôlés par `satisfies BunMessageHandlers`, donc toute nouvelle méthode sans gestionnaire câblé fait échouer la vérification de types — ajouter au contrat vous force à le câbler partout.

## Pour aller plus loin

- [Architecture côté utilisateur](/fr/concepts/architecture/)
- [Compilation](/fr/development/building/)
- [Tests](/fr/development/testing/)
