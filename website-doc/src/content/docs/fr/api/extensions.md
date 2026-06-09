---
title: extension.*
description: list, templates, open, split, new, install, remove, reload, stop — le côté hôte de la plateforme d'applications d'extension.
sidebar:
  order: 11
---

Le côté hôte de la [plateforme d'applications d'extension](/fr/features/extensions/). Ces méthodes sous-tendent la CLI [`ht extension`](/fr/cli/extensions/) et les entrées de la palette de commandes. Elles constituent la surface de *gestion* — le backend/frontend d'une extension pilote le reste de τ-mux via le [`@tau-mux/sdk`](/fr/features/extensions/#le-tau-muxsdk), qui appelle les méthodes habituelles [`surface.*`](/fr/api/surface/), [`notification.*`](/fr/api/notification/), [`sidebar.*`](/fr/api/sidebar/), [`workspace.*`](/fr/api/workspace/) et [`browser.*`](/fr/api/browser/).

## Registre

| Méthode | Params | Résultat |
|---|---|---|
| `extension.list` | `{}` | `[{ id, name, version, icon, description, enabled, hasBuild, running, path }]` |
| `extension.templates` | `{}` | `string[]` — noms des templates d'échafaudage embarqués |
| `extension.reload` | `{}` | `"OK"` — re-scanne le répertoire des extensions + reconstruit le registre |

## Surfaces

| Méthode | Params | Résultat |
|---|---|---|
| `extension.open` | `{ id: string, split?: boolean, direction?: "right"\|"down" }` | `"OK"` |
| `extension.split` | `{ id: string, direction?: "right"\|"down" }` | `"OK"` |
| `extension.stop` | `{ surface_id: string }` | `"OK"` — arrête un backend d'extension en cours d'exécution |

`extension.open` / `extension.split` génèrent un nouvel id de surface préfixé par `ext:`, démarrent le backend de l'extension (et le serveur de dev Vite, en mode dev), et montent son iframe.

## Création

| Méthode | Params | Résultat |
|---|---|---|
| `extension.new` | `{ id: string, template: string, name?: string }` | `{ id, path }` |
| `extension.install` | `{ path: string }` | `{ id, path }` |
| `extension.remove` | `{ id: string }` | `"OK"` |

`extension.new` clone un template embarqué (voir `extension.templates`) dans `<config>/extensions/<id>/` et réécrit l'id de son manifeste. `extension.install` copie un répertoire externe contenant un `manifest.json` valide. `extension.remove` arrête toute surface en cours d'exécution, puis supprime le dossier.

## Notes

- Toutes les méthodes nécessitent qu'un `ExtensionManager` soit câblé ; dans les processus qui n'en ont pas (certaines fixtures de test), elles lèvent `extensions are not available`.
- Les extensions sont **entièrement de confiance** — les `permissions` du manifeste sont indicatives. Le jeton de la socket RPC (s'il est activé) protège toujours la socket, donc seuls les clients légitimement connectés peuvent les appeler. Voir le [modèle de confiance](/fr/features/extensions/#modèle-de-confiance).
