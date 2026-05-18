---
title: Processus de release
description: Comment couper une release τ-mux — bump de version, génération de changelog, packaging, rollback.
sidebar:
  order: 4
---

τ-mux livre les releases en lançant un petit ensemble de scripts qui propagent une unique chaîne de version à travers sept fichiers, optionnellement commitent + taguent + écrivent `CHANGELOG.md`, puis construisent des artefacts spécifiques à la plateforme. Tout vit dans `scripts/` ; rien dans le pipeline de build ne sort du dépôt.

## Les sept fichiers à version

La chaîne de version dans `package.json` est la **source de vérité**. `scripts/bump-version.ts` la propage à six autres emplacements :

```
package.json
electrobun.config.ts
src/bun/rpc-handlers/system.ts        (retourné par le RPC `system.version`)
website-doc/src/content/docs/cli/system.md      (sortie d'exemple dans `ht version`)
website-doc/src/content/docs/api/system.md      (sortie d'exemple dans le RPC `system.version`)
website-doc/src/content/docs/fr/cli/system.md   (miroir français du précédent)
website-doc/src/content/docs/fr/api/system.md   (miroir français du précédent)
```

Si l'un d'eux dérive, le bump suivant les amènera tous à la nouvelle version — les remplacements regex ciblés sont écrits pour converger.

## Flags de `bump-version`

```bash
bun scripts/bump-version.ts <patch|minor|major|x.y.z> [flags]
```

| Flag | Ce qu'il fait |
|---|---|
| `--commit` | Crée un commit `chore(release): vX.Y.Z` qui ne stage que les sept fichiers à version. Refuse un arbre de travail sale sauf si `--allow-dirty` est aussi passé. |
| `--tag` | Crée un tag annoté `vX.Y.Z` sur HEAD (implique `--commit`). Refuse d'écraser un tag existant. |
| `--changelog` | Génère / étend `CHANGELOG.md` avec une section groupée par conventional-commit (feat / fix / perf / refactor / docs / test / chore / other). Les sections vides sont ignorées. Plage = `$(prev-tag)..HEAD`. |
| `--allow-dirty` | Contourne la vérification d'arbre de travail propre. |
| `--dry-run` | Affiche tout ce qui changerait sans écrire de fichier ni toucher à git. |

Câblé comme scripts npm :

```bash
bun run bump:patch    # 0.3.148 → 0.3.149
bun run bump:minor    # 0.3.148 → 0.4.0
bun run bump:major    # 0.3.148 → 1.0.0
```

## Coupe de release typique

```bash
# 1. (Optionnel) prévisualiser l'entrée de changelog
bun scripts/bump-version.ts patch --dry-run --changelog

# 2. Bump, écrire CHANGELOG.md, commiter et taguer en un seul appel
bun scripts/bump-version.ts patch --changelog --tag

# 3. Construire les artefacts de plateforme
bun run build

# 4. (Optionnel) pousser le tag
git push --follow-tags
```

La forme `--changelog --tag` est le chemin recommandé : le commit résultant (`chore(release): vX.Y.Z`) contient les bumps de fichiers **et** la nouvelle section `CHANGELOG.md`, et le tag annoté pointe dessus.

## Sécurité du rollback

`bump-version` tourne en deux phases. Si quoi que ce soit échoue, il déroule dans l'ordre inverse.

