---
title: Compilation
description: "bun start, bun dev, bun run build:stable, build:cli — ce que fait chacun."
sidebar:
  order: 1
---

τ-mux est compilé sur Bun + Electrobun. Tout chemin de build passe par `bun` — il n'y a ni Node, ni npm, ni pnpm dans le workflow.

## Au quotidien

```bash
bun install                # dependencies
bun start                  # build + launch once
bun dev                    # build + launch with --watch (rebuilds on src change)
```

`bun start` est le bon défaut — recompilation unique, lancement rapide. `bun dev` maintient un watcher Electrobun en vie pour que les modifications de source se rechargent à chaud.

## Tests

```bash
bun test                   # unit + integration suite (~9 s)
bun run test:e2e           # Playwright web-mirror specs (~1 min)
bun run test:native        # Playwright native-app specs
bun run test:all           # bun test + Playwright web e2e
bun run test:full-suite    # typecheck + bun test + web e2e + native + design report gate
bun run typecheck          # TypeScript only
```

`bunfig.toml` cantonne `bun test` brut à `tests/` pour que les specs Playwright `tests-e2e/` ne soient pas ramassés.

## Linting / vérification de types

```bash
bun run typecheck          # tsc --noEmit
```

Il n'y a pas d'étape de lint séparée — le mode strict de TypeScript attrape la plupart des problèmes. Les directives de design du projet vivent dans `design_guidelines/`.

## Builds de production

```bash
bun run build:dev          # dev .app (no CLI injection — requires stable/canary for `Install in PATH`)
bun run build:canary       # canary .app + DMG
bun run build:stable       # stable .app + DMG with bundled `ht` CLI
bun run package:mac        # stable build + post-package step (DMG, signing, etc.)
```

Un hook Electrobun `postBuild` (`scripts/post-build.ts`) compile `bin/ht` en ciblant l'architecture du build et l'injecte dans le bundle interne avant l'archivage. Donc `Install 'ht' Command in PATH` fonctionne d'emblée sur les builds stable et canary.

## Binaire CLI autonome

```bash
bun run build:cli          # → ./build/ht-cli
```

Un binaire `ht` statique et autosuffisant sans exigence de runtime Bun. Livrez-le sur n'importe quel Mac où τ-mux tourne.

## Bundle du client web

Le client du miroir web vit dans `src/web-client/` et se bundle vers `assets/web-client/client.js` :

```bash
bun run build:web-client                     # readable bundle
bun run build:web-client -- --minify         # production-minified
```

`bun start` et `bun run build:*` exécutent tous deux le bundle du client web avant d'invoquer Electrobun.

## Versionnement

Conformément au CLAUDE.md du projet, exécutez `bun run bump:patch` (ou `:minor` / `:major`) avant de committer. Le script de bump édite `package.json`, la configuration Electrobun, et toutes les références de version épinglées d'un seul coup.

## Logs

Les logs atterrissent dans `~/Library/Logs/tau-mux/app-YYYY-MM-DD.log` — un fichier par jour, rotation par date.

```bash
tail -f ~/Library/Logs/tau-mux/app-$(date +%Y-%m-%d).log
```

Les tests redirigent vers `$HT_CONFIG_DIR/logs` pour garder le vrai répertoire propre.

## Pour aller plus loin

- [Architecture](/fr/concepts/architecture/)
- [Tests](/fr/development/testing/)
- [Contribution](/fr/development/contributing/)
