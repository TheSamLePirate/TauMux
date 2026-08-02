---
title: Référence des paramètres
description: Chaque paramètre dans `~/Library/Application Support/hyperterm-canvas/settings.json` — ce qu'il fait et quand il s'applique.
sidebar:
  order: 1
---

τ-mux persiste les paramètres dans `~/Library/Application Support/hyperterm-canvas/settings.json`. Le panneau de paramètres (`⌘,`) écrit ce fichier ; vous pouvez aussi l'éditer à la main — `SettingsManager` surveille le fichier et le recharge à chaque modification.

Schéma : `AppSettings` dans `src/shared/settings.ts`. Valeurs par défaut : `DEFAULT_SETTINGS`. Validation : `validateSettings`.

## Général

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `shellPath` | string | `""` (= `$SHELL`) | Chemin vers le binaire du shell. **S'applique uniquement aux nouvelles surfaces** — les shells existants continuent de tourner. |
| `scrollbackLines` | number | `10000` | Lignes conservées dans le tampon de défilement par surface. |

## Apparence

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `fontFamily` | string | `"JetBrains Mono"` | Police du terminal. Bascule sur la suivante disponible si non installée. |
| `fontSize` | number | `13` | Taille de police en px. |
| `lineHeight` | number | `1.2` | Multiplicateur de hauteur de ligne. |
| `cursorStyle` | enum | `"block"` | `block`, `underline`, `bar`. |
| `cursorBlink` | boolean | `true` | Si le curseur clignote. |
| `copyOnSelect` | boolean | `false` | Copie automatique de la sélection. |

## Thème

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `themePreset` | enum | `"obsidian"` | L'un des 10 préréglages. Voir [Thèmes](/fr/configuration/themes/). |
| `themeOverrides` | object | `{}` | Surcharges par couleur ; fusionnées dans le préréglage choisi. |
| `backgroundOpacity` | number | `1.0` | 0.0–1.0 ; la fenêtre sous-jacente de l'application a un noir uni derrière. |
| `accentColor`, `secondaryColor`, `foregroundColor` | string | (préréglage) | Surcharges rapides pour les couleurs les plus utilisées. |
| `ansiPalette` | object | (préréglage) | Palette ANSI 16 couleurs complète. |

## Effets

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `bloomEnabled` | boolean | `false` | Couche de bloom WebGL au-dessus du terminal. |
| `bloomIntensity` | number | `0.5` | 0.0–1.0. Plus haut = lueur plus brillante. |
| `legacyBloomIntensity` | number | (snapshot) | Capturée automatiquement lors de la migration depuis l'ancien slider de bloom. Alimente le bouton **Restore previous bloom (X.XX)** dans Paramètres → Effets, qui n'apparaît que si vous avez été migré ET que vous n'avez pas encore choisi un `bloomIntensity` non nul depuis. Un clic règle `bloomIntensity` à la valeur capturée et masque le bouton. |

