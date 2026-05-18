---
title: Observabilité
description: Logging, gates CI, scripts d'audit — comment voir ce que τ-mux fait.
sidebar:
  order: 5
---

τ-mux est lancé depuis Finder / Dock aussi souvent que depuis un terminal, donc la sortie `console.log` qui disparaîtrait dans le `/dev/null` de `launchd` laisserait de gros trous dans n'importe quelle post-mortem. Le pipeline d'observabilité attrape la sortie partout où elle pourrait aller, la persiste durablement, et ajoute des gates CI pour empêcher les régressions de débarquer en silence sur `main`.

## Fichiers de log persistants (`src/bun/logger.ts`)

`setupLogging(configDir)` enveloppe `process.stdout.write` + `process.stderr.write` et chaque méthode `console.{log,error,warn,info,debug}` pour qu'une copie de tout atterrisse dans un fichier sur disque. La sortie TTY originale est intacte — lancer τ-mux depuis un terminal affiche toujours la sortie bun en direct ; le fichier ne fait que capturer les mêmes octets pour plus tard.

### Où les fichiers atterrissent

- **Production** (pas de `HT_CONFIG_DIR`) : `~/Library/Logs/tau-mux/app-YYYY-MM-DD.log` — l'emplacement standard macOS pour les logs utilisateur, visible dans Console.app sous « Log Reports ».
- **End-to-end / dev** (`HT_CONFIG_DIR` positionné) : `$HT_CONFIG_DIR/logs/app-YYYY-MM-DD.log` — garde `~/Library/Logs` propre à travers des centaines de runs de tests.

### Rotation par date

Un fichier par jour calendaire UTC, nommé `app-YYYY-MM-DD.log`. À la première écriture après minuit UTC, le logger ré-ouvre avec le nouveau nom de fichier — pas de timer en arrière-plan. Les fichiers plus vieux que 14 jours sont purgés au boot, en correspondance avec le glob `app-*.log` (donc un fichier placé par l'utilisateur dans le répertoire est laissé tranquille).

### Rotation par taille (depuis 0.3.145)

Une seule session multi-jours avec un sous-système bavard (bruit PTY, flux d'agent, démos sideband) pouvait gonfler `app-DATE.log` à plusieurs Gio. Pour borner ça, le logger rote aussi par taille :

- Quand le fichier actif dépasse `HT_LOG_MAX_BYTES` (par défaut **50 Mio**) il est renommé `app-DATE.<n>.log` (prochain index disponible 1, 2, 3, …) et un nouveau `app-DATE.log` est ouvert.
- `tail -f app-DATE.log` suit toujours le morceau le plus récent ; les morceaux numérotés forment l'archive.
- À l'ouverture, `fstatSync` amorce le compteur d'octets depuis la taille existante — un redémarrage le même jour reprend là où le run précédent s'est arrêté plutôt que de recompter depuis zéro.
- `HT_LOG_MAX_BYTES=0` (ou toute valeur ≤ 0) désactive la rotation par taille. La rotation par date s'applique toujours.
- Le motif de purge à 14 jours couvre aussi les variantes numérotées — les fichiers `app-DATE.<n>.log` sont supprimés aux côtés du morceau actif quand ils vieillissent.

### Politique d'échec

Tout ce qui touche au FS est enveloppé dans `try/catch`. Un home en lecture-seule, un disque plein, ou un problème de permission ne doit **pas** empêcher l'app de démarrer, donc le logger retombe silencieusement sur « pas de tee fichier » et laisse le chemin TTY continuer comme avant.

### Mode de fichier

Le log peut transporter des tokens de bot et des URLs de handshake d'auth, donc les fichiers sont en `chmod 0o600` après ouverture. Le chmod tourne même si le fichier pré-existait (une version précédente a pu être livrée avec des permissions plus laxes).

## Garde-fou de couverture en CI (`.github/workflows/ci.yml`)

La CI du dépôt lance deux jobs en parallèle :

| Job | Ce qu'il fait |
|---|---|
| **typecheck-and-unit** | `bun run typecheck` puis `bun test` sur macOS-14. |
| **coverage-gate** | `bun run test:coverage` puis `bun run report:coverage:check` sur macOS-14. |

Le garde-fou de couverture compare le `coverage/lcov.info` fraîchement généré contre `tests/baselines/coverage-baseline.lcov` par-fichier. Si le ratio lignes-couvertes d'un fichier baisse au-delà d'une tolérance de 0,5 pp (pour absorber le bruit d'arrondi flottant), le job sort non-zéro et la PR est bloquée.

Pour **abaisser intentionnellement le plancher** — par exemple après avoir supprimé du code fortement couvert — lancer `bun run baseline:coverage` en local et commiter la nouvelle baseline. La promotion est la seule façon d'abaisser le plancher, et la promotion passe par une code review.

La comparaison par-fichier (plutôt qu'overall) a été un choix délibéré : un seuil overall peut cacher des régressions à l'intérieur d'une moyenne « couverte assez », où la longue queue des petits modules glisse silencieusement sous la barre.

## Audit CSS (`audit:theming`)

```bash
bun run audit:theming
```

Scanne `src/views/terminal/index.css` et `src/web-client/client.css` pour les littéraux de couleur en dur hors du bloc de tokens `:root`. La Phase 7 a fait passer le compte de ~1013 à **zéro** — chaque littéral est désormais une référence `var(--ht-*)`. Le script garde le cluster propre en échouant sur tout nouveau littéral hex / rgba / rgb qu'une future PR ré-introduirait.

Voir la [référence des tokens de thème](/fr/configuration/themes/) pour le vocabulaire `--ht-*` complet.

## Audit du halo de focus (`tau-focus-audit`)

Guideline de design §4 : **« le pane focalisé est le seul élément de l'UI avec un halo. »** Un module `tau-focus-audit.ts` marche chaque élément de chrome et reporte tout `box-shadow` dont le blur ≥ 4 px, l'alpha > 0,02, et la couleur n'est pas l'ombre d'élévation quasi-noire par défaut — tout ce qui survit à ces filtres est une fuite de halo chromatique.

Depuis 0.3.144, l'audit est câblé dans `bun test` via une suite happy-dom (`tests/tau-focus-audit.test.ts`, 10 tests). Une fuite de halo dans le CSS de chrome fait désormais échouer le build au lieu d'attendre qu'on ouvre DevTools et qu'on lance `window.tauAuditFocus()` à la main.

Le hook `window.tauAuditFocus()` est préservé pour usage DevTools / REPL — il pretty-print le résultat de l'audit dans un groupe collapsable coloré.

## Registre de santé

Le processus bun enregistre un registre « santé » d'exécution qui agrège des audits (locale, bun-on-path, shell-exists, pont telegram, miroir web, …). Chaque audit reporte `ok` / `warn` / `error` et une remédiation `fix()` optionnelle. Les trouvailles du registre sont affichées dans le panneau Settings → Advanced et joignables via le RPC `system.health`.

## `CHANGELOG.md` du projet

Généré à la racine du dépôt par `bump-version --changelog`. Groupé conventional-commit (feat / fix / perf / refactor / docs / test / chore / other). La page [Journal des modifications](/fr/changelog/) du site est le récit éditorial ; le fichier du dépôt est l'enregistrement littéral groupé par commits.

## En lire plus

- [Processus de release](/fr/development/release-process/) — bump de version, packaging, rollback.
- [Tests](/fr/development/testing/) — disposition de la suite de tests, cibles de couverture.
- [Référence des tokens de thème](/fr/configuration/themes/) — le vocabulaire `--ht-*` que `audit:theming` garde.
