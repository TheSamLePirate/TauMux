---
title: Paramètres
description: Où vivent les paramètres, quand ils s'appliquent en direct vs nécessitent un redémarrage, et la forme du fichier settings.json.
sidebar:
  order: 10
---

Tous les paramètres sont persistés dans `~/Library/Application Support/hyperterm-canvas/settings.json`. Ouvrez le panneau intégré à l'app avec `⌘,`. La plupart des changements s'appliquent en direct — aucun redémarrage nécessaire.

## Sections

| Section | Ce qu'elle couvre |
|---|---|
| **General** | `shellPath` (vide = `$SHELL`), `scrollbackLines`, gestionnaire de paquets. |
| **Appearance** | famille / taille de police, hauteur de ligne, style du curseur, clignotement du curseur, densité. |
| **Theme** | 12 préréglages + remplacements par couleur, opacité de l'arrière-plan du terminal, couleurs accent / secondaire / premier plan, palette ANSI 16 couleurs complète. |
| **Effects** | bascule du bloom du terminal + intensité, son de notification + volume. |
| **Layout** | variante de disposition (Bridge / Cockpit / Atlas), écart entre panneaux, largeur de la barre latérale. |
| **Network** | port du miroir web + auto-démarrage + adresse de bind + jeton d'auth optionnel, exigence de jeton pour le socket RPC. |
| **Browser** | moteur de recherche, page d'accueil, mode sombre forcé, interception des liens du terminal. |
| **Telegram** | jeton du bot + politique d'accès + conversations + transfert de notifications. |
| **Advanced** | moteur de rendu du terminal (GPU / DOM), diagnostics, moteur d'auto-continue. |

Référence complète par champ : [Configuration → Settings](/fr/configuration/settings/).

## Quand les changements s'appliquent

| Paramètre | Comportement |
|---|---|
| `shellPath` | S'applique uniquement aux **nouvelles** surfaces — les shells existants continuent. |
| `webMirrorPort`, `webMirrorBind`, `webMirrorAuthToken` | Redémarre un miroir en cours d'exécution lors du changement. |
| `autoStartWebMirror` | Ne compte qu'au lancement. Le miroir peut toujours être basculé à tout moment ensuite. |
| Theme / appearance / effects | S'appliquent en direct sur tous les panneaux. |
| Jeton de bot Telegram | Re-validation immédiate ; le service de long-poll redémarre en cas de succès. |

## Édition directe du JSON

Vous pouvez éditer `settings.json` pendant que τ-mux tourne — le `SettingsManager` surveille le fichier et recharge à chaque changement. Utile pour les setups scriptés (setups `bun scripts/...`) ou pour synchroniser la configuration entre machines.

Le schéma est appliqué par `validateSettings` dans `src/shared/settings.ts`. Les champs inconnus sont supprimés au chargement avec un avertissement de logger.

## Fichiers source

- `src/shared/settings.ts` — schéma `AppSettings`, `DEFAULT_SETTINGS`, `validateSettings`, préréglages de thèmes.
- `src/bun/settings-manager.ts` — chargement/sauvegarde avec persistance debounced.
- `src/views/terminal/settings-panel.ts` — UI complète.

## Pour aller plus loin

- [Référence des paramètres](/fr/configuration/settings/)
- [Thèmes](/fr/configuration/themes/)
- [Variables d'environnement](/fr/configuration/env-vars/)
