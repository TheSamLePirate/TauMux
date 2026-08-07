---
title: script.*
description: run — exécuter un script package.json / Cargo dans un panneau.
---

Exécute un script de manifest comme le font les boutons de la barre latérale :
un panneau est créé (ou réutilisé) dans l'espace cible et la commande y est
tapée — vous la voyez tourner dans un vrai terminal.

| Méthode | Params | Résultat |
|---|---|---|
| `script.run` | `{ command, cwd?, workspace_id?, script_key? }` | `{ ok: true, scriptKey }` |

- `command` — la commande shell à exécuter.
- `cwd` — dossier d'exécution (défaut : le cwd sélectionné de l'espace).
- `workspace_id` — aussi accepté : `workspace` ; défaut : l'espace actif.
- `script_key` — clé stable pour suivre l'état « ce script tourne » sur la
  carte d'espace. Défaut : la commande.

Le lanceur des scripts `package.json` est
[`packageRunner`](/fr/configuration/settings/).
