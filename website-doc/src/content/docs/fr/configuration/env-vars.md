---
title: Variables d'environnement
description: Variables d'environnement que τ-mux lit — à la fois dans les shells lancés et au démarrage de l'application.
sidebar:
  order: 2
---

τ-mux lit les variables d'environnement à deux moments distincts :

1. **Au démarrage de l'application** — celles-ci affectent le processus principal (port du miroir web, répertoire de logs).
2. **À l'intérieur des shells lancés** — celles-ci sont définies automatiquement par τ-mux pour que les scripts et le CLI `ht` les consomment.

## Lues au démarrage de l'application

| Variable | Défaut | Effet |
|---|---|---|
| `HYPERTERM_WEB_PORT` | (non défini) | Surcharge `webMirrorPort` et force le démarrage automatique, indépendamment des paramètres. |
| `HT_SOCKET_PATH` | `/tmp/hyperterm.sock` | Surcharge le chemin du socket Unix. Doit correspondre entre τ-mux et le CLI `ht`. |
| `HYPERTERM_INCLUDE_TEST_HOOKS` | `1` (dev), `0` (stable) | Indique si les méthodes RPC réservées aux tests sont exposées. Mettez à `0` pour les builds de production. |
| `HT_CONFIG_DIR` | `~/Library/Application Support/hyperterm-canvas` | Emplacement de settings.json, telegram.db, sharebin/, logs/. Les tests surchargent cette valeur. |

## Définies automatiquement dans les shells lancés

Celles-ci sont peuplées automatiquement quand τ-mux lance une nouvelle surface de terminal. Les scripts à l'intérieur du shell peuvent les lire.

| Variable | Valeur | Objectif |
|---|---|---|
| `HT_SURFACE` | par ex. `surface:3` | L'identifiant de cette surface. Le CLI le lit comme `--surface` par défaut ; les gestionnaires bun en déduisent l'espace de travail propriétaire pour `ht plan`, `ht set-status`, `ht log`, `ht notify`. |
| `HYPERTERM_PROTOCOL_VERSION` | `1` | Définie sur chaque shell lancé. Les clients sideband l'utilisent comme test « sommes-nous dans τ-mux ? ». |
| `HYPERTERM_CHANNELS` | `{"meta":3,"data":4,"events":5}` | Mappage JSON des canaux pour le protocole sideband. |
| `TERM` | `xterm-256color` | Entrée terminfo standard. |
| `COLORTERM` | `truecolor` | Indique le support des couleurs 24 bits aux TUIs. |

## Lues par le CLI / les clients

| Variable | Effet |
|---|---|
| `HT_SOCKET_PATH` | Surcharge `/tmp/hyperterm.sock`. |
| `HT_SURFACE` | `--surface` par défaut pour les commandes `ht`. |
| `HYPERTERM_DEBUG` | Active les logs de débogage dans les clients sideband Python / TS. |

## Patterns courants

### Forcer le miroir web dans un plist launchd

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>HYPERTERM_WEB_PORT</key>
  <string>3000</string>
</dict>
```

### Socket personnalisé par projet

```bash
export HT_SOCKET_PATH=/tmp/foo.sock
bun start                          # τ-mux uses this
HT_SOCKET_PATH=/tmp/foo.sock ht ping
```

### Désactiver les test hooks pour un build

```bash
HYPERTERM_INCLUDE_TEST_HOOKS=0 bun run build:stable
```

## Pour aller plus loin

- [Paramètres](/fr/configuration/settings/)
- [Aperçu de `ht`](/fr/cli/overview/)
