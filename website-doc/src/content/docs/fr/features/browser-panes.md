---
title: Panneaux navigateur
description: Panneaux navigateur WebKit intégrés qui partagent les espaces de travail avec les terminaux — et une API scriptable de plus de 40 commandes pour les agents.
sidebar:
  order: 2
---

Un panneau navigateur est une véritable instance WebKit hébergée comme `<electrobun-webview>` à l'intérieur d'un panneau τ-mux. Il s'inscrit dans la même mise en page en mosaïque que les panneaux terminal — glissez-le, splittez-le, fermez-le comme n'importe quelle autre surface.

## En ouvrir un

| Action | Raccourci | CLI |
|---|---|---|
| Ouvrir dans un nouveau split | `⌘⇧L` | `ht browser open-split <url>` |
| Ouvrir dans le panneau focalisé | (palette) | `ht browser open <url>` |
| Focaliser la barre d'adresse | `⌘L` | — |
| Précédent / suivant | `⌘[` / `⌘]` | `ht browser <id> back` / `forward` |
| Recharger | `⌘R` | `ht browser <id> reload` |
| DevTools | `⌥⌘I` | `ht browser <id> devtools` |
| Rechercher dans la page | `⌘F` | — |

## Points forts

- **Barre d'adresse avec détection d'URL intelligente.** Tapez `localhost:3000`, `github.com/x/y`, ou une requête de recherche — la barre résout correctement.
- **Intégration de moteurs de recherche.** Google, DuckDuckGo, Bing, Kagi. Configurez dans **Settings → Browser**.
- **Partage de cookies.** Tous les panneaux navigateur partagent la même session WebKit.
- **Persistance de session.** Les URL sont sauvegardées et restaurées au redémarrage de l'app.
- **Forcer le mode sombre.** Optionnel, dans **Settings → Browser**.
- **Interception des liens depuis le terminal.** Lorsque activé, cliquer sur un lien `http(s)://` dans n'importe quel terminal l'ouvre dans un panneau navigateur τ-mux plutôt que dans votre navigateur par défaut.

## Automatisation du navigateur

Le groupe de commandes `ht browser` expose plus de 40 commandes scriptables — conçues pour les agents et les scripts CI.

```bash
# Navigate, wait, inspect
ht browser open https://example.com/login
ht browser browser:1 wait --load-state complete --timeout-ms 15000
ht browser browser:1 snapshot                 # accessibility tree
ht browser browser:1 get title

# Fill a form
ht browser browser:1 fill "#email" "ops@example.com"
ht browser browser:1 fill "#password" "$PASSWORD"
ht browser browser:1 click "button[type='submit']"
ht browser browser:1 wait --text "Welcome"
ht browser browser:1 is visible "#dashboard"

# Inject code
ht browser browser:1 addscript "console.log('hello')"
ht browser browser:1 addstyle "body { font-size: 20px }"

# Debug
ht browser browser:1 console                  # page console logs
ht browser browser:1 errors                   # page JS errors
```

Catalogue complet des commandes : [`ht browser`](/fr/cli/browser/).

## Matrice des capacités

| Capacité | Statut |
|---|---|
| Naviguer, précédent/suivant, recharger | ✅ |
| Click, dblclick, hover, focus, check/uncheck | ✅ |
| Type, fill, press, select | ✅ |
| Scroll, scroll-into-view, highlight | ✅ |
| Attendre selector / texte / load-state | ✅ |
| Snapshot (arbre d'accessibilité) | ✅ |
| Eval JS arbitraire | ✅ |
| Add script / style à document-start | ✅ |
| Find / stop find | ✅ |
| Capture console + erreurs | ✅ |
| Historique (recherche, dédup, effacement) | ✅ |
| Plusieurs panneaux navigateur | ✅ |
| Onglets dans un seul panneau | ❌ (chaque panneau est un onglet) |
| Inspection d'iframes cross-origin | ⚠ dépend de WebKit |

## Fichiers source

- `src/views/terminal/browser-pane.ts` — `<electrobun-webview>`, barre d'adresse, navigation, preload.
- `src/views/terminal/browser-events.ts` — pont CustomEvent `ht-browser-*` → RPC.
- `src/bun/browser-surface-manager.ts` — état URL, titre, zoom, console, erreurs.
- `src/bun/browser-history.ts` — historique persisté en JSON avec recherche + dédup.
- `src/bun/rpc-handlers/browser-*.ts` — gestionnaires des méthodes RPC `browser.*`.

## Pour aller plus loin

- [CLI `ht browser`](/fr/cli/browser/)
- [Méthodes API Browser](/fr/api/browser/)
- [Settings: Browser](/fr/configuration/settings/)
