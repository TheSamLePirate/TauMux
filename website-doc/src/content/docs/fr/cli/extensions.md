---
title: Extensions
description: ht extension list, templates, open, split, new, install, remove, enable, disable, reload, stop.
sidebar:
  order: 13
---

Gérez les [applications d'extension](/fr/features/extensions/) depuis la CLI. Chaque sous-commande correspond à une [méthode JSON-RPC](/fr/api/extensions/) `extension.*`.

## list

```bash
ht extension list
```

Liste les extensions installées — id, name, version, icon, si un bundle compilé existe, et si l'une d'elles est en cours d'exécution.

## templates

```bash
ht extension templates
```

Noms des templates d'échafaudage embarqués (p. ex. `hello`, `three-demo`, `http-client`) utilisables avec `extension new`.

## open

```bash
ht extension open <id>                  # nouveau panneau dans l'espace de travail actif
ht extension open <id> --split          # splitte le panneau focalisé
ht extension open <id> --direction down # right (défaut) | down
```

Lance une extension dans un nouveau panneau. Le backend démarre, et l'iframe charge l'URL de dev Vite (mode dev) ou le bundle compilé (mode installé).

## split

```bash
ht extension split <id> --direction down
```

Raccourci pour `open <id> --split` avec une direction explicite.

## new

```bash
ht extension new com.you.my-app --template hello
ht extension new com.you.my-app --template three-demo --name "My App"
```

Échafaude une nouvelle extension à partir d'un template embarqué dans `<config>/extensions/<id>/`, en réécrivant l'id du manifeste (et le name, si `--name` est fourni). Utilisez [`ht extension templates`](#templates) pour lister les choix.

## install

```bash
ht extension install /path/to/an-extension-dir
```

Copie un répertoire d'extension externe (contenant un `manifest.json` valide) dans le magasin d'extensions et l'enregistre.

## remove

```bash
ht extension remove <id>
```

Arrête toute surface en cours d'exécution pour l'extension et supprime son dossier.

## enable / disable

```bash
ht extension enable <id>
ht extension disable <id>
```

*(v0.4.12)* Désactiver une extension **arrête toute surface qui
l'exécute** et fait refuser `extension.open` / `extension.split` jusqu'à
sa réactivation. Avant la v0.4.12 le drapeau existait mais n'était
jamais appliqué — une extension « désactivée » se lançait quand même en
silence.

**Note de confiance :** l'installation exécute `bun install` (scripts
postinstall arbitraires inclus) et l'ouverture lance le backend de
l'extension avec un jeton donnant accès à toute la surface de contrôle
`ht`. N'installez que ce que vous enverriez dans un shell — voir le
[modèle de confiance](/fr/features/extensions/). Depuis la v0.4.12, le
repli réseau `bun x` du serveur dev a disparu (un binaire dev manquant
échoue avec « run `bun install` » au lieu d'aller sur le réseau), et les
ports dev sont alloués par instance — le `devPort` du manifest est une
préférence, τ-mux passe au port libre suivant au lieu de charger l'UI
d'un autre serveur dans le panneau.

## reload

```bash
ht extension reload
```

Re-scanne le répertoire des extensions et reconstruit le registre — prend en compte une extension ajoutée ou éditée sur disque sans redémarrer τ-mux.

## stop

```bash
ht extension stop <ext:N>
```

Arrête le backend (et le serveur de dev) d'une surface d'extension précise en cours d'exécution, par id de surface (les ids `ext:` affichés dans `ht list-surfaces`).
