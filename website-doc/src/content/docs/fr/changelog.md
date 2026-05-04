---
title: Journal des modifications
description: Changements notables — les plus récents en haut.
sidebar:
  order: 1
---

Cette page résume les changements visibles par les utilisateurs. Le journal complet des commits est sur [GitHub](https://github.com/TheSamLePirate/TauMux/commits/main).

## Non publié

- Lancement du site de documentation (ce site).
- Ask-user (Plan #10) : protocole structuré agent → humain pour poser des questions, avec `ht ask {yesno|choice|text|confirm-command}`. Réponses via une fenêtre modale dans la webview de l'app, via la CLI sœur (`ht ask answer`) ou via les boutons inline / force-reply de Telegram. File FIFO par surface, puce d'attente dans la barre latérale, piste d'audit éditée en place dans Telegram.

## 0.2.82

- pi-extensions/ht-bridge : les résumés label-actif et `agent_end` suivent désormais le modèle vivant de la session pi (auth + base URL synchronisés). Passer pi de Haiku à Sonnet redirige aussi le résumeur sans édition de config. Nouveau flag `useSessionModel` (par défaut `true`) + override d'env `PI_HT_BRIDGE_USE_SESSION_MODEL` ; la paire `provider` / `modelId` existante devient le chemin de repli (fallback).
- claude-integration : nouvelle skill Claude Code `tau-mux` à `claude-integration/skills/tau-mux/SKILL.md`. Reflète le côté *actif* / outils LLM-appelables de `pi-extensions/ht-bridge` (plans → `.claude/plans/<name>.md` revue-gatée via `ht ask choice` puis `ht plan set`, `ht ask {yesno|choice|text|confirm-command}` pour les questions structurées, `ht notify` aux jalons, `ht new-split` + `ht send` pour les processus longs, `ht browser` pour la vérification, `ht screenshot` pour les preuves, `ht set-status` / `ht set-progress` pour les signaux en cours, garde bash-safety). Le pont de hooks d'exécution conserve la responsabilité des pastilles passives (label actif, téléscripteur de coût, idle/permission). `install.sh` installe maintenant les deux pièces ; `SKIP_HOOKS=1` / `SKIP_SKILL=1` pour des installations partielles.

## 0.2.x

- Pont Telegram : panneau de chat, service bot en long-poll, journal SQLite, CLI `ht telegram`, transfert optionnel des notifications.
- Sharebin : déposer-et-partager des fichiers servis par le miroir web.
- Améliorations du panneau navigateur : plus de 40 commandes `ht browser`, barre d'adresse avec détection d'URL intelligente, mode sombre forcé, interception des liens du terminal.
- Gestionnaire de processus : repli/déploiement par surface, puces de port à l'intérieur des lignes, en-tête récapitulatif.
- Métadonnées de processus en direct : état git (branche, ahead/behind, compteurs « dirty ») ajouté à la charge utile par surface, mis en cache avec TTL.
- Miroir web : enveloppes du protocole v2, reprise à la reconnexion via un buffer circulaire de 2 Mo, rejeu d'instantané `@xterm/headless`, comparaison des jetons en temps constant.
- Carte du `package.json` de l'espace de travail avec lancement de script en un clic et points d'état vert/rouge/gris.

## 0.1.x

- Première préversion publique.
- Espaces de travail, splits en mosaïque, séparateurs glissables.
- xterm.js + PTYs `Bun.spawn`.
- Protocole sideband (fd 3/4/5) avec clients Python + TypeScript.
- Panneaux canvas flottants.
- CLI `ht` pour le contrôle via socket.
- Miroir web v1.
