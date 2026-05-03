---
title: shareBin
description: Un dossier d'exécutables fournis (show_md, show_img, show_chart, …) ajoutés en tête du $PATH dans chaque shell. Ils affichent des panneaux sideband plein-volet.
sidebar:
  order: 8
---

`shareBin/` est un dossier de petits exécutables livrés avec τ-mux. Son chemin absolu est **ajouté en tête du `$PATH` de chaque shell que τ-mux ouvre**, donc les scripts fournis (`show_md`, `show_img`, `show_chart`, …) sont accessibles comme commandes nues depuis n'importe quel volet — sans étape d'installation, sans modification de shell-rc, sans wrapper `bun run`.

Chaque script utilise le [protocole sideband](/fr/sideband/overview/) (fd 3/4/5) pour afficher un panneau HTML/SVG plein-volet épinglé au volet hôte. Quand l'utilisateur ferme le panneau — ou envoie SIGINT / SIGTERM — le script se termine.

## Commandes fournies

| Commande | Ce qu'elle fait |
|---|---|
| `show_md <file.md>` | Aperçu markdown en direct. Re-rend à chaque changement de mtime sauf `--no-watch`. |
| `show_img <path>` | Panneau image centré. Conserve le ratio ; plafond 50 Mo. |
| `show_html <file>` | Habille un fragment HTML quelconque dans la chrome de panneau standard. |
| `show_table <csv\|tsv>` | Table HTML triable. Cliquer un en-tête trie asc / desc / restaure. |
| `show_chart <csv>` | Graphique ligne / barre / nuage de points. Re-rendu à chaque redimensionnement. |
| `show_json <file>` | Arbre JSON pliable. `--depth N` règle la profondeur ouverte par défaut. |
| `show_yaml <file>` | YAML → arbre (parseur partiel ; pour du YAML complexe, passez par `yq -o json`). |
| `show_diff <patch>` | Diff unifié côte-à-côte avec compte des hunks et des +/-. |
| `show_gitdiff` | `git diff` du dépôt courant, côte-à-côte. |
| `show_gitlog [path]` | Log git en graphe de branches. `--max N` et `--branches`. |
| `show_qr <text>` | SVG de QR code. `--ec`, `--scale`, `--margin`, `--dark`/`--light`. |
| `show_sysmon` | Moniteur système plein-volet — arc CPU, barres par cœur, RAM, top procs, sparkline. |
| `show_webcam` | Flux MJPEG webcam via ffmpeg + AVFoundation (macOS) / V4L2 (Linux). |
| `demo_status_keys` | Exerce tous les rendus du DSL de status-keys via `ht set-status`. |

La plupart acceptent `<path>` ou stdin (`-` est implicite quand argv est vide), donc ils se composent avec les pipes shell :

```bash
ps aux | show_table --tsv
git diff | show_diff
curl -s api.example.com/data.json | show_json --depth 3
echo "https://example.com" | show_qr --ec H
```

## Comment ça marche

- `src/bun/pty-manager.ts` résout le chemin absolu de `shareBin/` (que l'on tourne depuis un checkout dev ou depuis le `.app` packagé) et le préfixe au `PATH` de chaque `Bun.spawn`. Le dossier est aussi listé sous `build.copy` dans `electrobun.config.ts` pour qu'il soit inclus dans le bundle.
- Chaque script est un exécutable `#!/usr/bin/env bun` (ou `python3`) sans extension — `show_md`, pas `show_md.ts`. Le shebang permet au kernel de les lancer directement via le lookup `PATH`.
- Les scripts importent depuis `shareBin/lib/` (helpers de rendu — `full-screen`, `chart`, `csv`, `markdown`, `json-tree`, `qr`, `git-log`, `diff-render`, `table`, `yaml`) et depuis les clients fournis `hyperterm.ts` / `hyperterm.py`. Ces clients deviennent des no-ops hors de τ-mux, donc le même script tourne aussi depuis un terminal classique.
- Le rendu passe par `lib/full-screen.ts`, qui produit une page HTML stylée Catppuccin et l'épingle au volet hôte. La page se re-rend au redimensionnement, sort proprement à la fermeture, et n'affecte jamais le PTY sous-jacent.

## Ajouter votre propre commande

Déposez un exécutable dans `shareBin/`, marquez-le `+x`, et il devient une commande de première classe dans chaque shell τ-mux. Le guide d'authoring orienté agents — boilerplate, helpers de rendu, positionnement des panneaux, gestion des événements — vit dans [`doc/system-sharebin.md`](https://github.com/TheSamLePirate/TauMux/blob/main/doc/system-sharebin.md). Version courte :

```typescript
#!/usr/bin/env bun
// shareBin/show_widget
import { fullScreenHtml, fullScreenPage, CATPPUCCIN } from "./lib/full-screen";

fullScreenHtml({
  render: () => fullScreenPage({
    tag: { label: "WIDGET", color: CATPPUCCIN.blue },
    title: "hello",
    body: `<p style="padding:24px">…</p>`,
  }),
});
```

```bash
chmod +x shareBin/show_widget
# rebuild / relance τ-mux — `show_widget` est maintenant sur le $PATH de chaque volet
```

## Fichiers source

- `shareBin/` — les scripts eux-mêmes et leurs helpers `lib/`.
- `shareBin/hyperterm.ts` / `shareBin/hyperterm.py` — bibliothèques client sideband.
- `src/bun/pty-manager.ts` — préfixe `PATH` au moment du spawn de shell.
- `electrobun.config.ts` — `build.copy.shareBin` embarque le dossier dans l'app packagée.
- `doc/system-sharebin.md` — guide d'authoring pour de nouvelles commandes.

## Pour aller plus loin

- [Vue d'ensemble du sideband](/fr/sideband/overview/)
- [Client TypeScript](/fr/sideband/typescript-client/)
- [Client Python](/fr/sideband/python-client/)
- [Scripts de démo](/fr/sideband/demos/)
