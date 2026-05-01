---
title: Modèle PTY
description: "Pourquoi τ-mux utilise Bun.spawn avec `terminal: true` et en quoi cela diffère de node-pty."
sidebar:
  order: 3
---

Chaque surface de terminal dans τ-mux est soutenue par un unique processus enfant attaché à un PTY, lancé via l'API native de Bun :

```ts
Bun.spawn([shellPath, "-l"], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  terminal: true,         // mode PTY — requis
  env: { ...process.env, HT_SURFACE: surfaceId, HYPERTERM_PROTOCOL_VERSION: "1", ... },
});
```

`terminal: true` alloue une paire de pseudo-terminaux, attache le stdio de l'enfant au côté esclave, et retourne au parent les flux maître en lecture/écriture. C'est la seule API PTY utilisée dans le code — il n'y a pas de `node-pty`.

## Pourquoi pas node-pty ?

- node-pty nécessite une compilation native par version de Node et par plateforme — hostile à Bun.
- Le support PTY de Bun est intégré au runtime, aucun rebuild natif nécessaire.
- L'API est plus simple : `terminal: true` est un seul booléen plutôt qu'un constructeur avec des réglages locale, cwd, env, cols/rows.

## Redimensionnement

L'instance `xterm.js` de la webview rapporte ses cols/rows au processus principal chaque fois que le panneau est redimensionné. Le processus principal transmet un ioctl `winsize` au maître PTY. xterm voit le redimensionnement, le processus enfant reçoit un `SIGWINCH`, les TUI se redessinent correctement.

## Ce que Bun.spawn ne fait PAS pour nous

- **Descripteurs de fichiers sideband.** Bun.spawn n'expose pas de fds supplémentaires au-delà de stdio. τ-mux ouvre les fd 3, 4 et 5 séparément et les transmet à l'enfant via le tableau `stdio` de `Bun.spawn`. Voir [Aperçu sideband](/fr/concepts/sideband-overview/).
- **Suivi des enfants des enfants.** Un shell peut lancer des descendants arbitraires. Les suivre est le rôle du [SurfaceMetadataPoller](/fr/features/live-process-metadata/), qui exécute `ps` contre la chaîne pid + `ppid` du shell à 1 Hz.
- **Détection du processus au premier plan.** Lorsque le shell lance `bun run dev`, le processus au premier plan n'est plus le shell. Le surveillant lit le groupe de processus au premier plan de `/dev/tty<N>` pour trouver le véritable processus en premier plan.

## Cycle de vie

| Événement | Ce qui se passe |
|---|---|
| Surface créée | `Bun.spawn` s'exécute, le fd maître est connecté à xterm, l'env est peuplé avec `HT_SURFACE`. |
| Le shell se termine proprement | La surface reste ouverte en affichant le message de sortie. Relancez avec `ht send "<command>"` ou fermez. |
| Surface fermée | `SessionManager.onSurfaceClosed` se déclenche ; le maître PTY se ferme ; le surveillant de métadonnées vide le cache au tick suivant. |
| Espace de travail fermé | Toutes les surfaces de l'espace de travail se ferment en séquence. |
| App quittée | Chaque shell reçoit un SIGHUP ; `Bun.spawn` nettoie les fds maîtres. |

## Mise en tampon de la sortie

Le stdout du PTY est transféré à la webview avec une granularité de 16 ms (une frame à 60 Hz) — la fusion réduit le bavardage RPC sans retarder visiblement la frappe. Le miroir web utilise la même couche de fusion, plus un tampon circulaire de 2 Mo par session afin que les clients qui se reconnectent puissent rejouer la sortie manquée.

## Fichiers source

- `src/bun/session-manager.ts` — propriétaire multi-surfaces, callbacks pour onSurfaceClosed.
- `src/bun/pty-manager.ts` — PTY unique : spawn, flux stdin/stdout, ouverture des fd sideband.
- `src/shared/types.ts` — `SurfaceMetadata`, contrat RPC.

## En savoir plus

- [Espaces de travail & panneaux](/fr/concepts/workspaces-and-panes/)
- [Métadonnées de processus en direct](/fr/features/live-process-metadata/)
- [Aperçu sideband](/fr/concepts/sideband-overview/)
