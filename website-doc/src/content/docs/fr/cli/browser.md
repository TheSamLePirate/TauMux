---
title: Browser
description: ht browser — plus de 40 commandes pour automatiser les panneaux du navigateur intégré.
sidebar:
  order: 8
---

`ht browser` contrôle les [panneaux du navigateur intégré](/fr/features/browser-panes/). Conçu pour les agents, les scripts CI et les workflows de régression visuelle.

## Niveau supérieur

```bash
ht browser open <url>                 # open in current pane (creates one if needed)
ht browser open-split <url>           # open as a new split
ht browser list                       # list browser surfaces
```

Toutes les autres commandes ciblent une surface de navigateur spécifique :

```bash
ht browser <id> <command> [args]
# example:
ht browser browser:2 navigate https://example.org
ht browser browser:2 click "button[type='submit']"
```

À l'intérieur d'un panneau de navigateur, `HT_SURFACE` est défini automatiquement, vous pouvez donc omettre l'id :

```bash
ht browser navigate https://example.org    # uses HT_SURFACE
```

## Navigation

| Commande | Rôle |
|---|---|
| `navigate <url>` | Va à l'URL. |
| `goto <url>` | Alias pour `navigate`. |
| `back` | Retour dans l'historique. |
| `forward` | Avance dans l'historique. |
| `reload` | Recharge la page. |
| `url` / `get-url` | Affiche l'URL actuelle. |
| `identify` | Id de la surface, titre, URL. |

## Attente

```bash
ht browser browser:1 wait --selector "#dashboard" --timeout-ms 15000
ht browser browser:1 wait --text "Welcome" --timeout-ms 15000
ht browser browser:1 wait --load-state complete
```

Choisissez au plus une option parmi `--selector`, `--text`, `--load-state`. `--timeout-ms` vaut 30000 par défaut.

## Interaction

| Commande | Args | Rôle |
|---|---|---|
| `click <selector>` | | Clic. |
| `dblclick <selector>` | | Double clic. |
| `hover <selector>` | | Survol. |
| `focus <selector>` | | Focus. |
| `check <selector>` / `uncheck <selector>` | | Bascule une case à cocher. |
| `scroll-into-view <selector>` | | Fait défiler l'élément dans le viewport. |
| `type <selector> <text>` | | Saisit du texte dans le champ focalisé. |
| `fill <selector> <text>` | | Définit la valeur. |
| `press <key>` | | Envoie une touche (par ex. `Enter`, `Escape`, `Control+a`). |
| `keydown <key>` / `keyup <key>` | | Événements clavier de plus bas niveau. |
| `select <selector> <value>` | | Sélectionne une `<option>`. |
| `scroll <x> <y>` | | Fait défiler la page. |
| `highlight <selector>` | | Surlignage visuel (debug). |

## Inspection

```bash
ht browser browser:1 snapshot                  # accessibility tree
ht browser browser:1 get title
ht browser browser:1 get url
ht browser browser:1 get text "#welcome"       # textContent of selector
ht browser browser:1 get value "#email"
ht browser browser:1 is visible "#dashboard"
ht browser browser:1 is enabled "button[type='submit']"
ht browser browser:1 is checked "#agree"
```

## Injection

```bash
ht browser browser:1 addscript "console.log('hello')"
ht browser browser:1 addstyle "body { background: red }"
ht browser browser:1 eval "document.title"
ht browser browser:1 eval "await fetch('/api/health').then(r => r.json())"
```

`eval` renvoie le résultat sérialisé en JSON. Les expressions asynchrones sont attendues automatiquement.

## Console / erreurs

```bash
ht browser browser:1 console                   # tail console logs
ht browser browser:1 console --clear           # clear the buffer
ht browser browser:1 errors                    # tail JS errors
ht browser browser:1 errors --clear
```

## Historique

```bash
ht browser browser:1 history                   # list visited URLs (deduped)
ht browser browser:1 history --search "github"
ht browser browser:1 history --clear
```

## Recherche dans la page

```bash
ht browser browser:1 find-in-page "search query"
```

La moitié « annuler » est exposée uniquement en RPC (`browser.stop_find`) — le bouton d'annulation vit dans l'UI du panneau navigateur, pas comme verbe `ht`. Voir [Méthodes RPC sans verbe CLI](/fr/api/system/#méthodes-rpc-sans-verbe-cli).

## Aide

```bash
ht browser help
ht browser --help          # alias
ht browser -h              # alias
```

Imprime le même bloc browser-section que le `ht --help` global, restreint aux sous-commandes browser. Le chemin d'erreur par défaut (`Unknown browser subcommand: …`) renvoie vers cette commande ; elle pointe désormais vers une vraie commande.

## DevTools

```bash
ht browser browser:1 devtools                  # toggle WebKit inspector
```

## Fermer

```bash
ht browser browser:1 close
```

## Pour aller plus loin

- [Panneaux de navigateur](/fr/features/browser-panes/)
- [Méthodes JSON-RPC du navigateur](/fr/api/browser/)