## Réseau (miroir web)

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `autoStartWebMirror` | boolean | `false` | Si le miroir démarre au lancement de l'application. |
| `webMirrorPort` | number | `3000` | Port TCP. **Redémarre** un miroir en cours d'exécution lors d'un changement. |
| `webMirrorBind` | string | `"0.0.0.0"` | Adresse de bind. Mettez `"127.0.0.1"` pour rester local uniquement. **Redémarre** lors d'un changement. |
| `webMirrorAuthToken` | string | `""` | Secret partagé. Vide = pas d'authentification. **Redémarre** lors d'un changement. Depuis la **v0.3.161**, ce paramètre (et `webMirrorBind`) s'applique aussi quand le miroir démarre automatiquement au lancement, et pas seulement lors d'un démarrage manuel. |
| `rpcSocketRequireToken` | boolean | `true` | **Activé par défaut depuis la v0.4.12.** Le socket Unix `ht` exige un jeton propre au boot pour les commandes qui modifient l'état (saisie dans les panneaux, arrêt de processus, installation d'extensions) ; les diagnostics en lecture seule restent ouverts pour que `ht doctor` fonctionne. Le `ht` fourni, les ponts pi/Claude et le SDK d'extensions le présentent automatiquement — rien ne change pour les usages internes ; ne le désactivez que pour un client tiers qui parle directement le protocole socket sans envoyer `__token`. Défense en profondeur, pas une frontière stricte. Paramètres → Réseau → « Exiger un jeton de socket RPC ». *(ajouté v0.3.163 ; défaut inversé v0.4.12)* |
| `terminalRenderer` | `"dom"` \| `"webgl"` | `"dom"` | **Expérimental.** Rendu GPU opt-in pour les panneaux terminal (addon WebGL de xterm.js) avec repli DOM automatique (matériel non supporté, échec d'init, perte de contexte) — le panneau de réglages affiche un indice « running on DOM — raison » en cas de repli. Livré activé en v0.4.9, il rendait des panneaux vides sur certaines configurations ; une migration unique en v0.4.12 remet un `webgl` persisté sur `dom` (le réactiver ensuite tient). Palette : « Use WebGL/DOM Terminal Renderer ». *(ajouté v0.4.9)* |

## Navigateur

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `searchEngine` | enum | `"google"` | `google`, `duckduckgo`, `bing`, `kagi`. |
| `homePage` | string | `"about:blank"` | URL à ouvrir dans les nouveaux panneaux navigateur. |
| `forceDarkMode` | boolean | `false` | Injecte du CSS pour forcer le mode sombre sur les pages. |
| `interceptTerminalLinks` | boolean | `false` | Si vrai, cliquer sur un lien `http(s)://` dans n'importe quel terminal l'ouvre dans un panneau navigateur τ-mux au lieu du navigateur système par défaut. |

## Telegram

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `botToken` | string | `""` | Jeton de BotFather. |
| `accessPolicy` | enum | `"open"` | `open`, `dm-only`, `allowlist`. |
| `allowedChats` | string[] | `[]` | Identifiants de chat autorisés sous `allowlist`. |
| `telegramAllowedUserIds` | string[] | `[]` | Identifiants numériques d'utilisateurs Telegram autorisés à joindre le bot. Depuis la **v0.3.161**, ce paramètre est **vide** par défaut, et une liste vide est **fail-closed** — elle rejette *tous* les messages entrants. Vous devez saisir votre propre identifiant Telegram numérique pour recevoir des messages. |
| `forwardNotifications` | boolean | `false` | Transférer `ht notify` vers Telegram. |
| `forwardChatId` | string | `""` | Chat cible pour les notifications transférées. |

## Avancé

| Champ | Type | Défaut | Effet |
|---|---|---|---|
| `paneGap` | number | `4` | Pixels entre les panneaux split. |
| `sidebarWidth` | number | `260` | Largeur de la barre latérale en px. |
| `notificationSoundEnabled` | boolean | `true` | Jouer un son sur `ht notify --sound`. |
| `notificationSoundVolume` | number | `0.5` | 0.0–1.0. |

## Quand les changements s'appliquent

La plupart des champs s'appliquent en direct dans tous les panneaux à l'instant où ils sont enregistrés. Exceptions :

- `shellPath` — nouvelles surfaces uniquement.
- `webMirrorPort`, `webMirrorBind`, `webMirrorAuthToken` — redémarrent un miroir en cours d'exécution. Depuis la v0.3.161, `webMirrorBind` et `webMirrorAuthToken` prennent aussi effet lors du démarrage automatique au lancement.
- `autoStartWebMirror` — uniquement au lancement (basculez le miroir manuellement à tout moment).
- `rpcSocketRequireToken` — s'applique immédiatement aux nouvelles connexions au socket `ht`.

## Édition du JSON

Sûr à éditer pendant que τ-mux tourne. Le fichier est rechargé à chaque changement. Les champs inconnus sont écartés au chargement avec un avertissement dans le logger.

```bash
$EDITOR ~/Library/Application\ Support/hyperterm-canvas/settings.json
```

## Pour aller plus loin

- [Thèmes](/fr/configuration/themes/)
- [Variables d'environnement](/fr/configuration/env-vars/)
- [Raccourcis clavier](/fr/configuration/keyboard-shortcuts/)
