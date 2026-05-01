---
title: Introduction
description: Ce qu'est τ-mux, ce qu'il n'est pas, et les choix de conception qui le sous-tendent.
sidebar:
  order: 1
---

τ-mux est un émulateur de terminal de bureau qui associe une couche texte PTY traditionnelle avec des superpositions canvas flottantes, un observateur en direct de chaque processus descendant, et un CLI scriptable — le tout construit sur [Electrobun](https://electrobun.dev) + [Bun](https://bun.sh).

C'est un **logiciel à un stade précoce** qui privilégie la performance et la correction au détriment de l'étendue des fonctionnalités.

## Ce que vous obtenez

- **Un terminal qui se comporte comme un vrai terminal.** xterm.js pour le rendu, `Bun.spawn` avec `terminal: true` pour les PTY. Couleurs, applications TUI, édition de ligne, rapport de souris — tout fonctionne simplement.
- **Superpositions canvas flottantes** aux côtés du texte. Les scripts peuvent diffuser du contenu SVG, HTML, des images, et du `canvas2d` via des descripteurs de fichiers supplémentaires et le placer n'importe où dans le panneau.
- **Une vue en direct, multi-panneaux, de chaque processus.** Un surveillant `ps` + `lsof` à 1 Hz expose le cwd, les ports TCP en écoute, le CPU%, le RSS, et l'argv complet pour chaque descendant de chaque shell. Ce pipeline unique alimente les puces des panneaux, la barre latérale, le Process Manager, le miroir web, et le CLI `ht`.
- **Un CLI de premier ordre (`ht`).** Lancez des panneaux, envoyez des touches, ouvrez des ports dans un navigateur, tuez des processus, pilotez un navigateur intégré — tout depuis un shell.
- **Un navigateur intégré.** Divisez un navigateur WebKit aux côtés des terminaux ; entièrement scriptable pour l'automatisation par agents.
- **Un miroir web.** L'interface complète diffusée via WebSocket vers tout appareil sur le LAN.

## Ce qu'il n'est pas

- **Pas un remplacement de tmux.** Il n'y a pas de protocole de multiplexage côté shell. Les espaces de travail et les panneaux vivent dans le processus GUI ; les shells distants diffusent simplement leur PTY à travers.
- **Pas Electron.** Electrobun est un runtime de bureau distinct, beaucoup plus léger, construit sur les WebViews système.
- **Pas React.** La webview est en TypeScript + DOM purs. xterm.js est la seule dépendance significative dans la couche vue.
- **Pas en sandbox.** Le contenu sideband (HTML, SVG) est rendu directement. Les scripts s'exécutant à l'intérieur du terminal sont considérés comme de confiance.

## Choix de conception qui comptent

1. **Le PTY est la source de vérité.** Les panneaux canvas et les puces de métadonnées sont des superpositions éphémères — ils n'affectent jamais l'état du terminal. Si le pipeline de métadonnées plante, le terminal continue de fonctionner.
2. **Le clavier va toujours au terminal.** Les panneaux et les puces sont uniquement à la souris. L'exception : les panneaux navigateur, qui reçoivent l'entrée clavier lorsqu'ils sont focalisés.
3. **Chaque bloc de contenu est son propre élément DOM.** Pas un seul canvas partagé — des panneaux indépendants avec des transformations CSS, déplaçables et redimensionnables.
4. **Les métadonnées ne touchent jamais au PTY.** Le surveillant lit les pids que l'application possède déjà et exécute `ps` / `lsof` à 1 Hz. Pas d'intégration shell, pas de sortie analysée.

## Pour aller plus loin

- [Installation](/fr/getting-started/installation/) — compilez depuis les sources ou installez le binaire fourni.
- [Démarrage rapide](/fr/getting-started/quick-start/) — première session, premier split, premier panneau sideband.
- [Architecture](/fr/concepts/architecture/) — le diagramme, de bout en bout.
