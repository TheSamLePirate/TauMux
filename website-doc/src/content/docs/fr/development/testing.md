---
title: Tests
description: Suites unitaires, e2e, et de rapport de design — ce que chacune couvre et quand les exécuter.
sidebar:
  order: 3
---

τ-mux est livré avec trois suites de tests et un pipeline de rapport de design.

## Unitaire / intégration

```bash
bun test                   # ~9 s, 800+ tests across 50+ files
bun run typecheck
```

Couverture :

- Parseurs `ps` / `lsof` / sideband (tests de fonctions pures, pas de sous-processus).
- Gestionnaire PTY.
- Gestionnaires RPC (chaque domaine).
- Disposition des panneaux (mathématiques de split en arbre binaire).
- Reducer + modules de vue du client web (DOM via `happy-dom`).
- Cycle de vie des notifications de la barre latérale native.
- Sous-modules du panneau d'agent.
- Suite de tests fumée de SurfaceManager.
- Helper de son partagé.
- db / service / paramètres / forwarder Telegram.

`bunfig.toml` cantonne `bun test` brut à `tests/` uniquement — les specs Playwright `tests-e2e/` ne sont pas ramassés.

## E2E web

```bash
bun run test:e2e           # ~1 min, 43 Playwright specs
```

Chaque spec lance un `WebServer` isolé dans un sous-processus Bun via `tests-e2e/server-boot.ts` pour que les workers ne partagent pas d'état. Couverture :

- **Authentification** — accès ouvert, jeton en query string, `Authorization: Bearer`, jeton incorrect 401.
- **Validation d'origine** — upgrade same-host 101, upgrade cross-origin 403 même avec un jeton valide.
- **Round-trip terminal** — le navigateur charge la page, xterm rend, les touches arrivent au shell, stdout apparaît dans le DOM.
- **Résilience** — la limite de taille de stdin ne tue pas la connexion, le clamping de redimensionnement non plus, `?resume=<id>&seq=<n>` rejoue la sortie tamponnée après une déconnexion, les ids de resume inconnus retombent sur un nouveau `hello`.

Playwright cible Chromium uniquement — ajoutez Firefox/WebKit sous `projects:` dans `playwright.config.ts` pour une couverture plus large.

## E2E natif

```bash
bun run test:native              # full native suite
bun run test:native:bloom-on     # with WebGL bloom enabled
bun run test:native:packaged     # against the packaged .app
bun run test:native:design-review
```

Pilote la webview Electrobun directement via le chemin connection-over-CDP de Playwright. Utile pour les régressions visuelles et les tests de gestion de raccourcis que le miroir web ne peut pas attraper.

## Rapport de design

Un pipeline personnalisé qui capture des captures d'écran depuis un ensemble curaté de routes et les compare aux références.

```bash
bun run report:design:web                # web mirror only (fast)
bun run test:full-suite                  # web + native + design gate
bun run baseline:design                  # promote current screenshots to baseline
```

La sortie vit dans `test-results/design-report/index.html`. La forme `--gate` fait échouer la CI si une capture d'écran dépasse le seuil configuré de différence en pixels.

## CI

GitHub Actions (`.github/workflows/ci.yml`) exécute `typecheck + bun test` et `Playwright e2e` à chaque push et PR. Les deux jobs tournent sur `macos-latest` — les tests d'intégration PTY / `ps` / `lsof` reposent sur le comportement macOS, et le boot e2e lance un vrai `WebServer` piloté par un vrai `SessionManager`.

## Quand exécuter quoi

| Changement | Suite |
|---|---|
| Changement de fonction pure / parseur | `bun test` (le fichier pertinent). |
| Gestionnaire RPC / nouvelle méthode | `bun test` + `bun run typecheck`. |
| Changement du serveur miroir web | `bun test` + `bun run test:e2e`. |
| UI webview / interaction xterm | `bun run test:native`. |
| Changement visuel | `bun run report:design:web`, puis promouvoir la baseline une fois satisfait. |
| Avant d'ouvrir une PR | `bun run test:full-suite`. |

## Pour aller plus loin

- [Compilation](/fr/development/building/)
- [Plongée dans l'architecture](/fr/development/architecture/)
- [Contribuer](/fr/development/contributing/)
