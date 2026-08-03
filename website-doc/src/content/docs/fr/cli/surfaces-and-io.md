---
title: Surfaces et I/O
description: split, focus, close, send, send-key, read-screen, screenshot.
sidebar:
  order: 4
---

Cycle de vie des surfaces et I/O — splitter les panneaux, leur donner le focus, envoyer des frappes, lire le tampon visible.

## list-surfaces

```bash
ht list-surfaces
# surface:1  ws:0  ~/code/foo  bun run dev
# surface:2  ws:0  ~/code/bar  zsh
# surface:3  ws:1  ~/code/docs astro dev
```

## new-split

```bash
ht new-split right                 # left | right | up | down
ht new-split right --cwd ~/code/foo
ht new-split down --shell /bin/zsh
```

Crée une nouvelle surface terminal comme split du panneau focalisé (ou ciblé par `--surface`). Options optionnelles :

- `--cwd <path>` — répertoire de travail initial.
- `--shell <path>` — remplace le binaire shell uniquement pour cette surface.
- `--ratio 0.6` — ratio du split.

## rename-surface

```bash
ht rename-surface "build watcher"
ht rename-surface --surface surface:3 "api server"
```

Définit le titre affiché du panneau. Sans `--surface`, renomme le panneau où
vous êtes (`HT_SURFACE`), sinon le panneau focalisé. Un panneau renommé ignore
ensuite les séquences OSC 0/2 : le nom que vous posez tient.

## list-panes

```bash
ht list-panes
```

L'arbre de panneaux de l'espace actif (directions et ratios de split), là où
`list-surfaces` donne une liste plate.

## list-panels

```bash
ht list-panels [--surface S]
```

Les [panneaux canvas](/fr/features/canvas-panels/) ouverts dans une surface.

## list-browsers

```bash
ht list-browsers
```

Chaque [panneau navigateur](/fr/features/browser-panes/) avec son id et son URL.

## editor

```bash
ht edit src/index.ts
ht editor open|split <path> [--split] [--direction right|down] [--create]
ht editor list
ht editor save|reload|close [editor:N]
```

Panneaux [éditeur CodeMirror](/fr/features/file-explorer-and-editor/).

## agent

```bash
ht agent create | create-split | list | count | close --agent <id>
```

Le [panneau d'agent pi](/fr/integrations/pi/). Pour Claude Code, voir
[`ht claude pane`](/fr/cli/claude/).

## run-script

```bash
ht run-script --command "bun run dev" --cwd ~/code/app
```

Exécute une commande comme les boutons de script de la barre latérale — dans un
vrai panneau que vous voyez tourner.

## close-surface

```bash
ht close-surface
ht close-surface --surface surface:3
```

Ferme la surface ciblée (par défaut, celle qui a le focus). Le shell reçoit SIGHUP.

## focus-surface

```bash
ht focus-surface --surface surface:3
```

## wait-ready

```bash
ht wait-ready                                      # attend la surface focalisée
ht wait-ready --surface surface:7                  # cible explicite
ht wait-ready --surface surface:7 --timeout-ms 5000
```

Bloque jusqu'à ce que les métadonnées de la surface ciblée soient observables (le poller 1 Hz a produit son premier snapshot), puis affiche le snapshot. Retourne `null` au timeout. Le timeout par défaut est 2000 ms ; plafonné à 30 000 ms.

À utiliser pour synchroniser de l'automation qui fait la course avec le poll de métadonnées post-spawn — par ex. spawn d'un panneau puis appel immédiat à `ht open`. Les scripts naïfs n'en ont plus besoin : `ht open` et `ht kill` attendent désormais jusqu'à 2 s en interne avant d'échouer. N'utilisez `wait-ready` que si vous voulez fixer le moment exact vous-même.

## send

```bash
ht send "echo hello\n"
ht send --surface surface:3 "ls\n"
```

Envoie du texte brut au PTY de la surface. La chaîne est désechappée avant écriture, donc les séquences suivantes sont interprétées :

| Échappement | Envoyé comme | Utilisation |
|---|---|---|
| `\n` | `\r` (CR) | Soumettre une commande — les terminaux attendent un retour chariot, pas un line feed. |
| `\r` | `\r` (CR) | Identique à `\n` ; forme explicite pour les scripts qui produisent déjà CR. |
| `\t` | `\t` (HT) | Tab — autocomplétion, navigation entre champs. |
| `\x1b` | `\x1b` (ESC) | Échap — sortir du mode insertion vim, fermer un menu. |
| `\\` | `\` | Backslash littéral. |

Tout le reste passe verbatim. Mettez l'argument entre guillemets doubles (ou la forme préférée de votre shell) pour que les backslashes survivent au parsing du shell.

## send-key

```bash
ht send-key enter
ht send-key tab
ht send-key arrow-up
ht send-key ctrl+c
```

Touches symboliques pour les choses qui sont gênantes à échapper. Prend en charge les modificateurs (`shift+`, `ctrl+`, `alt+`, `cmd+`) et les touches nommées (`enter`, `tab`, `escape`, `arrow-up/down/left/right`, `home`, `end`, `page-up/down`, `f1` … `f12`).

## read-screen

```bash
ht read-screen --lines 20
ht read-screen --scrollback true     # include scrollback buffer
ht read-screen --json
```

Lit le tampon visible actuel du terminal. Utile pour les agents qui suivent la sortie de logs ou pour des captures-d'écran-en-texte. Avec `--scrollback true`, inclut tout ce qui est dans le scrollback (jusqu'au paramètre `scrollbackLines`).

## screenshot

```bash
ht screenshot                                   # le panneau focalisé
ht screenshot --surface surface:3               # un panneau précis
ht screenshot workspace                         # tous les panneaux de l'espace actif
ht screenshot workspace ws:2                    # tous les panneaux d'un espace précis
ht screenshot window                            # toute la fenêtre de l'application
ht screenshot workspace --output ~/Desktop/ws.png
```

Capture un PNG, puis le rogne selon l'une de trois cibles :

- **(par défaut)** le panneau focalisé — ou `--surface <id>` / `$HT_SURFACE`.
- **`workspace`** — la boîte englobante de tous les panneaux visibles d'un espace de travail (exclut la barre de titre + la barre latérale). Cible l'espace actif, ou un espace précis via un id en position finale / `--workspace <id>`. Seuls les panneaux de l'espace actif sont visibles à la capture ; un espace en arrière-plan retombe sur la capture de la fenêtre entière.
- **`window`** (ou `--full-window`) — toute la fenêtre de l'application, non rognée (barre de titre + barre latérale). Utile pour les rapports de bug.

Le chemin de sortie est optionnel (`--output` / `-o`) ; s'il est omis, un PNG horodaté atterrit dans le tmpdir système. Le chemin résultant est affiché. macOS uniquement (utilise `screencapture`). Capture le canvas xterm.js rendu plus toute superposition de panneaux.

## Compatibilité tmux

```bash
ht capture-pane --lines 50    # alias for read-screen
```

## Pour aller plus loin

- [Méthodes JSON-RPC surface](/fr/api/surface/)
- [Métadonnées de processus en direct](/fr/features/live-process-metadata/)