1. **Phase fichier.** Avant toute écriture, le script prend un snapshot du contenu actuel (ou « n'existait pas ») de chaque fichier cible. Si une mise à jour lève — typiquement parce qu'un regex n'a pas matché un fichier édité à la main hors forme — tous les snapshots sont restaurés. `CHANGELOG.md` est **supprimé** plutôt que restauré à vide quand il n'existait pas avant.
2. **Phase git.** Chaque action git post-écriture (commit, tag) pousse une callback de défaite sur une pile LIFO. Si `--tag` échoue après que `--commit` ait réussi, le commit est `reset --soft`'é et le rollback de fichiers tourne aussi. L'utilisateur voit le même état de départ.

L'échec quitte avec le code 3 et une ligne `[bump] ERROR — rolling back: …`.

## Sandboxing pour tests

Pour rendre le script testable unitairement, il honore une variable d'env `BUMP_VERSION_ROOT` qui override le chemin de racine de dépôt sur lequel il opère. Les tests dans `tests/bump-version-flags.test.ts` construisent un tmpdir frais, le sèment avec les sept fichiers à version plus un `git init`, puis invoquent le script avec `BUMP_VERSION_ROOT=<tmpdir>`. 12 tests couvrent les cas heureux, le refus d'arbre sale, le refus de tag dupliqué, le groupage du changelog + skip de sections vides + staging de CHANGELOG.md, et trois scénarios de rollback.

## `CHANGELOG.md` du projet

La racine du dépôt porte un `CHANGELOG.md` peuplé par `bump-version --changelog`. Le format est groupé conventional-commit, par exemple :

```md
## v0.3.148 — 2026-05-18

### Features

- **panel-registry**: per-surface panel cap with oldest-eviction (b4e2e084)
- **workspaces**: strict layout.json validator + truncation recovery (f41f2484)

### Refactoring

- **rpc**: extract bunMessageHandlers into per-domain modules (Cluster F.10 / P7) (e6f3f530)
```

Le [journal des modifications](/fr/changelog/) du site est le récit éditorial ; le `CHANGELOG.md` du projet est l'enregistrement littéral groupé par commits.

## Packaging plateforme — `scripts/post-package.ts`

Tourne après `electrobun build`. Branche selon la plateforme :

| Plateforme | Ce qui se passe |
|---|---|
| **macos** | Patche `CFBundleDisplayName="τ-mux"` dans le `Info.plist` du bundle (Electrobun régénère le plist tard dans son pipeline, donc cette étape est requise pour livrer le joli nom) ; reconstruit `.tar.zst` depuis le `.app/` patché via `tar | zstd -19` ; reconstruit le DMG via `hdiutil` avec une cible glisser-Applications. |
| **linux** | Saute l'étape `Info.plist` (pas d'équivalent sur Linux). Saute l'étape DMG. Reconstruit `.tar.zst` depuis le répertoire de build plat `tau-mux/` (le electrobun Linux émet un répertoire, pas un bundle `.app/`). |
| **other** (Windows, BSD, …) | Log `[post-package] Skipping — no post-package recipe for platform=<x>` et sort 0. |

La reconstruction `.tar.zst` utilise `tar -cf - -C <BUILD_DIR> <APP_DIR_NAME> \| zstd -19 -q -o <TARBALL>` — même pipeline shell sur les deux plateformes supportées ; la seule chose qui branche est le nom de racine d'archive (`tau-mux.app/` sur macOS, `tau-mux/` sur Linux).

## Où sont les tests

| Fichier | Ce qu'il couvre |
|---|---|
| `tests/bump-version-flags.test.ts` | 12 tests — cas heureux + refus d'arbre sale + refus de tag dupliqué + groupage changelog + scénarios de rollback |
| `tests/post-package-platform.test.ts` | 9 tests source-grep — union de plateforme, prédicats de garde pour Info.plist / hdiutil, la pipeline tar réutilise `APP_DIR_NAME`, template BUILD_DIR, skip de plateforme inconnue |
| `tests/ci-coverage-gate.test.ts` | 4 tests source-grep — déclaration du job `coverage-gate` dans `.github/workflows/ci.yml`, lance `test:coverage` puis `report:coverage:check`, runner macOS, timeout posé |

## En lire plus

- `CHANGELOG.md` du projet à la racine du dépôt (généré, groupé conventional-commit).
- [Journal des modifications](/fr/changelog/) — changements éditoriaux visibles par les utilisateurs.
- [Tests](/fr/development/testing/) — comment le garde-fou de couverture en CI fonctionne.
