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

## paste

```bash
ht paste "ligne un\nligne deux\nligne trois"
ht paste --surface surface:3 "$(cat prompt.md)"
```

Mêmes échappements que `send`, mais le texte est livré comme un **collage** et non comme une frappe : lorsque le programme qui tourne dans le panneau a activé le collage entre crochets (`DECSET 2004`), la charge utile est encadrée par `ESC[200~` … `ESC[201~`.

C'est là tout l'intérêt. Les CLI d'agent — Claude Code, pi, et tout ce qui possède un éditeur de prompt multiligne — utilisent le collage entre crochets pour distinguer un bloc collé d'une saisie au clavier. Envoyez un prompt multiligne avec `send` et chaque saut de ligne le soumet : un prompt de cinq lignes devient cinq tours séparés. Envoyez-le avec `paste` et il arrive comme un seul message.

Utilisez `send` pour lancer une commande ; utilisez `paste` pour confier un bloc de texte à ce qui tourne déjà.

Si le programme n'a **pas** activé le collage entre crochets — une simple invite shell, par exemple — `paste` se comporte exactement comme `send`. L'encadrement est la décision de l'application, jamais la nôtre.

Les séquences `ESC[200~` / `ESC[201~` intégrées sont retirées de la charge utile : une chaîne malveillante ne peut donc pas refermer le crochet prématurément et faire exécuter le reste comme des commandes tapées.

## shell-integration

```bash
ht shell-integration status
ht shell-integration install
ht shell-integration uninstall
ht shell-integration install --shell bash    # défaut : $SHELL
```

Ajoute (ou retire) un petit bloc dans `~/.zshrc` / `~/.bashrc` qui fait émettre à votre shell les **marques sémantiques d'invite OSC 133** — « une invite commence ici », « la saisie de l'utilisateur commence ici », « la commande démarre ici », « elle s'est terminée avec le statut N ».

**C'est optionnel et additif.** Le collecteur de métadonnées de τ-mux lit les vrais pid via libSystem : cwd, commande au premier plan, ports, CPU et mémoire fonctionnent dans n'importe quel shell sans aucune configuration. Cela reste la base. Ce que le collecteur ne peut pas savoir, c'est où une commande finit et où la suivante commence, ni ce qu'une commande a retourné — seul le shell le sait. Installer ceci transforme ces inférences en faits, que [`ht blocks`](#blocks) rapporte.

La ligne ajoutée à votre fichier rc source `$HT_SHELL_INTEGRATION_PATH`, une variable que τ-mux exporte dans chaque panneau. Deux conséquences :

- **Cela ne peut pas casser votre shell ailleurs.** Hors de τ-mux la variable n'est pas définie, la garde échoue, et votre fichier rc se comporte exactement comme avant — dans iTerm2, à travers SSH, dans un conteneur CI.
- **Cela survit aux mises à jour.** Le chemin est résolu au lancement du panneau : déplacer ou mettre à jour le `.app` ne laisse rien de périmé.

Votre fichier rc est sauvegardé dans `<fichier>.tau-mux.bak` avant chaque modification.

`status` rapporte deux faits distincts, car ils diffèrent juste après une installation et un utilisateur qui l'ignore conclut que la fonctionnalité est cassée :

```
shell:      zsh
rc file:    /Users/moi/.zshrc (installed)
script:     /Applications/τ-mux.app/…/shareBin/lib/shell-integration.sh
this shell: not emitting marks

Installed but not active in this shell — it has not re-read its
rc file. Open a new pane or run `exec $SHELL -l`.
```

## blocks

```bash
ht blocks                                 # dernière commande terminée, avec sa sortie
ht blocks --no-output                     # …métadonnées seules
ht blocks list --limit 10                 # historique récent, sans sortie
ht blocks list --limit 10 --output        # …avec la sortie
ht blocks current                         # ce qui tourne en ce moment
ht blocks --surface surface:3
```

Rapporte les **blocs de commandes** — ce qui a été exécuté, ce que ça a retourné, combien de temps ça a pris, et ce que ça a affiché :

```json
{
  "integration_detected": true,
  "block": {
    "id": 12,
    "command": "bun test",
    "exit_code": 1,
    "duration_ms": 4200,
    "running": false,
    "output": "…",
    "output_truncated": false
  }
}
```

Nécessite [`ht shell-integration`](#shell-integration). Sans elle, `integration_detected` vaut `false` et la liste est vide — volontairement distinguable de « installée, mais rien n'a encore tourné », pour qu'un script sache lequel des deux problèmes il rencontre.

`exit_code` vaut `null` pendant l'exécution, et également lorsque le shell a signalé la fin d'une commande sans indiquer son statut. Ce n'est pas la même chose que `0`, et ce n'est pas rapporté comme tel.

Les blocs sont plafonnés à 50 par surface ; la sortie capturée à 16 Ko par bloc et 64 Ko par surface, la plus ancienne étant abandonnée en premier. Les métadonnées survivent à la sortie, car c'est ce que la plupart des appelants veulent. Voir [`blocks.*`](/fr/api/blocks/) pour le contrat complet.

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
