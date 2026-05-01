---
title: Process Manager
description: Superposition plein écran (⌘⌥P) listant chaque processus à travers chaque espace de travail avec CPU, mémoire, et boutons de kill.
sidebar:
  order: 3
---

`⌘⌥P` ouvre le **Process Manager** — une superposition plein écran qui agrège chaque processus dans chaque arbre de descendants de chaque shell, à travers chaque espace de travail.

## Mise en page

```
┌─ Process Manager ────────────────────────── 47 processes · 12.3% CPU · 1.2 G RSS ─┐
│                                                                                    │
│ ▼ Workspace: build                                                                 │
│   ▼ surface:1  ~/code/foo  port chips: :3000 :8080                                 │
│     PID    Command                          CPU%   RSS   [kill]                    │
│     12345 *bun run dev                      4.2%   180M  [kill]                    │ ← * = foreground
│     12346  esbuild                          0.8%    42M  [kill]                    │
│   ▶ surface:2  ~/code/bar                                                          │
│                                                                                    │
│ ▶ Workspace: docs                                                                  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Ce que chaque colonne affiche

| Colonne | Quoi |
|---|---|
| **PID** | Id du processus. La ligne de premier plan est mise en surbrillance avec la couleur d'accent. |
| **Command** | argv complet — `bun run dev`, `python3 -m http.server 8765`, etc. |
| **CPU %** | Instantané depuis `ps %cpu` ; la cellule chauffe vers le rouge via `color-mix`. |
| **Memory** | RSS, formaté en K / M / G. |
| **Action** | Bouton **kill** — SIGTERM par défaut. **Shift+clic pour SIGKILL.** |

Au-dessus de la liste des espaces de travail : un résumé (`N processes · X.X% CPU · Y.Y M RSS`).

## Comment il reste à jour

Le panneau se rafraîchit en place à chaque changement de métadonnées — pas de polling depuis la webview. Chaque émission du [SurfaceMetadataPoller](/fr/features/live-process-metadata/) (1 Hz quand focalisé, ~3 Hz quand masqué) passe par le même pipeline de diff qui pilote les puces de panneau. Si rien n'a changé, pas de re-render.

## D'où viennent les ports

Chaque ligne de surface se réduit pour afficher son cwd et une rangée de puces de port. Les puces sont extraites de l'instantané `lsof -iTCP -sTCP:LISTEN` que le poller exécute une fois par tick — même source que les puces de l'en-tête de panneau. Cliquez sur une puce pour ouvrir `http://localhost:<port>` dans un panneau navigateur.

## Fichiers source

- `src/views/terminal/process-manager.ts` — le panneau de superposition.
- `src/bun/surface-metadata.ts` — le poller (utilisé par le panneau et le CLI).
- `src/bun/rpc-handlers/surface.ts` — `surface.kill_pid`, `surface.kill_port`.

## Pour aller plus loin

- [Métadonnées de processus en direct](/fr/features/live-process-metadata/) — le pipeline sous-jacent.
- [`ht ps` / `ht ports` / `ht kill`](/fr/cli/process-and-ports/)
- [Architecture](/fr/concepts/architecture/)
