---
title: Vue d'ensemble JSON-RPC
description: Comment dialoguer avec τ-mux via le socket Unix — encadrage, erreurs, index des méthodes.
sidebar:
  order: 1
---

τ-mux expose une API JSON-RPC sur `/tmp/hyperterm.sock` (substituable via `HT_SOCKET_PATH`). Le même ensemble de gestionnaires est disponible via Electrobun RPC (utilisé par le webview) et le [miroir web](/fr/features/web-mirror/) WebSocket.

## Connexion

Le socket est un simple socket de domaine Unix. Parlez en JSON délimité par des sauts de ligne.

```bash
echo '{"id":"1","method":"system.ping","params":{}}' | nc -U /tmp/hyperterm.sock
# {"id":"1","result":"PONG"}
```

Ou en code :

```ts
import { connect } from "node:net";

const s = connect("/tmp/hyperterm.sock");
s.write(JSON.stringify({ id: "1", method: "system.ping", params: {} }) + "\n");
s.on("data", (buf) => console.log(buf.toString()));
```

## Forme de la requête

```json
{ "id": "<your-id>", "method": "domain.method", "params": { … } }
```

- `id` — string. Renvoyé dans la réponse. Utilisez n'importe quelle valeur unique par requête.
- `method` — `"<domain>.<name>"` (`system.ping`, `surface.split`, `browser.click`, …).
- `params` — object. Les paramètres requis par méthode sont documentés sur chaque page de domaine.

## Forme de la réponse

Succès :

```json
{ "id": "<your-id>", "result": <any> }
```

Erreur :

```json
{ "id": "<your-id>", "error": "human-readable message" }
```

Contrairement à JSON-RPC 2.0 standard, les erreurs sont de simples chaînes plutôt que des objets `{code, message, data}`. L'`id` est toujours renvoyé.

## Événements en streaming

Certaines méthodes sont des **flux** plutôt que des appels à réponse unique — `surface.metadata` (changements de métadonnées en direct), `browser.console_list` avec `--follow`, etc. Le streaming s'active explicitement par méthode.

En mode streaming, le serveur émet de manière répétée des trames `{"id":"<your-id>","event":<payload>}` jusqu'à ce que le client ferme le socket ou envoie un appel `"<method>.cancel"`. Voir [Protocole miroir web v2](/fr/web-mirror/protocol-v2/) pour l'encadrage utilisé sur WebSocket.

## Index des méthodes

| Domaine | Méthodes |
|---|---|
| [system](/fr/api/system/) | ping, version, identify, capabilities, tree |
| [workspace](/fr/api/workspace/) | list, current, create, select, close, rename, next, previous |
| [surface](/fr/api/surface/) | list, split, close, focus, send_text, send_key, read_text, metadata, open_port, kill_port, kill_pid, screenshot |
| [sidebar](/fr/api/sidebar/) | set_status, clear_status, set_progress, clear_progress, log |
| [pane](/fr/api/pane/) | list |
| [notification](/fr/api/notification/) | create, list, clear, dismiss |
| [browser](/fr/api/browser/) | open, navigate, click, fill, wait, snapshot, eval, console_list, errors_list, history, … (40+) |
| [telegram](/fr/api/telegram/) | list_chats, read, send, status, settings |
| [agent](/fr/api/agent/) | ask_user, ask_pending, ask_answer, ask_cancel |

## Découvrabilité

De manière programmatique :

```bash
ht capabilities --json
```

Retourne le catalogue complet des méthodes avec leur forme de paramètres. Utile pour les intégrations d'agent qui doivent s'adapter à la version de τ-mux à laquelle elles sont attachées.

## Validation

Chaque méthode valide `params` par rapport à un schéma (`METHOD_SCHEMAS` dans `src/bun/rpc-handlers/shared.ts`) avant la répartition. Les erreurs émergent sous la forme `{"id", "error": "param X is required"}`.

## Fichiers sources

- `src/bun/socket-server.ts` — serveur de socket Unix, encadrage.
- `src/bun/rpc-handler.ts` — répartiteur fusionnant les gestionnaires par domaine.
- `src/bun/rpc-handlers/` — modules de gestionnaires par domaine.
- `src/bun/rpc-handlers/shared.ts` — `METHOD_SCHEMAS`, `validateParams`.
- `src/shared/types.ts` — type de contrat `TauMuxRPC`.
