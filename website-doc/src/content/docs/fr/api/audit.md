---
title: audit.*
description: list, run, fix — les auto-audits intégrés.
---

τ-mux exécute quelques canaris d'environnement au démarrage (locale UTF-8,
`bun` sur le `PATH`, `$SHELL` existant, `git user.name` conforme). Les
résultats alimentent [`system.health`](/fr/api/system/) et la barre latérale.

| Méthode | Params | Résultat |
|---|---|---|
| `audit.list` | `{}` | `AuditResult[]` — chaque audit avec son dernier résultat |
| `audit.run` | `{ id? }` | le `AuditResult` rafraîchi (ou tous sans `id`) |
| `audit.fix` | `{ id }` | le `AuditResult` après tentative de correction |

Tous les audits ne sont pas corrigeables ; `audit.fix` sur l'un d'eux renvoie
son résultat inchangé. Le nom git attendu se configure via
[`auditsGitUserNameExpected`](/fr/configuration/settings/) (`null` désactive
la vérification).

Voir [`ht audit`](/fr/cli/system/).
