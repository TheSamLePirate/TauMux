---
title: editor.*
description: open, split, list, save, reload, close — panneaux éditeur CodeMirror.
---

Les panneaux éditeur sont une surface non-PTY (ids `editor:`). Voir
[explorateur & éditeur](/fr/features/file-explorer-and-editor/) et le
[CLI `ht edit` / `ht editor`](/fr/cli/surfaces-and-io/).

| Méthode | Params | Résultat |
|---|---|---|
| `editor.open` | `{ path?, cwd?, create?, split?, direction? }` | `"OK"` |
| `editor.split` | `{ path?, cwd?, create?, direction? }` | `"OK"` |
| `editor.list` | `{}` | `{ editors: string[] }` — ids des panneaux éditeur de l'espace actif |
| `editor.save` | `{ surface_id? }` | `"OK"` |
| `editor.reload` | `{ surface_id? }` | `"OK"` |
| `editor.close` | `{ surface_id? }` | `"OK"` |

**Params**

- `path` — fichier à ouvrir. Omis : buffer vide.
- `cwd` — dossier de base pour résoudre un `path` relatif.
- `create` — crée le fichier s'il n'existe pas (`true` ou `"true"`).
- `split` (`editor.open` seulement) — ouvre à côté du panneau focalisé.
- `direction` — `"right"` / `"horizontal"` (défaut) ou `"down"` / `"vertical"`.
- `surface_id` — panneau ciblé (aussi accepté : `surfaceId`, `id`). Par défaut
  la surface focalisée ; l'appel échoue si l'id résolu n'est pas un éditeur.

La sauvegarde est aussi liée à `⌘S` dans le panneau ; `editor.save` en est
l'équivalent scriptable.
