---
title: Espaces de travail & panneaux
description: Comment les espaces de travail, les splits et les surfaces se relient — et ce que « surface » signifie réellement.
sidebar:
  order: 2
---

τ-mux organise le travail en **espaces de travail** contenant un arbre binaire de **panneaux**. Chaque panneau héberge une **surface**. Il en existe sept types :

| Type | Porté par | Notes |
|---|---|---|
| `terminal` | un vrai PTY (`Bun.spawn`, `terminal: true`) | le défaut ; le seul type avec un shell |
| `browser` | une webview embarquée | [panneaux navigateur](/fr/features/browser-panes/) |
| `agent` | l'agent pi (`pi --mode rpc`) | [intégration pi](/fr/integrations/pi/) |
| `claude` | une session Claude Code (SDK Agent) | [panneau Claude Code](/fr/features/claude-code-pane/) |
| `telegram` | le service bot Telegram | [pont Telegram](/fr/features/telegram-bridge/) |
| `editor` | CodeMirror | [explorateur & éditeur](/fr/features/file-explorer-and-editor/) |
| `extension` | backend Bun + iframe Vite | [applications d'extension](/fr/features/extensions/) |

Seuls les panneaux `terminal` possèdent un PTY. Tout le reste est une surface
DOM (ou webview) qui vit dans le même arbre de panneaux — d'où leur absence de
l'arbre de processus et le fait que le poller de métadonnées n'a rien à en dire.

## La hiérarchie

```
Workspace
  └── PaneTree (binary tree of splits)
        └── PaneLeaf
              └── Surface (terminal | browser | agent | claude | telegram | editor | extension)
```

- **Espace de travail** — disposition indépendante. Basculez avec `⌘⇧]` / `⌘⇧[` ou sautez directement avec `⌘1…9`.
- **Arbre des panneaux** — un arbre binaire. Chaque nœud interne est un split horizontal ou vertical avec un séparateur déplaçable ; chaque feuille est une surface unique.
- **Surface** — le contenu réel. Une surface a un id stable (`surface:N`) référencé par chaque commande CLI et appel RPC.

## Pourquoi « surface » ?

Un panneau est le rectangle visuel. La surface est le contenu à l'intérieur. La plupart du temps, la distinction n'a pas d'importance — mais lorsque vous glissez un terminal dans un autre panneau, la surface se déplace tandis que le panneau reste. Le CLI et le RPC parlent en ids de surface car ils s'intéressent au contenu, pas à la géométrie.

## Splits

| Action | Raccourci | CLI |
|---|---|---|
| Split à droite | `⌘D` | `ht new-split right` |
| Split en bas | `⌘⇧D` | `ht new-split down` |
| Split à gauche / en haut | (glisser-déposer) | `ht new-split left` / `up` |
| Fermer le panneau | `⌘W` | `ht close-surface` |
| Focaliser un voisin | `⌘⌥←↑→↓` | `ht focus-surface --surface surface:N` |

Les splits se valident en glissant un panneau sur une zone de dépôt, ou via `ht new-split <direction>`. Le ratio de split par défaut est de 50 % ; redimensionnez en glissant le séparateur.

## Glisser-déposer

Glissez l'en-tête d'un panneau dans un autre panneau pour :

- échanger deux panneaux
- fusionner deux panneaux (ferme la source)
- créer un nouveau split dans l'une des quatre zones de bord

La superposition de dépôt affiche la zone cible avant que vous relâchiez. Voir `src/views/terminal/pane-drag.ts` pour la machine à états.

## Les espaces de travail sont indépendants

Chaque espace de travail a son propre :

- arbre des panneaux
- pastilles de statut de la barre latérale
- vue Process Manager (la vue globale agrège entre espaces de travail)
- couleur d'espace de travail (un accent de bordure gauche)

Fermer un espace de travail (`⌘⇧W`) tue également chaque shell qu'il contient. Le surveillant de métadonnées vide les surfaces mortes au tick suivant.

## Persistance

La disposition des espaces de travail et des panneaux est sauvegardée dans `~/Library/Application Support/hyperterm-canvas/settings.json`. Au redémarrage, les surfaces de terminal relancent leurs shells avec le cwd et le shellPath sauvegardés ; les surfaces non-PTY (browser, agent, telegram) se remontent avec leur état sauvegardé.

## En savoir plus

- [Architecture](/fr/concepts/architecture/)
- [Modèle PTY](/fr/concepts/pty-model/)
- [Paramètres](/fr/configuration/settings/)
