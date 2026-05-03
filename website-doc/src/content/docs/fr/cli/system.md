---
title: System
description: ping, version, identify, tree, capabilities.
sidebar:
  order: 2
---

Commandes d'introspection au niveau système. Utiles dans les scripts shell pour vérifier que τ-mux est joignable et énumérer ce qu'il peut faire.

## ping

```bash
ht ping
# PONG
```

Vérifie que le socket est joignable. Sortie 0 en cas de succès ; non-zéro si le socket est absent ou que τ-mux ne répond pas.

## version

```bash
ht version
# tau-mux 0.2.80 (build: …)
```

## identify

```bash
ht identify
# surface:1  workspace:0  cwd=/Users/me/code/foo  fg=bun run dev
```

Rapporte la surface et l'espace de travail focalisés, ainsi que les mêmes métadonnées que `ht metadata` expose — pratique comme sonde d'une ligne « qu'est-ce que je regarde ».

## tree

```bash
ht tree
# Workspace ws:0 "build"
#   Pane (split right)
#     surface:1  ~/code/foo  bun run dev
#     surface:2  ~/code/bar
#   Pane
#     surface:3  ~/code/docs
```

Arbre complet espace de travail / panneau / surface. Utilisez `--json` pour une sortie lisible par machine.

## capabilities

```bash
ht capabilities --json
```

Liste chaque méthode JSON-RPC que le τ-mux en cours d'exécution prend en charge, avec les formes de leurs paramètres. Toujours adapté à `--json`. Utile pour les intégrations de style agent qui veulent découvrir des fonctionnalités à l'exécution.

## Pour aller plus loin

- [Méthodes JSON-RPC system](/fr/api/system/)
- [Vue d'ensemble de `ht`](/fr/cli/overview/)
