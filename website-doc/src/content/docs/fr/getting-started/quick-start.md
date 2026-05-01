---
title: Démarrage rapide
description: Votre première session τ-mux — splits, barre latérale, CLI, et un panneau sideband.
sidebar:
  order: 3
---

Cinq minutes pour une session utilisable.

## 1. Lancer et explorer

```bash
bun start                     # depuis le dépôt
# …ou ouvrez le .app depuis /Applications
```

Un seul espace de travail s'ouvre avec un panneau. La barre latérale à gauche affiche la liste des espaces de travail et le statut en direct. L'en-tête du panneau affiche la commande au premier plan et les ports en écoute sous forme de puces.

| Raccourci | Action |
|----------|--------|
| `⌘D` | Split à droite |
| `⌘⇧D` | Split en bas |
| `⌘W` | Fermer le panneau focalisé |
| `⌘⌥←↑→↓` | Focaliser un panneau voisin |
| `⌘⇧P` | Palette de commandes |
| `⌘⌥P` | Process Manager |
| `⌘B` | Basculer la barre latérale |
| `⌘,` | Paramètres |

Référence complète : [Raccourcis clavier](/fr/configuration/keyboard-shortcuts/).

## 2. Lancer quelque chose d'intéressant

Dans n'importe quel panneau :

```bash
cd ~/code/some-project
bun run dev                   # ou npm run dev / cargo run / python -m http.server …
```

En moins d'une seconde :

- La puce de l'en-tête du panneau affiche `bun run dev`.
- Une puce de port apparaît dès que le serveur commence à écouter — cliquez dessus pour l'ouvrir dans un navigateur.
- La carte package.json de la barre latérale affiche le script avec **pulsation verte = en cours d'exécution**.
- `⌘⌥P` ouvre le Process Manager — chaque pid de l'arbre des descendants, avec CPU/MEM et un bouton kill.

## 3. Le piloter depuis un second shell

Dans un autre terminal (ou un autre panneau τ-mux) :

```bash
ht tree                       # espaces de travail / panneaux / surfaces
ht ports                      # PORT PROTO ADDR PID COMMAND
ht open                       # ouvre le port en écoute unique
ht kill 3000                  # SIGTERM le pid lié à :3000
```

Le CLI communique avec τ-mux via `/tmp/hyperterm.sock`. Voir [Aperçu du CLI](/fr/cli/overview/).

## 4. Essayer un panneau sideband

Les canaux sideband permettent aux scripts à l'intérieur du terminal de diffuser du contenu structuré (images, graphiques, HTML interactif) dans des superpositions flottantes. Des scripts de démonstration sont fournis avec le dépôt :

```bash
python3 scripts/demo_dashboard.py     # panneaux CPU + mémoire + horloge
bun scripts/demo_draw.ts              # dessin SVG piloté à la souris
python3 scripts/demo_chart.py         # graphique SVG matplotlib
```

Le protocole est documenté dans [Aperçu sideband](/fr/sideband/overview/). Les bibliothèques clientes sont des no-op en dehors de τ-mux, donc le même script s'exécute sans modification dans un terminal classique.

## 5. Ouvrir le miroir web

Le miroir diffuse l'interface complète via WebSocket. Activez-le dans **Paramètres → Réseau → Auto-start Web Mirror**, puis visitez `http://<your-ip>:3000` depuis n'importe quel appareil sur le LAN. Définissez un jeton d'authentification dans le même panneau si le réseau n'est pas entièrement de confiance.

Plus : [Aperçu du miroir web](/fr/web-mirror/overview/).

## La suite

- [Architecture](/fr/concepts/architecture/) — comment les pièces s'assemblent.
- [Référence du CLI `ht`](/fr/cli/overview/) — chaque commande regroupée par domaine.
- [Protocole sideband](/fr/sideband/overview/) — rendre du contenu structuré depuis des scripts.
- [Paramètres](/fr/configuration/settings/) — chaque réglage, avec ce que chacun fait réellement.
