---
title: Architecture
description: Comment le processus principal Bun, la webview Electrobun et le miroir web s'assemblent.
sidebar:
  order: 1
---

τ-mux exécute trois couches coordonnées :

1. Un **processus principal Bun** qui possède les PTY, analyse les canaux sideband, sonde les métadonnées des processus, et expose le RPC à la fois via Electrobun et via un socket Unix.
2. Une **webview Electrobun** qui rend xterm.js, la barre latérale, le Process Manager, les superpositions canvas, et le panneau navigateur.
3. Un **miroir web optionnel** — un point d'accès HTTP/WebSocket servi par Bun qui diffuse la même interface vers tout appareil sur le LAN.

```
┌──────────────────────────── Bun main process (src/bun/) ────────────────────────────┐
│                                                                                      │
│  SessionManager  ──  N × PtyManager (Bun.spawn with terminal: true)                  │
│                         │                                                            │
│                         │ stdout / stdin / fd3 / fd4 / fd5                           │
│                         ▼                                                            │
│  SidebandParser / EventWriter      SocketServer (/tmp/hyperterm.sock — JSON-RPC)     │
│                         │                     ▲                                       │
│                         │                     │                                       │
│                         ▼                     │                                       │
│                       Electrobun RPC ───┐   ht CLI talks here                         │
│                                          │                                            │
│   ┌────────────── SurfaceMetadataPoller ─┘                                            │
│   │  1 Hz ps + 2 combined lsof calls;                                                 │
│   │  diffed snapshot emits to RPC + web mirror                                        │
│   └───────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  WebServer (Bun.serve + WebSocket — optional; set autoStartWebMirror=true or env)    │
│                                                                                      │
└──────────────────────────────────┬──────────────────────────────────────────────────┘
                                   │ RPC messages
                                   ▼
┌──────────────────── Electrobun webview (src/views/terminal/) ───────────────────────┐
│                                                                                      │
│  SurfaceManager (workspaces + PaneLayout + xterm.js + browser instances)              │
│     ├── per-pane chips row  (fg command, cwd, port badges — click to open)           │
│     ├── Sidebar (workspaces + fg command + port chips + status pills)                │
│     ├── ProcessManagerPanel (⌘⌥P overlay, CPU/MEM, kill)                              │
│     ├── PanelManager (floating canvas overlays)                                       │
│     ├── TerminalEffects (GPU ripple + bloom)                                          │
│     └── CommandPalette (⌘⇧P)                                                          │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Contraintes clés

Elles façonnent chaque décision architecturale du projet.

- **Pas de node-pty.** `Bun.spawn` avec `terminal: true` est la seule API PTY utilisée.
- **Pas de React.** TypeScript + DOM purs dans la webview. xterm.js est la seule dépendance significative de la couche vue.
- **Le clavier va à xterm.js.** Les panneaux et les puces sont uniquement à la souris (les boutons de puces sont focalisables au clavier). Les panneaux navigateur reçoivent l'entrée clavier lorsqu'ils sont focalisés.
- **Chaque bloc de contenu est son propre élément DOM.** Des panneaux indépendants avec des transformations CSS — pas un canvas partagé.
- **Le RPC Electrobun est le pont de la webview. Le RPC socket est le pont du CLI.** Ils partagent un registre de gestionnaires unique fusionné depuis les modules par domaine sous `src/bun/rpc-handlers/`.
- **Les métadonnées ne touchent jamais au PTY.** Le surveillant lit les pids que l'application possède déjà et exécute `ps` / `lsof` — s'il plante, le terminal continue de fonctionner.

## Trois surfaces RPC, un seul registre de gestionnaires

| Surface | Utilisée par | Transport |
|---|---|---|
| Electrobun RPC | La webview Electrobun | IPC via le runtime Electrobun |
| Socket Unix | Le CLI `ht`, scripts, agents | `/tmp/hyperterm.sock`, JSON délimité par retour à la ligne |
| WebSocket | Le client miroir web | Trames encapsulées par session via WS |

Les trois partagent les mêmes implémentations de gestionnaires — ajouter une méthode RPC l'expose automatiquement sur chaque transport. Domaines :

- `system` — ping, version, identify, tree, capabilities.
- `workspace` — list, current, create, select, close, rename, next, previous.
- `surface` — list, split, close, focus, send_text, send_key, read_text, metadata, open_port, kill_port, kill_pid, screenshot.
- `sidebar` — set_status, clear_status, set_progress, clear_progress, log.
- `notification` — create, list, clear, dismiss.
- `pane` — list.
- `browser` — open, navigate, click, fill, wait, snapshot, eval, console_list, errors_list, … (40+ méthodes).
- `telegram` — list_chats, read, send, status, settings.

Voir [Aperçu de l'API JSON-RPC](/fr/api/overview/) pour le catalogue complet des méthodes.

## En savoir plus

- [Espaces de travail & panneaux](/fr/concepts/workspaces-and-panes/)
- [Modèle PTY](/fr/concepts/pty-model/)
- [Aperçu sideband](/fr/concepts/sideband-overview/)
